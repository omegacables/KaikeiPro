"use server";

import { createServerSupabaseClient } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/fetch-all";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertClientAccess } from "@/lib/authz";
import { computeTaxSummary, type TaxSummary as LibTaxSummary } from "@/lib/tax-book";
import { loadExclusiveEntries, toTaxBookLines } from "@/lib/tax-exclusive";

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

export type TaxSummary = LibTaxSummary;

/**
 * 消費税の集計。
 *
 * 判定は**勘定科目の種類**（収益か費用か）で行い、税区分は「扱い」だけを決める。
 * 税込経理・税抜経理は仕訳ごとに判断する（仮受消費税・仮払消費税の行があれば税抜経理）。
 * 計算そのものは src/lib/tax-book.ts の computeTaxSummary（テストあり）。
 */
export async function getTaxSummary(
  clientId: string,
  startDate: string,
  endDate: string
): Promise<TaxSummary> {
  await assertClientAccess(clientId);
  const supabase = await createServerSupabaseClient();

  // 1000行の取得上限で黙って打ち切られないよう全ページ取得する
  type TaxLine = {
    journal_entry_id: string;
    debit_amount: number;
    credit_amount: number;
    tax_category: string | null;
    tax_rate: number | null;
    accounts: { account_categories: { type: string } | null } | null;
    journal_entries: { client_id: string; entry_date: string; needs_review: boolean | null };
  };
  const [data, exclusive] = await Promise.all([
    fetchAllRows<TaxLine>((from, to) =>
      supabase
        .from("journal_entry_lines")
        .select(`
      journal_entry_id,
      debit_amount,
      credit_amount,
      tax_category,
      tax_rate,
      accounts!inner ( account_categories!inner ( type ) ),
      journal_entries!inner ( client_id, entry_date, needs_review )
    `)
        .eq("journal_entries.client_id", clientId)
        .gte("journal_entries.entry_date", startDate)
        .lte("journal_entries.entry_date", endDate)
        .range(from, to) as unknown as PromiseLike<{ data: TaxLine[] | null; error: { message: string } | null }>
    ),
    loadExclusiveEntries(supabase as unknown as SupabaseClient, clientId, startDate, endDate),
  ]);

  return computeTaxSummary(
    toTaxBookLines(
      data.map((l) => ({
        entryId: l.journal_entry_id,
        accountType: l.accounts?.account_categories?.type ?? "",
        taxCategory: l.tax_category,
        taxRate: l.tax_rate,
        debit: Number(l.debit_amount) || 0,
        credit: Number(l.credit_amount) || 0,
        // 要確認の仕訳は決算書と同じく集計に入れない
        needsReview: Boolean(l.journal_entries.needs_review),
      })),
      exclusive
    )
  );
}
