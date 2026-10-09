"use server";

/**
 * 勘定科目内訳明細書（法人税申告書の添付書類）。
 *
 * 記載基準の判定・科目の対応・照合は src/lib/breakdown.ts の純粋関数に任せ、
 * ここではデータの読み込みと組み立てだけを行う。
 */

import { createServerSupabaseClient } from "@/lib/supabase";
import { assertClientAccess } from "@/lib/authz";
import { fetchAllRows } from "@/lib/fetch-all";
import {
  currentFiscalStartYear,
  resolveFiscalPeriodByKey,
  adjacentFiscalPeriodKeys,
  type FiscalPeriodRow,
} from "@/lib/fiscal";
import {
  BREAKDOWN_FORMS,
  findBreakdownForm,
  isAvailableForm,
  LOAN_LISTING_RULE,
  selectListedRows,
  isBorrowingAccount,
  isLendingAccount,
  isInterestExpenseAccount,
  isInterestIncomeAccount,
  buildPersonnelBreakdown,
  miscKindOf,
  buildMiscRows,
  reconcile,
  type BalanceAccount,
  type BreakdownFormDef,
  type MiscRow,
  type MiscSourceLine,
  type PersonnelBreakdown,
  type Reconciliation,
} from "@/lib/breakdown";
import {
  findItemFormSpec,
  reconcileItems,
  type BreakdownItem,
  type DetailValue,
} from "@/lib/breakdown-items";
import { getTrialBalance } from "@/actions/statements";
import { getLoanBreakdownSource } from "@/actions/loans";
import type { LoanBreakdownRow } from "@/types/index";

type DbRow = Record<string, unknown>;

// ---------------------------------------------------------------------------
// 型
// ---------------------------------------------------------------------------

export type BreakdownPeriod = {
  clientName: string;
  startDate: string;
  endDate: string;
  /** 決算月の変更などで、fiscal_years に記録された期間を使ったか */
  fromFiscalYears: boolean;
  /** 前期・翌期の指定（開始日）。決算月を変えた期も途切れずにたどれる */
  prevKey: string;
  nextKey: string;
};

export type LoanFormData = {
  kind: "loan";
  direction: "borrow" | "lend";
  /** 各別に記入する行＋「その他」の行 */
  rows: LoanBreakdownRow[];
  totalBalance: number;
  totalInterest: number;
  /** 期末現在高と、試算表の借入金（貸付金）科目との照合 */
  balanceCheck: Reconciliation;
  /**
   * 期中の利息額と、試算表の支払利息（受取利息）科目との照合。
   * 利息の科目には預金利息やカードの利息なども入るため、参考として示す。
   */
  interestCheck: Reconciliation;
};

export type PersonnelFormData = {
  kind: "personnel";
  breakdown: PersonnelBreakdown;
};

export type MiscSection = {
  listed: MiscRow[];
  /** 記載基準（10万円）に満たず、記入を省いた分 */
  omittedAmount: number;
  omittedCount: number;
  /** 記入した額＋省いた額と、試算表の科目残高との照合 */
  check: Reconciliation;
};

export type MiscFormData = {
  kind: "misc";
  gains: MiscSection;
  losses: MiscSection;
};

/** 取引先マスタ（明細の名称入力で候補に出し、所在地・登録番号を補う） */
export type PartnerOption = {
  id: string;
  name: string;
  aliases: string[];
  address: string;
  registrationNumber: string;
};

export type ItemFormData = {
  kind: "items";
  items: BreakdownItem[];
  /** 照合する科目（「科目」欄の選択肢にもなる） */
  balances: BalanceAccount[];
  partners: PartnerOption[];
};

export type BreakdownFormData = (LoanFormData | PersonnelFormData | MiscFormData | ItemFormData) & {
  def: BreakdownFormDef;
  period: BreakdownPeriod;
};

export type BreakdownOverviewItem = {
  def: BreakdownFormDef;
  /** 作成できる様式のみ。記入額の合計と照合結果 */
  summary?: {
    total: number;
    checks: { label: string; check: Reconciliation; informational: boolean }[];
    /** 入力式の様式の明細の件数 */
    itemCount?: number;
    /** 試算表と照合する科目がある様式か */
    reconcilable?: boolean;
  };
};

