"use server";

import { createAdminSupabaseClient } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/fetch-all";
import { aggregateTrialBalance, needsReviewSummary, CATEGORY_BY_DB_TYPE } from "@/lib/trial-balance";
import { assertClientAccess } from "@/lib/authz";
import type { PlClassification } from "@/types/database";

export interface TrialBalanceRow {
  id: string;
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

export type MonthlyTrendMode = "pl" | "bs";

export interface MonthlyTrendRow {
  code: string;
  name: string;
  months: number[];      // 当期 各月の値（PL=各月の発生額 / BS=各月末残高、いずれも科目の性質に応じた正の値）
  prevMonths: number[];  // 前期 同月の値（前年同月比の算出用）
  total: number;         // PL=当期累計 / BS=期末残高
  category: string;      // asset | liability | equity | revenue | expense
}

export async function getTrialBalance(
  clientId: string,
  startDate: string,
  endDate: string
): Promise<TrialBalanceRow[]> {
  await assertClientAccess(clientId);
  const supabase = createAdminSupabaseClient();

  // Get all accounts with their categories
  // pl_classification 列が未マイグレーションのDBでも動作するようフォールバックする
  type AccRow = {
    id: string;
    code: string;
    name: string;
    pl_classification?: PlClassification | null;
    account_categories: { type: string };
  };

  const fetchAccounts = async (): Promise<AccRow[]> => {
    const withPl = await supabase
      .from("accounts")
      .select(`id, code, name, pl_classification, account_categories!inner ( type )`)
      .or(`client_id.eq.${clientId},is_default.eq.true`)
      .eq("is_active", true)
      .order("code");
    if (!withPl.error) return withPl.data as unknown as AccRow[];
    const noPl = await supabase
      .from("accounts")
      .select(`id, code, name, account_categories!inner ( type )`)
      .or(`client_id.eq.${clientId},is_default.eq.true`)
      .eq("is_active", true)
      .order("code");
    if (noPl.error) throw new Error(noPl.error.message);
    return noPl.data as unknown as AccRow[];
  };

  // 当期＋前期繰越をまとめて取得（endDate以前の全仕訳）。
  // 1000行の取得上限で黙って打ち切られないよう全ページ取得する。
  // 科目取得と並列実行してラウンドトリップを削減する。
  type LineRow = {
    account_id: string;
    debit_amount: number;
    credit_amount: number;
    journal_entry_id: string;
    journal_entries: {
      client_id: string;
      entry_date: string;
      source?: string;
      needs_review?: boolean | null;
    };
  };
  const linesQuery = fetchAllRows<LineRow>((from, to) =>
    supabase
      .from("journal_entry_lines")
      .select(
        `account_id, debit_amount, credit_amount, journal_entry_id, journal_entries!inner ( client_id, entry_date, source, needs_review )`
      )
      .eq("journal_entries.client_id", clientId)
      .lte("journal_entries.entry_date", endDate)
      .range(from, to) as unknown as PromiseLike<{ data: LineRow[] | null; error: { message: string } | null }>
  );

  const [accounts, lines] = await Promise.all([fetchAccounts(), linesQuery]);

  // 集計は純粋関数に委譲（会計ロジックのテストは src/lib/trial-balance.test.ts）
  const aggregatable = (accounts ?? []).map((a) => ({
    id: a.id,
    code: a.code,
    name: a.name,
    category:
      CATEGORY_BY_DB_TYPE[(a.account_categories as unknown as { type: string }).type] ?? "expense",
  }));
  // 要確認の仕訳は集計から除く（aggregateTrialBalance 側で判定）。
  // 除外した分は画面で知らせるため、件数と金額も出しておく
  const aggregatableLines = lines.map((l) => ({
    account_id: l.account_id,
    debit_amount: l.debit_amount,
    credit_amount: l.credit_amount,
    entry_date: l.journal_entries.entry_date,
    source: l.journal_entries.source ?? null,
    needs_review: l.journal_entries.needs_review ?? false,
    journal_entry_id: l.journal_entry_id,
  }));
  const aggregated = aggregateTrialBalance(aggregatable, aggregatableLines, startDate, endDate);

  const rows: TrialBalanceRow[] = [];
  for (const acct of accounts ?? []) {
    const agg = aggregated.get(acct.id);
    if (!agg) continue; // 当期の動きも前期繰越も無い科目

    const cat = acct.account_categories as unknown as { type: string };
    const category = CATEGORY_BY_DB_TYPE[cat.type] ?? "expense";
    const currentBalance = agg.currentBalance;

    const explicit = (acct as { pl_classification?: PlClassification | null }).pl_classification ?? null;
    const plClassification =
      category === "revenue" || category === "expense"
        ? explicit ?? inferPlClassification(category, acct.code, acct.name)
        : null;

    rows.push({
      id: acct.id,
      code: acct.code,
      name: acct.name,
      prevBalance: agg.prevBalance,
      debitTotal: agg.debitTotal,
      creditTotal: agg.creditTotal,
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
  await assertClientAccess(clientId);
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
    // 要確認の仕訳は数字に入れない（試算表・決算書と同じルール）
    .eq("journal_entries.needs_review", false)
    .lte("journal_entries.entry_date", beforeDate);

  // Get journal lines for the current period
  const { data: periodLines } = await supabase
    .from("journal_entry_lines")
    .select(`account_id, debit_amount, credit_amount, journal_entries!inner ( client_id, entry_date )`)
    .eq("journal_entries.client_id", clientId)
    // 要確認の仕訳は数字に入れない（試算表・決算書と同じルール）
    .eq("journal_entries.needs_review", false)
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

// startDate(月初)から count ヶ月分の月キー(YYYY-MM)とラベルを生成
function buildMonths(startDate: string, count = 12): { keys: string[]; labels: string[] } {
  const start = new Date(startDate);
  const keys: string[] = [];
  const labels: string[] = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), 1);
  for (let i = 0; i < count; i++) {
    keys.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}`);
    labels.push(`${cur.getMonth() + 1}月`);
    cur.setMonth(cur.getMonth() + 1);
  }
  return { keys, labels };
}

const TREND_CATEGORY_MAP: Record<string, "asset" | "liability" | "equity" | "revenue" | "expense"> = {
  assets: "asset",
  liabilities: "liability",
  equity: "equity",
  revenue: "revenue",
  expenses: "expense",
};

export async function getMonthlyTrend(
  clientId: string,
  fiscalYearStart: string,
  fiscalYearEnd: string,
  mode: MonthlyTrendMode = "pl"
): Promise<{ rows: MonthlyTrendRow[]; monthLabels: string[] }> {
  await assertClientAccess(clientId);
  const supabase = createAdminSupabaseClient();

  // 当期と前期の月キー（前期は1年前の同月）
  const current = buildMonths(fiscalYearStart, 12);
  const priorStartDate = (() => {
    const d = new Date(fiscalYearStart);
    d.setFullYear(d.getFullYear() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  })();
  const prior = buildMonths(priorStartDate, 12);
  const monthLabels = current.labels;

  const curIdx = (k: string) => current.keys.indexOf(k);
  const prIdx = (k: string) => prior.keys.indexOf(k);

  // 勘定科目
  const { data: accounts } = await supabase
    .from("accounts")
    .select(`id, code, name, account_categories!inner ( type )`)
    .or(`client_id.eq.${clientId},is_default.eq.true`)
    .eq("is_active", true)
    .order("code");

  const accountInfo = new Map<string, { code: string; name: string; type: string }>();
  for (const a of accounts ?? []) {
    const cat = a.account_categories as unknown as { type: string };
    accountInfo.set(a.id, { code: a.code, name: a.name, type: cat.type });
  }

  const isPl = mode === "pl";
  const wantType = (t: string) =>
    isPl ? t === "revenue" || t === "expenses" : t === "assets" || t === "liabilities" || t === "equity";

  // BSは累計残高のため全期間、PLは前期期首以降を取得
  let q = supabase
    .from("journal_entry_lines")
    .select(`account_id, debit_amount, credit_amount, journal_entries!inner ( client_id, entry_date )`)
    .eq("journal_entries.client_id", clientId)
    // 要確認の仕訳は数字に入れない（試算表・決算書と同じルール）
    .eq("journal_entries.needs_review", false)
    .lte("journal_entries.entry_date", fiscalYearEnd);
  if (isPl) q = q.gte("journal_entries.entry_date", priorStartDate);
  const { data: lines } = await q;

  // 当期・前期の各月の値（PL=フロー / BS=フローを後で累積）
  const curArr = new Map<string, number[]>();
  const prevArr = new Map<string, number[]>();
  // BS用 期首繰越（各ウィンドウ開始前の net = 借方−貸方）
  const openCur = new Map<string, number>();
  const openPrev = new Map<string, number>();
  const ensure = (m: Map<string, number[]>, id: string) => {
    if (!m.has(id)) m.set(id, new Array(12).fill(0));
    return m.get(id)!;
  };

  for (const line of lines ?? []) {
    const info = accountInfo.get(line.account_id);
    if (!info || !wantType(info.type)) continue;
    const entry = line.journal_entries as unknown as { entry_date: string };
    const date = entry.entry_date;
    const monthKey = date.slice(0, 7);

    if (isPl) {
      const flow = info.type === "revenue"
        ? line.credit_amount - line.debit_amount
        : line.debit_amount - line.credit_amount;
      const ci = curIdx(monthKey);
      if (ci >= 0) ensure(curArr, line.account_id)[ci] += flow;
      const pi = prIdx(monthKey);
      if (pi >= 0) ensure(prevArr, line.account_id)[pi] += flow;
    } else {
      const net = line.debit_amount - line.credit_amount; // 借方プラス
      const ci = curIdx(monthKey);
      const pi = prIdx(monthKey);
      if (ci >= 0) ensure(curArr, line.account_id)[ci] += net;
      else if (date < current.keys[0] + "-01") openCur.set(line.account_id, (openCur.get(line.account_id) ?? 0) + net);
      if (pi >= 0) ensure(prevArr, line.account_id)[pi] += net;
      else if (date < prior.keys[0] + "-01") openPrev.set(line.account_id, (openPrev.get(line.account_id) ?? 0) + net);
    }
  }

  const rows: MonthlyTrendRow[] = [];
  const ids = new Set<string>([...curArr.keys(), ...prevArr.keys(), ...openCur.keys(), ...openPrev.keys()]);
  for (const id of ids) {
    const info = accountInfo.get(id);
    if (!info) continue;
    const category = TREND_CATEGORY_MAP[info.type] ?? "expense";

    let months = curArr.get(id) ?? new Array(12).fill(0);
    let prevMonths = prevArr.get(id) ?? new Array(12).fill(0);

    if (!isPl) {
      // BS: フローを期首繰越から累積して各月末残高に変換し、科目の性質に応じた正の値へ
      const sign = category === "asset" ? 1 : -1; // 資産=借方正、負債・純資産=貸方正
      const accumulate = (flows: number[], opening: number) => {
        const out: number[] = [];
        let run = opening;
        for (let i = 0; i < 12; i++) {
          run += flows[i];
          out.push(run * sign);
        }
        return out;
      };
      months = accumulate(months, openCur.get(id) ?? 0);
      prevMonths = accumulate(prevMonths, openPrev.get(id) ?? 0);
    }

    const total = isPl ? months.reduce((s, v) => s + v, 0) : months[11];
    const allZero =
      months.every((m) => m === 0) && prevMonths.every((m) => m === 0);
    if (allZero) continue;

    rows.push({ code: info.code, name: info.name, months, prevMonths, total, category });
  }

  rows.sort((a, b) => a.code.localeCompare(b.code));
  return { rows, monthLabels };
}

/**
 * 集計から除外した「要確認」の仕訳の件数と金額。
 *
 * 要確認の仕訳（AIの信頼度が低い・貸借が合わない・証憑の合計と金額が合わない）は
 * 試算表・決算書の集計に入れていない。人の目を通していない金額を
 * 決算書に載せないためである。
 * ただし黙って落とすと、帳簿の一覧と決算書の数字が合わない理由が分からない。
 * 画面に「N件・¥X を集計に含めていません」と出すためにこれを使う。
 *
 * getTrialBalance の戻り値に混ぜず別のアクションにしているのは、
 * 既存の呼び出し側（決算書・申告書・開始残高）の型を変えないため。
 */
export async function getNeedsReviewSummary(
  clientId: string,
  startDate: string,
  endDate: string
): Promise<{ entryCount: number; amount: number }> {
  await assertClientAccess(clientId);
  const supabase = createAdminSupabaseClient();

  type Row = {
    debit_amount: number;
    journal_entry_id: string;
    journal_entries: { client_id: string; entry_date: string; needs_review?: boolean | null };
  };
  const rows = await fetchAllRows<Row>((from, to) =>
    supabase
      .from("journal_entry_lines")
      .select(
        `debit_amount, journal_entry_id, journal_entries!inner ( client_id, entry_date, needs_review )`
      )
      .eq("journal_entries.client_id", clientId)
      .eq("journal_entries.needs_review", true)
      .gte("journal_entries.entry_date", startDate)
      .lte("journal_entries.entry_date", endDate)
      .range(from, to) as unknown as PromiseLike<{ data: Row[] | null; error: { message: string } | null }>
  );

  return needsReviewSummary(
    rows.map((r) => ({
      account_id: "",
      debit_amount: r.debit_amount,
      credit_amount: 0,
      entry_date: r.journal_entries.entry_date,
      needs_review: true,
      journal_entry_id: r.journal_entry_id,
    })),
    startDate,
    endDate
  );
}
