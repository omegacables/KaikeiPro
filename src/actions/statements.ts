"use server";

import { createAdminSupabaseClient } from "@/lib/supabase";
import type { PlClassification } from "@/types/database";

export interface TrialBalanceRow {
  code: string;
  name: string;
  prevBalance: number;     // 前期繰越残高（借方プラスの符号付き）
  debitTotal: number;      // 当期 借方合計
  creditTotal: number;     // 当期 貸方合計
  currentBalance: number;  // 当期残高 = 前期繰越 + 借方合計 − 貸方合計（借方プラス）
  debitBalance: number;
  creditBalance: number;
  category: "asset" | "liability" | "equity" | "revenue" | "expense";
  plClassification: PlClassification | null; // 損益計算書の表示区分（収益・費用のみ）
}

// pl_classification 未設定の収益・費用科目を、コード・名前から推定する。
function inferPlClassification(
  category: string,
  code: string,
  name: string
): PlClassification | null {
  if (category === "revenue") {
    if (/利息|配当|雑収入|為替差益|有価証券/.test(name)) return "non_op_revenue";
    return "sales";
  }
  if (category === "expense") {
    if (/法人税|住民税|事業税/.test(name)) return "tax";
    if (/仕入|売上原価|期首商品|期末商品/.test(name)) return "cogs";
    if (/支払利息|為替差損|有価証券|手形売却損/.test(name)) return "non_op_expense";
    if (code.startsWith("51")) return "cogs";
    return "sga";
  }
  return null;
}

export interface MonthlyTrendRow {
  name: string;
  months: number[];
  total: number;
  category: string;
}

export async function getTrialBalance(
  clientId: string,
  startDate: string,
  endDate: string
): Promise<TrialBalanceRow[]> {
  const supabase = createAdminSupabaseClient();

  // Get all accounts with their categories
  const { data: accounts, error: accError } = await supabase
    .from("accounts")
    .select(`
      id, code, name, pl_classification,
      account_categories!inner ( type )
    `)
    .or(`client_id.eq.${clientId},is_default.eq.true`)
    .eq("is_active", true)
    .order("code");

  if (accError) throw new Error(accError.message);

  // Get all journal entry lines for this client within date range
  const { data: lines, error: linesError } = await supabase
    .from("journal_entry_lines")
    .select(`
      account_id, debit_amount, credit_amount,
      journal_entries!inner ( client_id, entry_date )
    `)
    .eq("journal_entries.client_id", clientId)
    .gte("journal_entries.entry_date", startDate)
    .lte("journal_entries.entry_date", endDate);

  if (linesError) throw new Error(linesError.message);

  // 前期繰越: startDate より前の全仕訳の差引（借方プラス）
  const dayBefore = new Date(startDate);
  dayBefore.setDate(dayBefore.getDate() - 1);
  const beforeDate = dayBefore.toISOString().slice(0, 10);

  const { data: priorLines, error: priorError } = await supabase
    .from("journal_entry_lines")
    .select(`
      account_id, debit_amount, credit_amount,
      journal_entries!inner ( client_id, entry_date )
    `)
    .eq("journal_entries.client_id", clientId)
    .lte("journal_entries.entry_date", beforeDate);

  if (priorError) throw new Error(priorError.message);

  const prevBalanceMap = new Map<string, number>();
  for (const line of priorLines ?? []) {
    const prev = prevBalanceMap.get(line.account_id) ?? 0;
    prevBalanceMap.set(line.account_id, prev + line.debit_amount - line.credit_amount);
  }

  // Aggregate by account
  const accountTotals = new Map<string, { debit: number; credit: number }>();
  for (const line of lines ?? []) {
    const existing = accountTotals.get(line.account_id) ?? { debit: 0, credit: 0 };
    existing.debit += line.debit_amount;
    existing.credit += line.credit_amount;
    accountTotals.set(line.account_id, existing);
  }

  const categoryMap: Record<string, "asset" | "liability" | "equity" | "revenue" | "expense"> = {
    assets: "asset",
    liabilities: "liability",
    equity: "equity",
    revenue: "revenue",
    expenses: "expense",
  };

  const rows: TrialBalanceRow[] = [];
  for (const acct of accounts ?? []) {
    const totals = accountTotals.get(acct.id) ?? { debit: 0, credit: 0 };
    const prevBalance = prevBalanceMap.get(acct.id) ?? 0;

    // 当期に動きが無く前期繰越も無い科目はスキップ
    if (totals.debit === 0 && totals.credit === 0 && prevBalance === 0) continue;

    const cat = acct.account_categories as unknown as { type: string };
    const category = categoryMap[cat.type] ?? "expense";

    const currentBalance = prevBalance + totals.debit - totals.credit;

    const explicit = (acct as { pl_classification?: PlClassification | null }).pl_classification ?? null;
    const plClassification =
      category === "revenue" || category === "expense"
        ? explicit ?? inferPlClassification(category, acct.code, acct.name)
        : null;

    rows.push({
      code: acct.code,
      name: acct.name,
      prevBalance,
      debitTotal: totals.debit,
      creditTotal: totals.credit,
      currentBalance,
      debitBalance: currentBalance > 0 ? currentBalance : 0,
      creditBalance: currentBalance < 0 ? -currentBalance : 0,
      category,
      plClassification,
    });
  }

  return rows;
}

