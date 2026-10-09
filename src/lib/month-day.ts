/**
 * 月日の手入力を読み取る（期間指定で、年は選択・月日は手入力にするため）。
 * 受け付ける形: 4/1・04/01・4-1・4.1・4月1日・0401・401（3桁は先頭1桁が月）・全角数字
 * 存在しない日付（2/30 など）は null。
 */
export function parseMonthDay(text: string, year: number): { month: number; day: number } | null {
  const t = text.normalize("NFKC").trim().replace(/日$/, "");
  if (!t) return null;
  let m: number;
  let d: number;
  const sep = t.match(/^(\d{1,2})\s*[/\-.月]\s*(\d{1,2})$/);
  if (sep) {
    m = Number(sep[1]);
    d = Number(sep[2]);
  } else if (/^\d{3,4}$/.test(t)) {
    m = Number(t.slice(0, t.length - 2));
    d = Number(t.slice(-2));
  } else {
    return null;
  }
  if (m < 1 || m > 12 || d < 1) return null;
  if (d > new Date(year, m, 0).getDate()) return null;
  return { month: m, day: d };
}

/** 年と月日の手入力から YYYY-MM-DD を作る。読み取れなければ null */
export function toIsoDate(year: number, monthDay: string): string | null {
  const md = parseMonthDay(monthDay, year);
  if (!md) return null;
  return `${year}-${String(md.month).padStart(2, "0")}-${String(md.day).padStart(2, "0")}`;
}

/** YYYY-MM-DD の月日を、手入力欄に出す形（MM/DD）にする */
export function monthDayText(iso: string): string {
  const [, m, d] = iso.split("-");
  return m && d ? `${m}/${d}` : "";
}
