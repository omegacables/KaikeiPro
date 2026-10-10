"use server";

/**
 * 法人税申告書。計算は src/lib/corporate-tax-return.ts（テストあり）。
 * 帳簿（試算表）と固定資産台帳から数字を集め、期ごとの入力（corporate_tax_returns）と合わせて計算する。
 * 期ごとの入力が無い期は、前期の申告（保存済みなら）の翌期首の利益積立金・繰越欠損金・事業税を引き継ぐ。
 */

import { createServerSupabaseClient } from "@/lib/supabase";
import { assertClientAccess } from "@/lib/authz";
import {
  resolveFiscalPeriodByKey,
  adjacentFiscalPeriodKeys,
  currentFiscalStartYear,
  type FiscalPeriodRow,
} from "@/lib/fiscal";
import {
  computeCorporateTaxReturn,
  STANDARD_LOCAL_RATES,
  type CorporateInput,
  type CorporateTaxReturn,
  type Adjustment,
  type LossCarryforward,
  type RetainedItem,
  type LocalTaxRates,
} from "@/lib/corporate-tax-return";
import { getTrialBalance } from "@/actions/statements";
import { getDepreciationBook } from "@/actions/assets";

type Db = Awaited<ReturnType<typeof createServerSupabaseClient>>;

/** 画面で入力する値（期ごとに保存） */
export type CorporateReturnInputs = {
  capital: number | null;
  employees: number | null;
  interim: CorporateInput["interim"];
  withholdingTax: number;
  losses: LossCarryforward[];
  openingRetained: RetainedItem[];
  adjustments: Adjustment[];
  localRates: LocalTaxRates;
  priorEnterpriseTaxPaid: number;
  entertainmentDining: number | null;
  note: string | null;
};

export type CorporateReturnView = {
  period: { startDate: string; endDate: string; key: string; prevKey: string; nextKey: string; months: number };
  entityType: "individual" | "corporation" | null;
  clientCapital: number | null;
  inputs: CorporateReturnInputs;
  /** 入力を保存しているか。false なら前期の申告からの引き継ぎ（または空） */
  saved: boolean;
  /** 前期の申告から引き継いだか */
  carriedFromPrior: boolean;
  /** 帳簿から集めた数字 */
  books: { netIncome: number; taxExpenseBooked: number; entertainment: number; depreciationExcess: number; depreciationAllowed: number };
  result: CorporateTaxReturn;
};

const monthIndex = (iso: string) => {
  const [y, m] = iso.split("-").map(Number);
  return y * 12 + (m - 1);
};

const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0);
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

type SavedRow = {
  capital_amount: number | null;
  employees: number | null;
  interim_corporate_tax: number;
  interim_local_corporate_tax: number;
  interim_prefectural: number;
  interim_municipal: number;
  interim_enterprise: number;
  withholding_income_tax: number;
  loss_carryforwards: unknown;
  opening_retained: unknown;
  adjustments: unknown;
  local_tax_rates: unknown;
  prior_enterprise_tax_paid: number;
  entertainment_dining: number | null;
  note: string | null;
};

function inputsFromRow(row: SavedRow, clientCapital: number | null): CorporateReturnInputs {
  const rates = (row.local_tax_rates ?? {}) as Partial<LocalTaxRates>;
  return {
    capital: row.capital_amount !== null ? num(row.capital_amount) : clientCapital,
    employees: row.employees,
    interim: {
      corporate: num(row.interim_corporate_tax),
      localCorporate: num(row.interim_local_corporate_tax),
      prefectural: num(row.interim_prefectural),
      municipal: num(row.interim_municipal),
      enterprise: num(row.interim_enterprise),
    },
    withholdingTax: num(row.withholding_income_tax),
    losses: arr<LossCarryforward>(row.loss_carryforwards).map((l) => ({ periodEnd: l.periodEnd, amount: num(l.amount) })),
    openingRetained: arr<RetainedItem>(row.opening_retained).map((r) => ({ name: r.name, amount: num(r.amount) })),
    adjustments: arr<Adjustment>(row.adjustments).map((a) => ({ ...a, amount: num(a.amount) })),
    localRates: { ...STANDARD_LOCAL_RATES, ...rates },
    priorEnterpriseTaxPaid: num(row.prior_enterprise_tax_paid),
    entertainmentDining: row.entertainment_dining === null ? null : num(row.entertainment_dining),
    note: row.note,
  };
}

const emptyInputs = (clientCapital: number | null): CorporateReturnInputs => ({
  capital: clientCapital,
  employees: null,
  interim: { corporate: 0, localCorporate: 0, prefectural: 0, municipal: 0, enterprise: 0 },
  withholdingTax: 0,
  losses: [],
  openingRetained: [],
  adjustments: [],
  localRates: STANDARD_LOCAL_RATES,
  priorEnterpriseTaxPaid: 0,
  entertainmentDining: null,
  note: null,
});