// ---------------------------------------------------------------------------
// 共通の読み込み
// ---------------------------------------------------------------------------

async function loadPeriod(clientId: string, periodKey: string): Promise<BreakdownPeriod> {
  const supabase = await createServerSupabaseClient();
  const [{ data: client, error }, { data: fyRows }] = await Promise.all([
    supabase.from("clients").select("name, fiscal_year_start_month").eq("id", clientId).single(),
    supabase.from("fiscal_years").select("start_date, end_date").eq("client_id", clientId),
  ]);
  if (error || !client) throw new Error("顧問先が見つかりません");

  const rows = (fyRows ?? []) as FiscalPeriodRow[];
  const p = resolveFiscalPeriodByKey(
    rows,
    (client as DbRow).fiscal_year_start_month as number | null,
    periodKey
  );
  return {
    clientName: ((client as DbRow).name as string) ?? "",
    startDate: p.startDate,
    endDate: p.endDate,
    fromFiscalYears: p.fromFiscalYears,
    ...adjacentFiscalPeriodKeys(rows, p),
  };
}

/** 試算表の科目残高（期末時点。損益科目は当期発生額） */
async function loadBalances(clientId: string, period: BreakdownPeriod): Promise<BalanceAccount[]> {
  const rows = await getTrialBalance(clientId, period.startDate, period.endDate);
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    category: r.category,
    plClassification: r.plClassification,
    currentBalance: r.currentBalance,
  }));
}

// ---------------------------------------------------------------------------
// ⑪ 借入金及び支払利子 ／ ④ 貸付金及び受取利息
// ---------------------------------------------------------------------------

async function buildLoanForm(
  clientId: string,
  period: BreakdownPeriod,
  balances: BalanceAccount[],
  direction: "borrow" | "lend"
): Promise<LoanFormData> {
  const source = await getLoanBreakdownSource(clientId, direction, period);

  // 期末残高も期中の利息も無いものは、記入する事実が無いので除く
  // （完済済みの借入が「その他（n口）0円」として出ていた）
  const candidates = source.rows.filter((r) => r.closing_balance !== 0 || r.interest_paid !== 0);

  const sel = selectListedRows(candidates, LOAN_LISTING_RULE, (r) => ({
    amount: r.closing_balance,
    secondary: r.interest_paid,
    mustList: r.is_related_party,
  }));

  const rows: LoanBreakdownRow[] = [...sel.listed];
  // 各別記入にならなかったものは一括して1行で記入する（記載要領）
  if (sel.rest.count > 0) {
    rows.push({
      lender_name: `その他（${sel.rest.count}口）`,
      address: null,
      registration_number: null,
      closing_balance: sel.rest.amount,
      interest_paid: sel.rest.secondary,
      interest_rate: null,
      relationship: null,
      collateral: null,
      is_related_party: false,
      merged_count: sel.rest.count,
    });
  }

  const totalBalance = rows.reduce((s, r) => s + r.closing_balance, 0);
  const totalInterest = rows.reduce((s, r) => s + r.interest_paid, 0);

  const ledgerAccounts = new Set(source.accountIds);
  const isTarget = direction === "borrow" ? isBorrowingAccount : isLendingAccount;
  const isInterest = direction === "borrow" ? isInterestExpenseAccount : isInterestIncomeAccount;

  return {
    kind: "loan",
    direction,
    rows,
    totalBalance,
    totalInterest,
    balanceCheck: reconcile(
      balances.filter((a) => isTarget(a) || ledgerAccounts.has(a.id)),
      totalBalance
    ),
    interestCheck: reconcile(balances.filter(isInterest), totalInterest),
  };
}

// ---------------------------------------------------------------------------
// ⑯ 雑益、雑損失等
// ---------------------------------------------------------------------------

type MiscLineRow = {
  account_id: string;
  debit_amount: number;
  credit_amount: number;
  journal_entries: {
    client_id: string;
    entry_date: string;
    description: string | null;
    metadata: { partner_name?: string } | null;
    receipt_id: string | null;
  };
};

