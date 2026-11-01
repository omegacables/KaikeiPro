"use server";

/**
 * 固定資産台帳と減価償却。計算は src/lib/depreciation.ts（テストあり）。
 *
 *   - 資産ごと・事業年度ごとの償却限度額（普通償却・特別償却）、計上額、償却超過額
 *   - 計上額の指定（法人の任意償却）は fixed_asset_depreciations に is_manual=true で残す
 *   - 減価償却の仕訳を作ると、その期の計上額と仕訳を fixed_asset_depreciations に残す
 *   - 売却・除却の仕訳（src/lib/asset-disposal.ts）には手放した月までの当期の償却費も入れ、
 *     fixed_asset_depreciations に journal_entry_id = 売却・除却の仕訳 で残す（期末の減価償却の仕訳には入れない）
 */

import { createServerSupabaseClient } from "@/lib/supabase";
import { assertClientAccess } from "@/lib/authz";
import {
  resolveFiscalPeriodByKey,
  adjacentFiscalPeriodKeys,
  currentFiscalStartYear,
  fiscalPeriodsUpTo,
  fiscalPeriodContaining,
  type FiscalPeriodRow,
} from "@/lib/fiscal";
import {
  planDisposal,
  DISPOSAL_ACCOUNT_NAMES,
  SALE_TAX_CATEGORIES,
  type DisposalRole,
  type DisposalType,
} from "@/lib/asset-disposal";
import { taxCategoryInfo, type TaxCategoryCode } from "@/lib/tax-category";
import {
  buildDepreciationSchedule,
  depreciationKind,
  rateInfo,
  straightLineOnlyReason,
  KIND_LABELS,
  MIN_USEFUL_LIFE,
  MAX_USEFUL_LIFE,
  type DepreciationKind,
  type DepreciationMethod,
  type DepreciationRounding,
  type ScheduleRow,
} from "@/lib/depreciation";
import { specialMeasure } from "@/lib/special-measures";
import { deleteJournalEntries } from "@/actions/journals";
import type { Database } from "@/types/database";

type AssetRow = Database["public"]["Tables"]["fixed_assets"]["Row"];
type Db = Awaited<ReturnType<typeof createServerSupabaseClient>>;

/** 償却する固定資産の科目（土地・減価償却累計額は除く） */
const FIXED_ASSET_ACCOUNT = /建物|構築物|機械|装置|車両|運搬具|器具|備品|工具|ソフトウェア|一括償却資産|リース資産|船舶|航空機|特許権|商標権|営業権|のれん|無形固定資産|有形固定資産/;
const EXPENSE_ACCOUNT = "減価償却費";
const ACCUMULATED_ACCOUNT = "減価償却累計額";

/** 帳簿閲覧の固定資産タブなど、一覧だけ欲しいとき */
export async function getAssets(clientId: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("fixed_assets")
    .select("*")
    .eq("client_id", clientId)
    .is("disposed_at", null)
    .order("acquisition_date", { ascending: false });

  if (error) throw new Error(error.message);
  return data as AssetRow[];
}

// ---------------------------------------------------------------------------
// 台帳（期ごとの計算）
// ---------------------------------------------------------------------------

export type DepreciationAsset = {
  id: string;
  name: string;
  accountId: string | null;
  accountName: string;
  acquisitionDate: string;
  serviceStartDate: string;
  acquisitionCost: number;
  usefulLife: number;
  method: DepreciationMethod;
  kind: DepreciationKind;
  kindLabel: string;
  rate: { rate: number; revised: number | null; guarantee: number | null } | null;
  specialRate: number | null;
  specialNote: string | null;
  /** 使う租税特別措置の区分番号（src/lib/special-measures.ts）と、特別償却か税額控除か */
  specialMeasureCode: string | null;
  specialTreatment: "depreciation" | "tax_credit" | null;
  /** 事業専用割合（%）。個人事業主の家事と共用の資産は、減価償却費のうちこの割合だけを経費にする */
  businessRatio: number;
  note: string | null;
  /** 中古で取得した資産（耐用年数の簡便法の入力。経過年数は月数） */
  isUsed: boolean;
  usedStatutoryLife: number | null;
  usedElapsedMonths: number | null;
  /** 手放した日（売却・除却） */
  disposedAt: string | null;
  /** 売却・除却の中身。type が null は種類を記録していない以前の登録。journal が null は日付だけの記録 */
  disposal: {
    type: DisposalType | null;
    salePrice: number | null;
    saleAccountName: string | null;
    saleTaxCategory: string | null;
    journal: { entryId: string; date: string } | null;
  } | null;
  /** 選んだ期の償却費を売却・除却の仕訳に入れたか（期末の減価償却の仕訳には入れない） */
  depreciationInDisposal: boolean;
  /** 選んだ期の計算（その期に償却しない資産は null） */
  current: ScheduleRow | null;
  /** 期末の帳簿価額（選んだ期の期末時点） */
  closingBook: number;
  /** 使い始めた期から、償却し終わるまで（選んだ期の後は見込み） */
  schedule: ScheduleRow[];
  /** 確かめてほしいこと */
  warnings: string[];
};

export type DepreciationBook = {
  period: { startDate: string; endDate: string; key: string; prevKey: string; nextKey: string };
  entityType: "individual" | "corporation" | null;
  rounding: DepreciationRounding;
  entryMethod: "direct" | "indirect";
  assets: DepreciationAsset[];
  totals: {
    cost: number;
    openingBook: number;
    /** 償却限度額（普通＋特別）と、その内訳 */
    limit: number;
    ordinaryLimit: number;
    specialLimit: number;
    /** 翌期へ繰り越す特別償却不足額 */
    specialShortfall: number;
    booked: number;
    excess: number;
    allowed: number;
    closingBook: number;
    /** 計上額のうち、売却・除却の仕訳に入れた分 */
    inDisposal: number;
    /** 期末の減価償却の仕訳で計上する額（計上額 − 売却・除却の仕訳に入れた分） */
    toPost: number;
  };
  /** この期に作った減価償却の仕訳（売却・除却の仕訳は含めない） */
  journal: { entryIds: string[]; date: string; amount: number } | null;
  /** 選べる固定資産の科目 */
  assetAccounts: { id: string; code: string; name: string }[];
  /** 売却代金の入金先に選べる科目（預金・未収入金・未払金など。固定資産と消費税の科目は除く） */
  receiptAccounts: { id: string; code: string; name: string }[];
  /** 仕訳に要るのに見つからない科目 */
  missingAccounts: string[];
};

type Context = {
  db: Db;
  sm: number | null;
  rows: FiscalPeriodRow[];
  entityType: "individual" | "corporation" | null;
  rounding: DepreciationRounding;
  entryMethod: "direct" | "indirect";
};

async function loadContext(clientId: string): Promise<Context> {
  const db = await createServerSupabaseClient();
  const [{ data: client, error }, { data: fyRows }] = await Promise.all([
    db
      .from("clients")
      .select("fiscal_year_start_month, entity_type, depreciation_rounding, depreciation_entry_method")
      .eq("id", clientId)
      .single(),
    db.from("fiscal_years").select("start_date, end_date").eq("client_id", clientId),
  ]);
  if (error || !client) throw new Error(error?.message ?? "顧問先が見つかりません");
  return {
    db,
    sm: (client.fiscal_year_start_month as number | null) ?? null,
    rows: (fyRows ?? []) as FiscalPeriodRow[],
    entityType: (client.entity_type as Context["entityType"]) ?? null,
    rounding: ((client.depreciation_rounding as DepreciationRounding) ?? "floor") as DepreciationRounding,
    entryMethod: ((client.depreciation_entry_method as "direct" | "indirect") ?? "direct") as "direct" | "indirect",
  };
}

