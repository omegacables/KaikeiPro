"use server";

import { createServerSupabaseClient } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/fetch-all";
import {
  normalizeTaxCategory,
  taxCategoryInfo,
  taxFromGross,
  type AccountType,
} from "@/lib/tax-category";

export async function getFiscalYears(clientId: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("fiscal_years")
    .select("*")
    .eq("client_id", clientId)
    .order("start_date", { ascending: false });

  if (error) throw new Error(error.message);
  return data;
}

export interface TaxSummary {
  sales10: number;
  sales10Tax: number;
  sales8: number;
  sales8Tax: number;
  purchase10: number;
  purchase10Tax: number;
  purchase8: number;
  purchase8Tax: number;
  salesExempt: number;
  salesTaxFree: number;
  salesOutOfScope: number;
  /** 経過措置で控除できない金額（免税事業者からの仕入れの控除対象外部分） */
  transitionNotDeductible: number;
  /** 税区分が付いていない費用・収益の行数。多いほど集計の精度が落ちる */
  uncategorizedLines: number;
}

/**
 * 消費税の集計。
 *
 * 判定は**勘定科目の種類**（収益か費用か）で行い、税区分は「扱い」だけを決める。
 * 以前は税区分の文字列だけで判定していたため、
 *   - 現金・仮払消費税・未払金の行にも税区分が付いており、同じ取引を多重に数える
 *   - 集計側が探す名前（taxable_purchase）が実際のデータに一つも存在しない
 * という二重の問題で、**仕入れが1件も計上されていなかった**。
 *
 * 免税事業者等からの仕入れの経過措置は、控除できる割合を掛けて反映する。
 */
export async function getTaxSummary(
  clientId: string,
  startDate: string,
  endDate: string
): Promise<TaxSummary> {
  const supabase = await createServerSupabaseClient();

  // 1000行の取得上限で黙って打ち切られないよう全ページ取得する
  type TaxLine = {
    debit_amount: number;
    credit_amount: number;
    tax_category: string | null;
    tax_rate: number | null;
    accounts: { account_categories: { type: string } | null } | null;
    journal_entries: { client_id: string; entry_date: string; needs_review: boolean | null };
  };
  const data = await fetchAllRows<TaxLine>((from, to) =>
    supabase
      .from("journal_entry_lines")
      .select(`
      debit_amount,
      credit_amount,
      tax_category,
      tax_rate,
      accounts!inner ( account_categories!inner ( type ) ),
      journal_entries!inner ( client_id, entry_date, needs_review )
    `)
      .eq("journal_entries.client_id", clientId)
      // 要確認の仕訳は決算書と同じく集計に入れない
      .eq("journal_entries.needs_review", false)
      .gte("journal_entries.entry_date", startDate)
      .lte("journal_entries.entry_date", endDate)
      .range(from, to) as unknown as PromiseLike<{ data: TaxLine[] | null; error: { message: string } | null }>
  );

  const result: TaxSummary = {
    sales10: 0,
    sales10Tax: 0,
    sales8: 0,
    sales8Tax: 0,
    purchase10: 0,
    purchase10Tax: 0,
    purchase8: 0,
    purchase8Tax: 0,
    salesExempt: 0,
    salesTaxFree: 0,
    salesOutOfScope: 0,
    transitionNotDeductible: 0,
    uncategorizedLines: 0,
  };

  for (const line of data ?? []) {
    const accountType = line.accounts?.account_categories?.type as AccountType | undefined;
    // 税区分が意味を持つのは費用・収益の行だけ。
    // 現金や仮払消費税の行まで数えると同じ取引を何重にも計上してしまう
    if (accountType !== "expenses" && accountType !== "revenue") continue;

    const code = normalizeTaxCategory(line.tax_category, accountType, line.tax_rate);
    if (!code) {
      result.uncategorizedLines++;
      continue;
    }
    const info = taxCategoryInfo(code);
    if (!info) continue;

    // 収益は貸方が増加、費用は借方が増加。戻し（反対仕訳）は差引で消える
    const amount =
      accountType === "revenue"
        ? line.credit_amount - line.debit_amount
        : line.debit_amount - line.credit_amount;
    if (amount === 0) continue;

    if (info.side === "sales") {
      if (info.rate === 0.1) {
        result.sales10 += amount;
        result.sales10Tax += taxFromGross(amount, 0.1);
      } else if (info.rate === 0.08) {
        result.sales8 += amount;
        result.sales8Tax += taxFromGross(amount, 0.08);
      } else if (code === "sales_exempt") {
        result.salesExempt += amount;
      } else if (code === "sales_tax_free") {
        result.salesTaxFree += amount;
      } else {
        result.salesOutOfScope += amount;
      }
      continue;
    }

    // 仕入側。非課税・不課税は仕入税額控除の対象にならないので金額だけ数えない
    if (info.rate === 0) continue;

    const fullTax = taxFromGross(amount, info.rate);
    // 経過措置の対象なら、控除できるのはその割合分だけ
    const deductible = info.transitionRate ? Math.floor(fullTax * info.transitionRate) : fullTax;
    result.transitionNotDeductible += fullTax - deductible;

    if (info.rate === 0.1) {
      result.purchase10 += amount;
      result.purchase10Tax += deductible;
    } else {
      result.purchase8 += amount;
      result.purchase8Tax += deductible;
    }
  }

  return result;
}
