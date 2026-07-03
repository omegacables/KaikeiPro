"use server";

// 経営ダッシュボード（ポータル「経営」タブ）用の集計。
// 会社の財産（現金預金・純資産）、業績（売上・利益の月次推移）、
// 役員報酬・社員給与を1回の呼び出しでまとめて返す。

import { createAdminSupabaseClient } from "@/lib/supabase";
import { assertClientAccess } from "@/lib/authz";
import { fiscalRangeFromStartYear, currentFiscalStartYear } from "@/lib/fiscal";

type DbRow = Record<string, unknown>;

export interface MonthPoint {
  month: string; // YYYY-MM
  label: string; // N月
  sales: number;
  profit: number;
  cashBalance: number; // 月末の現金・預金残高
}

export interface PayrollLine {
  name: string;
  gross: number; // 総支給
  net: number; // 手取り
}

export interface ExecutiveSummary {
  companyName: string;
  period: { start: string; end: string };
  asOf: string; // 集計基準日
  wealth: {
    cashAndDeposits: number;
    totalAssets: number;
    totalLiabilities: number;
    netAssets: number; // 当期利益込み
  };
  performance: {
    sales: number; // 当期累計売上
    netIncome: number; // 当期利益
    months: MonthPoint[]; // 期首月〜当月
  };
  executive: {
    latestMonth: string | null; // YYYY-MM
    latestMonthly: number; // 直近月の役員報酬（総支給）
    yearTotal: number; // 今期累計
    officers: PayrollLine[]; // 直近月の役員別
    source: "payroll" | "journal";
  };
  payroll: {
    latestMonth: string | null;
    latestTotal: number; // 直近月の給与合計（総支給）
    latestCount: number; // 直近月の人数
    yearTotal: number; // 今期累計
    employees: PayrollLine[]; // 直近月の従業員別
    source: "payroll" | "journal";
  };
}

const CASH_NAME = /現金|預金|貯金|小口/;
const OFFICER_PAY_NAME = /役員報酬/;
const EMPLOYEE_PAY_NAME = /給料|給与|賃金|雑給/;

function monthKey(date: string): string {
  return date.slice(0, 7);
}

