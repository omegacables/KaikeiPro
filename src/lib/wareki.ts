/**
 * 帳票（決算書・勘定科目内訳明細書）の表記に使う和暦と金額の書式。
 *
 * 帳票ごとに同じ処理を書くと、改元の境界を片方だけ間違える
 * （2019年1〜4月を令和元年と表示していた）。ここに一本化する。
 */

type Era = { name: string; start: string };

// 改元日（その日から新元号）。新しい順に並べる
const ERAS: Era[] = [
  { name: "令和", start: "2019-05-01" },
  { name: "平成", start: "1989-01-08" },
];

/**
 * 西暦の日付（YYYY-MM-DD）を和暦にする。例: 2026-03-31 → 令和8年3月31日
 * 平成より前、または解釈できない値は西暦のまま返す。
 */
export function toWareki(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);

  const era = ERAS.find((e) => date >= e.start);
  if (!era) return `${y}年${mo}月${d}日`;

  const n = y - Number(era.start.slice(0, 4)) + 1;
  return `${era.name}${n === 1 ? "元" : n}年${mo}月${d}日`;
}

/**
 * 帳票の金額表記。3桁区切りで、マイナスは △ で表す（帳簿の慣行）。
 * 円未満は四捨五入する。
 */
export function formatYen(n: number): string {
  const v = Math.round(n);
  const s = Math.abs(v).toLocaleString("ja-JP");
  return v < 0 ? `△${s}` : s;
}
