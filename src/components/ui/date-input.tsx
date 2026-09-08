"use client";

import { useRef, useCallback, useState, memo } from "react";
import { CalendarDays } from "lucide-react";

interface DateInputProps {
  value: string; // YYYY-MM-DD
  onChange: (value: string) => void;
  inputRef?: (el: HTMLInputElement | null) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  className?: string;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** その年月に存在する日に丸める（2月31日のような値を作らない） */
function clampDay(y: number, m: number, d: number) {
  const maxDay = new Date(y, m, 0).getDate();
  return Math.min(Math.max(d, 1), maxDay);
}

function format(y: number, m: number, d: number) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** 全角数字を半角に直す（テンキー以外からの入力を拾うため） */
function toHalfWidth(v: string) {
  return v.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

/**
 * 打ち込まれた文字列を日付として解釈する。
 * 会計ソフトの日付入力と同じく、区切りなしの数字だけでも入力できるようにする。
 *
 *   20260410 / 2026-04-10 / 2026.4.10 → 2026-04-10
 *   260410                            → 2026-04-10
 *   0410 / 4/10                       → 基準日の年の 4月10日
 *   10                                → 基準日の年月の 10日
 *
 * 解釈できなければ null を返し、呼び出し側は元の値を保つ。
 */
export function parseDateInput(raw: string, base: { y: number; m: number; d: number }): string | null {
  const s = toHalfWidth(raw).trim();
  if (!s) return null;

  // 区切り文字がある場合はそれで分解する
  if (/[/\-.]/.test(s)) {
    const parts = s.split(/[/\-.]/).filter((p) => p !== "");
    const nums = parts.map((p) => Number(p));
    if (nums.some((n) => !Number.isFinite(n))) return null;
    if (nums.length === 3) {
      const y = nums[0] < 100 ? 2000 + nums[0] : nums[0];
      return format(y, Math.min(Math.max(nums[1], 1), 12), clampDay(y, nums[1], nums[2]));
    }
    if (nums.length === 2) {
      const m = Math.min(Math.max(nums[0], 1), 12);
      return format(base.y, m, clampDay(base.y, m, nums[1]));
    }
    return null;
  }

  const digits = s.replace(/\D/g, "");
  if (digits.length !== s.length) return null;

  switch (digits.length) {
    case 8: {
      const y = Number(digits.slice(0, 4));
      const m = Math.min(Math.max(Number(digits.slice(4, 6)), 1), 12);
      return format(y, m, clampDay(y, m, Number(digits.slice(6, 8))));
    }
    case 6: {
      const y = 2000 + Number(digits.slice(0, 2));
      const m = Math.min(Math.max(Number(digits.slice(2, 4)), 1), 12);
      return format(y, m, clampDay(y, m, Number(digits.slice(4, 6))));
    }
    case 4: {
      const m = Math.min(Math.max(Number(digits.slice(0, 2)), 1), 12);
      return format(base.y, m, clampDay(base.y, m, Number(digits.slice(2, 4))));
    }
    case 3: {
      // 会計ソフトでよくある「410 = 4月10日」の打ち方
      const m = Math.min(Math.max(Number(digits.slice(0, 1)), 1), 12);
      return format(base.y, m, clampDay(base.y, m, Number(digits.slice(1, 3))));
    }
    case 1:
    case 2:
      return format(base.y, base.m, clampDay(base.y, base.m, Number(digits)));
    default:
      return null;
  }
}

/**
 * 日付入力欄。次の3つの方法すべてで入力できる。
 *
 *   1. 打ち込み  … 20260410 / 0410 / 4/10 など。確定は Enter・Tab・フォーカスを外したとき
 *   2. カレンダー … 右のアイコンから日付を選ぶ
 *   3. 上下キー   … カーソルのある区画（年・月・日）を1つずつ増減
 *
 * 左右キーは区画の移動に使う。Enter などのキーは onKeyDown で親に渡すので、
 * 仕訳入力のような「Enterで次の欄へ」の移動と組み合わせられる。
 */
export const DateInput = memo(function DateInput({
  value,
  onChange,
  inputRef,
  onKeyDown,
  className,
}: DateInputProps) {
  const innerRef = useRef<HTMLInputElement | null>(null);
  const pickerRef = useRef<HTMLInputElement | null>(null);
  // 打ち込み途中の文字列。null なら確定値を表示している
  const [draft, setDraft] = useState<string | null>(null);

  const parts = value.split("-");
  const year = Number(parts[0]) || new Date().getFullYear();
  const month = Number(parts[1]) || 1;
  const day = Number(parts[2]) || 1;

  const display = draft ?? `${year}/${pad2(month)}/${pad2(day)}`;

  // カーソルのある区画: 0=年, 1=月, 2=日
  const getSegment = (): number => {
    const el = innerRef.current;
    if (!el) return 2;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? start;
    // 全選択中（フォーカス直後の既定）は「日」として扱う。
    // 上下キーで最も動かしたいのは日のため。
    if (start === 0 && end >= display.length) return 2;
    if (start <= 4) return 0;
    if (start <= 7) return 1;
    return 2;
  };

  const selectSegment = (seg: number) => {
    const el = innerRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      switch (seg) {
        case 0: el.setSelectionRange(0, 4); break;
        case 1: el.setSelectionRange(5, 7); break;
        case 2: el.setSelectionRange(8, 10); break;
      }
    });
  };

  /** 打ち込み中の文字列を確定する。解釈できなければ元の値に戻す。 */
  const commitDraft = useCallback((): boolean => {
    if (draft === null) return false;
    const parsed = parseDateInput(draft, { y: year, m: month, d: day });
    setDraft(null);
    if (parsed && parsed !== value) {
      onChange(parsed);
      return true;
    }
    return false;
  }, [draft, year, month, day, value, onChange]);

  const adjust = useCallback(
    (delta: number) => {
      const seg = getSegment();
      let y = year, m = month, d = day;
      switch (seg) {
        case 0:
          y += delta;
          break;
        case 1:
          m += delta;
          if (m > 12) { m = 1; y++; }
          if (m < 1) { m = 12; y--; }
          break;
        case 2: {
          d += delta;
          const maxDay = new Date(y, m, 0).getDate();
          if (d > maxDay) { d = 1; m++; if (m > 12) { m = 1; y++; } }
          if (d < 1) { m--; if (m < 1) { m = 12; y--; } d = new Date(y, m, 0).getDate(); }
          break;
        }
      }
      d = clampDay(y, m, d);
      onChange(format(y, m, d));
      selectSegment(seg);
    },
    [year, month, day, onChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // IME変換中はキー操作を横取りしない
      if ((e.nativeEvent as KeyboardEvent).isComposing) return;

      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          commitDraft();
          adjust(1);
          return;
        case "ArrowDown":
          e.preventDefault();
          commitDraft();
          adjust(-1);
          return;
        case "ArrowLeft":
        case "ArrowRight": {
          // 打ち込み中は普通のカーソル移動として扱う（親のセル移動もしない）
          if (draft !== null) return;
          const seg = getSegment();
          const next = e.key === "ArrowLeft" ? seg - 1 : seg + 1;
          if (next >= 0 && next <= 2) {
            e.preventDefault();
            selectSegment(next);
            return;
          }
          break;
        }
        case "Enter":
        case "Tab":
          // 打ち込み内容を確定してから、親（Enterで次の欄へ）に処理を渡す
          commitDraft();
          break;
        case "Escape":
          if (draft !== null) {
            e.preventDefault();
            setDraft(null);
            return;
          }
          break;
      }
      onKeyDown?.(e);
    },
    [adjust, commitDraft, draft, onKeyDown]
  );

