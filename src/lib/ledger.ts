/**
 * 総勘定元帳・補助元帳の計算（純粋関数）。
 *
 * 残高の考え方は試算表（src/lib/trial-balance.ts）とそろえる。
 *   - 要確認の仕訳は残高に入れない（行は「要確認」として表示する）
 *   - 期首の開始仕訳（source='closing' で期首日付）は前期繰越として扱う
 *   - 資産・負債・純資産は過去の全期間から繰り越す。
 *     収益・費用は事業年度ごとに区切り、期首から表示開始日の前日までを繰り越す
 * 残高は科目の性質に応じた向き（資産・費用は借方、負債・純資産・収益は貸方）を正とする。
 */

export type LedgerCategory = "asset" | "liability" | "equity" | "revenue" | "expense";

export type LedgerLine = {
  lineId: string;
  entryId: string;
  entryDate: string;
  createdAt: string;
  description: string;
  source: string | null;
  needsReview: boolean;
  debit: number;
  credit: number;
  subAccountId: string | null;
};

export type LedgerRow<T extends LedgerLine = LedgerLine> = T & {
  /** この行までの残高（要確認の行は残高に入れない） */
  balance: number;
};

export type Ledger<T extends LedgerLine = LedgerLine> = {
  /** 前期繰越（収益・費用は期首から表示開始日の前日まで） */
  opening: number;
  rows: LedgerRow<T>[];
  debitTotal: number;
  creditTotal: number;
  closing: number;
};

export const isDebitNormal = (c: LedgerCategory) => c === "asset" || c === "expense";
const isPl = (c: LedgerCategory) => c === "revenue" || c === "expense";

/** 科目の性質に応じた向きの増減額 */
export function signedAmount(c: LedgerCategory, debit: number, credit: number): number {
  return isDebitNormal(c) ? debit - credit : credit - debit;
}

/** 前期繰越に入る行か（表示期間より前、または期首の開始仕訳） */
function isCarriedForward(l: LedgerLine, dateFrom: string) {
  return l.entryDate < dateFrom || (l.entryDate === dateFrom && l.source === "closing");
}

/**
 * 元帳を作る。
 * @param fiscalStart 表示開始日が属する事業年度の期首日（収益・費用の繰越の起点）
 */
export function buildLedger<T extends LedgerLine>(
  category: LedgerCategory,
  lines: T[],
  dateFrom: string,
  dateTo: string,
  fiscalStart: string
): Ledger<T> {
  let opening = 0;
  const inRange: T[] = [];
  for (const l of lines) {
    if (l.entryDate > dateTo) continue;
    if (isCarriedForward(l, dateFrom)) {
      if (l.needsReview) continue;
      // 収益・費用は前の事業年度から繰り越さない
      if (isPl(category) && l.entryDate < fiscalStart) continue;
      opening += signedAmount(category, l.debit, l.credit);
    } else {
      inRange.push(l);
    }
  }
  inRange.sort(
    (a, b) => a.entryDate.localeCompare(b.entryDate) || a.createdAt.localeCompare(b.createdAt)
  );

  let balance = opening;
  let debitTotal = 0;
  let creditTotal = 0;
  const rows = inRange.map((l) => {
    if (!l.needsReview) {
      balance += signedAmount(category, l.debit, l.credit);
      debitTotal += l.debit;
      creditTotal += l.credit;
    }
    return { ...l, balance };
  });
  return { opening, rows, debitTotal, creditTotal, closing: balance };
}

export type SubAccountSummaryRow = {
  /** 補助科目。補助科目の無い行は null にまとめる */
  subAccountId: string | null;
  opening: number;
  /** 発生（売掛金なら売上、買掛金なら仕入） */
  increase: number;
  /** 減少（売掛金なら回収、買掛金なら支払） */
  decrease: number;
  closing: number;
  count: number;
};

/**
 * 補助科目（相手先）ごとに、前期繰越・発生・減少・残高をまとめる。
 * 売掛帳・買掛帳を「取引ごと」ではなく「相手先ごと」に見るために使う。
 */
export function summarizeBySubAccount(
  category: LedgerCategory,
  lines: LedgerLine[],
  dateFrom: string,
  dateTo: string,
  fiscalStart: string
): SubAccountSummaryRow[] {
  const map = new Map<string | null, SubAccountSummaryRow>();
  const get = (id: string | null) => {
    let r = map.get(id);
    if (!r) {
      r = { subAccountId: id, opening: 0, increase: 0, decrease: 0, closing: 0, count: 0 };
      map.set(id, r);
    }
    return r;
  };
  for (const l of lines) {
    if (l.entryDate > dateTo || l.needsReview) continue;
    const amt = signedAmount(category, l.debit, l.credit);
    if (isCarriedForward(l, dateFrom)) {
      if (isPl(category) && l.entryDate < fiscalStart) continue;
      get(l.subAccountId).opening += amt;
    } else {
      const r = get(l.subAccountId);
      r.count++;
      // 科目の性質の向きに動いたものを発生、逆向きを減少とする
      const inc = isDebitNormal(category) ? l.debit : l.credit;
      const dec = isDebitNormal(category) ? l.credit : l.debit;
      r.increase += inc;
      r.decrease += dec;
    }
  }
  const rows = [...map.values()].map((r) => ({ ...r, closing: r.opening + r.increase - r.decrease }));
  return rows.filter((r) => r.opening !== 0 || r.count > 0);
}