async function loadAccounts(db: Db, clientId: string) {
  const { data } = await db
    .from("accounts")
    .select("id, code, name, client_id, account_categories!inner ( type )")
    .or(`client_id.eq.${clientId},client_id.is.null`)
    .eq("is_active", true)
    .order("code");
  type A = { id: string; code: string; name: string; client_id: string | null; account_categories: { type: string } | { type: string }[] };
  const all = ((data ?? []) as unknown as A[]).map((a) => ({
    id: a.id,
    code: a.code,
    name: a.name,
    clientOwned: Boolean(a.client_id),
    type: Array.isArray(a.account_categories) ? a.account_categories[0]?.type : a.account_categories?.type,
  }));
  // 顧問先の科目を共有の基本科目より優先する
  const byName = (name: string) =>
    all.filter((a) => a.name === name).sort((a, b) => Number(b.clientOwned) - Number(a.clientOwned))[0] ?? null;
  const assetAccounts = all
    .filter((a) => a.type === "assets" && FIXED_ASSET_ACCOUNT.test(a.name) && a.name !== ACCUMULATED_ACCOUNT)
    .map(({ id, code, name }) => ({ id, code, name }));
  // 売却代金の入金先（下取りで未払金と相殺することもあるので負債も選べる）
  const receiptAccounts = all
    .filter(
      (a) =>
        (a.type === "assets" || a.type === "liabilities") &&
        !FIXED_ASSET_ACCOUNT.test(a.name) &&
        a.name !== ACCUMULATED_ACCOUNT &&
        !/消費税/.test(a.name)
    )
    .map(({ id, code, name }) => ({ id, code, name }));
  return { all, byName, assetAccounts, receiptAccounts };
}

const addDays = (iso: string, days: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
};

