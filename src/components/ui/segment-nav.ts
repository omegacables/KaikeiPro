/**
 * 日付・年月の欄で、区画（年・月・日）をキーボードで順に選ぶための判定。純粋関数。
 *
 *   欄に入った直後（全体が選択されている）
 *     Enter / ← … そのまま前後の欄へ（0410 と打って Enter で次へ、の速さを保つ）
 *     →        … 年の区画を選び始める
 *   区画を選んでいるとき
 *     Enter / → … 年 → 月 → 日 → 次の欄
 *     Shift+Enter / ← … 日 → 月 → 年 → 前の欄
 *
 * @param current 選択中の区画。全体が選択されている（区画を選んでいない）ときは null
 * @param count   区画の数（年月日は3、年月は2）
 */
export type SegmentMove = { kind: "select"; seg: number } | { kind: "leave"; dir: 1 | -1 } | null;

export function segmentNav(key: string, shiftKey: boolean, current: number | null, count: number): SegmentMove {
  let dir: 1 | -1;
  if (key === "Enter") dir = shiftKey ? -1 : 1;
  else if (key === "ArrowRight") dir = 1;
  else if (key === "ArrowLeft") dir = -1;
  else return null;

  if (current === null) return key === "ArrowRight" ? { kind: "select", seg: 0 } : { kind: "leave", dir };
  const next = current + dir;
  return next >= 0 && next < count ? { kind: "select", seg: next } : { kind: "leave", dir };
}

/**
 * 欄を離れる前に、文字カーソルを端へ寄せる。
 * 入力欄の並びを渡り歩く共通処理（handleBarKeyNav）は「カーソルが端にあるとき」だけ ← → で
 * 隣へ移るため、区画を選んだまま渡すと移れない。
 */
export function moveCaretToEdge(el: HTMLInputElement | null, dir: 1 | -1) {
  if (!el) return;
  const at = dir === 1 ? el.value.length : 0;
  el.setSelectionRange(at, at);
}
