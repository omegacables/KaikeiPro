"use client";

import { useState, useCallback, memo } from "react";

interface AmountInputProps {
  /** 3桁区切りを含まない数値文字列。空文字は未入力 */
  value: string;
  onChange: (value: string) => void;
  inputRef?: (el: HTMLInputElement | null) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  /** 小数を許す（年利など）。既定は整数のみ */
  allowDecimal?: boolean;
}

/** 全角数字と全角のカンマ・ピリオドを半角に直す */
function toHalfWidth(v: string): string {
  return v
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[．。]/g, ".")
    .replace(/[，、]/g, ",");
}

/**
 * 入力文字列から、計算に使える数値文字列を取り出す。
 * カンマ・空白は取り除く。マイナスは受け付けない（帳簿にマイナスは使わない）。
 */
export function normalizeAmount(raw: string, allowDecimal = false): string {
  const s = toHalfWidth(raw).replace(/[,\s]/g, "");
  if (s === "") return "";
  const re = allowDecimal ? /^\d*\.?\d*$/ : /^\d*$/;
  if (!re.test(s)) return "";
  return s;
}

/** 3桁区切りを付ける。小数部はそのまま残す */
export function formatAmount(value: string): string {
  if (value === "") return "";
  const [int, frac] = value.split(".");
  const withComma = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac !== undefined ? `${withComma}.${frac}` : withComma;
}

/**
 * 金額の入力欄。
 *
 * type="number" ではブラウザが3桁区切りを表示できないため、テキスト欄として作る。
 * 桁が読めないと金額を見誤るので、入力を終えた時点（Enter・Tab・欄を離れたとき）に
 * カンマを付けて表示する。編集中は素の数字を出し、打ちやすさを保つ。
 *
 * 親に渡す値は常にカンマ抜きの数値文字列なので、既存の Number() での解釈が壊れない。
 */
export const AmountInput = memo(function AmountInput({
  value,
  onChange,
  inputRef,
  onKeyDown,
  className,
  placeholder,
  disabled,
  allowDecimal = false,
}: AmountInputProps) {
  // 編集中は素の数字、そうでなければカンマ付きを表示する
  const [editing, setEditing] = useState(false);

  const display = editing ? value : formatAmount(value);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.nativeEvent as KeyboardEvent).isComposing) return;
      // Enter / Tab で入力を確定し、カンマ付きの表示に切り替える
      if (e.key === "Enter" || e.key === "Tab") setEditing(false);
      onKeyDown?.(e);
    },
    [onKeyDown]
  );

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode={allowDecimal ? "decimal" : "numeric"}
      value={display}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => onChange(normalizeAmount(e.target.value, allowDecimal))}
      onKeyDown={handleKeyDown}
      onFocus={(e) => {
        setEditing(true);
        // 打ち込みで丸ごと置き換わるようにする。
        // 0 などが入った欄に打つと連結され、桁を1つ間違えるため
        e.currentTarget.select();
      }}
      onBlur={() => setEditing(false)}
      className={className}
    />
  );
});
