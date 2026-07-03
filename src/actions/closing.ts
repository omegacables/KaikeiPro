"use server";

import { createServerSupabaseClient, createAdminSupabaseClient } from "@/lib/supabase";
import { assertClientAccess } from "@/lib/authz";
import { currentFiscalStartYear, fiscalRangeFromStartYear } from "@/lib/fiscal";
import type { Database } from "@/types/database";

type FiscalYearRow = Database["public"]["Tables"]["fiscal_years"]["Row"];
type FixedAssetRow = Database["public"]["Tables"]["fixed_assets"]["Row"];

export async function getActiveFiscalYear(clientId: string): Promise<FiscalYearRow | null> {
  await assertClientAccess(clientId);
  const supabase = await createServerSupabaseClient();

  // Get the most recent fiscal year (prefer open, then closed)
  const { data, error } = await supabase
    .from("fiscal_years")
    .select("*")
    .eq("client_id", clientId)
    .in("status", ["open", "closed"])
    .order("end_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (data) return data;

  // 会計年度が未登録なら、クライアントの決算月から当期分を自動作成する
  // （fiscal_years はUI上に作成手段がなく、未登録だと決算処理・年度ロックが使えないため）
  const admin = createAdminSupabaseClient();
  const { data: client } = await admin
    .from("clients")
    .select("fiscal_year_start_month")
    .eq("id", clientId)
    .single();
  const startMonth =
    (client as { fiscal_year_start_month?: number } | null)?.fiscal_year_start_month ?? 4;
  const { startDate, endDate } = fiscalRangeFromStartYear(
    startMonth,
    currentFiscalStartYear(startMonth)
  );
  const { data: created, error: insertError } = await admin
    .from("fiscal_years")
    .insert({ client_id: clientId, start_date: startDate, end_date: endDate, status: "open" })
    .select()
    .single();
  if (insertError) throw new Error(insertError.message);
  return created;
}

export interface ClosingEntry {
  id: string;
  date: string;
  description: string;
  debit: string;
  credit: string;
  amount: number;
  type: string;
  status: "confirmed" | "draft";
}

export async function getClosingEntries(
  clientId: string,
  endDate: string
): Promise<ClosingEntry[]> {
  const supabase = await createServerSupabaseClient();

  // Get journal entries on the closing date with source='closing' or description containing 決算
  const { data, error } = await supabase
    .from("journal_entries")
    .select(`
      id,
      entry_date,
      description,
      status,
      source,
      journal_entry_lines (
        debit_amount,
        credit_amount,
        accounts:account_id ( name )
      )
    `)
    .eq("client_id", clientId)
    .eq("entry_date", endDate)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);

  return (data ?? [])
    .filter((e) => e.source === "closing" || (e.description ?? "").includes("決算"))
    .map((entry) => {
      const lines = entry.journal_entry_lines ?? [];
      const debitLine = lines.find((l) => l.debit_amount > 0);
      const creditLine = lines.find((l) => l.credit_amount > 0);
      const amount = debitLine?.debit_amount ?? creditLine?.credit_amount ?? 0;

      // Extract type from description
      let type = "その他";
      const desc = entry.description ?? "";
      if (desc.includes("前払")) type = "前払費用";
      else if (desc.includes("未払")) type = "未払費用";
      else if (desc.includes("引当金")) type = "引当金";
      else if (desc.includes("前受")) type = "前受収益";
      else if (desc.includes("棚卸")) type = "棚卸";
      else if (desc.includes("減価償却")) type = "減価償却";

      const debitAccount = debitLine?.accounts as { name: string } | null;
      const creditAccount = creditLine?.accounts as { name: string } | null;

      return {
        id: entry.id,
        date: entry.entry_date.replace(/-/g, "/"),
        description: desc,
        debit: debitAccount?.name ?? "",
        credit: creditAccount?.name ?? "",
        amount,
        type,
        status: entry.status === "confirmed" ? "confirmed" as const : "draft" as const,
      };
    });
}

export interface DepreciationItem {
  category: string;
  amount: number;
  count: number;
}

export interface DepreciationSummary {
  totalAssets: number;
  totalDepreciation: number;
  items: DepreciationItem[];
}