async function computeBook(clientId: string, periodKey?: string): Promise<DepreciationBook & { ctx: Context }> {
  const ctx = await loadContext(clientId);
  const { db, sm, rows } = ctx;
  const p = resolveFiscalPeriodByKey(rows, sm, periodKey ?? String(currentFiscalStartYear(sm)));
  const adj = adjacentFiscalPeriodKeys(rows, p);

  const [{ data: assetRows, error }, { data: depRows }, accounts] = await Promise.all([
    db.from("fixed_assets").select("*").eq("client_id", clientId).order("acquisition_date"),
    db
      .from("fixed_asset_depreciations")
      .select("asset_id, period_start, booked_amount, is_manual, journal_entry_id")
      .eq("client_id", clientId),
    loadAccounts(db, clientId),
  ]);
  if (error) throw new Error(error.message);

  const allAssets = (assetRows ?? []) as AssetRow[];
  // 選んだ期より前に手放した資産は出さない。ただし一括償却資産は除却しても3年で償却し続けるので、
  // 償却が残っている間は出す（下で current が無ければ外す）
  const assets = allAssets.filter(
    (a) =>
      !a.disposed_at ||
      a.disposed_at >= p.startDate ||
      depreciationKind(a.depreciation_method as DepreciationMethod, a.acquisition_date) === "lump"
  );
  const accountName = new Map(accounts.all.map((a) => [a.id, a.name]));

  // 計上額が決まっている期（任意償却で指定した、または仕訳を作った）
  type Dep = { asset_id: string; period_start: string; booked_amount: number; is_manual: boolean; journal_entry_id: string | null };
  // 売却・除却の仕訳は、期末の減価償却の仕訳として数えない（手放した月までの償却費が入っているだけ）
  const disposalEntryOf = new Map(allAssets.filter((a) => a.disposal_journal_entry_id).map((a) => [a.id, a.disposal_journal_entry_id!]));
  const disposalEntryIds = new Set(disposalEntryOf.values());
  const fixedBy = new Map<string, Record<string, number>>();
  const journalIds = new Set<string>();
  /** 選んだ期の償却費を売却・除却の仕訳に入れた資産 */
  const inDisposal = new Set<string>();
  for (const d of (depRows ?? []) as Dep[]) {
    if (!d.is_manual && !d.journal_entry_id) continue;
    const m = fixedBy.get(d.asset_id) ?? {};
    m[d.period_start] = Number(d.booked_amount);
    fixedBy.set(d.asset_id, m);
    if (d.journal_entry_id && d.period_start === p.startDate) {
      if (disposalEntryIds.has(d.journal_entry_id)) {
        if (disposalEntryOf.get(d.asset_id) === d.journal_entry_id) inDisposal.add(d.asset_id);
      } else journalIds.add(d.journal_entry_id);
    }
  }

  // 期の一覧: いちばん早く使い始めた資産の期から、選んだ期まで。その後は償却し終わるまでの見込み
  const earliest = assets.reduce<string | null>((min, a) => {
    const s = a.service_start_date || a.acquisition_date;
    return !min || s < min ? s : min;
  }, null);
  const past = earliest ? fiscalPeriodsUpTo(rows, sm, p, earliest) : [];
  const future: { startDate: string; endDate: string }[] = [];
  let last: { startDate: string; endDate: string } = p;
  const maxLife = assets.reduce((m, a) => Math.max(m, a.useful_life), 0);
  for (let i = 0; i < maxLife + 1; i++) {
    const next = resolveFiscalPeriodByKey(rows, sm, addDays(last.endDate, 1));
    future.push(next);
    last = next;
  }
  const periods = [...past, ...future].map((x) => ({ start: x.startDate, end: x.endDate }));

  const list: DepreciationAsset[] = assets.map((a) => {
    const method = a.depreciation_method as DepreciationMethod;
    const kind = depreciationKind(method, a.acquisition_date);
    const serviceStart = a.service_start_date || a.acquisition_date;
    const schedule = buildDepreciationSchedule(
      {
        acquisitionDate: a.acquisition_date,
        serviceStartDate: serviceStart,
        acquisitionCost: Number(a.acquisition_cost),
        usefulLife: a.useful_life,
        method,
        // 税額控除を選んだ資産は特別償却をしない（どちらか一方）
        specialRate: a.special_treatment === "tax_credit" ? null : a.special_depreciation_rate,
        disposedAt: a.disposed_at,
      },
      periods,
      fixedBy.get(a.id) ?? {},
      ctx.rounding
    ).filter((r) => r.start <= p.startDate || r.openingBook > 1); // 償却し終わった後の見込みは出さない
    const current = schedule.find((r) => r.start === p.startDate) ?? null;
    const before = schedule.filter((r) => r.end < p.startDate);
    const closingBook = current?.closingBook ?? (before.length ? before[before.length - 1].closingBook : Number(a.acquisition_cost));
    const acctName = (a.account_id && accountName.get(a.account_id)) || a.category || "";

    const warnings: string[] = [];
    if (kind === "unsupported")
      warnings.push("2007年3月以前の取得のため、旧定額法・旧定率法の計上額を「当期の計上額」に入力してください");
    if (a.useful_life < MIN_USEFUL_LIFE || a.useful_life > MAX_USEFUL_LIFE)
      warnings.push(`耐用年数は${MIN_USEFUL_LIFE}〜${MAX_USEFUL_LIFE}年で入力してください`);
    const slOnly = method === "declining_balance" ? straightLineOnlyReason(acctName, a.acquisition_date) : null;
    if (slOnly) warnings.push(slOnly);
    if (ctx.entityType === "individual" && current?.overridden && current.limit !== null && current.booked !== current.limit)
      warnings.push("個人事業主は償却限度額どおりに計上します（任意償却はできません）");
    if (current && current.excess > 0) warnings.push("償却限度額を超えています。超えた分は損金になりません（償却超過額）");
    if (kind === "lump" && Number(a.acquisition_cost) >= 200_000)
      warnings.push("一括償却資産にできるのは、取得価額が20万円未満の資産です");
    if (kind === "immediate" && Number(a.acquisition_cost) >= 300_000)
      warnings.push("少額減価償却資産にできるのは、取得価額が30万円未満の資産です");
    if (kind === "immediate")
      warnings.push("少額減価償却資産の特例は、中小企業者等（青色申告）だけが使えます。別表十六(七)の添付が必要です");
    if (current && current.specialShortfall > 0)
      warnings.push(`特別償却不足額 ${current.specialShortfall.toLocaleString()}円を翌期へ繰り越します（翌期の償却限度額に上乗せされます）`);

    return {
      id: a.id,
      name: a.name,
      accountId: a.account_id,
      accountName: acctName,
      acquisitionDate: a.acquisition_date,
      serviceStartDate: serviceStart,
      acquisitionCost: Number(a.acquisition_cost),
      usefulLife: a.useful_life,
      method,
      kind,
      kindLabel: KIND_LABELS[kind],
      rate: rateInfo(a.useful_life, kind),
      specialRate: a.special_treatment === "tax_credit" ? null : a.special_depreciation_rate,
      specialNote: a.special_depreciation_note,
      specialMeasureCode: a.special_measure_code ?? null,
      specialTreatment: a.special_treatment ?? null,
      businessRatio: Number(a.business_ratio ?? 100),
      note: a.note,
      isUsed: Boolean(a.is_used),
      usedStatutoryLife: a.used_statutory_life ?? null,
      usedElapsedMonths: a.used_elapsed_months ?? null,
      disposedAt: a.disposed_at,
      disposal: a.disposed_at
        ? {
            type: a.disposal_type ?? null,
            salePrice: a.sale_price == null ? null : Number(a.sale_price),
            saleAccountName: (a.sale_account_id && accountName.get(a.sale_account_id)) || null,
            saleTaxCategory: a.sale_tax_category ?? null,
            journal: a.disposal_journal_entry_id ? { entryId: a.disposal_journal_entry_id, date: a.disposed_at } : null,
          }
        : null,
      depreciationInDisposal: inDisposal.has(a.id),
      current,
      closingBook,
      schedule,
      warnings,
    };
  }).filter(
    // 前の期に除却した一括償却資産は、償却が残っている間だけ出す（償却し終わった後も 0円の行が続くため、期首の残りで見る）
    (a) => !(a.disposedAt && a.disposedAt < p.startDate && !(a.current && a.current.openingBook > 0))
  );

  const sum = (f: (a: DepreciationAsset) => number) => list.reduce((s, a) => s + f(a), 0);
  const totals = {
    cost: sum((a) => a.acquisitionCost),
    openingBook: sum((a) => a.current?.openingBook ?? a.closingBook),
    limit: sum((a) => a.current?.limit ?? 0),
    ordinaryLimit: sum((a) => a.current?.ordinaryLimit ?? 0),
    specialLimit: sum((a) => a.current?.specialLimit ?? 0),
    specialShortfall: sum((a) => a.current?.specialShortfall ?? 0),
    booked: sum((a) => a.current?.booked ?? 0),
    excess: sum((a) => a.current?.excess ?? 0),
    allowed: sum((a) => a.current?.allowed ?? 0),
    closingBook: sum((a) => a.closingBook),
    inDisposal: sum((a) => (a.depreciationInDisposal ? a.current?.booked ?? 0 : 0)),
    toPost: 0,
  };
  totals.toPost = totals.booked - totals.inDisposal;

  let journal: DepreciationBook["journal"] = null;
  if (journalIds.size > 0) {
    const ids = [...journalIds];
    const { data: entries } = await db
      .from("journal_entries")
      .select("id, entry_date, journal_entry_lines ( debit_amount )")
      .in("id", ids);
    type E = { id: string; entry_date: string; journal_entry_lines: { debit_amount: number }[] };
    const es = (entries ?? []) as unknown as E[];
    if (es.length) {
      journal = {
        entryIds: es.map((e) => e.id),
        date: es[0].entry_date,
        amount: es.reduce((s, e) => s + e.journal_entry_lines.reduce((t, l) => t + Number(l.debit_amount || 0), 0), 0),
      };
    }
  }

  // 少額減価償却資産は、その期に使い始めた分の合計が年300万円（月割り）まで
  const immediateTotal = list
    .filter((a) => a.kind === "immediate" && a.current && a.current.booked > 0)
    .reduce((s, a) => s + a.acquisitionCost, 0);
  const months = (() => {
    const [ys, ms] = p.startDate.split("-").map(Number);
    const [ye, me] = p.endDate.split("-").map(Number);
    return ye * 12 + me - (ys * 12 + ms) + 1;
  })();
  const immediateLimit = Math.floor((3_000_000 * months) / 12);
  if (immediateTotal > immediateLimit) {
    for (const a of list.filter((x) => x.kind === "immediate" && x.current && x.current.booked > 0))
      a.warnings.push(
        `この期の少額減価償却資産の合計 ${immediateTotal.toLocaleString()}円が、限度額 ${immediateLimit.toLocaleString()}円（年300万円の月割り）を超えています。超える分は通常の減価償却にしてください`
      );
  }

  const missingAccounts: string[] = [];
  if (!accounts.byName(EXPENSE_ACCOUNT)) missingAccounts.push(EXPENSE_ACCOUNT);
  if (ctx.entryMethod === "indirect" && !accounts.byName(ACCUMULATED_ACCOUNT)) missingAccounts.push(ACCUMULATED_ACCOUNT);

  return {
    ctx,
    period: { startDate: p.startDate, endDate: p.endDate, key: p.startDate, prevKey: adj.prevKey, nextKey: adj.nextKey },
    entityType: ctx.entityType,
    rounding: ctx.rounding,
    entryMethod: ctx.entryMethod,
    assets: list,
    totals,
    journal,
    assetAccounts: accounts.assetAccounts,
    receiptAccounts: accounts.receiptAccounts,
    missingAccounts,
  };
}

/** 固定資産台帳（選んだ期の減価償却） */
export async function getDepreciationBook(clientId: string, periodKey?: string): Promise<DepreciationBook> {
  await assertClientAccess(clientId);
  const { ctx, ...book } = await computeBook(clientId, periodKey);
  return book;
}

// ---------------------------------------------------------------------------
// 決算の概算（決算整理・チェックリスト）
// ---------------------------------------------------------------------------

export interface DepreciationItem {
  category: string;
  amount: number;
  count: number;
}

export interface DepreciationSummary {
  totalAssets: number;
  totalDepreciation: number;
  items: DepreciationItem[];
}

/** 期末日で指定した事業年度の、科目ごとの償却額 */
export async function getDepreciationSummary(clientId: string, fiscalYearEndDate: string): Promise<DepreciationSummary> {
  await assertClientAccess(clientId);
  const ctx = await loadContext(clientId);
  // 記録された期（変則期間を含む）を優先し、無ければ12ヶ月の期とみなす
  const row = ctx.rows.find((r) => r.end_date === fiscalYearEndDate);
  const book = await computeBook(clientId, row ? row.start_date : addDays(addMonthsIso(fiscalYearEndDate, -12), 1));
  const byCat = new Map<string, { amount: number; count: number }>();
  for (const a of book.assets) {
    if (!a.current) continue;
    const cat = a.accountName || "その他";
    const e = byCat.get(cat) ?? { amount: 0, count: 0 };
    e.amount += a.current.booked;
    e.count += 1;
    byCat.set(cat, e);
  }
  return {
    totalAssets: book.assets.filter((a) => a.current).length,
    totalDepreciation: book.totals.booked,
    items: [...byCat].map(([category, v]) => ({ category, ...v })),
  };
}