  return (
    <div className="relative inline-flex w-full items-center">
      <input
        ref={(el) => {
          innerRef.current = el;
          inputRef?.(el);
        }}
        type="text"
        inputMode="numeric"
        value={display}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => commitDraft()}
        onFocus={(e) => {
          // 全体を選択しておく。こうしないと「日」の部分にだけ文字が挿し込まれ、
          // 20260410 のようにフルの日付を打ったときに壊れた文字列になる。
          // 全選択中でも上下キーは日の増減として働く（getSegment 参照）。
          e.currentTarget.select();
        }}
        className={className}
      />

      {/* カレンダーから選ぶ経路。ネイティブの日付ピッカーを呼び出すだけの隠し入力を使う */}
      <input
        ref={pickerRef}
        type="date"
        value={value}
        tabIndex={-1}
        aria-hidden
        onChange={(e) => e.target.value && onChange(e.target.value)}
        className="absolute right-1 size-6 opacity-0 pointer-events-none"
      />
      <button
        type="button"
        tabIndex={-1}
        title="カレンダーから選ぶ"
        onClick={() => {
          const el = pickerRef.current;
          if (!el) return;
          // showPicker はブラウザや表示状態によっては例外を投げるため保護する
          try {
            if (typeof el.showPicker === "function") el.showPicker();
            else el.focus();
          } catch {
            el.focus();
          }
        }}
        className="absolute right-1 p-1 rounded text-foreground/70 hover:text-foreground hover:bg-muted"
      >
        <CalendarDays className="size-4" />
      </button>
    </div>
  );
});
