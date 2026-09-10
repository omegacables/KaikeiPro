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
 *
 *   "1,200,000" "¥1200000" "1200000円" "１２００００0" → "1200000"
 *   ""                                                 → ""（未入力）
 *   "120000o"                                          → null（読み取れない）
 *
 * 金額に「円」や「¥」を添えるのは日本語では自然な書き方で、
 * 表計算から貼り付ければ通貨記号もカンマも付いてくる。
 * これらは**金額の一部ではない**ので取り除いたうえで数字を読む。
 *
 * 読み取れないときに 0 や空にしてしまうと、打ったはずの金額が黙って消える。
 * 呼び出し側が「未入力」と「読み取れない」を区別できるよう null を返す。
 * マイナスは受け付けない（帳簿にマイナスは使わない）。
 */
export function parseAmountInput(raw: string, allowDecimal = false): string | null {
  // 通貨記号・単位・区切り・空白は金額の一部ではないので落とす
  const s = toHalfWidth(raw).replace(/[,\s　¥￥円]/g, "");
  if (s === "") return "";
  const re = allowDecimal ? /^\d*\.?\d*$/ : /^\d*$/;
  if (!re.test(s)) return null;
  return s;
}

/**
 * 読み取れない入力を空として扱う版。
 * 表示を伴わない場所（テストや一括変換）でだけ使う。
 */
export function normalizeAmount(raw: string, allowDecimal = false): string {
  return parseAmountInput(raw, allowDecimal) ?? "";
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
 * 数字として読み取れない文字が混じったときは、**打った内容を消さずに残して**
 * 赤枠で知らせる。以前は空にしていたため、「1200000円」と打つと金額が
 * 丸ごと消え、なぜ消えたのか分からないまま登録される恐れがあった。
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
  // 読み取れなかった打ち込み。null なら確定値を表示している
  const [draft, setDraft] = useState<string | null>(null);

  const display = draft ?? (editing ? value : formatAmount(value));

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const parsed = parseAmountInput(e.target.value, allowDecimal);
      if (parsed === null) {
        // 打った内容を残して知らせる。消してしまうと打ち直しになるうえ、
        // 何が起きたのか分からない
        setDraft(e.target.value);
        return;
      }
      setDraft(null);
      onChange(parsed);
    },
    [onChange, allowDecimal]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.nativeEvent as KeyboardEvent).isComposing) return;
      // 読み取れないまま次の欄へ進ませない。進むと消えたことに気づけない
      if (draft !== null && (e.key === "Enter" || e.key === "ArrowRight")) {
        e.preventDefault();
        return;
      }
      if (e.key === "Escape" && draft !== null) {
        e.preventDefault();
        setDraft(null);
        return;
      }
      // Enter / Tab で入力を確定し、カンマ付きの表示に切り替える
      if (e.key === "Enter" || e.key === "Tab") setEditing(false);
      onKeyDown?.(e);
    },
    [onKeyDown, draft]
  );

  const invalid = draft !== null;

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode={allowDecimal ? "decimal" : "numeric"}
      value={display}
      placeholder={placeholder}
      disabled={disabled}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onFocus={(e) => {
        setEditing(true);
        // 打ち込みで丸ごと置き換わるようにする。
        // 0 などが入った欄に打つと連結され、桁を1つ間違えるため
        e.currentTarget.select();
      }}
      onMouseUp={(e) => {
        // 2回目以降のクリックでは onFocus が起きず全選択が外れる。
        // その状態で打つと数字の途中に差し込まれ、桁を1つ間違える
        if (draft === null) {
          e.preventDefault();
          e.currentTarget.select();
        }
      }}
      onBlur={() => setEditing(false)}
      aria-invalid={invalid || undefined}
      title={
        invalid
          ? "金額として読み取れません。数字で入力してください（¥・円・カンマは付けたままで構いません）"
          : undefined
      }
      className={
        (className ?? "") + (invalid ? " !border-destructive ring-2 ring-destructive/40" : "")
      }
    />
  );
});