async function buildMiscForm(
  clientId: string,
  period: BreakdownPeriod,
  balances: BalanceAccount[]
): Promise<MiscFormData> {
  const miscAccounts = balances.filter((a) => miscKindOf(a) != null);
  const accountById = new Map(miscAccounts.map((a) => [a.id, a]));
  const supabase = await createServerSupabaseClient();

  // 試算表と同じく、要確認の仕訳は集計から除く（数字を一致させるため）
  const lines =
    miscAccounts.length === 0
      ? []
      : await fetchAllRows<MiscLineRow>((from, to) =>
          supabase
            .from("journal_entry_lines")
            .select(
              "account_id, debit_amount, credit_amount, journal_entries!inner ( client_id, entry_date, description, metadata, receipt_id )"
            )
            .in("account_id", [...accountById.keys()])
            .eq("journal_entries.client_id", clientId)
            .eq("journal_entries.needs_review", false)
            .gte("journal_entries.entry_date", period.startDate)
            .lte("journal_entries.entry_date", period.endDate)
            .range(from, to) as unknown as PromiseLike<{
            data: MiscLineRow[] | null;
            error: { message: string } | null;
          }>
        );

  // 相手先は仕訳に無いことが多い。証憑の読み取り結果と連携元の取引先名で補う
  const receiptIds = [...new Set(lines.map((l) => l.journal_entries.receipt_id).filter(Boolean))] as string[];
  const vendorByReceipt = new Map<string, { vendor: string | null; regNo: string | null }>();
  for (let i = 0; i < receiptIds.length; i += 100) {
    const { data } = await supabase
      .from("receipts")
      .select("id, ocr_result")
      .in("id", receiptIds.slice(i, i + 100));
    for (const r of data ?? []) {
      const ocr = (r as DbRow).ocr_result as { vendor_name?: string; invoice_number?: string } | null;
      vendorByReceipt.set((r as DbRow).id as string, {
        vendor: ocr?.vendor_name?.trim() || null,
        regNo: ocr?.invoice_number?.trim() || null,
      });
    }
  }

  // 取引先マスタ（名前・別名で突き合わせ、所在地と登録番号を引く）
  const { data: partners } = await supabase
    .from("business_partners")
    .select("name, aliases, address, invoice_registration_number")
    .eq("client_id", clientId);
  const partnerByName = new Map<string, { address: string | null; regNo: string | null }>();
  for (const p of partners ?? []) {
    const row = p as DbRow;
    const info = {
      address: (row.address as string) ?? null,
      regNo: (row.invoice_registration_number as string) ?? null,
    };
    for (const n of [row.name as string, ...((row.aliases as string[]) ?? [])]) {
      if (n?.trim()) partnerByName.set(n.trim(), info);
    }
  }

  const sourceLines: MiscSourceLine[] = lines.map((l) => {
    const account = accountById.get(l.account_id)!;
    const kind = miscKindOf(account)!;
    const fromReceipt = l.journal_entries.receipt_id
      ? vendorByReceipt.get(l.journal_entries.receipt_id)
      : undefined;
    const counterparty =
      l.journal_entries.metadata?.partner_name?.trim() || fromReceipt?.vendor || null;
    const partner = counterparty ? partnerByName.get(counterparty) : undefined;
    return {
      kind,
      accountName: account.name,
      description: (l.journal_entries.description ?? "").trim(),
      counterparty,
      address: partner?.address ?? null,
      registrationNumber: partner?.regNo ?? fromReceipt?.regNo ?? null,
      amount:
        kind === "gain"
          ? l.credit_amount - l.debit_amount
          : l.debit_amount - l.credit_amount,
    };
  });

  const section = (kind: "gain" | "loss"): MiscSection => {
    const r = buildMiscRows(sourceLines, kind);
    const listedTotal = r.listed.reduce((s, x) => s + x.amount, 0);
    return {
      listed: r.listed,
      omittedAmount: r.rest.amount,
      omittedCount: r.rest.count,
      check: reconcile(
        miscAccounts.filter((a) => miscKindOf(a) === kind),
        listedTotal + r.rest.amount
      ),
    };
  };

  return { kind: "misc", gains: section("gain"), losses: section("loss") };
}

// ---------------------------------------------------------------------------
// 公開する操作
// ---------------------------------------------------------------------------

