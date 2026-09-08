"use client";

import { useEffect } from "react";

/**
 * 数値入力欄（input type="number"）の「意図しない値の変化」を防ぐ。
 *
 * ブラウザの標準動作では、数値欄にフォーカスがある状態で
 *   - マウスホイールを回す
 *   - キーボードの上下キーを押す
 * と値が増減する。会計データではこれが誤入力の原因になり、しかも
 * 本人が気づかないまま金額が変わるため発見が遅れる。
 * 値の変更は打ち込みだけに限定する。
 *
 * 画面ごとに対策すると漏れるので、document 単位で一括して押さえる。
 */
function isNumberInput(el: EventTarget | null): el is HTMLInputElement {
  return el instanceof HTMLInputElement && el.type === "number";
}

export function NumberInputGuard() {
  useEffect(() => {
    // ホイール: フォーカス中の数値欄の上で回されたらフォーカスを外す。
    // preventDefault にするとページ自体がスクロールしなくなり操作しづらいため、
    // 「フォーカスを外してから通常どおりスクロールさせる」方式にしている。
    const onWheel = (e: WheelEvent) => {
      const el = e.target;
      if (isNumberInput(el) && document.activeElement === el) {
        el.blur();
      }
    };

    // 上下キー: 値を増減させない（打ち込みのみ）。
    // 数値欄以外の上下キー操作（プルダウンの選択など）には影響しない。
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isNumberInput(e.target)) return;
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
      }
    };

    // passive: false にしないと preventDefault 系の制御が効かないブラウザがあるため明示する
    document.addEventListener("wheel", onWheel, { passive: true });
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("wheel", onWheel);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return null;
}
