/**
 * 証憑の一覧で、期間（月・年度）の絞り込みのせいで見えていない証憑を、月ごとに数える。
 * 「この月には無い」と「証憑が無い」を見分けられるよう、ほかの月の件数と移る先を画面に出すために使う。
 */

export type HiddenMonth = { ym: string; count: number };

/** 期間の外にある証憑を月ごとに数える（新しい月から） */
export function hiddenMonthsOutside(dates: string[], from: string, to: string): HiddenMonth[] {
  if (!from && !to) return [];
  const byMonth = new Map<string, number>();
  for (const d of dates) {
    if (!/^\d{4}-\d{2}/.test(d)) continue;
    if ((!from || d >= from) && (!to || d <= to)) continue;
    const ym = d.slice(0, 7);
    byMonth.set(ym, (byMonth.get(ym) ?? 0) + 1);
  }
  return [...byMonth.entries()].map(([ym, count]) => ({ ym, count })).sort((a, b) => b.ym.localeCompare(a.ym));
}

/** "2026-06" → { from: "2026-06-01", to: "2026-06-30" } */
export function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number);
  const ld = new Date(y, m, 0).getDate();
  const mm = String(m).padStart(2, "0");
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(ld).padStart(2, "0")}` };
}

/** "2026-06" → "2026年6月" */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${y}年${m}月`;
}
