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
