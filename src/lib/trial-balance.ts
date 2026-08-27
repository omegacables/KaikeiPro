/**
 * 試算表の集計ロジック（純粋関数）。
 *
 * 試算表・貸借対照表・損益計算書・決算書はすべてこの集計結果を土台にしている。
 * DBアクセスと切り離してテストできるよう、計算部分だけをここに置く。
 */

export type AccountCategory = "asset" | "liability" | "equity" | "revenue" | "expense";

export const CATEGORY_BY_DB_TYPE: Record<string, AccountCategory> = {
  assets: "asset",
  liabilities: "liability",
  equity: "equity",
  revenue: "revenue",
  expenses: "expense",
};

export type AggregatableAccount = {
  id: string;
  code: string;
  name: string;
  category: AccountCategory;
};

export type AggregatableLine = {
  account_id: string;
  debit_amount: number;
  credit_amount: number;
  entry_date: string;
  source?: string | null;
};

export type AggregatedAccount = {
  id: string;
  prevBalance: number;
  debitTotal: number;
  creditTotal: number;
  currentBalance: number;
};

/**
 * 繰越利益剰余金（個人事業主は元入金）かどうか。
 * 過年度の損益をここへ振り替える。
 */
export function isRetainedEarningsAccount(acct: {
  code: string;
  name: string;
  category: AccountCategory;
}): boolean {
  return (
    acct.category === "equity" &&
    (acct.code === "3310" ||
      acct.name.includes("繰越利益剰余金") ||
      acct.name.includes("元入金"))
  );
}

/**
 * 仕訳明細を勘定科目ごとに集計する。
 *
 * 会計上の要点:
 * - startDate より前の仕訳は「前期繰越」。期首日付の期首残高仕訳
 *   （source='closing'）も当期発生ではなく前期繰越として扱う。
 * - 損益科目（収益・費用）は会計期間ごとに独立するため前期残高を繰り越さない。
 * - 繰り越さなかった過年度の損益は繰越利益剰余金へ振り替える
 *   （年度締めの損益振替に相当）。これを行わないと翌期のB/Sが貸借不一致になる。
 */
export function aggregateTrialBalance(
  accounts: AggregatableAccount[],
  lines: AggregatableLine[],
  startDate: string,
  endDate: string
): Map<string, AggregatedAccount> {
  const prevBalanceMap = new Map<string, number>();
  const accountTotals = new Map<string, { debit: number; credit: number }>();

  for (const line of lines) {
    if (line.entry_date > endDate) continue;
    const isOpeningEntry = line.entry_date === startDate && line.source === "closing";
    if (line.entry_date < startDate || isOpeningEntry) {
      const prev = prevBalanceMap.get(line.account_id) ?? 0;
      prevBalanceMap.set(line.account_id, prev + line.debit_amount - line.credit_amount);
    } else {
      const cur = accountTotals.get(line.account_id) ?? { debit: 0, credit: 0 };
      cur.debit += line.debit_amount;
      cur.credit += line.credit_amount;
      accountTotals.set(line.account_id, cur);
    }
  }

  const categoryById = new Map(accounts.map((a) => [a.id, a.category]));

  // 過年度純損益（利益がプラス）。prevBalance は「借方 - 貸方」なので符号を反転して足す。
  let pastNetIncome = 0;
  for (const [accId, v] of prevBalanceMap) {
    const c = categoryById.get(accId);
    if (c === "revenue" || c === "expense") pastNetIncome -= v;
  }

  const result = new Map<string, AggregatedAccount>();
  for (const acct of accounts) {
    const totals = accountTotals.get(acct.id) ?? { debit: 0, credit: 0 };
    const isPlAccount = acct.category === "revenue" || acct.category === "expense";
    let prevBalance = isPlAccount ? 0 : prevBalanceMap.get(acct.id) ?? 0;
    if (isRetainedEarningsAccount(acct)) prevBalance -= pastNetIncome;

    if (totals.debit === 0 && totals.credit === 0 && prevBalance === 0) continue;

    result.set(acct.id, {
      id: acct.id,
      prevBalance,
      debitTotal: totals.debit,
      creditTotal: totals.credit,
      currentBalance: prevBalance + totals.debit - totals.credit,
    });
  }
  return result;
}