function addMonthsIso(iso: string, months: number) {
  const [y, m, d] = iso.split("-").map(Number);
  // 月末をまたいでも月がずれないよう、その月の日数で丸める
  const last = new Date(y, m - 1 + months + 1, 0).getDate();
  const dt = new Date(y, m - 1 + months, Math.min(d, last));
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// 資産の登録・修正
// ---------------------------------------------------------------------------

export type AssetInput = {
  name: string;
  accountId: string;
  acquisitionDate: string;
  serviceStartDate?: string | null;
  acquisitionCost: number;
  usefulLife: number;
  method: DepreciationMethod;
  /** 特別償却率（%）。使わないなら null */
  specialRatePercent?: number | null;
  specialNote?: string | null;
  /** 租税特別措置の区分番号（一覧に無い制度は null で、制度名を specialNote に） */
  specialMeasureCode?: string | null;
  specialTreatment?: "depreciation" | "tax_credit" | null;
  /** 事業専用割合（%）。個人事業主だけ。無ければ100 */
  businessRatio?: number | null;
  note?: string | null;
  /** 中古で取得したか。簡便法で耐用年数を出したときの法定耐用年数と経過月数を残す */
  isUsed?: boolean;
  usedStatutoryLife?: number | null;
  usedElapsedMonths?: number | null;
};

function validateAsset(input: AssetInput) {
  if (!input.name.trim()) throw new Error("資産名を入力してください");
  if (!input.accountId) throw new Error("勘定科目を選んでください");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.acquisitionDate)) throw new Error("取得日を入力してください");
  if (input.serviceStartDate && input.serviceStartDate < input.acquisitionDate)
    throw new Error("事業に使い始めた日は、取得日より後にしてください");
  if (!(input.acquisitionCost > 0)) throw new Error("取得価額を入力してください");
  if (!Number.isInteger(input.usefulLife) || input.usefulLife < MIN_USEFUL_LIFE || input.usefulLife > MAX_USEFUL_LIFE)
    throw new Error(`耐用年数は${MIN_USEFUL_LIFE}〜${MAX_USEFUL_LIFE}年で入力してください`);
  if (!["straight_line", "declining_balance", "lump_sum", "small_immediate"].includes(input.method))
    throw new Error("償却方法を選んでください");
  const sr = input.specialRatePercent;
  if (sr != null && !(sr > 0 && sr <= 100)) throw new Error("特別償却率は0より大きく100%以下で入力してください");
  if (input.specialMeasureCode && !specialMeasure(input.specialMeasureCode)) throw new Error("特別償却の制度を選び直してください");
  const br = input.businessRatio;
  if (br != null && !(br > 0 && br <= 100)) throw new Error("事業専用割合は0より大きく100%以下で入力してください");
  if (input.specialMeasureCode && input.specialTreatment !== "tax_credit" && !sr)
    throw new Error("特別償却率を入力してください");
  if (input.isUsed) {
    const life = input.usedStatutoryLife;
    const months = input.usedElapsedMonths;
    if (life != null && !(Number.isInteger(life) && life >= 1 && life <= 100))
      throw new Error("中古資産の法定耐用年数は1〜100年で入力してください");
    if (months != null && !(Number.isInteger(months) && months >= 0)) throw new Error("中古資産の経過年数を正しく入力してください");
  }
}

export async function saveAsset(clientId: string, input: AssetInput, assetId?: string): Promise<void> {
  await assertClientAccess(clientId);
  validateAsset(input);
  const db = await createServerSupabaseClient();
  if (assetId) {
    // 売却・除却の仕訳は、取得価額・耐用年数などから計算した額で作っている。変えると仕訳と台帳が食い違う
    const { data: cur } = await db.from("fixed_assets").select("disposal_journal_entry_id").eq("id", assetId).eq("client_id", clientId).maybeSingle();
    if (cur?.disposal_journal_entry_id)
      throw new Error("売却・除却の仕訳を作った資産は編集できません。直すときは先に売却・除却を取り消してください");
  }
  const { data: account } = await db.from("accounts").select("id, name").eq("id", input.accountId).maybeSingle();
  if (!account) throw new Error("勘定科目が見つかりません");
  const row = {
    name: input.name.trim(),
    account_id: input.accountId,
    category: account.name as string,
    acquisition_date: input.acquisitionDate,
    service_start_date: input.serviceStartDate || null,
    acquisition_cost: Math.round(input.acquisitionCost),
    useful_life: input.usefulLife,
    depreciation_method: input.method,
    // 2007年4月以後の取得は残存価額なし（1円まで償却）
    salvage_value: 0,
    special_depreciation_rate: input.specialRatePercent ? input.specialRatePercent / 100 : null,
    special_depreciation_note: input.specialRatePercent || input.specialMeasureCode ? input.specialNote?.trim() || null : null,
    special_measure_code: input.specialMeasureCode || null,
    special_treatment: input.specialMeasureCode || input.specialRatePercent ? input.specialTreatment ?? "depreciation" : null,
    business_ratio: input.businessRatio ?? 100,
    note: input.note?.trim() || null,
    is_used: Boolean(input.isUsed),
    used_statutory_life: input.isUsed ? input.usedStatutoryLife ?? null : null,
    used_elapsed_months: input.isUsed ? input.usedElapsedMonths ?? null : null,
  };
  const { error } = assetId
    ? await db.from("fixed_assets").update(row).eq("id", assetId).eq("client_id", clientId)
    : await db.from("fixed_assets").insert({ ...row, client_id: clientId });
  if (error) throw new Error(error.message);
}

