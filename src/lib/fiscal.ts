// 会計年度（決算月）に関する共通ロジック。
// クライアントの fiscal_year_start_month（期首月, 1-12）を基準に会計年度の期間を算出する。
// 例: 期首月=4 → 4月〜翌3月（決算月=3月）。期首月=1 → 1月〜12月（決算月=12月）。

export const DEFAULT_FISCAL_START_MONTH = 4;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function fmt(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function normalizeStartMonth(startMonth: number | null | undefined): number {
  const m = Number(startMonth);
  return m >= 1 && m <= 12 ? m : DEFAULT_FISCAL_START_MONTH;
}

// 期首月と基準(年・月: 1-12)から、会計年度の開始年・開始日・終了日を返す
export function getFiscalPeriod(
  startMonth: number | null | undefined,
  year: number,
  month: number
): { startYear: number; startDate: string; endDate: string } {
  const sm = normalizeStartMonth(startMonth);
  const startYear = month >= sm ? year : year - 1;
  return { startYear, ...fiscalRangeFromStartYear(sm, startYear) };
}

// 会計年度の開始年から、開始日・終了日を返す
export function fiscalRangeFromStartYear(
  startMonth: number | null | undefined,
  startYear: number
): { startDate: string; endDate: string } {
  const sm = normalizeStartMonth(startMonth);
  const start = new Date(startYear, sm - 1, 1);
  const end = new Date(startYear, sm - 1 + 12, 0); // 12ヶ月後の前日 = 期末日
  return { startDate: fmt(start), endDate: fmt(end) };
}

// 期首月 → 決算月（期末の月）
export function settlementMonth(startMonth: number | null | undefined): number {
  const sm = normalizeStartMonth(startMonth);
  return ((sm + 10) % 12) + 1;
}

// 決算月 → 期首月
export function startMonthFromSettlement(settlement: number): number {
  return (Number(settlement) % 12) + 1;
}

/**
 * 決算月を変えたときの、締めていない当期の新しい期末日。
 *
 * 期首日はそのままに、期首日以降で最初に来る「新しい決算月の末日」を期末日とする。
 * 会社法上の事業年度変更と同じく、当期は12ヶ月以内の変則期間になる。
 * 例: 期首 2026-04-01 のまま 12月決算へ → 2026-12-31（9ヶ月決算）
 */
export function transitionalPeriodEnd(
  periodStartDate: string,
  newStartMonth: number | null | undefined
): string {
  const [y, m] = periodStartDate.split("-").map(Number);
  const settlement = settlementMonth(newStartMonth);
  const offset = (settlement - m + 12) % 12; // 期首月から新しい決算月までの月数
  return fmt(new Date(y, m - 1 + offset + 1, 0));
}

// 現在日付が属する会計年度の開始年（期首月基準）
export function currentFiscalStartYear(
  startMonth: number | null | undefined,
  now: Date = new Date()
): number {
  return getFiscalPeriod(startMonth, now.getFullYear(), now.getMonth() + 1).startYear;
}

/**
 * 保存された日時（UTCのISO文字列）を、日本時間の YYYY-MM-DD に直す。
 *
 * `iso.split("T")[0]` で切り出すとUTCの日付になり、日本時間の 0:00〜9:00 に
 * 登録したものが**前日として表示される**。登録日は電子帳簿保存法の
 * 訂正削除履歴として意味を持つ値なので、1日ずれてはいけない。
 */
export function toJstDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // en-CA は YYYY-MM-DD 形式を返す
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** 記録された事業年度（fiscal_years の行） */
export type FiscalPeriodRow = { start_date: string; end_date: string };

export type ResolvedFiscalPeriod = {
  startDate: string;
  endDate: string;
  /** fiscal_years に記録された期間を使ったか（決算月を変えた変則期間など） */
  fromFiscalYears: boolean;
};

function parseIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function addDays(iso: string, days: number): string {
  const d = parseIso(iso);
  d.setDate(d.getDate() + days);
  return fmt(d);
}
function addMonthsToDate(iso: string, months: number): string {
  const d = parseIso(iso);
  return fmt(new Date(d.getFullYear(), d.getMonth() + months, d.getDate()));
}

/**
 * 帳票に使う事業年度の期間を決める。期は次のどちらかで指定する。
 *   "2025"       … 期首月から計算した、その年に始まる事業年度
 *   "2025-09-01" … その日に始まる事業年度（前期・翌期への移動はこちらを使う）
 *
 * 決算月を変えた年度は12ヶ月より短い変則期間になり、その実際の期間は
 * fiscal_years テーブルにだけ残る。期首月からの計算だけで期間を出すと、
 * 変則期間の帳票を誤った期間で作ってしまう。そこで記録された期間を優先する。
 *
 * 決算月を変えると同じ年に始まる期が2つでき（例: 2025/4〜8月の変則期間と
 * 2025/9月〜）、「開始年」だけでは区別できない。年で指定されたときは
 * 「今の期首月で計算した期末日」と期末日が一致する期を選び、
 * それ以外の期には開始日での指定と前後の移動でたどり着けるようにする。
 */
export function resolveFiscalPeriodByKey(
  rows: FiscalPeriodRow[],
  startMonth: number | null | undefined,
  key: string
): ResolvedFiscalPeriod {
  const row = (r: FiscalPeriodRow | undefined): ResolvedFiscalPeriod | null =>
    r ? { startDate: r.start_date, endDate: r.end_date, fromFiscalYears: true } : null;

  if (/^\d{4}$/.test(key)) {
    const computed = fiscalRangeFromStartYear(startMonth, Number(key));
    return (
      row(rows.find((r) => r.end_date === computed.endDate)) ??
      row(rows.find((r) => r.start_date === computed.startDate)) ?? {
        ...computed,
        fromFiscalYears: false,
      }
    );
  }

  // 2025-13-01 のような存在しない日付は Date が翌年1月に繰り上げてしまうので、
  // 往復変換して元の文字列に戻るものだけを受け付ける
  if (/^\d{4}-\d{2}-\d{2}$/.test(key) && fmt(parseIso(key)) === key) {
    // 記録が無い期は12ヶ月とみなす（変則期間は必ず fiscal_years に残るため）
    return (
      row(rows.find((r) => r.start_date === key)) ?? {
        startDate: key,
        endDate: addDays(addMonthsToDate(key, 12), -1),
        fromFiscalYears: false,
      }
    );
  }

  throw new Error(`事業年度の指定が正しくありません: ${key}`);
}

/**
 * 前期・翌期の開始日。翌期はこの期の期末日の翌日から始まる。
 * 前期は、この期の期首日の前日に終わる記録があればその期、無ければ12ヶ月前から。
 */
export function adjacentFiscalPeriodKeys(
  rows: FiscalPeriodRow[],
  period: { startDate: string; endDate: string }
): { prevKey: string; nextKey: string } {
  const prevEnd = addDays(period.startDate, -1);
  const prevRow = rows.find((r) => r.end_date === prevEnd);
  return {
    prevKey: prevRow ? prevRow.start_date : addMonthsToDate(period.startDate, -12),
    nextKey: addDays(period.endDate, 1),
  };
}
