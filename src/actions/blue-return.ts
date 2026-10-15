"use server";

/**
 * 所得税青色申告決算書（一般用）。個人事業主は暦年（1月〜12月）。
 * 1ページ・4ページの計算は src/lib/blue-return.ts（テストあり）。2ページの月別売上・仕入は月次推移から、
 * 3ページの減価償却費の計算は固定資産台帳から作る。
 */

import { createAdminSupabaseClient, createServerSupabaseClient } from "@/lib/supabase";
import { assertClientAccess } from "@/lib/authz";
import { getTrialBalance, getMonthlyTrend } from "@/actions/statements";
import { getDepreciationBook, type DepreciationAsset } from "@/actions/assets";
import { getLedgerBook } from "@/actions/ledger-books";
import {
  computeBlueReturn,
  wageBreakdown,
  partnerBreakdown,
  counterparties,
  PROFESSIONAL,
  type Counterparties,
  type BlueReturn,
  type WageBreakdown,
  type PartnerAmount,
} from "@/lib/blue-return";
import { KIND_LABELS } from "@/lib/depreciation";

export type BlueDeduction = 650_000 | 550_000 | 100_000;

export type BlueReturnView = {
  year: number;
  period: { start: string; end: string };
  clientName: string;
  deductionSetting: BlueDeduction;
  result: BlueReturn;
  /** 2ページ 月別売上（収入）金額及び仕入金額（1〜12月。雑収入は別の行） */
  monthly: { sales: number[]; purchases: number[]; misc: number; salesTotal: number; purchaseTotal: number };
  /** 3ページ 減価償却費の計算 */
  depreciation: {
    name: string;
    acquired: string;
    cost: number;
    method: string;
    life: number;
    rate: number | null;
    months: number;
    ordinary: number;
    special: number;
    total: number;
    businessRatio: number;
    expense: number;
    closingBook: number;
  }[];
  /** 2ページ 給料賃金・専従者給与の内訳（給与台帳から）、地代家賃の内訳 ／ 3ページ 利子割引料・税理士等の報酬の内訳（元帳から） */
  wages: WageBreakdown;
  spouseWages: WageBreakdown;
  rent: PartnerAmount[];
  interest: PartnerAmount[];
  professional: PartnerAmount[];
  /** 3ページ 売上先・仕入先の明細（元帳の取引先ごと。所在地・登録番号は取引先マスタ） */
  customers: Counterparties;
  suppliers: Counterparties;
  warnings: string[];
};

/** 決算書を作る年（指定が無ければ、3月までは前年・4月からは今年） */
function defaultYear() {
  const now = new Date();
  return now.getMonth() + 1 <= 3 ? now.getFullYear() - 1 : now.getFullYear();
}