/** 資産を削除する（減価償却・売却・除却の仕訳を作った資産は消せない） */
export async function deleteAsset(clientId: string, assetId: string): Promise<void> {
  await assertClientAccess(clientId);
  const db = await createServerSupabaseClient();
  const { data: cur } = await db.from("fixed_assets").select("disposal_journal_entry_id").eq("id", assetId).eq("client_id", clientId).maybeSingle();
  if (cur?.disposal_journal_entry_id) throw new Error("売却・除却の仕訳を作った資産は削除できません。先に売却・除却を取り消してください");
  const { count } = await db
    .from("fixed_asset_depreciations")
    .select("id", { count: "exact", head: true })
    .eq("asset_id", assetId)
    .not("journal_entry_id", "is", null);
  if ((count ?? 0) > 0) throw new Error("減価償却の仕訳を作った資産は削除できません。売却・除却として登録してください");
  const { error } = await db.from("fixed_assets").delete().eq("id", assetId).eq("client_id", clientId);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// 売却・除却
// ---------------------------------------------------------------------------

export type DisposalRequest = {
  type: DisposalType;
  /** 手放した日 */
  date: string;
  /** 売却代金（税込） */
  salePrice?: number | null;
  /** 売却代金の入金先の科目 */
  saleAccountId?: string | null;
  saleTaxCategory?: TaxCategoryCode | null;
  /** 税抜経理か。省略すると、仕訳（仮受消費税の有無）から判断する */
  exclusive?: boolean | null;
};

export type DisposalPreview = {
  type: DisposalType;
  date: string;
  /** 手放した日が入る事業年度 */
  period: { startDate: string; endDate: string };
  /** 仕訳を作るか、日付だけを記録するか */
  mode: "journal" | "record_only";
  /** 日付だけを記録する理由 */
  reason: string | null;
  lines: { accountName: string; debit: number; credit: number; taxCategoryName: string | null; note: string }[];
  /** 手放した期に使っていた月数（期首から手放した月まで） */
  months: number;
  /** 手放した期の期首の帳簿価額 */
  openingBook: number;
  /** 期首から手放した月までの償却費 */
  depreciation: number;
  /** 償却費をこの仕訳に入れるか（期末の減価償却の仕訳を作成済みなら、そちらに入っている） */
  depreciationIncluded: boolean;
  /** 手放しても償却を続ける資産か（一括償却資産）。償却費・帳簿価額はこの仕訳で扱わない */
  continuesAmortization: boolean;
  /** 手放した時点の帳簿価額 */
  bookValue: number;
  salePrice: number;
  tax: number;
  gain: number;
  loss: number;
  retireLoss: number;
  exclusive: boolean;
  /** 税込経理・税抜経理をどう決めたか */
  exclusiveNote: string;
  taxExempt: boolean;
  missingAccounts: string[];
  /** 知っておいてほしいこと */
  notes: string[];
  /** 確かめてほしいこと */
  warnings: string[];
};

const OUTPUT_TAX_ACCOUNT = "仮受消費税";

/** 売却・除却の記録を消して、手放す前に戻す値 */
const CLEAR_DISPOSAL = {
  disposed_at: null,
  disposal_type: null,
  sale_price: null,
  sale_account_id: null,
  sale_tax_category: null,
  disposal_journal_entry_id: null,
};

async function assertDateOpen(db: Db, clientId: string, date: string, message: string) {
  const { data: locked } = await db
    .from("fiscal_years")
    .select("id")
    .eq("client_id", clientId)
    .eq("status", "locked")
    .lte("start_date", date)
    .gte("end_date", date)
    .limit(1);
  if (locked && locked.length) throw new Error(message);
}

/**
 * 税抜経理か。仮受消費税の仕訳があれば税抜経理とみなす（貸倒れの画面と同じ考え方）。
 * 期首に近い日付ではその期の仕訳がまだ無いことがあるので、その期に無ければこれまでの仕訳で判断する。
 * 画面では、ここで決めた方を選んだ状態で見せ、選び直せるようにする。
 */
async function detectExclusive(db: Db, clientId: string, period: { startDate: string; endDate: string }) {
  const base = () =>
    db
      .from("journal_entry_lines")
      .select("id, accounts!inner ( name ), journal_entries!inner ( client_id, entry_date )", { count: "exact", head: true })
      .eq("journal_entries.client_id", clientId)
      .eq("accounts.name", OUTPUT_TAX_ACCOUNT);
  const { count: inPeriod } = await base()
    .gte("journal_entries.entry_date", period.startDate)
    .lte("journal_entries.entry_date", period.endDate);
  if ((inPeriod ?? 0) > 0) return { exclusive: true, note: "この期に仮受消費税の仕訳があるため、税抜経理にしています。" };
  const { count: ever } = await base();
  if ((ever ?? 0) > 0) return { exclusive: true, note: "これまでに仮受消費税の仕訳があるため、税抜経理にしています。" };
  return { exclusive: false, note: "仮受消費税の仕訳が無いため、税込経理にしています。" };
}

/** 売却・除却の仕訳を組み立てる（保存しない）。見込みと作成で同じ計算を使う */
async function prepareDisposal(clientId: string, assetId: string, req: DisposalRequest) {
  const ctx = await loadContext(clientId);
  const { db } = ctx;
  if (req.type !== "sale" && req.type !== "retire") throw new Error("売却か除却かを選んでください");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.date ?? "")) throw new Error("手放した日を入力してください");

  const { data: row } = await db.from("fixed_assets").select("*").eq("id", assetId).eq("client_id", clientId).maybeSingle();
  if (!row) throw new Error("この顧問先の固定資産ではありません");
  const a = row as AssetRow;
  if (a.disposed_at) throw new Error("この資産は売却・除却を登録済みです。やり直すときは先に取り消してください");
  if (req.date < a.acquisition_date) throw new Error("手放した日が取得日より前になっています");
  await assertDateOpen(db, clientId, req.date, "締めた会計年度の日付では、売却・除却を登録できません");

  const method = a.depreciation_method as DepreciationMethod;
  const kind = depreciationKind(method, a.acquisition_date);
  const serviceStart = a.service_start_date || a.acquisition_date;
  const fp = fiscalPeriodContaining(ctx.rows, ctx.sm, req.date);
  const period = { startDate: fp.startDate, endDate: fp.endDate };

  type Dep = { id: string; period_start: string; period_end: string; booked_amount: number; is_manual: boolean; journal_entry_id: string | null };
  const { data: depRows, error: depErr } = await db
    .from("fixed_asset_depreciations")
    .select("id, period_start, period_end, booked_amount, is_manual, journal_entry_id")
    .eq("asset_id", assetId);
  if (depErr) throw new Error(depErr.message);
  const deps = (depRows ?? []) as Dep[];
  // 一括償却資産は手放しても3年で償却し続けるので、期末の減価償却の仕訳とはぶつからない
  const lump = kind === "lump";
  if (!lump) {
    // 手放した後の期に減価償却の仕訳があると、無い資産を償却したことになる
    const later = deps
      .filter((d) => d.journal_entry_id && d.period_start > period.startDate)
      .sort((x, y) => x.period_start.localeCompare(y.period_start))[0];
    if (later)
      throw new Error(
        `手放した日より後の期（${later.period_start}〜${later.period_end}）に、この資産の減価償却の仕訳があります。先にその期の減価償却の仕訳を取り消してください`
      );
  }
  // 手放した期の、期末の減価償却の仕訳（作成済みなら、手放す前に計算した1年分が入っている）
  const posted = lump ? null : deps.find((d) => d.period_start === period.startDate && d.journal_entry_id) ?? null;

  // 手放した月までの償却スケジュール。作成済みの期末の仕訳の額は、任意償却で決めた額でなければ
  // 手放す前の1年分なので使わず、手放した月までの限度額で計算し直す
  const fixed: Record<string, number> = {};
  for (const d of deps) {
    if (!d.is_manual && !d.journal_entry_id) continue;
    if (d === posted && !d.is_manual) continue;
    fixed[d.period_start] = Number(d.booked_amount);
  }
  const periods = fiscalPeriodsUpTo(ctx.rows, ctx.sm, period, serviceStart).map((x) => ({ start: x.startDate, end: x.endDate }));
  const schedule = buildDepreciationSchedule(
    {
      acquisitionDate: a.acquisition_date,
      serviceStartDate: serviceStart,
      acquisitionCost: Number(a.acquisition_cost),
      usefulLife: a.useful_life,
      method,
      specialRate: a.special_treatment === "tax_credit" ? null : a.special_depreciation_rate,
      disposedAt: req.date,
    },
    periods,
    fixed,
    ctx.rounding
  );
  const cur = schedule.find((r) => r.start === period.startDate) ?? null;
  // 使い始める前に手放したときは、償却していない（期首の帳簿価額＝取得価額）
  const openingBook = cur ? cur.openingBook : Math.round(Number(a.acquisition_cost));
  let depreciation = cur ? cur.booked : 0;

  const notes: string[] = [];
  const warnings: string[] = [];
  /**
   * 期末の減価償却の仕訳を作成済みの期に手放したとき:
   *   その仕訳の額が手放した月までの償却限度額を超えていれば止め、仕訳の取り消しと作り直しを案内する。
   *   （そのまま進めると、手放した後の月まで償却したことになる。個人事業主は限度額どおりにしか計上できず、
   *     法人でも超えた分は償却超過になる。二重に計上しないよう、作成済みの仕訳の額を後から書き換えることもしない）
   *   超えていなければ（期の最後の月に手放した・任意償却で少なく計上した）、償却費はその仕訳に入っているので、
   *   売却・除却の仕訳には入れず、その分を引いた帳簿価額を消す。
   */
  let included = true;
  if (posted) {
    const x = Number(posted.booked_amount);
    const limit = cur?.limit ?? null;
    if (limit !== null && x > limit)
      throw new Error(
        `この期の減価償却の仕訳に、この資産の償却費 ${x.toLocaleString()}円（手放す前に計算した1年分）が入っています。` +
          `手放した月までの償却限度額は ${limit.toLocaleString()}円です。先にこの期の減価償却の仕訳を取り消してから売却・除却を登録し、` +
          "そのあと減価償却の仕訳を作り直してください（手放した月までの分に直し、二重に計上しないため）"
      );
    included = false;
    depreciation = x;
    notes.push(`手放した月までの償却費 ${x.toLocaleString()}円は、この期の減価償却の仕訳に入っているため、この仕訳には入れません。`);
  }

  const { data: client } = await db.from("clients").select("consumption_tax_status, tax_method").eq("id", clientId).single();
  const taxExempt = client?.consumption_tax_status === "exempt";
  let exclusive = false;
  let exclusiveNote = "";
  if (req.type === "sale") {
    if (taxExempt) {
      exclusiveNote = "免税事業者のため、税込経理（仮受消費税を立てない）で作ります。";
    } else {
      const d = await detectExclusive(db, clientId, period);
      exclusive = req.exclusive ?? d.exclusive;
      exclusiveNote = d.note;
    }
  }
  const saleTaxCategory = (req.saleTaxCategory ?? "sales_10") as TaxCategoryCode;
  if (req.type === "sale" && !SALE_TAX_CATEGORIES.includes(saleTaxCategory)) throw new Error("売却代金の税区分を選び直してください");

  const plan = planDisposal({
    type: req.type,
    kind,
    entityType: ctx.entityType,
    entryMethod: ctx.entryMethod,
    acquisitionCost: Number(a.acquisition_cost),
    openingBook: included ? openingBook : openingBook - depreciation,
    depreciation: included ? depreciation : 0,
    salePrice: req.salePrice,
    saleTaxCategory,
    exclusive,
    businessRatio: Number(a.business_ratio ?? 100),
  });

  // 行の役割に科目を当てる
  const accounts = await loadAccounts(db, clientId);
  const accountName = new Map(accounts.all.map((x) => [x.id, x.name]));
  const accountOf = new Map<DisposalRole, { id: string; name: string }>();
  const missingAccounts: string[] = [];
  if (plan.mode === "journal") {
    for (const role of new Set(plan.lines.map((l) => l.role))) {
      if (role === "asset") {
        // 減価償却の仕訳と同じく、資産に登録した科目を使う
        const acct = a.account_id
          ? { id: a.account_id, name: accountName.get(a.account_id) ?? a.category ?? "" }
          : accounts.byName(a.category ?? "");
        if (!acct) throw new Error(`「${a.name}」の勘定科目が決まっていません。資産を編集して科目を選んでください`);
        accountOf.set(role, acct);
      } else if (role === "receipt") {
        if (!req.saleAccountId) throw new Error("売却代金の入金先の科目を選んでください");
        const acct = accounts.receiptAccounts.find((x) => x.id === req.saleAccountId);
        if (!acct) throw new Error("入金先の科目を選び直してください");
        accountOf.set(role, acct);
      } else {
        const name = DISPOSAL_ACCOUNT_NAMES[role]!;
        const acct = accounts.byName(name);
        if (acct) accountOf.set(role, acct);
        else missingAccounts.push(name);
      }
    }
  }

  if (cur && cur.excess > 0 && cur.limit !== null)
    warnings.push(
      `当期の計上額（任意償却で決めた額）が、手放した月までの償却限度額 ${cur.limit.toLocaleString()}円を超えています。超えた分は損金になりません。`
    );
  if (ctx.entityType !== "individual" && cur && cur.closingExcess > 0)
    notes.push(`償却超過額の残り ${cur.closingExcess.toLocaleString()}円は、手放した期の法人税の申告で減算（認容）します（別表四）。`);
  if (plan.mode === "journal" && plan.lines.some((l) => l.role === "accumulated"))
    notes.push("間接法: 前期までの償却費を減価償却累計額に計上してきた前提で、その分の累計額を取り崩します。");
  if (plan.mode === "journal" && lump)
    notes.push("一括償却資産は売却しても、残りを3年で均等に償却し続けます。帳簿価額は消さず、売却代金だけを固定資産売却益にします。");
  if (plan.mode === "journal" && req.type === "sale" && !taxExempt && client?.tax_method === "simplified")
    notes.push("簡易課税: 売却代金は第四種事業の売上として数えます（事業用の固定資産の譲渡）。");

  const preview: DisposalPreview = {
    type: req.type,
    date: req.date,
    period,
    mode: plan.mode,
    reason: plan.mode === "record_only" ? plan.reason : null,
    lines:
      plan.mode === "journal"
        ? plan.lines.map((l) => ({
            accountName: accountOf.get(l.role)?.name ?? DISPOSAL_ACCOUNT_NAMES[l.role] ?? "",
            debit: l.debit,
            credit: l.credit,
            taxCategoryName: l.taxCategory ? taxCategoryInfo(l.taxCategory)?.name ?? null : null,
            note: l.note,
          }))
        : [],
    months: cur?.months ?? 0,
    openingBook,
    depreciation: lump ? 0 : depreciation,
    depreciationIncluded: included,
    continuesAmortization: lump,
    bookValue: lump ? openingBook : openingBook - depreciation,
    salePrice: plan.mode === "journal" ? plan.salePrice : Math.round(Number(req.salePrice) || 0),
    tax: plan.mode === "journal" ? plan.tax : 0,
    gain: plan.mode === "journal" ? plan.gain : 0,
    loss: plan.mode === "journal" ? plan.loss : 0,
    retireLoss: plan.mode === "journal" ? plan.retireLoss : 0,
    exclusive,
    exclusiveNote,
    taxExempt,
    missingAccounts,
    notes,
    warnings,
  };
  return { ctx, asset: a, period, plan, included, deps, accountOf, saleTaxCategory, preview };
}