// 棚卸関連の勘定科目名
const INVENTORY_ACCOUNT_NAMES = ["商品", "製品", "仕掛品", "原材料", "貯蔵品", "半製品"];

export interface InventoryScheduleRow {
  code: string;
  name: string;
  openingBalance: number;   // 期首棚卸高
  increase: number;         // 当期仕入高（増加）
  decrease: number;         // 当期払出高（減少）
  closingBalance: number;   // 期末棚卸高
}

export async function getInventorySchedule(
  clientId: string,
  fiscalYearStart: string,
  endDate: string
): Promise<InventoryScheduleRow[]> {
  const supabase = createAdminSupabaseClient();

  // Get inventory-related accounts
  const { data: accounts, error: accError } = await supabase
    .from("accounts")
    .select(`id, code, name, account_categories!inner ( type )`)
    .or(`client_id.eq.${clientId},is_default.eq.true`)
    .eq("is_active", true)
    .eq("account_categories.type", "assets")
    .order("code");

  if (accError) throw new Error(accError.message);

  const inventoryAccounts = (accounts ?? []).filter((a) =>
    INVENTORY_ACCOUNT_NAMES.some((n) => a.name.includes(n))
  );

  if (inventoryAccounts.length === 0) return [];

  // Get journal lines before fiscal year start (for opening balance)
  const dayBefore = new Date(fiscalYearStart);
  dayBefore.setDate(dayBefore.getDate() - 1);
  const beforeDate = dayBefore.toISOString().slice(0, 10);

  const { data: priorLines } = await supabase
    .from("journal_entry_lines")
    .select(`account_id, debit_amount, credit_amount, journal_entries!inner ( client_id, entry_date )`)
    .eq("journal_entries.client_id", clientId)
    .lte("journal_entries.entry_date", beforeDate);

  // Get journal lines for the current period
  const { data: periodLines } = await supabase
    .from("journal_entry_lines")
    .select(`account_id, debit_amount, credit_amount, journal_entries!inner ( client_id, entry_date )`)
    .eq("journal_entries.client_id", clientId)
    .gte("journal_entries.entry_date", fiscalYearStart)
    .lte("journal_entries.entry_date", endDate);

  const inventoryIds = new Set(inventoryAccounts.map((a) => a.id));

  // Calculate opening balances
  const openingMap = new Map<string, number>();
  for (const line of priorLines ?? []) {
    if (!inventoryIds.has(line.account_id)) continue;
    const prev = openingMap.get(line.account_id) ?? 0;
    openingMap.set(line.account_id, prev + line.debit_amount - line.credit_amount);
  }

  // Calculate period movements
  const increaseMap = new Map<string, number>();
  const decreaseMap = new Map<string, number>();
  for (const line of periodLines ?? []) {
    if (!inventoryIds.has(line.account_id)) continue;
    const prevInc = increaseMap.get(line.account_id) ?? 0;
    const prevDec = decreaseMap.get(line.account_id) ?? 0;
    increaseMap.set(line.account_id, prevInc + line.debit_amount);
    decreaseMap.set(line.account_id, prevDec + line.credit_amount);
  }

  return inventoryAccounts.map((a) => {
    const opening = openingMap.get(a.id) ?? 0;
    const increase = increaseMap.get(a.id) ?? 0;
    const decrease = decreaseMap.get(a.id) ?? 0;
    return {
      code: a.code,
      name: a.name,
      openingBalance: opening,
      increase,
      decrease,
      closingBalance: opening + increase - decrease,
    };
  });
}

