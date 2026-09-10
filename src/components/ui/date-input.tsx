"use client";

import { useRef, useCallback, useState, memo } from "react";
import { CalendarDays } from "lucide-react";

interface DateInputProps {
  value: string; // YYYY-MM-DD
  onChange: (value: string) => void;
  inputRef?: (el: HTMLInputElement | null) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  className?: string;
  /** 未入力を許す欄（任意項目）では true。既定は false で、空にすると元の値に戻る */
  allowEmpty?: boolean;
  placeholder?: string;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** その月に存在する日に丸める（2月31日 → 2月28日）。月末を狙った入力を救うため。 */
function clampDayToMonthEnd(y: number, m: number, d: number) {
  return Math.min(d, new Date(y, m, 0).getDate());
}

function format(y: number, m: number, d: number) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** 全角数字を半角に直す（テンキー以外からの入力を拾うため） */
function toHalfWidth(v: string) {
  return v.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

/**
 * 年月日を組み立てる。月が範囲外・日が0以下なら解釈できないものとして null を返す。
 *
 * 範囲外の値を黙って丸めてはいけない。たとえば "2030" を「20月30日」と読んで
 * 12月に丸めると 12月30日 という**もっともらしいが全く違う日付**が入り、
 * 打ち間違いに気づけない。日だけは月末に丸める（2/31 → 2/28）。
 * これは「月末」を狙った入力を救うためで、意味が変わらない範囲に限る。
 */
function build(y: number, m: number, d: number): string | null {
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (y < 1900 || y > 2200) return null;
  if (m < 1 || m > 12) return null;
  if (d < 1) return null;
  return format(y, m, clampDayToMonthEnd(y, m, d));
}

/**
 * 打ち込まれた文字列を日付として解釈する。
 * 会計ソフトの日付入力と同じく、区切りなしの数字だけでも入力できるようにする。
 *
 *   20260410 / 2026-04-10 / 2026.4.10 → 2026-04-10
 *   260410                            → 2026-04-10
 *   0410 / 410 / 4/10                 → 基準日の年の 4月10日
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
    if (!parts.every((p) => /^\d{1,4}$/.test(p))) return null;
    const nums = parts.map(Number);
    if (nums.length === 3) {
      const y = nums[0] < 100 ? 2000 + nums[0] : nums[0];
      return build(y, nums[1], nums[2]);
    }
    if (nums.length === 2) return build(base.y, nums[0], nums[1]);
    return null;
  }

  const digits = s.replace(/\D/g, "");
  if (digits.length !== s.length) return null;

  switch (digits.length) {
    case 8:
      return build(
        Number(digits.slice(0, 4)),
        Number(digits.slice(4, 6)),
        Number(digits.slice(6, 8))
      );
    case 6:
      return build(
        2000 + Number(digits.slice(0, 2)),
        Number(digits.slice(2, 4)),
        Number(digits.slice(4, 6))
      );
    case 4:
      // MMDD として読む。先頭2桁が月として成立しなければ受け付けない
      // （"2026" を「20月26日」と読んで12月に丸めるような事故を防ぐ）
      return build(base.y, Number(digits.slice(0, 2)), Number(digits.slice(2, 4)));
    case 3:
      // 会計ソフトでよくある「410 = 4月10日」の打ち方
      return build(base.y, Number(digits.slice(0, 1)), Number(digits.slice(1, 3)));
    case 1:
    case 2:
      return build(base.y, base.m, Number(digits));
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
  allowEmpty = false,
  placeholder,
}: DateInputProps) {
  const innerRef = useRef<HTMLInputElement | null>(null);
  const pickerRef = useRef<HTMLInputElement | null>(null);
  // 打ち込み途中の文字列。null なら確定値を表示している
  const [draft, setDraft] = useState<string | null>(null);
  // 日付として読み取れなかったときの目印。黙って元に戻すと理由が分からないため
  const [invalid, setInvalid] = useState(false);

  // 値が未設定・不正な形式のときは「空欄」として扱う。
  // 任意項目（借入の開始日など）で、入っていない日付を勝手に表示しないため。
  const isEmpty = !/^\d{4}-\d{2}-\d{2}$/.test(value);
  const nowRef = new Date();
  const parts = value.split("-");
  const year = isEmpty ? nowRef.getFullYear() : Number(parts[0]);
  const month = isEmpty ? nowRef.getMonth() + 1 : Number(parts[1]);
  const day = isEmpty ? nowRef.getDate() : Number(parts[2]);

  const display = draft ?? (isEmpty ? "" : `${year}/${pad2(month)}/${pad2(day)}`);

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

  /**
   * 打ち込み中の文字列を確定する。
   *
   * 戻り値は「未確定の打ち込みが残っていないか」。読み取れなかったときだけ false。
   * かつては読み取れないと黙って元の値に戻していたが、それでは
   * **打ち間違いに気づけないまま、初期値（今日の日付）で登録されてしまう**。
   * 日付の取り違えは決算期をまたぐ致命的な誤りになるため、
   * 読み取れないときは打った内容と赤枠をそのまま残して知らせる。
   */
  const commitDraft = useCallback((): boolean => {
    if (draft === null) return true;
    // 任意項目なら、空にして確定＝未入力に戻す操作として受け付ける
    if (allowEmpty && draft.trim() === "") {
      setDraft(null);
      setInvalid(false);
      if (value !== "") onChange("");
      return true;
    }
    const parsed = parseDateInput(draft, { y: year, m: month, d: day });
    if (!parsed) {
      // 打った内容は残したまま印だけ付ける。直せるようにするため
      setInvalid(true);
      return false;
    }
    setDraft(null);
    setInvalid(false);
    if (parsed !== value) onChange(parsed);
    return true;
  }, [draft, year, month, day, value, onChange, allowEmpty]);

  /** 読み取れない打ち込みを捨てて、確定値に戻す（↑↓ で数字を動かすときに使う） */
  const discardDraft = useCallback(() => {
    setDraft(null);
    setInvalid(false);
  }, []);

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
      d = clampDayToMonthEnd(y, m, d);
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
          if (!commitDraft()) discardDraft();
          adjust(1);
          return;
        case "ArrowDown":
          e.preventDefault();
          if (!commitDraft()) discardDraft();
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
          // 打ち込み内容を確定してから、親（Enterで次の欄へ）に処理を渡す。
          // 読み取れないときは次の欄へ進ませない。進んでしまうと
          // 打った日付が消えたことに気づけない
          if (!commitDraft()) {
            if (e.key === "Enter") {
              e.preventDefault();
              return;
            }
          }
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
    [adjust, commitDraft, discardDraft, draft, onKeyDown]
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
        placeholder={placeholder ?? (allowEmpty ? "未入力" : "YYYY/MM/DD")}
        onChange={(e) => {
          setDraft(e.target.value);
          setInvalid(false);
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          // 読み取れないまま欄を離れても、打った内容と赤枠は残す。
          // 黙って元に戻すと、間違った日付のまま登録されたことに気づけない。
          // 打ち直しをやめたいときは Esc で戻せる
          commitDraft();
        }}
        onFocus={(e) => {
          // 全体を選択しておく。こうしないと「日」の部分にだけ文字が挿し込まれ、
          // 20260410 のようにフルの日付を打ったときに壊れた文字列になる。
          // 全選択中でも上下キーは日の増減として働く（getSegment 参照）。
          e.currentTarget.select();
        }}
        onMouseUp={(e) => {
          // 2回目以降のクリックでは onFocus が起きず全選択が外れる。
          // その状態で 0401 と打つと "2026/040109/11" のように差し込まれ、
          // 日付として読めず、今日の日付のまま登録されてしまっていた。
          // 確定値を表示している間は、どこをクリックしても打ち直しになるようにする。
          // （年・月だけを直したいときは ← → で区画を選び ↑ ↓ で増減する）
          if (draft === null) {
            e.preventDefault();
            e.currentTarget.select();
          }
        }}
        aria-invalid={invalid || undefined}
        title={invalid ? "日付として読み取れません。20260430 / 0430 / 4/30 のように入力してください" : undefined}
        className={
          (className ?? "") +
          (invalid ? " !border-destructive ring-2 ring-destructive/40" : "")
        }
      />

      {/* カレンダーから選ぶ経路。ネイティブの日付ピッカーを呼び出すだけの隠し入力を使う */}
      <input
        ref={pickerRef}
        type="date"
        value={isEmpty ? "" : value}
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          // カレンダーの「消去」を押すと空で通知される。
          // 空を無視していたため、カレンダーからは日付を消せなかった。
          // 未入力を許す欄では、空もそのまま反映する
          const v = e.target.value;
          if (v || allowEmpty) onChange(v);
        }}
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
        className="absolute right-0.5 p-0.5 rounded text-foreground/70 hover:text-foreground hover:bg-muted"
      >
        <CalendarDays className="size-3.5" />
      </button>
    </div>
  );
});