/**
 * 内訳書を作る既定の事業年度。内訳書が必要になるのは決算後なので、
 * 「直前に終わった事業年度」を開く。決算月を変えた直後でも正しい期を
 * 指せるよう、当期の前期を期のつながりからたどって開始日で返す。
 */
export async function getBreakdownDefaultKey(clientId: string): Promise<string> {
  await assertClientAccess(clientId);
  const supabase = await createServerSupabaseClient();
  const [{ data: client }, { data: fyRows }] = await Promise.all([
    supabase.from("clients").select("fiscal_year_start_month").eq("id", clientId).single(),
    supabase.from("fiscal_years").select("start_date, end_date").eq("client_id", clientId),
  ]);
  const sm = (client as DbRow | null)?.fiscal_year_start_month as number | null;
  const rows = (fyRows ?? []) as FiscalPeriodRow[];
  const current = resolveFiscalPeriodByKey(rows, sm, String(currentFiscalStartYear(sm)));
  return adjacentFiscalPeriodKeys(rows, current).prevKey;
}

async function buildForm(
  clientId: string,
  period: BreakdownPeriod,
  balances: BalanceAccount[],
  key: string
): Promise<LoanFormData | PersonnelFormData | MiscFormData | ItemFormData | null> {
  const spec = findItemFormSpec(key);
  if (spec) {
    const [items, partners] = await Promise.all([
      loadItems(clientId, period.startDate, key),
      loadPartners(clientId),
    ]);
    return {
      kind: "items",
      items,
      balances: spec.isTargetAccount ? balances.filter(spec.isTargetAccount) : [],
      partners,
    };
  }
  switch (key) {
    case "11":
      return buildLoanForm(clientId, period, balances, "borrow");
    case "4-2":
      return buildLoanForm(clientId, period, balances, "lend");
    case "14-3":
      return { kind: "personnel", breakdown: buildPersonnelBreakdown(balances) };
    case "16":
      return buildMiscForm(clientId, period, balances);
    default:
      return null;
  }
}

/** 1つの様式のデータ */
export async function getBreakdownForm(
  clientId: string,
  periodKey: string,
  key: string
): Promise<BreakdownFormData> {
  await assertClientAccess(clientId);
  const def = findBreakdownForm(key);
  if (!def) throw new Error("指定された内訳書が見つかりません");
  if (!isAvailableForm(def)) throw new Error(`${def.number}${def.title}は準備中です`);

  const period = await loadPeriod(clientId, periodKey);
  const balances = await loadBalances(clientId, period);
  const data = await buildForm(clientId, period, balances, key);
  if (!data) throw new Error(`${def.number}${def.title}は準備中です`);
  return { ...data, def, period };
}

/** 様式の一覧と、作成できる様式の合計・照合結果 */
export async function getBreakdownOverview(
  clientId: string,
  periodKey: string
): Promise<{ period: BreakdownPeriod; items: BreakdownOverviewItem[] }> {
  await assertClientAccess(clientId);
  const period = await loadPeriod(clientId, periodKey);
  const balances = await loadBalances(clientId, period);

  // 入力式の様式は、期の明細をまとめて1回で読む
  const allItems = await loadItems(clientId, period.startDate);

  const items = await Promise.all(
    BREAKDOWN_FORMS.map(async (def): Promise<BreakdownOverviewItem> => {
      const spec = findItemFormSpec(def.key);
      if (spec) {
        const mine = allItems.filter((i) => i.formKey === def.key);
        const reconciled = new Set(spec.sections.filter((x) => x.reconciled).map((x) => x.key));
        return {
          def,
          summary: {
            total: mine.filter((i) => reconciled.has(i.section)).reduce((sum, i) => sum + i.amount, 0),
            checks: reconcileItems(spec, mine, balances).map((c) => ({
              label: c.label,
              check: c.check,
              informational: false,
            })),
            itemCount: mine.length,
            reconcilable: spec.isTargetAccount != null,
          },
        };
      }
      if (def.status !== "ready") return { def };
      const data = await buildForm(clientId, period, balances, def.key);
      if (!data) return { def };
      switch (data.kind) {
        case "items":
          return { def };
        case "loan": {
          const interestLabel = data.direction === "borrow" ? "支払利子" : "受取利息";
          return {
            def,
            summary: {
              total: data.totalBalance,
              checks: [
                { label: "期末現在高", check: data.balanceCheck, informational: false },
                { label: interestLabel, check: data.interestCheck, informational: true },
              ],
            },
          };
        }
        case "personnel":
          return { def, summary: { total: data.breakdown.total, checks: [] } };
        case "misc":
          return {
            def,
            summary: {
              total:
                data.gains.listed.reduce((s, r) => s + r.amount, 0) +
                data.losses.listed.reduce((s, r) => s + r.amount, 0),
              checks: [
                { label: "雑益等", check: data.gains.check, informational: false },
                { label: "雑損失等", check: data.losses.check, informational: false },
              ],
            },
          };
      }
    })
  );

  return { period, items };
}

