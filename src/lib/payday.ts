/**
 * 顧問先ごとの給料日から、その月の支給日を求める。
 *
 * 給料日は会社ごとに違う（末日・10日・25日など）ため、顧問先の設定として持つ。
 * 「末日」は月によって28〜31日と変わり日にちの数値では表せないので、
 * 0 を末日の意味に使う（1〜31 はその日にち）。
 */

/** 末日を表す値 */
export const PAYDAY_END_OF_MONTH = 0;

/** 給料日の表示名 */
export function paydayLabel(payday: number | null | undefined): string {
  if (payday == null) return "未設定";
  if (payday === PAYDAY_END_OF_MONTH) return "末日";
  return `${payday}日`;
}

/**
 * 支給月（YYYY-MM）と給料日から、実際の支給日（YYYY-MM-DD）を求める。
 *
 * 給料日がその月に存在しない場合（2月の31日など）は末日に丸める。
 * 未設定なら空文字を返す（支給日は任意項目なので、勝手な日付を入れない）。
 */
export function paydayOf(month: string, payday: number | null | undefined): string {
  if (payday == null) return "";
  if (!/^\d{4}-\d{2}$/.test(month)) return "";

  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const day = payday === PAYDAY_END_OF_MONTH ? lastDay : Math.min(payday, lastDay);

  return `${month}-${String(day).padStart(2, "0")}`;
}