/** 売却・除却の仕訳の見込み（保存しない） */
export async function previewDisposal(clientId: string, assetId: string, req: DisposalRequest): Promise<DisposalPreview> {
  await assertClientAccess(clientId);
  return (await prepareDisposal(clientId, assetId, req)).preview;
}

/** 作りかけの売却・除却の仕訳を消し、資産を手放す前に戻す（途中で失敗したとき） */
async function discardDisposalEntry(db: Db, clientId: string, assetId: string, entryId: string) {
  await db.from("fixed_assets").update(CLEAR_DISPOSAL).eq("id", assetId).eq("client_id", clientId).eq("disposal_journal_entry_id", entryId);
  await db.from("journal_entry_lines").delete().eq("journal_entry_id", entryId);
  await db.from("journal_entries").delete().eq("id", entryId);
}

/**
 * 売却・除却を登録する。仕訳を作るもの（src/lib/asset-disposal.ts）は手放した日付けで1本作り、
 * 手放した月までの償却費を入れたら fixed_asset_depreciations にこの仕訳で残す（期末の減価償却の仕訳から外すため）。
 * 仕訳を作らないもの（一括償却資産の除却など）は日付だけを記録する。
 */
export async function createDisposal(clientId: string, assetId: string, req: DisposalRequest): Promise<{ entryId: string | null }> {
  await assertClientAccess(clientId);
  const prep = await prepareDisposal(clientId, assetId, req);
  const { db } = prep.ctx;
  const { plan, period, asset } = prep;
  const record = {
    disposed_at: req.date,
    disposal_type: req.type,
    sale_price: req.type === "sale" && prep.preview.salePrice > 0 ? prep.preview.salePrice : null,
    sale_account_id: req.type === "sale" ? req.saleAccountId || null : null,
    sale_tax_category: req.type === "sale" ? prep.saleTaxCategory : null,
  };

  if (plan.mode === "record_only") {
    const { data, error } = await db
      .from("fixed_assets")
      .update({ ...record, disposal_journal_entry_id: null })
      .eq("id", assetId)
      .eq("client_id", clientId)
      .is("disposed_at", null)
      .select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new Error("この資産は売却・除却を登録済みです（画面を読み込み直してください）");
    return { entryId: null };
  }

  if (prep.preview.missingAccounts.length > 0)
    throw new Error(`勘定科目（${prep.preview.missingAccounts.join("・")}）が見つかりません。勘定科目管理で有効にしてください`);

  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) throw new Error("ログインが必要です");
  const { data: entry, error } = await db
    .from("journal_entries")
    .insert({
      client_id: clientId,
      entry_date: req.date,
      description: `固定資産の${req.type === "sale" ? "売却" : "除却"}（${asset.name}）`,
      status: "confirmed",
      source: "manual",
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !entry) throw new Error(error?.message ?? "仕訳の作成に失敗しました");

  const { error: lErr } = await db.from("journal_entry_lines").insert(
    plan.lines.map((l, i) => ({
      journal_entry_id: entry.id,
      account_id: prep.accountOf.get(l.role)!.id,
      debit_amount: l.debit,
      credit_amount: l.credit,
      tax_category: l.taxCategory,
      tax_rate: l.taxCategory ? taxCategoryInfo(l.taxCategory)?.rate ?? null : null,
      business_type: l.businessType,
      sort_order: i,
    }))
  );
  if (lErr) {
    await db.from("journal_entries").delete().eq("id", entry.id);
    throw new Error(lErr.message);
  }

  // 資産を手放した状態にする。同時に2回押されても仕訳が2本残らないよう、まだ手放していない資産だけを書き換える
  const { data: claimed, error: aErr } = await db
    .from("fixed_assets")
    .update({ ...record, disposal_journal_entry_id: entry.id })
    .eq("id", assetId)
    .eq("client_id", clientId)
    .is("disposed_at", null)
    .select("id");
  if (aErr || !claimed?.length) {
    await discardDisposalEntry(db, clientId, assetId, entry.id);
    throw new Error(aErr?.message ?? "この資産は売却・除却を登録済みです（画面を読み込み直してください）");
  }

  // 手放した月までの償却費をこの仕訳で計上したことを残す（任意償却で決めた行は、額を残して仕訳だけ結びつける）
  if (prep.included && plan.depreciation > 0) {
    const existing = prep.deps.find((d) => d.period_start === period.startDate);
    const { error: dErr } = existing
      ? await db
          .from("fixed_asset_depreciations")
          .update({ journal_entry_id: entry.id, booked_amount: plan.depreciation, period_end: period.endDate })
          .eq("id", existing.id)
      : await db.from("fixed_asset_depreciations").insert({
          client_id: clientId,
          asset_id: assetId,
          period_start: period.startDate,
          period_end: period.endDate,
          booked_amount: plan.depreciation,
          is_manual: false,
          journal_entry_id: entry.id,
        });
    if (dErr) {
      await discardDisposalEntry(db, clientId, assetId, entry.id);
      throw new Error(dErr.message);
    }
  }
  return { entryId: entry.id as string };
}

