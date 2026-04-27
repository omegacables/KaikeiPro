"use server";

import { createServerSupabaseClient } from "@/lib/supabase";

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
}

export async function getTaxSummary(
  clientId: string,
  startDate: string,
  endDate: string
): Promise<TaxSummary> {
  const supabase = await createServerSupabaseClient();

  // Get all journal entry lines with their tax info for the period
  const { data, error } = await supabase
    .from("journal_entry_lines")
    .select(`
      debit_amount,
      credit_amount,
      tax_category,
      tax_rate,
      journal_entries!inner (
        client_id,
        entry_date,
        status
      )
    `)
    .eq("journal_entries.client_id", clientId)
    .gte("journal_entries.entry_date", startDate)
    .lte("journal_entries.entry_date", endDate);

  if (error) throw new Error(error.message);

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
  };

  for (const line of data ?? []) {
    const cat = line.tax_category;
    const rate = line.tax_rate;
    // credit_amount on revenue lines = sales, debit_amount on expense lines = purchases
    const creditNet = line.credit_amount - line.debit_amount;
    const debitNet = line.debit_amount - line.credit_amount;

    if (!cat) continue;

    // Sales categories (credit-side dominant)
    if (cat === "taxable_sales" || cat === "課税売上") {
      if (rate === 10) {
        result.sales10 += creditNet;
        result.sales10Tax += Math.floor(creditNet * 10 / 110);
      } else if (rate === 8) {
        result.sales8 += creditNet;
        result.sales8Tax += Math.floor(creditNet * 8 / 108);
      }
    } else if (cat === "exempt_sales" || cat === "非課税売上") {
      result.salesExempt += creditNet;
    } else if (cat === "tax_free_sales" || cat === "免税売上") {
      result.salesTaxFree += creditNet;
    } else if (cat === "out_of_scope" || cat === "不課税") {
      result.salesOutOfScope += creditNet;
    }
    // Purchase categories (debit-side dominant)
    else if (cat === "taxable_purchase" || cat === "課税仕入") {
      if (rate === 10) {
        result.purchase10 += debitNet;
        result.purchase10Tax += Math.floor(debitNet * 10 / 110);
      } else if (rate === 8) {
        result.purchase8 += debitNet;
        result.purchase8Tax += Math.floor(debitNet * 8 / 108);
      }
    }
  }

  return result;
}
