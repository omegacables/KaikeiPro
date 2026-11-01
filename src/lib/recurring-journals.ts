/**
 * 定期仕訳（毎月くり返す仕訳）の計算。純粋関数。
 *
 * 家賃・リース料・顧問料・保険料・役員報酬・ローン返済・サブスク料金・家賃収入など、
 * 毎月同じ形で起きる取引を一度登録しておき、まだ作っていない月の分をまとめて作る。
 * ここでは「どの月を作るか」「その月の計上日はいつか」「貸借が合っているか」だけを決める。
 *
 * 計上日は給料日（payday.ts）と同じく 1〜31 の日にちか、0＝末日で持つ。
 * その月に無い日（2月の31日など）は月末にそろえる。
 */

/** 末日を表す値 */
export const END_OF_MONTH = 0;

/** 定期仕訳の明細（recurring_journals.lines の1要素） */
export type RecurringLine = {
  account_id: string;
  sub_account_id: string | null;
  debit_amount: number;
  credit_amount: number;
  tax_category: string | null;
  /** 個別対応方式の用途区分（任意）。既存の仕訳から作ったときに元の行から引き継ぐ */
  purchase_use?: "taxable" | "non_taxable" | "common" | null;
  /** 簡易課税の事業区分 1〜6（任意）。既存の仕訳から作ったときに元の行から引き継ぐ */
  business_type?: number | null;
};

/** くり返しの決まり */
export type RecurringSchedule = {
  /** 1〜31、0＝末日 */
  dayOfMonth: number;
  /** 最初の月（YYYY-MM） */
  startMonth: string;
  /** 最後の月（YYYY-MM）。null は終わりなし */
  endMonth: string | null;
  /** 何か月ごとか（1＝毎月、3＝四半期、12＝毎年） */
  intervalMonths: number;
  isActive: boolean;
};

/** 画面で選べる周期 */
export const INTERVAL_OPTIONS = [
  { value: 1, label: "毎月" },
  { value: 2, label: "2か月ごと" },
  { value: 3, label: "3か月ごと（四半期）" },
  { value: 6, label: "半年ごと" },
  { value: 12, label: "毎年" },
] as const;

/** 1回に作る月の上限（開始月を何十年も前にした打ち間違いで、大量に作らないため） */
export const MAX_MONTHS = 240;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

const pad2 = (n: number) => String(n).padStart(2, "0");

/** YYYY-MM の形か */
export function isMonth(v: unknown): v is string {
  return typeof v === "string" && MONTH_RE.test(v);
}

/** 年月を通しの番号に（月の足し引きのため） */
function monthIndex(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return y * 12 + (m - 1);
}

function fromIndex(i: number): string {
  return `${Math.floor(i / 12)}-${pad2((i % 12) + 1)}`;
}

/** 年月に n か月を足す（2026-11 + 3 → 2027-02） */
export function addMonths(month: string, n: number): string {
  return fromIndex(monthIndex(month) + n);
}

/** to が from の何か月後か（同じ月なら 0、前なら負） */
export function monthsBetween(from: string, to: string): number {
  return monthIndex(to) - monthIndex(from);
}

/**
 * 対象月（YYYY-MM）の計上日（YYYY-MM-DD）。
 * 0＝末日。その月に無い日（2月の31日・9月の31日）は月末にそろえる。
 * 形が不正なら空文字（勝手な日付を作らない）。
 */
export function postingDateOf(month: string, dayOfMonth: number): string {
  if (!isMonth(month)) return "";
  if (!Number.isInteger(dayOfMonth) || dayOfMonth < 0 || dayOfMonth > 31) return "";
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const day = dayOfMonth === END_OF_MONTH ? lastDay : Math.min(dayOfMonth, lastDay);
  return `${month}-${pad2(day)}`;
}

/** 計上日の表示名 */
export function dayOfMonthLabel(dayOfMonth: number): string {
  return dayOfMonth === END_OF_MONTH ? "末日" : `${dayOfMonth}日`;
}

/** 周期の表示名 */
export function intervalLabel(intervalMonths: number): string {
  return INTERVAL_OPTIONS.find((o) => o.value === intervalMonths)?.label ?? `${intervalMonths}か月ごと`;
}

/** 年月の表示（2026-04 → 2026年4月） */
export function monthLabel(month: string | null | undefined): string {
  if (!month || !isMonth(month)) return "";
  const [y, m] = month.split("-").map(Number);
  return `${y}年${m}月`;
}

/**
 * 予定の月のうち、計上日が through（YYYY-MM-DD）以前のもの（古い順）。
 * 開始月から interval か月ごとに数え、終了月を過ぎたら止める。停止中かどうかは見ない。
 */
export function scheduledMonths(s: RecurringSchedule, through: string, limit = MAX_MONTHS): string[] {
  if (!isMonth(s.startMonth) || !DATE_RE.test(through)) return [];
  if (s.endMonth != null && !isMonth(s.endMonth)) return [];
  const step = Number.isInteger(s.intervalMonths) && s.intervalMonths >= 1 ? s.intervalMonths : 0;
  if (!step) return [];
  const out: string[] = [];
  for (let k = 0; out.length < limit; k++) {
    const month = addMonths(s.startMonth, k * step);
    if (s.endMonth && month > s.endMonth) break;
    const date = postingDateOf(month, s.dayOfMonth);
    // 計上日は月が進むほど後ろになるので、過ぎたらそこで止めてよい
    if (!date || date > through) break;
    out.push(month);
  }
  return out;
}

/**
 * まだ作っていない月（古い順）。停止中なら作らない。
 * created は作成済みの対象月（その定期仕訳から作った仕訳の recurring_month）。
 */