/**
 * 売却・除却を取り消す（仕訳を削除し、資産を手放す前に戻す）。
 * 仕訳はほかの画面から消しても、データベースの仕掛け（082）で手放す前に戻る。
 */
export async function cancelDisposal(clientId: string, assetId: string): Promise<void> {
  await assertClientAccess(clientId);
  const db = await createServerSupabaseClient();
  const { data: a } = await db
    .from("fixed_assets")
    .select("id, disposed_at, disposal_journal_entry_id")
    .eq("id", assetId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (!a) throw new Error("この顧問先の固定資産ではありません");
  if (!a.disposed_at) return;
  if (a.disposal_journal_entry_id) {
    // 締めた会計年度の仕訳なら、ここで止まる
    await deleteJournalEntries([a.disposal_journal_entry_id]);
  } else {
    await assertDateOpen(db, clientId, a.disposed_at, "締めた会計年度に手放した資産は、取り消せません");
  }
  // 仕訳と結びつきが切れた償却費の行（任意償却で決めた行は残す）と、売却・除却の記録を消す
  const { error: dErr } = await db
    .from("fixed_asset_depreciations")
    .delete()
    .eq("client_id", clientId)
    .eq("asset_id", assetId)
    .eq("is_manual", false)
    .is("journal_entry_id", null);
  if (dErr) throw new Error(dErr.message);
  const { error } = await db.from("fixed_assets").update(CLEAR_DISPOSAL).eq("id", assetId).eq("client_id", clientId);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// 設定と計上額の指定
// ---------------------------------------------------------------------------

export async function saveDepreciationSettings(
  clientId: string,
  settings: { rounding?: DepreciationRounding; entryMethod?: "direct" | "indirect" }
): Promise<void> {
  await assertClientAccess(clientId);
  const update: { depreciation_rounding?: DepreciationRounding; depreciation_entry_method?: "direct" | "indirect" } = {};
  if (settings.rounding) {
    if (!["floor", "ceil", "round"].includes(settings.rounding)) throw new Error("端数処理が正しくありません");
    update.depreciation_rounding = settings.rounding;
  }
  if (settings.entryMethod) {
    if (!["direct", "indirect"].includes(settings.entryMethod)) throw new Error("記帳方法が正しくありません");
    update.depreciation_entry_method = settings.entryMethod;
  }
  const db = await createServerSupabaseClient();
  const { error } = await db.from("clients").update(update).eq("id", clientId);
  if (error) throw new Error(error.message);
}

/**
 * その期に帳簿へ計上する額を決める（法人の任意償却）。null を渡すと償却限度額どおりに戻す。
 * 仕訳を作った後は変えられない（先に仕訳を取り消す）。
 */
export async function setBookedAmount(
  clientId: string,
  assetId: string,
  period: { startDate: string; endDate: string },
  amount: number | null
): Promise<void> {
  await assertClientAccess(clientId);
  const ctx = await loadContext(clientId);
  if (ctx.entityType === "individual" && amount !== null)
    throw new Error("個人事業主は償却限度額どおりに計上します（任意償却はできません）");
  if (amount !== null && !(amount >= 0)) throw new Error("計上額を正しく入力してください");
  const { db } = ctx;
  // 取得価額を超える額は計算の側で丸められ、打ち間違いに気づけないので受け付けない（画面では期首の帳簿価額で止める）
  if (amount !== null) {
    const { data: asset } = await db.from("fixed_assets").select("acquisition_cost").eq("id", assetId).eq("client_id", clientId).maybeSingle();
    if (!asset) throw new Error("この顧問先の固定資産ではありません");
    if (amount > Number(asset.acquisition_cost) - 1) throw new Error("計上額が取得価額を超えています（1円の備忘価額を残します）");
  }
  const { data: existing } = await db
    .from("fixed_asset_depreciations")
    .select("id, journal_entry_id")
    .eq("asset_id", assetId)
    .eq("period_start", period.startDate)
    .maybeSingle();
  if (existing?.journal_entry_id) throw new Error("この期の減価償却の仕訳を作った後は変えられません。先に仕訳を取り消してください");

  if (amount === null) {
    if (existing) {
      const { error } = await db.from("fixed_asset_depreciations").delete().eq("id", existing.id);
      if (error) throw new Error(error.message);
    }
    return;
  }
  const { error } = existing
    ? await db
        .from("fixed_asset_depreciations")
        .update({ booked_amount: Math.round(amount), is_manual: true, period_end: period.endDate })
        .eq("id", existing.id)
    : await db.from("fixed_asset_depreciations").insert({
        client_id: clientId,
        asset_id: assetId,
        period_start: period.startDate,
        period_end: period.endDate,
        booked_amount: Math.round(amount),
        is_manual: true,
      });
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// 減価償却の仕訳
// ---------------------------------------------------------------------------

/**
 * 選んだ期の減価償却の仕訳を作る（期末日付で1本）。
 *   直接法: (借)減価償却費 / (貸)建物・器具備品など（資産の科目を直接減らす）
 *   間接法: (借)減価償却費 / (貸)減価償却累計額
 */
export async function postDepreciationJournal(clientId: string, periodKey: string): Promise<{ entryId: string; amount: number }> {
  await assertClientAccess(clientId);
  const book = await computeBook(clientId, periodKey);
  const { db } = book.ctx;
  if (book.journal) throw new Error("この期の減価償却の仕訳は作成済みです");

  const { data: locked } = await db
    .from("fiscal_years")
    .select("id")
    .eq("client_id", clientId)
    .eq("status", "locked")
    .lte("start_date", book.period.endDate)
    .gte("end_date", book.period.endDate)
    .limit(1);
  if (locked && locked.length) throw new Error("ロック済みの会計年度には仕訳を作れません");

  // 手放した月までの償却費を売却・除却の仕訳に入れた資産は、二重に計上しないよう外す
  const targets = book.assets.filter((a) => a.current && a.current.booked > 0 && !a.depreciationInDisposal);
  if (targets.length === 0) throw new Error("この期に計上する減価償却費がありません");

  const accounts = await loadAccounts(db, clientId);
  const expense = accounts.byName(EXPENSE_ACCOUNT);
  if (!expense) throw new Error("勘定科目「減価償却費」が見つかりません");
  const accumulated = book.entryMethod === "indirect" ? accounts.byName(ACCUMULATED_ACCOUNT) : null;
  if (book.entryMethod === "indirect" && !accumulated) throw new Error("勘定科目「減価償却累計額」が見つかりません");

  // 貸方の科目ごとにまとめる
  const credit = new Map<string, number>();
  for (const a of targets) {
    const accountId = accumulated?.id ?? a.accountId ?? accounts.byName(a.accountName)?.id;
    if (!accountId) throw new Error(`「${a.name}」の勘定科目が決まっていません。資産を編集して科目を選んでください`);
    credit.set(accountId, (credit.get(accountId) ?? 0) + a.current!.booked);
  }
  const amount = targets.reduce((s, a) => s + a.current!.booked, 0);
  // 個人事業主の家事と共用の資産は、事業専用割合の分だけを減価償却費にし、残りは事業主貸（1円未満は切り捨て）
  const individual = book.ctx.entityType === "individual";
  const businessPart = (a: (typeof targets)[number]) =>
    individual && a.businessRatio < 100 ? Math.floor((a.current!.booked * a.businessRatio) / 100) : a.current!.booked;
  const expenseAmount = targets.reduce((s, a) => s + businessPart(a), 0);
  const privateAmount = amount - expenseAmount;
  const ownerDraw = privateAmount > 0 ? accounts.byName("事業主貸") : null;
  if (privateAmount > 0 && !ownerDraw) throw new Error("勘定科目「事業主貸」が見つかりません（事業専用割合の私用分に使います）");

  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) throw new Error("ログインが必要です");
  const { data: entry, error } = await db
    .from("journal_entries")
    .insert({
      client_id: clientId,
      entry_date: book.period.endDate,
      description: `減価償却費（${book.period.startDate}〜${book.period.endDate}）`,
      status: "confirmed",
      source: "manual",
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !entry) throw new Error(error?.message ?? "仕訳の作成に失敗しました");

  const lines = [
    {
      journal_entry_id: entry.id,
      account_id: expense.id,
      debit_amount: expenseAmount,
      credit_amount: 0,
      tax_category: "purchase_out_of_scope",
      tax_rate: 0,
      sort_order: 0,
    },
    ...(ownerDraw
      ? [{ journal_entry_id: entry.id, account_id: ownerDraw.id, debit_amount: privateAmount, credit_amount: 0, sort_order: 1 }]
      : []),
    ...[...credit].map(([accountId, v], i) => ({
      journal_entry_id: entry.id,
      account_id: accountId,
      debit_amount: 0,
      credit_amount: v,
      sort_order: i + 2,
    })),
  ];
  const { error: lErr } = await db.from("journal_entry_lines").insert(lines);
  if (lErr) {
    await db.from("journal_entries").delete().eq("id", entry.id);
    throw new Error(lErr.message);
  }

  // 資産ごとの計上額と仕訳を残す（任意償却で指定した行はそのまま仕訳だけ結びつける）
  const { data: existing } = await db
    .from("fixed_asset_depreciations")
    .select("id, asset_id")
    .eq("client_id", clientId)
    .eq("period_start", book.period.startDate);
  const existingBy = new Map(((existing ?? []) as { id: string; asset_id: string }[]).map((r) => [r.asset_id, r.id]));
  for (const a of targets) {
    const id = existingBy.get(a.id);
    const { error: dErr } = id
      ? await db
          .from("fixed_asset_depreciations")
          .update({ journal_entry_id: entry.id, booked_amount: a.current!.booked, period_end: book.period.endDate })
          .eq("id", id)
      : await db.from("fixed_asset_depreciations").insert({
          client_id: clientId,
          asset_id: a.id,
          period_start: book.period.startDate,
          period_end: book.period.endDate,
          booked_amount: a.current!.booked,
          is_manual: false,
          journal_entry_id: entry.id,
        });
    if (dErr) throw new Error(dErr.message);
  }
  return { entryId: entry.id as string, amount };
}

/**
 * 選んだ期の減価償却の仕訳を取り消す（仕訳を削除し、任意償却で指定した額は残す）。
 * 消すのは、仕訳を消して結びつきが切れた行だけ（売却・除却の仕訳に入れた償却費の行は残す）
 */
export async function cancelDepreciationJournal(clientId: string, periodKey: string): Promise<void> {
  await assertClientAccess(clientId);
  const book = await computeBook(clientId, periodKey);
  if (!book.journal) return;
  await deleteJournalEntries(book.journal.entryIds);
  const { error } = await book.ctx.db
    .from("fixed_asset_depreciations")
    .delete()
    .eq("client_id", clientId)
    .eq("period_start", book.period.startDate)
    .eq("is_manual", false)
    .is("journal_entry_id", null);
  if (error) throw new Error(error.message);
}
