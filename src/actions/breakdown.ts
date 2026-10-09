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

export type BreakdownFormData = (LoanFormData | PersonnelFormData | MiscFormData) & {
  def: BreakdownFormDef;
  period: BreakdownPeriod;
};

export type BreakdownOverviewItem = {
  def: BreakdownFormDef;
  /** 作成できる様式のみ。記入額の合計と照合結果 */
  summary?: { total: number; checks: { label: string; check: Reconciliation; informational: boolean }[] };
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
): Promise<LoanFormData | PersonnelFormData | MiscFormData | null> {
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
  if (def.status !== "ready") throw new Error(`${def.number}${def.title}は準備中です`);

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

  const items = await Promise.all(
    BREAKDOWN_FORMS.map(async (def): Promise<BreakdownOverviewItem> => {
      if (def.status !== "ready") return { def };
      const data = await buildForm(clientId, period, balances, def.key);
      if (!data) return { def };
      switch (data.kind) {
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
