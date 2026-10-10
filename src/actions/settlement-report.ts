"use server";

import { createAdminSupabaseClient } from "@/lib/supabase";
import { assertClientAccess } from "@/lib/authz";
import { getTrialBalance, type TrialBalanceRow } from "@/actions/statements";
import { resolveFiscalPeriodByKey, adjacentFiscalPeriodKeys, type FiscalPeriodRow } from "@/lib/fiscal";
import { buildEquityChanges, type EquityChanges } from "@/lib/equity-changes";
import { buildNotes, type NoteSection } from "@/lib/financial-notes";

type DbRow = Record<string, unknown>;

export interface ReportLine {
  name: string;
  amount: number;
  prior: number;
}

// 貸借対照表の表示区分（流動資産／固定資産（有形・無形・投資その他）／繰延資産、流動負債／固定負債 など）
export interface BsGroup {
  title: string;
  lines: ReportLine[];
  total: number;
  subgroups?: BsGroup[];
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
  // 貸借対照表（勘定式・区分表示）
  bs: {
    assetGroups: BsGroup[];      // 流動資産・固定資産（有形/無形/投資その他）・繰延資産
    liabilityGroups: BsGroup[];  // 流動負債・固定負債
    equityGroups: BsGroup[];     // 株主資本（繰越利益剰余金は当期純利益込み）
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
  changesInEquity: EquityChanges;
  // 個別注記表
  notes: NoteSection[];
}

function dayBefore(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d - 1));
  return t.toISOString().slice(0, 10);
}

function plAmount(r: TrialBalanceRow): number {
  return r.category === "revenue"
    ? r.creditBalance - r.debitBalance
    : r.debitBalance - r.creditBalance;
}

// 資産科目の表示区分を科目名から推定する
type AssetSub = "current" | "tangible" | "intangible" | "investment" | "deferred";
function classifyAsset(name: string): AssetSub {
  if (/創立費|開業費|開発費|株式交付費|社債発行費/.test(name)) return "deferred";
  if (/減価償却累計|建物|構築物|機械|装置|車両|運搬具|工具|器具|備品|土地|一括償却|建設仮勘定|附属設備/.test(name))
    return "tangible";
  if (/ソフトウェア|のれん|特許|商標|意匠|借地権|電話加入権/.test(name)) return "intangible";
  if (/投資有価証券|出資金|敷金|保証金|差入保証金|保険積立|長期前払|長期貸付|関係会社/.test(name))
    return "investment";
  return "current";
}

// 負債科目が固定負債かどうかを科目名から推定する
function isFixedLiability(name: string): boolean {
  return /長期|社債|退職給付|退職給与/.test(name);
}

/**
 * 決算書。期は "2025"（その年に始まる期）か "2025-04-01"（その日に始まる期）で指定する。
 * 決算月を変えた年の変則期間は fiscal_years の記録どおりの期間で作る（lib/fiscal.ts の resolveFiscalPeriodByKey）。
 */