export async function getMonthlyTrend(
  clientId: string,
  startDate: string,
  endDate: string
): Promise<{ rows: MonthlyTrendRow[]; monthLabels: string[] }> {
  const supabase = createAdminSupabaseClient();

  // Parse start/end to get month range
  const start = new Date(startDate);
  const end = new Date(endDate);
  const monthLabels: string[] = [];
  const monthKeys: string[] = [];
  const current = new Date(start.getFullYear(), start.getMonth(), 1);
  while (current <= end) {
    monthLabels.push(`${current.getMonth() + 1}月`);
    monthKeys.push(`${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}`);
    current.setMonth(current.getMonth() + 1);
  }

  // Get accounts
  const { data: accounts } = await supabase
    .from("accounts")
    .select(`id, name, account_categories!inner ( type )`)
    .or(`client_id.eq.${clientId},is_default.eq.true`)
    .eq("is_active", true);

  // Get all journal lines
  const { data: lines } = await supabase
    .from("journal_entry_lines")
    .select(`
      account_id, debit_amount, credit_amount,
      journal_entries!inner ( client_id, entry_date )
    `)
    .eq("journal_entries.client_id", clientId)
    .gte("journal_entries.entry_date", startDate)
    .lte("journal_entries.entry_date", endDate);

  // Build account info map
  const accountInfo = new Map<string, { name: string; type: string }>();
  for (const a of accounts ?? []) {
    const cat = a.account_categories as unknown as { type: string };
    accountInfo.set(a.id, { name: a.name, type: cat.type });
  }

  // Aggregate by account × month
  const data = new Map<string, number[]>();
  for (const line of lines ?? []) {
    const entry = line.journal_entries as unknown as { entry_date: string };
    const monthKey = entry.entry_date.slice(0, 7); // YYYY-MM
    const monthIdx = monthKeys.indexOf(monthKey);
    if (monthIdx === -1) continue;

    const info = accountInfo.get(line.account_id);
    if (!info) continue;

    // Only revenue and expenses
    if (info.type !== "revenue" && info.type !== "expenses") continue;

    if (!data.has(line.account_id)) {
      data.set(line.account_id, new Array(monthKeys.length).fill(0));
    }
    const months = data.get(line.account_id)!;

    if (info.type === "revenue") {
      months[monthIdx] += line.credit_amount - line.debit_amount;
    } else {
      months[monthIdx] += line.debit_amount - line.credit_amount;
    }
  }

  const rows: MonthlyTrendRow[] = [];
  for (const [accountId, months] of data) {
    const info = accountInfo.get(accountId);
    if (!info) continue;
    const total = months.reduce((s, v) => s + v, 0);
    if (total === 0 && months.every((m) => m === 0)) continue;
    rows.push({
      name: info.name,
      months,
      total,
      category: info.type === "revenue" ? "revenue" : "expense",
    });
  }

  return { rows, monthLabels };
}
