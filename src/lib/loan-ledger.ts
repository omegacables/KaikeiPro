// 借入金台帳（借入金・役員借入金・役員貸付金）の算出ロジック。
//
// 設計の要点:
//   - 残高はDBに持たず、増減明細の積み上げから常に算出する。
//     手入力の「現在残高」は必ず実態とズレるため、そもそも保持しない。
//   - 残高は **その台帳の方向における正の値** で表す。
//     借入金台帳の残高＝債務、貸付金台帳の残高＝債権であり、
//     どちらも正の数で表示する（帳簿にマイナス表記は使わない）。
//     したがって増減の符号は entry_type だけで決まり、direction には依存しない。
//     direction が決めるのは「その残高が債務か債権か」という意味づけである。
//   - 会計年度（決算日）は src/lib/fiscal.ts を唯一の正とし、ここでは再計算しない。
//
// この方針により、途中の明細を修正・削除しても runningBalances を通すだけで
// 以降の残高がすべて再計算される。

import { fiscalRangeFromStartYear, getFiscalPeriod } from "@/lib/fiscal";

export type LoanDirection = "borrow" | "lend";
export type LoanEntryType = "borrow" | "advance" | "repay" | "interest" | "adjust";
export type LoanEntryStatus = "draft" | "confirmed" | "journalized";

/** 残高計算に必要な最小限の明細。DBの行そのものである必要はない。 */
export type LedgerEntry = {
  id: string;
  entry_date: string; // YYYY-MM-DD
  entry_type: LoanEntryType;
  amount: number;
  /** entry_type='adjust' のときのみ使う符号付きの差額 */
  signed_adjustment?: number | null;
  /**
   * entry_type='repay' のときに同時に支払った利息。
   * 費用として仕訳には載るが、借入金の残高は動かさない。
   */
  interest_amount?: number | null;
  status?: LoanEntryStatus;
  created_at?: string;
};

/**
 * 区分ごとの増減の符号。
 * 元本の発生（借入／貸付）・立替・利息は残高を増やし、返済／回収は減らす。
 * adjust は増減どちらにもなり得るため、この関数では扱わず deltaOf で分岐する。
 */
export function signOf(entryType: LoanEntryType): 1 | -1 | 0 {
  switch (entryType) {
    case "borrow":
    case "advance":
    case "interest":
      return 1;
    case "repay":
      return -1;
    case "adjust":
      return 0; // signed_adjustment を使う
  }
}

/** 明細1件が残高に与える増減（符号付き）。 */
export function deltaOf(entry: LedgerEntry): number {
  if (entry.entry_type === "adjust") {
    return Math.round(entry.signed_adjustment ?? 0);
  }
  return signOf(entry.entry_type) * Math.round(entry.amount ?? 0);
}

/**
 * AIの下書き（status='draft'）は人間が確定するまで残高に算入しない。
 * 要件4-2の原則1（AIは提案のみ。確定は必ず人間が行う）を残高の側でも担保する。
 */
export function isCountable(entry: LedgerEntry): boolean {
  return entry.status !== "draft";
}