export async function getBlueReturn(clientId: string, year?: number): Promise<BlueReturnView> {
  await assertClientAccess(clientId);
  const db = await createServerSupabaseClient();
  const { data: client, error } = await db
    .from("clients")
    .select("name, entity_type, fiscal_year_start_month, blue_return_deduction")
    .eq("id", clientId)
    .single();
  if (error || !client) throw new Error(error?.message ?? "顧問先が見つかりません");
  const y = year ?? defaultYear();
  const start = `${y}-01-01`;
  const end = `${y}-12-31`;
  const warnings: string[] = [];
  if (client.entity_type !== "individual") warnings.push("この顧問先は法人として登録されています。青色申告決算書は個人事業主のものです。");
  if ((client.fiscal_year_start_month ?? 1) !== 1)
    warnings.push("個人事業主の決算は1月〜12月です。顧問先の決算月の設定（12月決算）を確かめてください。");

  const [tb, trend, dep] = await Promise.all([
    getTrialBalance(clientId, start, end),
    getMonthlyTrend(clientId, start, end, "pl"),
    getDepreciationBook(clientId, start).catch(() => null),
  ]);
  const deductionSetting = ((client.blue_return_deduction as BlueDeduction | null) ?? 650_000) as BlueDeduction;
  const result = computeBlueReturn({
    deductionLimit: deductionSetting,
    tb: tb.map((r) => ({
      code: r.code,
      name: r.name,
      category: r.category,
      prevBalance: r.prevBalance,
      debitTotal: r.debitTotal,
      creditTotal: r.creditTotal,
      currentBalance: r.currentBalance,
      costOfSales: r.plClassification === "cogs",
    })),
  });

  // ---- 2ページ 月別売上・仕入 ----
  const plLine = (no: string) => result.pl.find((l) => l.no === no)!;
  const salesAccounts = new Set(plLine("1").accounts);
  const costAccounts = new Set(plLine("3").accounts);
  const sales = Array(12).fill(0) as number[];
  const purchases = Array(12).fill(0) as number[];
  let misc = 0;
  for (const r of trend.rows) {
    if (salesAccounts.has(r.name)) {
      if (/雑収入/.test(r.name)) misc += r.total;
      else r.months.forEach((v, k) => (sales[k] += v));
    } else if (costAccounts.has(r.name)) r.months.forEach((v, k) => (purchases[k] += v));
  }
  // 棚卸資産の増減（売上原価に織り込んだ分）は12月の仕入に戻し、③ 仕入金額とそろえる
  const purchaseTotal = plLine("3").amount;
  const diff = purchaseTotal - purchases.reduce((s, v) => s + v, 0);
  if (diff !== 0) purchases[11] += diff;

  // ---- 3ページ 減価償却費の計算 ----
  const depreciation = (dep?.assets ?? [])
    .filter((a: DepreciationAsset) => a.current)
    .map((a: DepreciationAsset) => {
      const c = a.current!;
      return {
        name: a.name,
        acquired: a.acquisitionDate.slice(0, 7),
        cost: a.acquisitionCost,
        method: KIND_LABELS[a.kind],
        life: a.usefulLife,
        rate: a.rate?.rate ?? null,
        months: c.months,
        ordinary: c.ordinaryLimit,
        special: Math.max(0, c.booked - c.ordinaryLimit),
        total: c.booked,
        // 事業専用割合（家事と共用の資産）の分だけが必要経費
        businessRatio: a.businessRatio,
        expense: a.businessRatio < 100 ? Math.floor((c.booked * a.businessRatio) / 100) : c.booked,
        closingBook: c.closingBook,
      };
    });
  // ---- 2ページ 給料賃金・専従者給与の内訳（給与台帳） ----
  const [{ data: pay }, { data: accts }] = await Promise.all([
    db
      .from("payroll_records")
      .select("employee_name, pay_month, gross_salary, income_tax, salary_account_id")
      .eq("client_id", clientId)
      .gte("pay_month", start)
      .lte("pay_month", end),
    db.from("accounts").select("id, name"),
  ]);
  const accountName = new Map((accts ?? []).map((a) => [a.id as string, a.name as string]));
  const payRecords = (pay ?? []).map((r) => ({
    employee: r.employee_name as string,
    month: String(r.pay_month).slice(0, 7),
    amount: Number(r.gross_salary),
    withholding: Number(r.income_tax),
    accountName: (r.salary_account_id && accountName.get(r.salary_account_id as string)) || "給料手当",
  }));
  const wages = wageBreakdown(payRecords, false);
  const spouseWages = wageBreakdown(payRecords, true);
  const plWages = plLine("20").amount;
  if (payRecords.length && wages.total.total !== plWages)
    warnings.push(`給料賃金の内訳（給与台帳の合計 ${wages.total.total.toLocaleString()}円）と、損益計算書の給料賃金 ${plWages.toLocaleString()}円が合いません。給与台帳に無い支払いが無いか確かめてください。`);

  // ---- 地代家賃・利子割引料・税理士等の報酬の内訳（元帳の支払先ごと） ----
  const idByName = new Map(tb.map((r) => [r.name, r.id]));
  const ledgerRows = async (names: string[]) => {
    const books = await Promise.all(names.map((n) => idByName.get(n)).filter((x): x is string => !!x).map((aid) => getLedgerBook(clientId, aid, start, end)));
    return books.flatMap((b) => b.rows.filter((r) => !r.needsReview).map((r) => ({ partner: r.partnerName, description: r.description, amount: r.debit - r.credit })));
  };
  const feeAccounts = tb.filter((r) => r.category === "expense" && /支払報酬|報酬|支払手数料|顧問料/.test(r.name)).map((r) => r.name);
  const [rentRows, interestRows, feeRows, salesRows, costRows, { data: partnersMaster }] = await Promise.all([
    ledgerRows(plLine("23").accounts),
    ledgerRows(plLine("22").accounts),
    ledgerRows(feeAccounts),
    ledgerRows(plLine("1").accounts.filter((n) => !/雑収入/.test(n))),
    ledgerRows(plLine("3").accounts),
    db.from("business_partners").select("name, aliases, address, invoice_registration_number").eq("client_id", clientId),
  ]);
  const master = (partnersMaster ?? []).map((m) => ({
    name: m.name as string,
    aliases: (m.aliases as string[] | null) ?? [],
    address: (m.address as string | null) ?? null,
    registrationNo: (m.invoice_registration_number as string | null) ?? null,
  }));
  // 売上は貸方が増加なので符号を戻す
  const customers = counterparties(salesRows.map((r) => ({ partner: r.partner, amount: -r.amount })), master);
  const suppliers = counterparties(costRows, master);
  const rent = partnerBreakdown(rentRows);
  const interest = partnerBreakdown(interestRows);
  const professional = partnerBreakdown(feeRows.filter((r) => PROFESSIONAL.test(r.partner ?? "") || PROFESSIONAL.test(r.description)));

  const depTotal = depreciation.reduce((s, d) => s + d.expense, 0);
  const plDep = plLine("18").amount;
  if (depreciation.length && depTotal !== plDep)
    warnings.push(`減価償却費の計算（3ページ）の合計 ${depTotal.toLocaleString()}円と、損益計算書の減価償却費 ${plDep.toLocaleString()}円が合いません。減価償却の仕訳を確かめてください。`);

  return {
    year: y,
    period: { start, end },
    clientName: client.name as string,
    deductionSetting,
    result,
    monthly: { sales, purchases, misc, salesTotal: plLine("1").amount, purchaseTotal },
    depreciation,
    wages,
    spouseWages,
    rent,
    interest,
    professional,
    customers,
    suppliers,
    warnings: [...warnings, ...result.warnings],
  };
}

/** 青色申告特別控除の種類を保存する（顧問先の表は顧問先ユーザーが RLS で更新できないため、他の顧問先設定と同じく管理側で書く） */
export async function saveBlueReturnDeduction(clientId: string, deduction: BlueDeduction): Promise<void> {
  await assertClientAccess(clientId);
  if (![650_000, 550_000, 100_000].includes(deduction)) throw new Error("青色申告特別控除は65万円・55万円・10万円から選んでください");
  const admin = createAdminSupabaseClient();
  const { error } = await admin.from("clients").update({ blue_return_deduction: deduction }).eq("id", clientId);
  if (error) throw new Error(error.message);
}