export async function getExecutiveSummary(clientId: string): Promise<ExecutiveSummary> {
  await assertClientAccess(clientId);
  const admin = createAdminSupabaseClient();

  // 会社情報と会計年度
  const { data: clientRow, error: clientErr } = await admin
    .from("clients")
    .select("name, fiscal_year_start_month")
    .eq("id", clientId)
    .single();
  if (clientErr) throw new Error(clientErr.message);
  const c = clientRow as DbRow;
  const startMonth = (c.fiscal_year_start_month as number) ?? 4;
  const fy = fiscalRangeFromStartYear(startMonth, currentFiscalStartYear(startMonth));

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const asOf = todayStr < fy.endDate ? todayStr : fy.endDate;

  // 期首月〜基準日の月キー
  const months: { month: string; label: string }[] = [];
  {
    const [sy, sm] = fy.startDate.split("-").map(Number);
    const endKey = monthKey(asOf);
    let y = sy;
    let m = sm;
    for (let i = 0; i < 12; i++) {
      const key = `${y}-${String(m).padStart(2, "0")}`;
      months.push({ month: key, label: `${m}月` });
      if (key === endKey) break;
      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
    }
  }

  // 勘定科目と仕訳明細（基準日まで全件）を並列取得
  const [accountsRes, linesRes, payrollRes] = await Promise.all([
    admin
      .from("accounts")
      .select("id, name, account_categories!inner ( type )")
      .or(`client_id.eq.${clientId},is_default.eq.true`)
      .eq("is_active", true),
    admin
      .from("journal_entry_lines")
      .select(
        "account_id, debit_amount, credit_amount, journal_entries!inner ( client_id, entry_date, source )"
      )
      .eq("journal_entries.client_id", clientId)
      .lte("journal_entries.entry_date", asOf),
    admin
      .from("payroll_records")
      .select("pay_month, employee_name, employee_type, gross_salary, net_pay")
      .eq("client_id", clientId)
      .gte("pay_month", fy.startDate)
      .lte("pay_month", fy.endDate)
      .order("pay_month"),
  ]);
  if (accountsRes.error) throw new Error(accountsRes.error.message);
  if (linesRes.error) throw new Error(linesRes.error.message);
  if (payrollRes.error) throw new Error(payrollRes.error.message);

  type AcctInfo = { name: string; type: string };
  const accounts = new Map<string, AcctInfo>();
  for (const a of accountsRes.data ?? []) {
    const cat = (a as DbRow).account_categories as { type: string };
    accounts.set((a as DbRow).id as string, {
      name: (a as DbRow).name as string,
      type: cat.type,
    });
  }

  // 集計（残高＝借方プラス、負債純資産収益は後で反転）
  const balance = new Map<string, number>(); // 基準日残高
  const cashOpening = { value: 0 };
  const monthIdx = new Map(months.map((m, i) => [m.month, i]));
  const cashFlow = new Array<number>(months.length).fill(0);
  const salesFlow = new Array<number>(months.length).fill(0);
  const profitFlow = new Array<number>(months.length).fill(0);
  const officerFlowJournal = new Array<number>(months.length).fill(0);
  const employeeFlowJournal = new Array<number>(months.length).fill(0);

  for (const line of linesRes.data ?? []) {
    const l = line as DbRow;
    const acct = accounts.get(l.account_id as string);
    if (!acct) continue;
    const entry = l.journal_entries as unknown as { entry_date: string; source?: string };
    const net = (l.debit_amount as number) - (l.credit_amount as number);

    balance.set(l.account_id as string, (balance.get(l.account_id as string) ?? 0) + net);

    const isCash = acct.type === "assets" && CASH_NAME.test(acct.name);
    // 期首残高仕訳（期首日付・source='closing'）は前期繰越として扱う
    const isOpening =
      entry.entry_date < fy.startDate ||
      (entry.entry_date === fy.startDate && entry.source === "closing");
    if (isCash && isOpening) cashOpening.value += net;

    if (isOpening) continue;
    const idx = monthIdx.get(monthKey(entry.entry_date));
    if (idx === undefined) continue;

    if (isCash) cashFlow[idx] += net;
    if (acct.type === "revenue") {
      const amount = -net; // 収益は貸方プラス
      salesFlow[idx] += amount;
      profitFlow[idx] += amount;
    } else if (acct.type === "expenses") {
      profitFlow[idx] -= net;
      if (OFFICER_PAY_NAME.test(acct.name)) officerFlowJournal[idx] += net;
      else if (EMPLOYEE_PAY_NAME.test(acct.name)) employeeFlowJournal[idx] += net;
    }
  }

  // 財産（基準日時点）。純資産は「資産 − 負債」で算出する
  // （過年度の損益振替の有無に左右されない、社長向けに最も直感的な定義）
  let cashAndDeposits = 0;
  let totalAssets = 0;
  let totalLiabilities = 0;
  for (const [accountId, bal] of balance) {
    const acct = accounts.get(accountId);
    if (!acct) continue;
    if (acct.type === "assets") {
      totalAssets += bal;
      if (CASH_NAME.test(acct.name)) cashAndDeposits += bal;
    } else if (acct.type === "liabilities") {
      totalLiabilities += -bal;
    }
  }
  const netAssets = totalAssets - totalLiabilities;

  // 業績は当期（期首〜基準日）のフローから算出
  const salesTotal = salesFlow.reduce((s, v) => s + v, 0);
  const netIncome = profitFlow.reduce((s, v) => s + v, 0);

  // 月次推移（現金残高は期首から累積）
  const monthPoints: MonthPoint[] = [];
  let cashRun = cashOpening.value;
  for (let i = 0; i < months.length; i++) {
    cashRun += cashFlow[i];
    monthPoints.push({
      month: months[i].month,
      label: months[i].label,
      sales: salesFlow[i],
      profit: profitFlow[i],
      cashBalance: cashRun,
    });
  }

  // 給与（給与台帳を優先、無ければ仕訳の科目から推定）
  type PayRow = {
    pay_month: string;
    employee_name: string;
    employee_type: string;
    gross_salary: number;
    net_pay: number;
  };
  const payRows = (payrollRes.data ?? []) as unknown as PayRow[];
  const officerRows = payRows.filter((r) => r.employee_type === "officer");
  const employeeRows = payRows.filter((r) => r.employee_type !== "officer");

  const buildFromPayroll = (rows: PayRow[]) => {
    if (rows.length === 0) return null;
    const latestMonth = monthKey(rows[rows.length - 1].pay_month);
    const latest = rows.filter((r) => monthKey(r.pay_month) === latestMonth);
    return {
      latestMonth,
      latestTotal: latest.reduce((s, r) => s + r.gross_salary, 0),
      latestCount: latest.length,
      yearTotal: rows.reduce((s, r) => s + r.gross_salary, 0),
      lines: latest.map((r) => ({
        name: r.employee_name,
        gross: r.gross_salary,
        net: r.net_pay,
      })),
    };
  };

  const buildFromJournal = (flow: number[]) => {
    let latestIdx = -1;
    for (let i = flow.length - 1; i >= 0; i--) {
      if (flow[i] !== 0) {
        latestIdx = i;
        break;
      }
    }
    return {
      latestMonth: latestIdx >= 0 ? months[latestIdx].month : null,
      latestTotal: latestIdx >= 0 ? flow[latestIdx] : 0,
      latestCount: 0,
      yearTotal: flow.reduce((s, v) => s + v, 0),
      lines: [] as PayrollLine[],
    };
  };

  const officer = buildFromPayroll(officerRows);
  const officerJ = buildFromJournal(officerFlowJournal);
  const employee = buildFromPayroll(employeeRows);
  const employeeJ = buildFromJournal(employeeFlowJournal);

  return {
    companyName: (c.name as string) ?? "",
    period: { start: fy.startDate, end: fy.endDate },
    asOf,
    wealth: { cashAndDeposits, totalAssets, totalLiabilities, netAssets },
    performance: { sales: salesTotal, netIncome, months: monthPoints },
    executive: {
      latestMonth: officer?.latestMonth ?? officerJ.latestMonth,
      latestMonthly: officer?.latestTotal ?? officerJ.latestTotal,
      yearTotal: officer?.yearTotal ?? officerJ.yearTotal,
      officers: officer?.lines ?? [],
      source: officer ? "payroll" : "journal",
    },
    payroll: {
      latestMonth: employee?.latestMonth ?? employeeJ.latestMonth,
      latestTotal: employee?.latestTotal ?? employeeJ.latestTotal,
      latestCount: employee?.latestCount ?? 0,
      yearTotal: employee?.yearTotal ?? employeeJ.yearTotal,
      employees: employee?.lines ?? [],
      source: employee ? "payroll" : "journal",
    },
  };
}