/** 日付昇順（同日は created_at、それも同じなら id）で安定ソートする。 */
export function sortEntries<T extends LedgerEntry>(entries: T[]): T[] {
  return [...entries].sort((a, b) => {
    if (a.entry_date !== b.entry_date) return a.entry_date < b.entry_date ? -1 : 1;
    const ac = a.created_at ?? "";
    const bc = b.created_at ?? "";
    if (ac !== bc) return ac < bc ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export type RunningBalance<T extends LedgerEntry = LedgerEntry> = {
  entry: T;
  delta: number;
  /** その明細を反映した後の残高（その台帳の方向における正の値） */
  balanceAfter: number;
};

/**
 * 明細から残高推移を算出する。
 * 途中の明細を修正・削除した場合も、この関数に通し直せば以降の残高が再計算される。
 */
export function runningBalances<T extends LedgerEntry>(entries: T[]): RunningBalance<T>[] {
  let balance = 0;
  return sortEntries(entries)
    .filter(isCountable)
    .map((entry) => {
      const delta = deltaOf(entry);
      balance += delta;
      return { entry, delta, balanceAfter: balance };
    });
}

/** 現在残高（全明細を反映した後の残高）。 */
export function currentBalance(entries: LedgerEntry[]): number {
  return entries.filter(isCountable).reduce((sum, e) => sum + deltaOf(e), 0);
}

/** 指定日時点の残高（その日を含む）。決算日時点の残高を出すのに使う。 */
export function balanceAsOf(entries: LedgerEntry[], date: string): number {
  return entries
    .filter(isCountable)
    .filter((e) => e.entry_date <= date)
    .reduce((sum, e) => sum + deltaOf(e), 0);
}

export type BalanceByType = Record<LoanEntryType, number>;

export type InterestTotals = {
  /** 元本に加算した未払利息（entry_type='interest'）。残高を増やす */
  accrued: number;
  /** 返済と同時に支払った利息（repay の interest_amount）。残高は動かさない */
  paid: number;
  /** 合計 */
  total: number;
};

/**
 * 利息の集計。「元本に積んだ利息」と「現金で払った利息」は性質が違うので分けて返す。
 *
 * 勘定科目内訳明細書の「期中の支払利子額」に載るのは paid（実際に支払った額）。
 * 集計を entry_type='interest' だけで数えると、銀行返済のように
 * 元金と同時に利息を払う形では常に0になってしまう。
 */
export function interestTotals(
  entries: LedgerEntry[],
  range?: { from: string; to: string }
): InterestTotals {
  const inRange = (e: LedgerEntry) =>
    !range || (e.entry_date >= range.from && e.entry_date <= range.to);

  let accrued = 0;
  let paid = 0;
  for (const e of entries.filter(isCountable).filter(inRange)) {
    if (e.entry_type === "interest") accrued += Math.round(e.amount ?? 0);
    if (e.entry_type === "repay") paid += Math.round(e.interest_amount ?? 0);
  }
  return { accrued, paid, total: accrued + paid };
}

/**
 * 区分ごとの内訳。決算時に「現金の貸付」と「未精算の立替」で説明が分かれるため、
 * 区分別の累計を出せるようにしておく（要件3-1）。
 */
export function balanceByType(entries: LedgerEntry[]): BalanceByType {
  const acc: BalanceByType = { borrow: 0, advance: 0, repay: 0, interest: 0, adjust: 0 };
  for (const e of entries.filter(isCountable)) {
    acc[e.entry_type] += e.entry_type === "adjust" ? deltaOf(e) : Math.round(e.amount ?? 0);
  }
  return acc;
}

// ---------------------------------------------------------------------------
// 相手先ごとの差引（要件3-4）
// ---------------------------------------------------------------------------

export type LedgerHeader = {
  id: string;
  lender_name: string;
  direction: LoanDirection;
};

export type NetPosition = {
  name: string;
  /** 借入金（会社の債務）の残高。正の値 */
  borrowBalance: number;
  /** 貸付金（会社の債権）の残高。正の値 */
  lendBalance: number;
  /** 差引の絶対額。正の値 */
  net: number;
  /** 差引がどちら側に残るか。even は相殺 */
  netSide: "borrow" | "lend" | "even";
};

/**
 * 同一相手先に借入金と貸付金の両方がある場合の差引を出す。
 * 会計上は両建てが原則であり、これは実態把握のための表示用。
 * 差額は符号ではなく netSide（どちら側に残るか）で表す。
 */
export function netByCounterparty(
  headers: LedgerHeader[],
  entriesByLoanId: Record<string, LedgerEntry[]>
): NetPosition[] {
  const byName = new Map<string, NetPosition>();

  for (const h of headers) {
    const name = h.lender_name.trim();
    const balance = currentBalance(entriesByLoanId[h.id] ?? []);
    const cur =
      byName.get(name) ??
      { name, borrowBalance: 0, lendBalance: 0, net: 0, netSide: "even" as const };

    if (h.direction === "lend") cur.lendBalance += balance;
    else cur.borrowBalance += balance;

    byName.set(name, cur);
  }

  for (const p of byName.values()) {
    const diff = p.lendBalance - p.borrowBalance;
    p.net = Math.abs(diff);
    p.netSide = diff > 0 ? "lend" : diff < 0 ? "borrow" : "even";
  }

  return [...byName.values()];
}

// ---------------------------------------------------------------------------
// 認定利息（要件3-4）
//
// 適用利率は「貸付けを行った日の属する年（暦年）」で決まり、その後の年が変わっても
// その貸付に対する利率は変わらない（所得税基本通達36-49 / タックスアンサー No.2606）。
// 会計年度ではなく暦年である点に注意。
//
// したがって残高を1つの数字として扱うと利率を決められない。貸付の実行ごとに
// 「トランシェ」として利率を保持し、返済は古い貸付から順に（FIFO）充当する。
// ---------------------------------------------------------------------------

const DAYS_PER_YEAR = 365;

/**
 * 給与課税されない差額の上限（年）。
 * 所定利率で計算した利息と実際に支払われた利息の差額が年5,000円以下であれば
 * 給与として課税されない（タックスアンサー No.2606 の例外規定）。
 */
export const TAX_EXEMPT_INTEREST_THRESHOLD = 5000;

/** 日数の差（end - start）。両端の日付は YYYY-MM-DD。 */
export function daysBetween(start: string, end: string): number {
  const ms = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/** 貸付1本ぶんの残高。利率はこの貸付を行った暦年で固定される。 */
export type Tranche = {
  /** 貸付けを行った日の属する年（暦年） */
  loanYear: number;
  date: string;
  outstanding: number;
};

/**
 * 指定日時点で残っている貸付をトランシェ単位で返す。
 * 返済は古い貸付から順に充当する（FIFO）。どの貸付が残っているかで利率が変わるため、
 * 残高を1つに合算せずに保持する。
 */
export function outstandingTranches(entries: LedgerEntry[], asOf: string): Tranche[] {
  const tranches: Tranche[] = [];

  const consume = (amount: number) => {
    let rest = amount;
    for (const t of tranches) {
      if (rest <= 0) break;
      const used = Math.min(t.outstanding, rest);
      t.outstanding -= used;
      rest -= used;
    }
  };

  for (const e of sortEntries(entries).filter(isCountable)) {
    if (e.entry_date > asOf) break;
    const delta = deltaOf(e);
    if (delta > 0) {
      tranches.push({
        loanYear: Number(e.entry_date.slice(0, 4)),
        date: e.entry_date,
        outstanding: delta,
      });
    } else if (delta < 0) {
      consume(-delta);
    }
  }

  return tranches.filter((t) => t.outstanding > 0);
}

/**
 * 認定利息の試算。利率は年利(%)。
 * 利率が未設定（null）の場合は推測せず null を返す。
 */
export function imputedInterest(
  balance: number,
  ratePercent: number | null | undefined,
  days: number
): number | null {
  if (ratePercent == null) return null;
  if (balance <= 0 || days <= 0) return 0;
  return Math.round((balance * (ratePercent / 100) * days) / DAYS_PER_YEAR);
}

export type InterestBreakdown = {
  loanYear: number;
  outstanding: number;
  /** その貸付年に適用される年利(%)。未登録なら null */
  rate: number | null;
  days: number;
  interest: number | null;
};

export type ImputedInterestAlert = {
  /** none=貸付金なし / warning=期末前 / required=期末をまたいだ（計上義務あり） */
  level: "none" | "warning" | "required";
  /** 現在の貸付金残高 */
  balance: number;
  /** 当期の決算日 */
  fiscalYearEnd: string;
  /** 決算日までの日数（過ぎていれば負） */
  daysUntilFiscalYearEnd: number;
  /** 直前の決算日（期末をまたいだ判定に使う） */
  priorFiscalYearEnd: string;
  /** 直前の決算日時点の残高 */
  balanceAtPriorYearEnd: number;
  /** 貸付年ごとの内訳（利率が貸付年で決まるため合算できない） */
  breakdown: InterestBreakdown[];
  /** 利率が未登録の貸付年。空でなければ試算は行わない */
  missingRateYears: number[];
  /** 認定利息の試算額。利率が未登録の貸付年があれば null */
  estimatedInterest: number | null;
  /**
   * 試算額が年5,000円以下で、給与課税の例外に該当しうるか。
   * 実際に支払われた利息との差額で判定されるため、あくまで目安。
   */
  withinTaxExemptThreshold: boolean;
};

/**
 * 役員貸付金の認定利息アラートを判定する。
 *
 * 役員借入金（会社が役員から借りる）は税務リスクがほぼ無いが、
 * 役員貸付金（会社が役員に貸す）は期末をまたいで残高があると
 * 認定利息の計上義務が生じ、常態化すると役員賞与と認定される。
 *
 * 決算日は fiscalRangeFromStartYear() の endDate をそのまま使う（再計算しない）。
 * 利率は貸付を行った暦年で引く（会計年度ではない）。
 */
export function imputedInterestAlert(params: {
  entries: LedgerEntry[];
  fiscalStartMonth: number | null | undefined;
  /** 判定基準日。既定は今日 */
  today?: string;
  /** 貸付けを行った暦年 → 年利(%) */
  rateByLoanYear?: Record<number, number>;
}): ImputedInterestAlert {
  const today = params.today ?? new Date().toISOString().slice(0, 10);
  const [y, m] = today.split("-").map(Number);

  const period = getFiscalPeriod(params.fiscalStartMonth, y, m);
  const fiscalYearEnd = period.endDate;
  const priorFiscalYearEnd = fiscalRangeFromStartYear(
    params.fiscalStartMonth,
    period.startYear - 1
  ).endDate;

  const balance = currentBalance(params.entries);
  const balanceAtPriorYearEnd = balanceAsOf(params.entries, priorFiscalYearEnd);
  const daysUntilFiscalYearEnd = daysBetween(today, fiscalYearEnd);

  // 期末をまたいで残高が残っている＝認定利息の計上義務が発生している
  const crossed = balanceAtPriorYearEnd > 0;

  let level: ImputedInterestAlert["level"];
  if (crossed) level = "required";
  else if (balance > 0) level = "warning";
  else level = "none";

  // 認定利息は事業年度を通じて発生する。
  // 貸付ごとに「その貸付が当期中に残っていた期間」で計算する:
  //   期首より前からある貸付 … 期首から期末まで
  //   期中に実行した貸付     … 実行日から期末まで
  // 「今日から期末まで」で数えると、すでに経過した期間が抜けて試算が過小になる。
  // 残高は今日時点のものを使い、以後の返済は見込まない（警告として過小に出さない）。
  const tranches = level === "none" ? [] : outstandingTranches(params.entries, today);

  const breakdown: InterestBreakdown[] = tranches.map((t) => {
    const rate = params.rateByLoanYear?.[t.loanYear] ?? null;
    const accrualFrom = t.date > period.startDate ? t.date : period.startDate;
    const days = Math.max(0, daysBetween(accrualFrom, fiscalYearEnd));
    return {
      loanYear: t.loanYear,
      outstanding: t.outstanding,
      rate,
      days,
      interest: imputedInterest(t.outstanding, rate, days),
    };
  });

  const missingRateYears = [
    ...new Set(breakdown.filter((b) => b.rate == null).map((b) => b.loanYear)),
  ].sort();

  // 利率が1年でも欠けていれば合計は出さない（推測しない）
  const estimatedInterest =
    level === "none"
      ? 0
      : missingRateYears.length > 0
        ? null
        : breakdown.reduce((sum, b) => sum + (b.interest ?? 0), 0);

  return {
    level,
    balance,
    fiscalYearEnd,
    daysUntilFiscalYearEnd,
    priorFiscalYearEnd,
    balanceAtPriorYearEnd,
    breakdown,
    missingRateYears,
    estimatedInterest,
    withinTaxExemptThreshold:
      estimatedInterest != null &&
      estimatedInterest > 0 &&
      estimatedInterest <= TAX_EXEMPT_INTEREST_THRESHOLD,
  };
}

// ---------------------------------------------------------------------------
// 表示用のラベル
// ---------------------------------------------------------------------------

/** 区分のラベル。台帳の方向によって呼び名が変わる。 */
export function entryTypeLabel(type: LoanEntryType, direction: LoanDirection): string {
  const lend = direction === "lend";
  switch (type) {
    case "borrow":
      return lend ? "貸付" : "借入";
    case "advance":
      return "立替";
    case "repay":
      return lend ? "回収" : "返済";
    case "interest":
      return "利息";
    case "adjust":
      return "調整";
  }
}

export function directionLabel(direction: LoanDirection): string {
  return direction === "lend" ? "役員貸付金" : "借入金";
}

// ---------------------------------------------------------------------------
// 仕訳の借方・貸方（要件3-2 / 3-5）
// ---------------------------------------------------------------------------

export type JournalLine = { accountId: string; debit: number; credit: number };

/**
 * 明細1件を仕訳の借方・貸方に変換する。会計上の対応はここが唯一の定義。
 *
 *  借入金台帳（direction='borrow'、残高＝会社の債務）
 *    借入 : 借方 普通預金   / 貸方 役員借入金
 *    立替 : 借方 費用科目   / 貸方 役員借入金   ← 現金は動かない（要件3-2）
 *    返済 : 借方 役員借入金 / 貸方 普通預金
 *    利息 : 借方 支払利息   / 貸方 役員借入金
 *
 *  貸付金台帳（direction='lend'、残高＝会社の債権）
 *    貸付 : 借方 役員貸付金 / 貸方 普通預金
 *    回収 : 借方 普通預金   / 貸方 役員貸付金
 *    利息 : 借方 役員貸付金 / 貸方 受取利息     ← 認定利息の計上
 */
export function buildJournalLines(params: {
  direction: LoanDirection;
  entryType: LoanEntryType;
  amount: number;
  /** 借入金/貸付金の科目 */
  ledgerAccountId: string;
  paymentAccountId: string | null;
  expenseAccountId: string | null;
  interestAccountId: string | null;
  /** 返済と同時に支払った利息。残高は動かさず、仕訳にだけ載る */
  paidInterest?: number;
}): JournalLine[] {
  const { direction, entryType, amount, ledgerAccountId } = params;
  const paidInterest = Math.max(0, Math.round(params.paidInterest ?? 0));

  const pair = (debitId: string, creditId: string): JournalLine[] => [
    { accountId: debitId, debit: amount, credit: 0 },
    { accountId: creditId, debit: 0, credit: amount },
  ];
  const need = (id: string | null, label: string): string => {
    if (!id) throw new Error(`${label}が特定できません。勘定科目を設定してください。`);
    return id;
  };

  if (entryType === "adjust") {
    throw new Error("調整の明細は仕訳化できません。内容を確認して区分を修正してください。");
  }

  if (direction === "borrow") {
    switch (entryType) {
      case "borrow":
        return pair(need(params.paymentAccountId, "入金先の科目"), ledgerAccountId);
      case "advance":
        // 現金は動かさない。費用の計上と債務の計上が同時に立つ
        return pair(need(params.expenseAccountId, "立替の費用科目"), ledgerAccountId);
      case "repay": {
        const payment = need(params.paymentAccountId, "支払元の科目");
        if (paidInterest === 0) return pair(ledgerAccountId, payment);
        // 元金と利息を同時に支払う。利息は費用で、借入金残高は元金分しか減らない
        return [
          { accountId: ledgerAccountId, debit: amount, credit: 0 },
          {
            accountId: need(params.interestAccountId, "「支払利息」科目"),
            debit: paidInterest,
            credit: 0,
          },
          { accountId: payment, debit: 0, credit: amount + paidInterest },
        ];
      }
      case "interest":
        // 未払利息を元本に加算する計上（支払済みの利息とは別物）
        return pair(need(params.interestAccountId, "「支払利息」科目"), ledgerAccountId);
    }
  }

  switch (entryType) {
    case "borrow": // 貸付
      return pair(ledgerAccountId, need(params.paymentAccountId, "支払元の科目"));
    case "repay": // 回収
      return pair(need(params.paymentAccountId, "入金先の科目"), ledgerAccountId);
    case "interest": // 認定利息
      return pair(ledgerAccountId, need(params.interestAccountId, "「受取利息」科目"));
    case "advance":
      throw new Error("立替は借入金台帳のみで使用できます。");
  }
}

// ---------------------------------------------------------------------------
// 返済予定表（要件3-7）
// ---------------------------------------------------------------------------

export type RepaymentMethod = "equal_principal" | "equal_payment";

/**
 * 返済日の決め方。
 *   same_day  … 初回と同じ日にちで毎月（4/30 起算なら 5/30, 6/30…）
 *   month_end … 毎月の末日（4/30 起算なら 5/31, 6/30, 7/31…）
 * 銀行融資は「毎月末日」の契約が多い一方、給与日に合わせて日を固定する場合もある。
 */
export type DueDateMode = "same_day" | "month_end";

export type ScheduleRow = {
  due_date: string;
  principal_amount: number;
  interest_amount: number;
};

/** その月の末日 */
export function endOfMonth(date: string): string {
  const [y, m] = date.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

/** 月を加算した日付。月末日は繰り上がらないよう、その月の末日に丸める。 */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const total = (m - 1) + months;
  const ny = y + Math.floor(total / 12);
  const nm = ((total % 12) + 12) % 12 + 1;
  const maxDay = new Date(ny, nm, 0).getDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, maxDay)).padStart(2, "0")}`;
}

/**
 * 返済予定表を作る。
 *
 *   元金均等（equal_principal）… 毎回の元金が一定。利息は残高に応じて減る
 *   元利均等（equal_payment）  … 毎回の支払総額が一定。元金と利息の比率が変わる
 *
 * 端数は最終回で吸収し、元金の合計が必ず借入額と一致するようにする。
 * （合計が合わないと、完済したのに残高が残る／マイナスになる）
 */
export function generateRepaymentSchedule(params: {
  principal: number;
  /** 年利(%) */
  annualRatePercent: number;
  /** 返済回数（月） */
  termMonths: number;
  /** 初回返済日 */
  firstDueDate: string;
  method: RepaymentMethod;
  /** 返済日の決め方。既定は初回と同じ日にち */
  dueDateMode?: DueDateMode;
}): ScheduleRow[] {
  const { principal, annualRatePercent, termMonths, firstDueDate, method } = params;
  const dueDateMode = params.dueDateMode ?? "same_day";
  if (principal <= 0 || termMonths <= 0) return [];

  const monthlyRate = annualRatePercent / 100 / 12;
  const rows: ScheduleRow[] = [];
  let remaining = principal;

  // 元利均等の毎回支払額（無利息なら単純に等分）
  const payment =
    method === "equal_payment" && monthlyRate > 0
      ? (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -termMonths))
      : principal / termMonths;

  for (let i = 0; i < termMonths; i++) {
    const isLast = i === termMonths - 1;
    const interest = Math.round(remaining * monthlyRate);

    let principalPart: number;
    if (isLast) {
      // 端数を最終回で吸収する
      principalPart = remaining;
    } else if (method === "equal_principal") {
      principalPart = Math.round(principal / termMonths);
    } else {
      principalPart = Math.max(0, Math.round(payment - interest));
    }
    principalPart = Math.min(principalPart, remaining);

    const nth = addMonths(firstDueDate, i);
    rows.push({
      due_date: dueDateMode === "month_end" ? endOfMonth(nth) : nth,
      principal_amount: principalPart,
      interest_amount: interest,
    });
    remaining -= principalPart;
  }

  return rows;
}

// ---------------------------------------------------------------------------
// 整合性チェック（要件3-5 / 4-6）
// ---------------------------------------------------------------------------

/** 仕訳側の1行。借入金/貸付金の科目に付いた行だけを渡す。 */
export type JournalLineForCheck = {
  journalEntryId: string;
  date: string;
  debit: number;
  credit: number;
  description?: string | null;
  source?: string | null;
};

export type ReconcileSuspect = {
  kind: "not_journalized" | "journal_without_entry" | "draft_entry";
  date: string;
  amount: number;
  label: string;
  /** 対応する台帳明細 or 仕訳のID */
  refId: string;
};

export type ReconcileResult = {
  /** 台帳の明細から算出した残高 */
  ledgerBalance: number;
  /** 仕訳から集計した勘定残高 */
  journalBalance: number;
  /** 差額の絶対値 */
  difference: number;
  /** 差額がどちら側に大きいか */
  largerSide: "ledger" | "journal" | "even";
  matched: boolean;
  /** 差額の原因と思われるもの */
  suspects: ReconcileSuspect[];
};

/**
 * 台帳の残高と、仕訳から集計した勘定残高を突き合わせる。
 *
 * 借入金（direction='borrow'）は負債なので 貸方−借方 が残高。
 * 貸付金（direction='lend'）は資産なので 借方−貸方 が残高。
 *
 * 一致しない場合は、原因になりやすいものを挙げる:
 *   - まだ仕訳にしていない明細（台帳にはあるが仕訳に無い）
 *   - 台帳の明細と結びついていない仕訳（仕訳にはあるが台帳に無い）
 *   - AIの下書きのまま確定していない明細
 */
export function reconcileLoanLedger(params: {
  direction: LoanDirection;
  entries: LedgerEntry[];
  journalLines: JournalLineForCheck[];
  /** 明細の区分名を出すために使う */
  labelOf?: (e: LedgerEntry) => string;
}): ReconcileResult {
  const { direction, entries, journalLines } = params;
  const label = params.labelOf ?? ((e: LedgerEntry) => entryTypeLabel(e.entry_type, direction));

  const ledgerBalance = currentBalance(entries);
  const journalBalance = journalLines.reduce(
    (sum, l) => sum + (direction === "lend" ? l.debit - l.credit : l.credit - l.debit),
    0
  );

  const diff = ledgerBalance - journalBalance;
  const suspects: ReconcileSuspect[] = [];

  // 台帳にあるが仕訳にしていない明細
  for (const e of entries) {
    if (e.status === "draft") {
      suspects.push({
        kind: "draft_entry",
        date: e.entry_date,
        amount: e.amount,
        label: `${label(e)}（AIの下書きのまま。確定すると残高に入ります）`,
        refId: e.id,
      });
    }
  }

  const journalIdsInLedger = new Set(
    entries
      .map((e) => (e as LedgerEntry & { journal_entry_id?: string | null }).journal_entry_id)
      .filter((v): v is string => Boolean(v))
  );

  for (const e of entries) {
    const jid = (e as LedgerEntry & { journal_entry_id?: string | null }).journal_entry_id;
    if (!jid && e.status !== "draft") {
      suspects.push({
        kind: "not_journalized",
        date: e.entry_date,
        amount: e.amount,
        label: `${label(e)}（まだ仕訳にしていません）`,
        refId: e.id,
      });
    }
  }

  // 仕訳にあるが台帳の明細と結びついていないもの
  const seen = new Set<string>();
  for (const l of journalLines) {
    if (journalIdsInLedger.has(l.journalEntryId) || seen.has(l.journalEntryId)) continue;
    seen.add(l.journalEntryId);
    suspects.push({
      kind: "journal_without_entry",
      date: l.date,
      amount: Math.max(l.debit, l.credit),
      label: `${l.description ?? "仕訳"}（台帳に対応する明細がありません）`,
      refId: l.journalEntryId,
    });
  }

  return {
    ledgerBalance,
    journalBalance,
    difference: Math.abs(diff),
    largerSide: diff > 0 ? "ledger" : diff < 0 ? "journal" : "even",
    matched: diff === 0,
    suspects: suspects.sort((a, b) => (a.date < b.date ? -1 : 1)),
  };
}

// ---------------------------------------------------------------------------
// 既にある仕訳から明細を組み立てる
// ---------------------------------------------------------------------------

/** 仕訳1行ぶん。取り込みの判定に使う最小限だけを持つ */
export type JournalLineForImport = {
  accountId: string;
  debit: number;
  credit: number;
};

export type ImportedEntryDraft = {
  entry_type: Extract<LoanEntryType, "borrow" | "repay">;
  amount: number;
  interest_amount: number;
};

/**
 * 既にある仕訳から、台帳の明細に相当する内容を読み取る。
 *
 * 判定はすべて「借入金（貸付金）科目の行が借方か貸方か」で決まる。
 *
 *   借りる側（direction='borrow'）… 貸方に立てば残高が増える＝借入
 *                                    借方に立てば残高が減る＝返済
 *   貸す側（direction='lend'）  … 上記の逆
 *
 * 支払利息（貸付なら受取利息）の行があれば、返済と同時に払った利息として取り込む。
 * 利息は残高を動かさないため、金額とは別に持つ。
 *
 * 借方と貸方が同額で相殺される仕訳（振替など）は増減が読み取れないので null を返す。
 */
export function entryFromJournalLines(params: {
  direction: LoanDirection;
  /** 借入金／貸付金の科目 */
  ledgerAccountId: string;
  /** 支払利息（貸付なら受取利息）の科目。無ければ null */
  interestAccountId: string | null;
  lines: JournalLineForImport[];
}): ImportedEntryDraft | null {
  const { direction, ledgerAccountId, interestAccountId, lines } = params;

  const ledgerLines = lines.filter((l) => l.accountId === ledgerAccountId);
  if (ledgerLines.length === 0) return null;

  const debit = ledgerLines.reduce((s, l) => s + l.debit, 0);
  const credit = ledgerLines.reduce((s, l) => s + l.credit, 0);

  // 残高を増やす向きを正とする
  const net = direction === "lend" ? debit - credit : credit - debit;
  if (net === 0) return null;

  const entry_type = net > 0 ? "borrow" : "repay";

  // 利息は返済（回収）と同時に払われたもののみ取り込む
  let interest_amount = 0;
  if (entry_type === "repay" && interestAccountId) {
    interest_amount = lines
      .filter((l) => l.accountId === interestAccountId)
      // 支払利息は借方に、受取利息は貸方に立つ
      .reduce((s, l) => s + (direction === "lend" ? l.credit : l.debit), 0);
  }

  return { entry_type, amount: Math.abs(net), interest_amount };
}