// ---------------------------------------------------------------------------
// 相手先ごとの明細（②③④⑥⑧⑨⑩⑮）
// ---------------------------------------------------------------------------

type StoredItem = BreakdownItem & { formKey: string };

function toItem(r: DbRow): StoredItem {
  return {
    id: r.id as string,
    formKey: r.form_key as string,
    section: r.section as string,
    accountId: (r.account_id as string | null) ?? null,
    partnerId: (r.partner_id as string | null) ?? null,
    name: (r.name as string) ?? "",
    address: (r.address as string) ?? "",
    registrationNumber: (r.registration_number as string) ?? "",
    relationship: (r.relationship as string) ?? "",
    amount: Number(r.amount) || 0,
    note: (r.note as string) ?? "",
    details: (r.details as Record<string, DetailValue>) ?? {},
    sortOrder: Number(r.sort_order) || 0,
  };
}

async function loadItems(clientId: string, periodStart: string, formKey?: string): Promise<StoredItem[]> {
  const supabase = await createServerSupabaseClient();
  let q = supabase
    .from("breakdown_items")
    .select("*")
    .eq("client_id", clientId)
    .eq("period_start", periodStart);
  if (formKey) q = q.eq("form_key", formKey);
  const { data, error } = await q.order("sort_order");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => toItem(r as DbRow));
}

