/**
 * 入力欄の並び（フィルターの行など）を、キーボードだけで移動できるようにする。
 *   Enter → 次の欄 ／ Shift+Enter → 前の欄
 *   ← → … 選択欄（select）はそのまま隣へ。文字の欄はカーソルが端にあるときだけ隣へ
 * 欄の中で処理済みのキー（候補の選択など、preventDefault 済み）は横取りしない。
 * 日本語入力の変換中は何もしない。
 */
import type { KeyboardEvent } from "react";

const FOCUSABLE = "input:not([type=hidden]):not([disabled]), select:not([disabled]), button:not([disabled])";

export function handleBarKeyNav(e: KeyboardEvent<HTMLElement>) {
  if (e.defaultPrevented || e.nativeEvent.isComposing) return;
  const target = e.target as HTMLElement;
  const isSelect = target instanceof HTMLSelectElement;
  const isText = target instanceof HTMLInputElement;
  if (!isSelect && !isText) return;

  let dir = 0;
  if (e.key === "Enter") dir = e.shiftKey ? -1 : 1;
  else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
    const right = e.key === "ArrowRight";
    if (isSelect) dir = right ? 1 : -1;
    else if (isText) {
      const input = target as HTMLInputElement;
      const atEdge = right
        ? input.selectionStart === input.value.length && input.selectionEnd === input.value.length
        : input.selectionStart === 0 && input.selectionEnd === 0;
      if (atEdge) dir = right ? 1 : -1;
    }
  }
  if (!dir) return;

  const items = [...e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.offsetParent !== null && el.tagName !== "BUTTON"
  );
  const idx = items.indexOf(target);
  const next = items[idx + dir];
  if (!next) return;
  e.preventDefault();
  // Enter で月日などを確定させてから移る（確定は各欄の blur で行う）
  next.focus();
  if (next instanceof HTMLInputElement) next.select();
}