export async function getSettlementReport(
  clientId: string,
  periodKey: string | number
): Promise<SettlementReport> {
  await assertClientAccess(clientId);
  const admin = createAdminSupabaseClient();

  // 会社情報
  const { data: clientRow } = await admin
    .from("clients")
    .select(
      "name, postal_code, address, telephone, invoice_registration_number, fiscal_year_start_month, firm_id, tax_method, consumption_tax_status"
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
  const { data: fyRows } = await admin.from("fiscal_years").select("start_date, end_date").eq("client_id", clientId);
  const periods = (fyRows ?? []) as FiscalPeriodRow[];
  const cur = resolveFiscalPeriodByKey(periods, startMonth, String(periodKey));
  const prevStart = resolveFiscalPeriodByKey(periods, startMonth, adjacentFiscalPeriodKeys(periods, cur).prevKey).startDate;
  // 前期は当期の期首の前日まで（記録が食い違っていてもつながるように）
  const prev = { startDate: prevStart, endDate: dayBefore(cur.startDate) };

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
  const assetRows = curTrial.filter((r) => r.category === "asset");
  const liabilityRows = curTrial.filter((r) => r.category === "liability");
  const equityRows = curTrial.filter((r) => r.category === "equity");

  const mkGroup = (title: string, lines: ReportLine[]): BsGroup => ({
    title,
    lines,
    total: lines.reduce((s, i) => s + i.amount, 0),
  });

  // 資産の部（流動／固定（有形・無形・投資その他）／繰延）
  const assetsBySub = new Map<AssetSub, ReportLine[]>();
  for (const r of assetRows) {
    const sub = classifyAsset(r.name);
    const arr = assetsBySub.get(sub) ?? [];
    arr.push(bsLine(r, true));
    assetsBySub.set(sub, arr);
  }
  const currentAssets = mkGroup("流動資産", assetsBySub.get("current") ?? []);
  const fixedSubs = (
    [
      ["有形固定資産", "tangible"],
      ["無形固定資産", "intangible"],
      ["投資その他の資産", "investment"],
    ] as const
  )
    .map(([title, key]) => mkGroup(title, assetsBySub.get(key) ?? []))
    .filter((g) => g.lines.length > 0);
  const fixedAssets: BsGroup = {
    title: "固定資産",
    lines: [],
    total: fixedSubs.reduce((s, g) => s + g.total, 0),
    subgroups: fixedSubs,
  };
  const deferredAssets = mkGroup("繰延資産", assetsBySub.get("deferred") ?? []);
  const assetGroups: BsGroup[] = [
    currentAssets,
    ...(fixedSubs.length > 0 ? [fixedAssets] : []),
    ...(deferredAssets.lines.length > 0 ? [deferredAssets] : []),
  ];

  // 負債の部（流動／固定）
  const currentLiabilities = mkGroup(
    "流動負債",
    liabilityRows.filter((r) => !isFixedLiability(r.name)).map((r) => bsLine(r, false))
  );
  const fixedLiabilities = mkGroup(
    "固定負債",
    liabilityRows.filter((r) => isFixedLiability(r.name)).map((r) => bsLine(r, false))
  );
  const liabilityGroups: BsGroup[] = [
    currentLiabilities,
    ...(fixedLiabilities.lines.length > 0 ? [fixedLiabilities] : []),
  ];

  const totalAssets = assetRows.reduce((s, r) => s + (r.debitBalance - r.creditBalance), 0);
  const totalLiabilities = liabilityRows.reduce(
    (s, r) => s + (r.creditBalance - r.debitBalance),
    0
  );
  const equityBase = equityRows.reduce((s, r) => s + (r.creditBalance - r.debitBalance), 0);

  // 当期純利益（当期・前期）
  const sumNetIncome = (trial: TrialBalanceRow[]): number => {
    const rev = trial
      .filter((r) => r.category === "revenue")
      .reduce((s, r) => s + (r.creditBalance - r.debitBalance), 0);
    const exp = trial
      .filter((r) => r.category === "expense")
      .reduce((s, r) => s + (r.debitBalance - r.creditBalance), 0);
    return rev - exp;
  };
  const netIncome = sumNetIncome(curTrial);
  const prevNetIncome = sumNetIncome(prevTrial);
  const totalEquity = equityBase + netIncome;
  const totalLE = totalLiabilities + totalEquity;

  // 純資産の部（株主資本）— 当期純利益は繰越利益剰余金に算入して表示する
  const equityLines = equityRows.map((r) => bsLine(r, false));
  const retainedLine =
    equityLines.find((l) => l.name.includes("繰越利益")) ??
    equityLines.find((l) => l.name.includes("利益剰余金"));
  if (retainedLine) {
    retainedLine.amount += netIncome;
    retainedLine.prior += prevNetIncome;
  } else {
    equityLines.push({ name: "繰越利益剰余金", amount: netIncome, prior: prevNetIncome });
  }
  const equityGroups: BsGroup[] = [
    { title: "株主資本", lines: equityLines, total: totalEquity },
  ];

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
  // 各純資産科目の 期首(=-prevBalance) / 期末(=creditBalance-debitBalance)。貸方プラス
  const equityAccounts = curTrial
    .filter((x) => x.category === "equity")
    .map((r) => ({ name: r.name, opening: -r.prevBalance, closing: r.creditBalance - r.debitBalance }));
  const changesInEquity = buildEquityChanges(equityAccounts, netIncome);

  // --- 個別注記表 ---
  // 期末に持っている（期首より前に除却していない・期末までに取得した）固定資産の償却方法
  const { data: fixedAssetRows } = await admin
    .from("fixed_assets")
    .select("depreciation_method, acquisition_date, disposed_at")
    .eq("client_id", clientId)
    .lte("acquisition_date", cur.endDate);
  const depreciationMethods = ((fixedAssetRows ?? []) as DbRow[])
    .filter((a) => !a.disposed_at || (a.disposed_at as string) >= cur.startDate)
    .map((a) => a.depreciation_method as string);
  // 免税事業者は税込方式。それ以外は当期に仮受・仮払消費税の動きがあれば税抜方式
  const exclusive =
    c.consumption_tax_status !== "exempt" &&
    curTrial.some((r) => /^仮(受|払)消費税/.test(r.name) && (r.debitTotal !== 0 || r.creditTotal !== 0));
  const notes = buildNotes({
    depreciationMethods,
    taxAccounting: exclusive ? "exclusive" : "inclusive",
    hasTreasuryStock: changesInEquity.columns.some((col) => col.kind === "treasury" && col.closing !== 0),
  });

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
      assetGroups,
      liabilityGroups,
      equityGroups,
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
    changesInEquity,
    notes,
  };
}