async function loadPartners(clientId: string): Promise<PartnerOption[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("business_partners")
    .select("id, name, aliases, address, invoice_registration_number")
    .eq("client_id", clientId)
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((p) => {
    const r = p as DbRow;
    return {
      id: r.id as string,
      name: (r.name as string) ?? "",
      aliases: (r.aliases as string[] | null) ?? [],
      address: (r.address as string | null) ?? "",
      registrationNumber: (r.invoice_registration_number as string | null) ?? "",
    };
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 1つの様式の明細を、渡された内容で置き換えて保存する。
 * 画面で消した行は削除する。別の顧問先・別の様式の行を書き換えないよう、
 * この様式・この期に既にある行のIDだけを引き継ぎ、それ以外は新しい行として作る。
 */
export async function saveBreakdownItems(
  clientId: string,
  periodKey: string,
  key: string,
  items: BreakdownItem[]
): Promise<BreakdownItem[]> {
  await assertClientAccess(clientId);
  const spec = findItemFormSpec(key);
  if (!spec) throw new Error("この内訳書は明細を入力する様式ではありません");
  const period = await loadPeriod(clientId, periodKey);
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const sections = new Set(spec.sections.map((x) => x.key));
  for (const i of items) {
    if (!sections.has(i.section)) throw new Error("明細の区分が正しくありません");
    if (!Number.isFinite(i.amount)) throw new Error("金額が正しくありません");
  }

  // 科目・取引先が、この顧問先のものかを確かめる
  const accountIds = [...new Set(items.map((i) => i.accountId).filter(Boolean))] as string[];
  if (accountIds.length) {
    const { data } = await supabase.from("accounts").select("id, client_id").in("id", accountIds);
    const ok = (data ?? []).filter((a) => a.client_id === clientId || a.client_id == null);
    if (ok.length !== accountIds.length) throw new Error("この顧問先の科目ではありません");
  }
  const partnerIds = [...new Set(items.map((i) => i.partnerId).filter(Boolean))] as string[];
  if (partnerIds.length) {
    const { data } = await supabase
      .from("business_partners")
      .select("id")
      .eq("client_id", clientId)
      .in("id", partnerIds);
    if ((data ?? []).length !== partnerIds.length) throw new Error("この顧問先の取引先ではありません");
  }

  const existing = await loadItems(clientId, period.startDate, key);
  const existingIds = new Set(existing.map((i) => i.id));
  const now = new Date().toISOString();
  const rows = items.map((i, idx) => ({
    id: existingIds.has(i.id) && UUID.test(i.id) ? i.id : crypto.randomUUID(),
    client_id: clientId,
    period_start: period.startDate,
    form_key: key,
    section: i.section,
    account_id: i.accountId,
    partner_id: i.partnerId,
    name: i.name.trim(),
    address: i.address.trim(),
    registration_number: i.registrationNumber.trim(),
    relationship: i.relationship.trim(),
    amount: Math.round(i.amount),
    note: i.note.trim(),
    details: i.details,
    sort_order: idx,
    created_by: user?.id ?? null,
    updated_at: now,
  }));

  const keep = new Set(rows.map((r) => r.id));
  const removed = existing.filter((i) => !keep.has(i.id)).map((i) => i.id);
  if (removed.length) {
    const { error } = await supabase.from("breakdown_items").delete().in("id", removed);
    if (error) throw new Error(error.message);
  }
  if (rows.length) {
    const { error } = await supabase.from("breakdown_items").upsert(rows);
    if (error) throw new Error(error.message);
  }
  return loadItems(clientId, period.startDate, key);
}

/**
 * ③売掛金の下書き。請求書のうち、期末日までに発行し期末日時点で未回収のものを
 * 取引先ごとに合計する（期末日より後の入金は差し引かない）。
 * 保存はしない。画面で確かめてから保存してもらう。
 */
export async function draftReceivablesFromInvoices(
  clientId: string,
  periodKey: string
): Promise<BreakdownItem[]> {
  await assertClientAccess(clientId);
  const period = await loadPeriod(clientId, periodKey);
  const supabase = await createServerSupabaseClient();

  type InvoiceRow = {
    business_partner_id: string | null;
    total_amount: number;
    business_partners: { id: string; name: string; address: string | null; invoice_registration_number: string | null } | null;
    payment_allocations: { allocated_amount: number; payments: { payment_date: string } | null }[];
  };
  const invoices = await fetchAllRows<InvoiceRow>((from, to) =>
    supabase
      .from("invoices")
      .select(
        "business_partner_id, total_amount, business_partners:business_partner_id ( id, name, address, invoice_registration_number ), payment_allocations ( allocated_amount, payments ( payment_date ) )"
      )
      .eq("client_id", clientId)
      .eq("direction", "sales")
      .neq("status", "void")
      .lte("issued_date", period.endDate)
      .range(from, to) as unknown as PromiseLike<{ data: InvoiceRow[] | null; error: { message: string } | null }>
  );

  const byPartner = new Map<string, { partner: InvoiceRow["business_partners"]; amount: number }>();
  for (const inv of invoices) {
    const collected = (inv.payment_allocations ?? [])
      .filter((a) => a.payments?.payment_date && a.payments.payment_date <= period.endDate)
      .reduce((s, a) => s + (Number(a.allocated_amount) || 0), 0);
    const remaining = (Number(inv.total_amount) || 0) - collected;
    if (remaining <= 0) continue;
    const k = inv.business_partner_id ?? "";
    const g = byPartner.get(k);
    if (g) g.amount += remaining;
    else byPartner.set(k, { partner: inv.business_partners, amount: remaining });
  }

  const balances = await loadBalances(clientId, period);
  const receivable =
    balances.find((a) => a.category === "asset" && a.name === "売掛金") ??
    balances.find((a) => a.category === "asset" && a.name.includes("売掛金"));

  return [...byPartner.values()]
    .sort((a, b) => b.amount - a.amount)
    .map((g, idx) => ({
      id: crypto.randomUUID(),
      section: "main",
      accountId: receivable?.id ?? null,
      partnerId: g.partner?.id ?? null,
      name: g.partner?.name ?? "取引先未設定",
      address: g.partner?.address ?? "",
      registrationNumber: g.partner?.invoice_registration_number ?? "",
      relationship: "",
      amount: Math.round(g.amount),
      note: "",
      details: {},
      sortOrder: idx,
    }));
}