export async function getDepreciationSummary(
  clientId: string,
  fiscalYearEndDate: string
): Promise<DepreciationSummary> {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("fixed_assets")
    .select("*")
    .eq("client_id", clientId)
    .is("disposed_at", null);

  if (error) throw new Error(error.message);

  const assets = data ?? [];
  const endDate = new Date(fiscalYearEndDate);

  // Group by category and calculate depreciation
  const categoryMap = new Map<string, { amount: number; count: number }>();

  for (const asset of assets) {
    const depreciation = calculateAnnualDepreciation(asset, endDate);
    const cat = asset.category || "その他";
    const existing = categoryMap.get(cat) ?? { amount: 0, count: 0 };
    existing.amount += depreciation;
    existing.count += 1;
    categoryMap.set(cat, existing);
  }

  const items: DepreciationItem[] = [];
  let totalDepreciation = 0;

  for (const [category, { amount, count }] of categoryMap) {
    items.push({ category, amount, count });
    totalDepreciation += amount;
  }

  return {
    totalAssets: assets.length,
    totalDepreciation,
    items,
  };
}

// 会計年度末日を基準に、当会計年度の減価償却費を月割りで計算する。
// - 会計年度は期末日から遡る12ヶ月（暦年ではなく決算期に対応）
// - 取得年度は取得月から期末までの月数で月割り
// - 償却累計が償却可能限度額（取得価額−残存価額）を超えないよう調整
function calculateAnnualDepreciation(
  asset: FixedAssetRow,
  fiscalYearEnd: Date
): number {
  const acquisition = new Date(asset.acquisition_date);
  if (acquisition > fiscalYearEnd) return 0;

  // 月を通し番号にして扱う（取得月・期首月を含む月数で計算）
  const monthIndex = (d: Date) => d.getFullYear() * 12 + d.getMonth();
  const acqIdx = monthIndex(acquisition);
  const fyEndIdx = monthIndex(fiscalYearEnd);
  const fyStartIdx = Math.max(fyEndIdx - 11, acqIdx); // 当期の償却開始月
  const monthsThisYear = fyEndIdx - fyStartIdx + 1;   // 当期の償却月数（1〜12）
  const monthsBefore = fyStartIdx - acqIdx;           // 期首までの経過月数

  if (asset.depreciation_method === "straight_line") {
    const depreciableBase = Math.max(0, asset.acquisition_cost - asset.salvage_value);
    const annual = depreciableBase / asset.useful_life;
    const accumulated = Math.floor((annual * monthsBefore) / 12);
    const remaining = depreciableBase - accumulated;
    if (remaining <= 0) return 0;
    return Math.min(Math.floor((annual * monthsThisYear) / 12), remaining);
  }

  // 定率法: rate = 1 - (残存価額/取得価額)^(1/耐用年数)、残存価額0なら200%定率法
  const rate =
    asset.salvage_value > 0
      ? 1 - Math.pow(asset.salvage_value / asset.acquisition_cost, 1 / asset.useful_life)
      : 2 / asset.useful_life;
  const floorValue = Math.max(asset.salvage_value, 0);

  // 過年度分を会計年度単位（取得年度は月割り）で償却して期首帳簿価額を求める
  let bookValue = asset.acquisition_cost;
  const firstWindowStart =
    fyStartIdx - 12 * Math.ceil((fyStartIdx - acqIdx) / 12);
  for (let ws = firstWindowStart; ws < fyStartIdx; ws += 12) {
    const from = Math.max(acqIdx, ws);
    const months = ws + 12 - from;
    const dep = Math.min(
      Math.floor((bookValue * rate * months) / 12),
      bookValue - floorValue
    );
    bookValue -= Math.max(0, dep);
  }

  const dep = Math.min(
    Math.floor((bookValue * rate * monthsThisYear) / 12),
    bookValue - floorValue
  );
  return Math.max(0, dep);
}

export async function updateFiscalYearStatus(
  fiscalYearId: string,
  status: "open" | "closed" | "locked"
) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("fiscal_years")
    .update({ status })
    .eq("id", fiscalYearId)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}