/** 帳簿（試算表・固定資産台帳）から、申告書に使う数字を集める */
async function loadBooks(clientId: string, p: { startDate: string; endDate: string }) {
  const [tb, dep] = await Promise.all([getTrialBalance(clientId, p.startDate, p.endDate), getDepreciationBook(clientId, p.startDate)]);
  let netIncome = 0;
  let taxExpenseBooked = 0;
  let entertainment = 0;
  for (const r of tb) {
    if (r.category !== "revenue" && r.category !== "expense") continue;
    netIncome += r.creditTotal - r.debitTotal;
    if (r.category === "expense" && /法人税/.test(r.name)) taxExpenseBooked += r.debitTotal - r.creditTotal;
    if (r.category === "expense" && /交際費/.test(r.name)) entertainment += r.debitTotal - r.creditTotal;
  }
  const re = tb.find((r) => r.category === "equity" && r.name === "繰越利益剰余金");
  const sumDep = (f: (a: (typeof dep.assets)[number]) => number) => dep.assets.reduce((s, a) => s + f(a), 0);
  return {
    netIncome,
    taxExpenseBooked,
    entertainment,
    retainedEarnings: { opening: re ? -re.prevBalance : 0, closingBeforeIncome: re ? -re.currentBalance : 0 },
    depreciation: {
      excess: dep.totals.excess,
      allowed: dep.totals.allowed,
      openingExcess: sumDep((a) => a.current?.openingExcess ?? 0),
      closingExcess: sumDep((a) => a.current?.closingExcess ?? 0),
    },
  };
}

async function compute(clientId: string, p: { startDate: string; endDate: string }, inputs: CorporateReturnInputs) {
  const books = await loadBooks(clientId, p);
  const months = monthIndex(p.endDate) - monthIndex(p.startDate) + 1;
  const result = computeCorporateTaxReturn({
    period: { start: p.startDate, end: p.endDate, months },
    capital: inputs.capital,
    employees: inputs.employees,
    netIncome: books.netIncome,
    taxExpenseBooked: books.taxExpenseBooked,
    entertainment: books.entertainment,
    entertainmentDining: inputs.entertainmentDining,
    depreciation: books.depreciation,
    withholdingTax: inputs.withholdingTax,
    adjustments: inputs.adjustments,
    losses: inputs.losses,
    interim: inputs.interim,
    openingRetained: inputs.openingRetained,
    retainedEarnings: books.retainedEarnings,
    priorEnterpriseTaxPaid: inputs.priorEnterpriseTaxPaid,
    localRates: inputs.localRates,
  });
  return { books, result, months };
}

async function loadSaved(db: Db, clientId: string, periodStart: string) {
  const { data } = await db
    .from("corporate_tax_returns")
    .select(
      "capital_amount, employees, interim_corporate_tax, interim_local_corporate_tax, interim_prefectural, interim_municipal, interim_enterprise, withholding_income_tax, loss_carryforwards, opening_retained, adjustments, local_tax_rates, prior_enterprise_tax_paid, entertainment_dining, note"
    )
    .eq("client_id", clientId)
    .eq("period_start", periodStart)
    .maybeSingle();
  return (data as SavedRow | null) ?? null;
}

