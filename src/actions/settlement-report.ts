"use server";

import { createAdminSupabaseClient } from "@/lib/supabase";
import { assertClientAccess } from "@/lib/authz";
import { getTrialBalance, type TrialBalanceRow } from "@/actions/statements";
import { fiscalRangeFromStartYear } from "@/lib/fiscal";

type DbRow = Record<string, unknown>;

export interface ReportLine {
  name: string;
  amount: number;
  prior: number;
}

export interface SettlementReport {
  company: {
    name: string;
    postalCode: string | null;
    address: string | null;
    telephone: string | null;
    registrationNumber: string | null;
  };
  preparer: { name: string; address: string | null } | null;
  period: { start: string; end: string };
  priorPeriod: { start: string; end: string };
  // 貸借対照表
  bs: {
    assets: ReportLine[];
    liabilities: ReportLine[];
    equity: ReportLine[];
    netIncome: number;
    totalAssets: number;
    totalLiabilities: number;
    totalEquity: number; // 当期純利益込み
    balanced: boolean;
  };
  // 損益計算書
  pl: {
    sales: ReportLine[];
    cogs: ReportLine[];
    sga: ReportLine[];
    nonOpRev: ReportLine[];
    nonOpExp: ReportLine[];
    extraGain: ReportLine[];
    extraLoss: ReportLine[];
    tax: ReportLine[];
    salesT: number;
    cogsT: number;
    grossProfit: number;
    sgaT: number;
    operatingProfit: number;
    nonOpRevT: number;
    nonOpExpT: number;
    ordinaryProfit: number;
    extraGainT: number;
    extraLossT: number;
    pretaxProfit: number;
    taxT: number;
    netIncome: number;
  };
  // 株主資本等変動計算書
  changesInEquity: {
    rows: { label: string; opening: number; change: number; closing: number }[];
    total: { opening: number; change: number; closing: number };
  };
  // 個別注記表
  notes: { heading: string; body: string }[];
}

function plAmount(r: TrialBalanceRow): number {
  return r.category === "revenue"
    ? r.creditBalance - r.debitBalance
    : r.debitBalance - r.creditBalance;
}

