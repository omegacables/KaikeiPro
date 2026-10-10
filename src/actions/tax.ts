"use server";

import { createServerSupabaseClient } from "@/lib/supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertClientAccess } from "@/lib/authz";
import { computeTaxSummary, type TaxSummary as LibTaxSummary } from "@/lib/tax-book";
import { loadTaxBookLines } from "@/lib/tax-exclusive";

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

  return computeTaxSummary(
    await loadTaxBookLines(supabase as unknown as SupabaseClient, clientId, startDate, endDate)
  );
}