export async function getCorporateTaxReturn(clientId: string, periodKey?: string): Promise<CorporateReturnView> {
  await assertClientAccess(clientId);
  const db = await createServerSupabaseClient();
  const [{ data: client, error }, { data: fyRows }] = await Promise.all([
    db.from("clients").select("fiscal_year_start_month, entity_type, capital_amount").eq("id", clientId).single(),
    db.from("fiscal_years").select("start_date, end_date").eq("client_id", clientId),
  ]);
  if (error || !client) throw new Error(error?.message ?? "顧問先が見つかりません");
  const sm = (client.fiscal_year_start_month as number | null) ?? null;
  const rows = (fyRows ?? []) as FiscalPeriodRow[];
  const clientCapital = client.capital_amount === null ? null : num(client.capital_amount);
  const p = resolveFiscalPeriodByKey(rows, sm, periodKey ?? String(currentFiscalStartYear(sm)));
  const adj = adjacentFiscalPeriodKeys(rows, p);

  const saved = await loadSaved(db, clientId, p.startDate);
  let inputs: CorporateReturnInputs;
  let carriedFromPrior = false;
  if (saved) {
    inputs = inputsFromRow(saved, clientCapital);
  } else {
    inputs = emptyInputs(clientCapital);
    // 前期の申告が保存されていれば、翌期首の利益積立金・繰越欠損金・事業税・税率を引き継ぐ
    const prev = resolveFiscalPeriodByKey(rows, sm, adj.prevKey);
    const prevSaved = await loadSaved(db, clientId, prev.startDate);
    if (prevSaved) {
      const prevInputs = inputsFromRow(prevSaved, clientCapital);
      const prevCalc = await compute(clientId, prev, prevInputs);
      inputs = {
        ...inputs,
        employees: prevInputs.employees,
        localRates: prevInputs.localRates,
        losses: prevCalc.result.nextLosses,
        openingRetained: prevCalc.result.closingRetained.filter((r) => r.amount !== 0 && r.name !== "減価償却超過額" && r.name !== "繰越損益金"),
        priorEnterpriseTaxPaid: Math.max(0, prevCalc.result.taxes.enterprise),
      };
      carriedFromPrior = true;
    }
  }

  const { books, result, months } = await compute(clientId, p, inputs);
  return {
    period: { startDate: p.startDate, endDate: p.endDate, key: p.startDate, prevKey: adj.prevKey, nextKey: adj.nextKey, months },
    entityType: (client.entity_type as CorporateReturnView["entityType"]) ?? null,
    clientCapital,
    inputs,
    saved: Boolean(saved),
    carriedFromPrior,
    books: {
      netIncome: books.netIncome,
      taxExpenseBooked: books.taxExpenseBooked,
      entertainment: books.entertainment,
      depreciationExcess: books.depreciation.excess,
      depreciationAllowed: books.depreciation.allowed,
    },
    result,
  };
}

function validate(i: CorporateReturnInputs) {
  const nonNeg = (v: number, label: string) => {
    if (!(v >= 0)) throw new Error(`${label}を正しく入力してください`);
  };
  if (i.capital !== null) nonNeg(i.capital, "資本金");
  if (i.employees !== null && !(Number.isInteger(i.employees) && i.employees >= 0)) throw new Error("従業者数を正しく入力してください");
  for (const [k, v] of Object.entries(i.interim)) nonNeg(v, `中間納付額（${k}）`);
  nonNeg(i.withholdingTax, "控除所得税額");
  nonNeg(i.priorEnterpriseTaxPaid, "前期分の事業税等");
  if (i.entertainmentDining !== null) nonNeg(i.entertainmentDining, "接待飲食費");
  for (const l of i.losses) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(l.periodEnd)) throw new Error("欠損金の事業年度（期末日）を入力してください");
    nonNeg(l.amount, "欠損金額");
  }
  for (const a of i.adjustments) {
    if (!a.name.trim()) throw new Error("加算・減算の項目名を入力してください");
    if (a.kind !== "add" && a.kind !== "deduct") throw new Error("加算・減算の区分が正しくありません");
    if (a.treatment !== "retained" && a.treatment !== "outflow") throw new Error("留保・社外流出の区分が正しくありません");
    nonNeg(a.amount, `「${a.name}」の金額`);
  }
  const r = i.localRates;
  for (const v of [r.prefectural, r.municipal, ...r.enterprise]) if (!(v >= 0 && v < 1)) throw new Error("地方税の税率を正しく入力してください");
}

/** 期ごとの入力を保存する（資本金は顧問先の設定にも残す） */
export async function saveCorporateTaxReturnInputs(
  clientId: string,
  period: { startDate: string; endDate: string },
  inputs: CorporateReturnInputs
): Promise<void> {
  await assertClientAccess(clientId);
  validate(inputs);
  const db = await createServerSupabaseClient();
  const { error } = await db.from("corporate_tax_returns").upsert(
    {
      client_id: clientId,
      period_start: period.startDate,
      period_end: period.endDate,
      capital_amount: inputs.capital,
      employees: inputs.employees,
      interim_corporate_tax: inputs.interim.corporate,
      interim_local_corporate_tax: inputs.interim.localCorporate,
      interim_prefectural: inputs.interim.prefectural,
      interim_municipal: inputs.interim.municipal,
      interim_enterprise: inputs.interim.enterprise,
      withholding_income_tax: inputs.withholdingTax,
      loss_carryforwards: inputs.losses,
      opening_retained: inputs.openingRetained,
      adjustments: inputs.adjustments.map((a) => ({ ...a, name: a.name.trim() })),
      local_tax_rates: inputs.localRates,
      prior_enterprise_tax_paid: inputs.priorEnterpriseTaxPaid,
      entertainment_dining: inputs.entertainmentDining,
      note: inputs.note?.trim() || null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "client_id,period_start" }
  );
  if (error) throw new Error(error.message);
  if (inputs.capital !== null) {
    const { error: cErr } = await db.from("clients").update({ capital_amount: inputs.capital }).eq("id", clientId);
    if (cErr) throw new Error(cErr.message);
  }
}