export function pendingMonths(
  s: RecurringSchedule,
  through: string,
  created: Iterable<string>,
  limit = MAX_MONTHS
): string[] {
  if (!s.isActive) return [];
  const done = new Set(created);
  return scheduledMonths(s, through, limit + done.size).filter((m) => !done.has(m)).slice(0, limit);
}

/**
 * 次に作る月。まだ作っていない月があればその最初の月、無ければ through より後の最初の予定の月。
 * 停止中・終了月を過ぎて予定が無いときは null。
 */
export function nextMonthToCreate(s: RecurringSchedule, through: string, created: Iterable<string>): string | null {
  if (!s.isActive || !isMonth(s.startMonth) || !DATE_RE.test(through)) return null;
  const done = new Set(created);
  const pending = pendingMonths(s, through, done, 1);
  if (pending.length) return pending[0];
  const past = scheduledMonths(s, through, MAX_MONTHS + done.size);
  const step = Number.isInteger(s.intervalMonths) && s.intervalMonths >= 1 ? s.intervalMonths : 0;
  if (!step) return null;
  // 予定の月のうち、through の後で最初のもの（作成済みの未来の月は飛ばす）
  let month = past.length ? addMonths(past[past.length - 1], step) : s.startMonth;
  for (let i = 0; i < MAX_MONTHS; i++) {
    if (s.endMonth && month > s.endMonth) return null;
    if (!done.has(month)) return month;
    month = addMonths(month, step);
  }
  return null;
}

export type BalanceCheck =
  | { ok: true; total: number }
  | { ok: false; debit: number; credit: number; message: string };

/** 貸借が合っているか（合計が0円のものも不可） */
export function checkBalance(lines: Pick<RecurringLine, "debit_amount" | "credit_amount">[]): BalanceCheck {
  const debit = lines.reduce((s, l) => s + (Number(l.debit_amount) || 0), 0);
  const credit = lines.reduce((s, l) => s + (Number(l.credit_amount) || 0), 0);
  if (debit <= 0 && credit <= 0) return { ok: false, debit, credit, message: "金額を入力してください" };
  if (debit !== credit) {
    return {
      ok: false,
      debit,
      credit,
      message: `貸借が一致していません（借方 ${debit.toLocaleString()} / 貸方 ${credit.toLocaleString()}）`,
    };
  }
  return { ok: true, total: debit };
}

/** 保存する定期仕訳の中身 */
export type RecurringJournalInput = {
  name: string;
  description: string | null;
  lines: RecurringLine[];
  dayOfMonth: number;
  startMonth: string;
  endMonth: string | null;
  intervalMonths: number;
};

/**
 * 保存の前の検査と整え。
 * 科目も金額も無い行（空の行）は落とす。金額があって科目が無い行・借方と貸方の両方に金額がある行は止める。
 * 金額は円の整数だけ（読み取れない値を丸めて別の金額にしない）。
 */
export function validateRecurringInput(
  input: RecurringJournalInput
): { ok: true; value: RecurringJournalInput } | { ok: false; message: string } {
  const name = (input.name ?? "").trim();
  if (!name) return { ok: false, message: "名前を入力してください（例: 事務所家賃）" };
  if (name.length > 100) return { ok: false, message: "名前は100文字までにしてください" };

  if (!Number.isInteger(input.dayOfMonth) || input.dayOfMonth < 0 || input.dayOfMonth > 31) {
    return { ok: false, message: "計上日は1〜31日か末日を選んでください" };
  }
  if (!INTERVAL_OPTIONS.some((o) => o.value === input.intervalMonths)) {
    return { ok: false, message: "周期を選んでください" };
  }
  if (!isMonth(input.startMonth)) return { ok: false, message: "開始月を入力してください" };
  const endMonth = input.endMonth ? input.endMonth : null;
  if (endMonth !== null && !isMonth(endMonth)) return { ok: false, message: "終了月の形が正しくありません" };
  if (endMonth !== null && endMonth < input.startMonth) {
    return { ok: false, message: "終了月は開始月より後にしてください" };
  }

  const lines: RecurringLine[] = [];
  for (const l of input.lines ?? []) {
    const debit = Number(l.debit_amount) || 0;
    const credit = Number(l.credit_amount) || 0;
    if (!l.account_id && debit === 0 && credit === 0) continue;
    if (!Number.isInteger(debit) || !Number.isInteger(credit) || debit < 0 || credit < 0) {
      return { ok: false, message: "金額は0以上の円単位（整数）で入力してください" };
    }
    if (debit === 0 && credit === 0) continue;
    if (!l.account_id) return { ok: false, message: "金額を入れた行の科目を選んでください" };
    if (debit > 0 && credit > 0) return { ok: false, message: "1つの行に借方と貸方の両方の金額は入れられません" };
    lines.push({
      account_id: l.account_id,
      sub_account_id: l.sub_account_id || null,
      debit_amount: debit,
      credit_amount: credit,
      tax_category: l.tax_category || null,
      ...(l.purchase_use !== undefined ? { purchase_use: l.purchase_use } : {}),
      ...(l.business_type !== undefined ? { business_type: l.business_type } : {}),
    });
  }
  if (!lines.some((l) => l.debit_amount > 0) || !lines.some((l) => l.credit_amount > 0)) {
    return { ok: false, message: "借方と貸方の両方に、科目と金額を入力してください" };
  }
  const balance = checkBalance(lines);
  if (!balance.ok) return { ok: false, message: balance.message };

  return {
    ok: true,
    value: {
      name,
      description: (input.description ?? "").trim() || null,
      lines,
      dayOfMonth: input.dayOfMonth,
      startMonth: input.startMonth,
      endMonth,
      intervalMonths: input.intervalMonths,
    },
  };
}
