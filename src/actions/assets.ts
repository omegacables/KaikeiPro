"use server";

/**
 * 固定資産台帳と減価償却。計算は src/lib/depreciation.ts（テストあり）。
 *
 *   - 資産ごと・事業年度ごとの償却限度額（普通償却・特別償却）、計上額、償却超過額
 *   - 計上額の指定（法人の任意償却）は fixed_asset_depreciations に is_manual=true で残す
 *   - 減価償却の仕訳を作ると、その期の計上額と仕訳を fixed_asset_depreciations に残す
 */

import { createServerSupabaseClient } from "@/lib/supabase";
import { assertClientAccess } from "@/lib/authz";
import {
  resolveFiscalPeriodByKey,
  adjacentFiscalPeriodKeys,
  currentFiscalStartYear,
  fiscalPeriodsUpTo,
  type FiscalPeriodRow,
} from "@/lib/fiscal";
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
  note: string | null;
  disposedAt: string | null;
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
  totals: { cost: number; openingBook: number; limit: number; booked: number; excess: number; allowed: number; closingBook: number };
  /** この期に作った減価償却の仕訳 */
  journal: { entryIds: string[]; date: string; amount: number } | null;
  /** 選べる固定資産の科目 */
  assetAccounts: { id: string; code: string; name: string }[];
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
  return { all, byName, assetAccounts };
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

  // 選んだ期より前に除却した資産は出さない
  const assets = ((assetRows ?? []) as AssetRow[]).filter((a) => !a.disposed_at || a.disposed_at >= p.startDate);
  const accountName = new Map(accounts.all.map((a) => [a.id, a.name]));

  // 計上額が決まっている期（任意償却で指定した、または仕訳を作った）
  type Dep = { asset_id: string; period_start: string; booked_amount: number; is_manual: boolean; journal_entry_id: string | null };
  const fixedBy = new Map<string, Record<string, number>>();
  const journalIds = new Set<string>();
  for (const d of (depRows ?? []) as Dep[]) {
    if (!d.is_manual && !d.journal_entry_id) continue;
    const m = fixedBy.get(d.asset_id) ?? {};
    m[d.period_start] = Number(d.booked_amount);
    fixedBy.set(d.asset_id, m);
    if (d.journal_entry_id && d.period_start === p.startDate) journalIds.add(d.journal_entry_id);
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
        specialRate: a.special_depreciation_rate,
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
      specialRate: a.special_depreciation_rate,
      specialNote: a.special_depreciation_note,
      note: a.note,
      disposedAt: a.disposed_at,
      current,
      closingBook,
      schedule,
      warnings,
    };
  });

  const sum = (f: (a: DepreciationAsset) => number) => list.reduce((s, a) => s + f(a), 0);
  const totals = {
    cost: sum((a) => a.acquisitionCost),
    openingBook: sum((a) => a.current?.openingBook ?? a.closingBook),
    limit: sum((a) => a.current?.limit ?? 0),
    booked: sum((a) => a.current?.booked ?? 0),
    excess: sum((a) => a.current?.excess ?? 0),
    allowed: sum((a) => a.current?.allowed ?? 0),
    closingBook: sum((a) => a.closingBook),
  };

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
  note?: string | null;
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
}

export async function saveAsset(clientId: string, input: AssetInput, assetId?: string): Promise<void> {
  await assertClientAccess(clientId);
  validateAsset(input);
  const db = await createServerSupabaseClient();
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
    special_depreciation_note: input.specialRatePercent ? input.specialNote?.trim() || null : null,
    note: input.note?.trim() || null,
  };
  const { error } = assetId
    ? await db.from("fixed_assets").update(row).eq("id", assetId).eq("client_id", clientId)
    : await db.from("fixed_assets").insert({ ...row, client_id: clientId });
  if (error) throw new Error(error.message);
}

/** 除却・売却（disposedAt に null を渡すと取り消し） */
export async function disposeAsset(clientId: string, assetId: string, disposedAt: string | null): Promise<void> {
  await assertClientAccess(clientId);
  const db = await createServerSupabaseClient();
  const { error } = await db
    .from("fixed_assets")
    .update({ disposed_at: disposedAt })
    .eq("id", assetId)
    .eq("client_id", clientId);
  if (error) throw new Error(error.message);
}

/** 資産を削除する（減価償却の仕訳を作った資産は消せない） */
export async function deleteAsset(clientId: string, assetId: string): Promise<void> {
  await assertClientAccess(clientId);
  const db = await createServerSupabaseClient();
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

  const targets = book.assets.filter((a) => a.current && a.current.booked > 0);
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
      debit_amount: amount,
      credit_amount: 0,
      tax_category: "purchase_out_of_scope",
      tax_rate: 0,
      sort_order: 0,
    },
    ...[...credit].map(([accountId, v], i) => ({
      journal_entry_id: entry.id,
      account_id: accountId,
      debit_amount: 0,
      credit_amount: v,
      sort_order: i + 1,
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

/** 選んだ期の減価償却の仕訳を取り消す（仕訳を削除し、任意償却で指定した額は残す） */
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
    .eq("is_manual", false);
  if (error) throw new Error(error.message);
}
