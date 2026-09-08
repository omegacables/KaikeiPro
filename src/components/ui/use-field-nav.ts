"use client";

import { useCallback, useRef } from "react";

/**
 * 入力欄をキーボードで渡り歩くための共通処理。
 *
 * 仕訳入力の操作感にそろえている:
 *   Enter / →  … 次の欄へ。最後まで来たら実行ボタンへ
 *   ←          … 前の欄へ
 *   ↑ ↓        … その欄の本来の動作（日付の増減、プルダウンの選択）に任せる
 *   IME変換中の Enter は移動しない（変換確定の Enter と区別する）
 *
 * 表示されていない欄（条件付きで出る欄）は自動で読み飛ばす。
 * React は要素が消えるとき ref に null を渡すので、その性質を利用している。
 *
 * @param lastCol   最後の欄の番号（0始まり）
 * @param cursorCols ←→ を「欄の移動」ではなく「文字カーソルの移動」に使う欄。
 *                   金額など、数字の途中にカーソルを置きたい欄を指定する
 */
export function useFieldNav(lastCol: number, cursorCols: number[] = []) {
  const cellRefs = useRef<(HTMLElement | null)[]>([]);
  const submitRef = useRef<HTMLButtonElement | null>(null);
  const cursorSet = useRef(new Set(cursorCols));
  cursorSet.current = new Set(cursorCols);

  const setCellRef = useCallback((col: number, el: HTMLElement | null) => {
    cellRefs.current[col] = el;
  }, []);

  /** dir 方向にある、実際に表示されている欄へ移る。無ければ false */
  const focusCell = useCallback(
    (from: number, dir: 1 | -1): boolean => {
      for (let c = from + dir; c >= 0 && c <= lastCol; c += dir) {
        const el = cellRefs.current[c];
        if (el) {
          el.focus();
          return true;
        }
      }
      return false;
    },
    [lastCol]
  );

  const handleKeyDown = useCallback(
    (col: number, e: React.KeyboardEvent) => {
      // 日本語入力の変換中は横取りしない
      if ((e.nativeEvent as KeyboardEvent).isComposing) return;
      // 上下キーは各欄の本来の動作に任せる
      if (e.key === "ArrowUp" || e.key === "ArrowDown") return;

      if (e.key === "Enter" || e.key === "ArrowRight") {
        if (e.key === "ArrowRight" && cursorSet.current.has(col)) return;
        e.preventDefault();
        if (!focusCell(col, 1)) submitRef.current?.focus();
        return;
      }
      if (e.key === "ArrowLeft") {
        if (cursorSet.current.has(col)) return;
        e.preventDefault();
        focusCell(col, -1);
      }
    },
    [focusCell]
  );

  /** 実行ボタン上での ← は最後の入力欄へ戻す（Enter/Space での実行は標準動作のまま） */
  const handleSubmitKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== "ArrowLeft") return;
      e.preventDefault();
      focusCell(lastCol + 1, -1);
    },
    [focusCell, lastCol]
  );

  return { setCellRef, handleKeyDown, submitRef, handleSubmitKeyDown };
}