export async function getSettlementReport(
  clientId: string,
  fiscalStartYear: number
): Promise<SettlementReport> {
  await assertClientAccess(clientId);
  const admin = createAdminSupabaseClient();

  // 会社情報
  const { data: clientRow } = await admin
    .from("clients")
    .select(
      "name, postal_code, address, telephone, invoice_registration_number, fiscal_year_start_month, firm_id, tax_method"
    )
    .eq("id", clientId)
    .single();
  const c = (clientRow as DbRow | null) ?? {};
  const startMonth = (c.fiscal_year_start_month as number) ?? 4;

  // 作成者（税理士事務所）
  let preparer: SettlementReport["preparer"] = null;
  if (c.firm_id) {
    const { data: firm } = await admin
      .from("firms")
      .select("name, address")
      .eq("id", c.firm_id as string)
      .single();
    if (firm) {
      preparer = {
        name: (firm as DbRow).name as string,
        address: ((firm as DbRow).address as string) ?? null,
      };
    }
  }

  // 当期・前期の期間
  const cur = fiscalRangeFromStartYear(startMonth, fiscalStartYear);
  const prev = fiscalRangeFromStartYear(startMonth, fiscalStartYear - 1);

  // 試算表（当期・前期）
  const [curTrial, prevTrial] = await Promise.all([
    getTrialBalance(clientId, cur.startDate, cur.endDate),
    getTrialBalance(clientId, prev.startDate, prev.endDate),
  ]);

  // 前期の金額をコードで引けるマップ
  const priorBsMap = new Map<string, number>();
  const priorPlMap = new Map<string, number>();
  for (const r of prevTrial) {
    if (r.category === "asset") priorBsMap.set(r.code, r.debitBalance - r.creditBalance);
    else if (r.category === "liability" || r.category === "equity")
      priorBsMap.set(r.code, r.creditBalance - r.debitBalance);
    else priorPlMap.set(r.code, plAmount(r));
  }

  // --- BS ---
  const bsLine = (r: TrialBalanceRow, asset: boolean): ReportLine => ({
    name: r.name,
    amount: asset ? r.debitBalance - r.creditBalance : r.creditBalance - r.debitBalance,
    prior: priorBsMap.get(r.code) ?? 0,
  });
  const assets = curTrial.filter((r) => r.category === "asset").map((r) => bsLine(r, true));
  const liabilities = curTrial
    .filter((r) => r.category === "liability")
    .map((r) => bsLine(r, false));
  const equity = curTrial.filter((r) => r.category === "equity").map((r) => bsLine(r, false));

  const totalAssets = assets.reduce((s, i) => s + i.amount, 0);
  const totalLiabilities = liabilities.reduce((s, i) => s + i.amount, 0);
  const equityBase = equity.reduce((s, i) => s + i.amount, 0);

  // 当期純利益
  const revenueT = curTrial
    .filter((r) => r.category === "revenue")
    .reduce((s, r) => s + (r.creditBalance - r.debitBalance), 0);
  const expenseT = curTrial
    .filter((r) => r.category === "expense")
    .reduce((s, r) => s + (r.debitBalance - r.creditBalance), 0);
  const netIncome = revenueT - expenseT;
  const totalEquity = equityBase + netIncome;
  const totalLE = totalLiabilities + totalEquity;

  // --- PL ---
  const itemsOf = (cls: string): ReportLine[] =>
    curTrial
      .filter((r) => r.plClassification === cls)
      .map((r) => ({ name: r.name, amount: plAmount(r), prior: priorPlMap.get(r.code) ?? 0 }));
  const sum = (items: ReportLine[]) => items.reduce((s, i) => s + i.amount, 0);

  const sales = itemsOf("sales");
  const cogs = itemsOf("cogs");
  const sga = itemsOf("sga");
  const nonOpRev = itemsOf("non_op_revenue");
  const nonOpExp = itemsOf("non_op_expense");
  const extraGain = itemsOf("extraordinary_gain");
  const extraLoss = itemsOf("extraordinary_loss");
  const tax = itemsOf("tax");

  const salesT = sum(sales);
  const cogsT = sum(cogs);
  const sgaT = sum(sga);
  const nonOpRevT = sum(nonOpRev);
  const nonOpExpT = sum(nonOpExp);
  const extraGainT = sum(extraGain);
  const extraLossT = sum(extraLoss);
  const taxT = sum(tax);

  const grossProfit = salesT - cogsT;
  const operatingProfit = grossProfit - sgaT;
  const ordinaryProfit = operatingProfit + nonOpRevT - nonOpExpT;
  const pretaxProfit = ordinaryProfit + extraGainT - extraLossT;
  const plNetIncome = pretaxProfit - taxT;

  // --- 株主資本等変動計算書 ---
  // 各純資産科目の 期首(=-prevBalance) / 期末(=creditBalance-debitBalance)
  const capitalKw = ["資本金", "資本準備金"];
  const retainedKw = ["利益剰余金", "繰越利益", "利益準備金", "別途積立金"];
  type Grp = { opening: number; change: number; closing: number };
  const mkGrp = (): Grp => ({ opening: 0, change: 0, closing: 0 });
  const capital = mkGrp();
  const retained = mkGrp();
  const other = mkGrp();
  for (const r of curTrial.filter((x) => x.category === "equity")) {
    const opening = -r.prevBalance; // 純資産の期首（貸方プラス）
    const closing = r.creditBalance - r.debitBalance;
    const grp = capitalKw.some((k) => r.name.includes(k))
      ? capital
      : retainedKw.some((k) => r.name.includes(k))
        ? retained
        : other;
    grp.opening += opening;
    grp.closing += closing;
    grp.change += closing - opening;
  }
  // 当期純利益を繰越利益剰余金（利益剰余金）の変動に反映
  retained.change += netIncome;
  retained.closing += netIncome;

  const ceRows: { label: string; opening: number; change: number; closing: number }[] = [];
  if (capital.opening !== 0 || capital.closing !== 0)
    ceRows.push({ label: "資本金", ...capital });
  ceRows.push({ label: "利益剰余金", ...retained });
  if (other.opening !== 0 || other.closing !== 0)
    ceRows.push({ label: "その他純資産", ...other });
  const ceTotal = {
    opening: capital.opening + retained.opening + other.opening,
    change: capital.change + retained.change + other.change,
    closing: capital.closing + retained.closing + other.closing,
  };

  // --- 個別注記表（定型） ---
  const taxLabel = c.tax_method === "simplified" ? "簡易課税" : "原則課税";
  const notes: { heading: string; body: string }[] = [
    {
      heading: "重要な会計方針に係る事項に関する注記",
      body:
        "1. 固定資産の減価償却の方法\n" +
        "　有形固定資産は定率法（ただし建物等は定額法）、無形固定資産は定額法によっている。\n" +
        "2. 消費税等の会計処理\n" +
        `　消費税等の会計処理は税抜方式によっている（消費税の計算方法：${taxLabel}）。`,
    },
    {
      heading: "株式会社に関する注記",
      body: "該当事項はありません。",
    },
    {
      heading: "その他の注記",
      body: "記載すべき重要な事項はありません。",
    },
  ];

  return {
    company: {
      name: (c.name as string) ?? "",
      postalCode: (c.postal_code as string) ?? null,
      address: (c.address as string) ?? null,
      telephone: (c.telephone as string) ?? null,
      registrationNumber: (c.invoice_registration_number as string) ?? null,
    },
    preparer,
    period: { start: cur.startDate, end: cur.endDate },
    priorPeriod: { start: prev.startDate, end: prev.endDate },
    bs: {
      assets,
      liabilities,
      equity,
      netIncome,
      totalAssets,
      totalLiabilities,
      totalEquity,
      balanced: totalAssets === totalLE,
    },
    pl: {
      sales,
      cogs,
      sga,
      nonOpRev,
      nonOpExp,
      extraGain,
      extraLoss,
      tax,
      salesT,
      cogsT,
      grossProfit,
      sgaT,
      operatingProfit,
      nonOpRevT,
      nonOpExpT,
      ordinaryProfit,
      extraGainT,
      extraLossT,
      pretaxProfit,
      taxT,
      netIncome: plNetIncome,
    },
    changesInEquity: { rows: ceRows, total: ceTotal },
    notes,
  };
}
