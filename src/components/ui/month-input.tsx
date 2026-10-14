"use client";

import { useCallback, useLayoutEffect, useRef, useState, memo } from "react";
import { ChevronDown } from "lucide-react";
import { useSegmentWheel, SegmentHighlight } from "./segment-wheel";
import { DrumPicker, DrumFooterButton, type DrumColumn } from "./drum-picker";
import { segmentNav, moveCaretToEdge } from "./segment-nav";

const MONTH_SEGMENTS = [[0, 4], [5, 7]] as const; // "YYYY/MM"

const pad2 = (n: number) => String(n).padStart(2, "0");

function toHalfWidth(v: string) {
  return v.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

function build(y: number, m: number): string | null {
  if (!Number.isFinite(y) || !Number.isFinite(m)) return null;
  if (y < 1900 || y > 2200 || m < 1 || m > 12) return null;
  return `${y}-${pad2(m)}`;
}

/**
 * 打ち込まれた文字列を年月（YYYY-MM）として解釈する。読み取れなければ null。
 *   202604 / 2026/4 / 2026-04 → 2026-04
 *   2604 / 26/4               → 2026-04
 *   4                         → 基準の年の 4月
 */
export function parseMonthInput(raw: string, baseYear: number): string | null {
  const s = toHalfWidth(raw).trim().replace(/[年月]/g, (c) => (c === "年" ? "/" : ""));
  if (!s) return null;
  if (/[/\-.]/.test(s)) {
    const parts = s.split(/[/\-.]/).filter((p) => p !== "");
    if (parts.length !== 2 || !parts.every((p) => /^\d{1,4}$/.test(p))) return null;
    const y = Number(parts[0]) < 100 ? 2000 + Number(parts[0]) : Number(parts[0]);
    return build(y, Number(parts[1]));
  }
  if (!/^\d+$/.test(s)) return null;
  switch (s.length) {
    case 6:
      return build(Number(s.slice(0, 4)), Number(s.slice(4, 6)));
    case 4:
      return build(2000 + Number(s.slice(0, 2)), Number(s.slice(2, 4)));
    case 1:
    case 2:
      return build(baseYear, Number(s));
    default:
      return null;
  }
}

interface MonthInputProps {
  value: string; // YYYY-MM（未入力は ""）
  onChange: (value: string) => void;
  className?: string;
  /** 空欄にして確定＝未指定に戻せる欄では true */
  allowEmpty?: boolean;
  /**
   * 空欄のままホイールを回したとき、今月から始めるか。
   * 絞り込みの欄では便利だが、登録する値の欄で勝手に埋まると気づきにくいので既定は false
   */
  wheelFromEmpty?: boolean;
  placeholder?: string;
  /** 外枠の幅など。横並びの絞り込み欄では "w-32 shrink-0" のように幅を決める */
  wrapperClassName?: string;
}

/**
 * 年月の入力欄。日付入力欄（DateInput）と同じ操作ができる。
 *   打ち込み（202604 / 2026/4 / 4）・ドラムロール（クリック・▼・Alt+↓）・↑↓キー・ホイール（クリック不要）
 * 区画を選び始めたら、Enter・→ で 年 → 月 → 次の欄 と進む（← ・Shift+Enter で戻る）。
 */
export const MonthInput = memo(function MonthInput({
  value,
  onChange,
  className,
  allowEmpty = false,
  wheelFromEmpty = false,
  placeholder,
  wrapperClassName = "w-full",
}: MonthInputProps) {
  const innerRef = useRef<HTMLInputElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [yearCenter, setYearCenter] = useState(() => new Date().getFullYear());
  const [draft, setDraft] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  // キーボード・ドラムで選んでいる区画（ドラムの列見出しに色を付ける）。全体選択中は null
  const [activeSeg, setActiveSeg] = useState<number | null>(null);

  const isEmpty = !/^\d{4}-\d{2}$/.test(value);
  const now = new Date();
  const year = isEmpty ? now.getFullYear() : Number(value.slice(0, 4));
  const month = isEmpty ? now.getMonth() + 1 : Number(value.slice(5, 7));
  const display = draft ?? (isEmpty ? "" : `${year}/${pad2(month)}`);

  const commitDraft = useCallback((): boolean => {
    if (draft === null) return true;
    if (allowEmpty && draft.trim() === "") {
      setDraft(null);
      setInvalid(false);
      if (value !== "") onChange("");
      return true;
    }
    const parsed = parseMonthInput(draft, year);
    if (!parsed) {
      setInvalid(true);
      return false;
    }
    setDraft(null);
    setInvalid(false);
    if (parsed !== value) onChange(parsed);
    return true;
  }, [draft, allowEmpty, value, onChange, year]);

  // seg: 0=年, 1=月
  const adjust = useCallback(
    (delta: number, seg: number) => {
      let y = year;
      let m = month;
      if (isEmpty) {
        // 空欄から始めるときは、まず今月を出す
        onChange(`${y}-${pad2(m)}`);
        return;
      }
      if (seg === 0) y += delta;
      else {
        m += delta;
        if (m > 12) { m = 1; y++; }
        if (m < 1) { m = 12; y--; }
      }
      onChange(`${y}-${pad2(m)}`);
    },
    [year, month, isEmpty, onChange]
  );

  // カーソルのある区画: 0=年, 1=月。全選択中（フォーカス直後の既定）は null
  const segmentAtCaret = (): number | null => {
    const el = innerRef.current;
    if (!el) return null;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? start;
    if (start === 0 && end >= display.length) return null;
    return start <= 4 ? 0 : 1;
  };

  // 値を変えると描き直しで選択が外れるので、選んでいる区画を選び直す
  useLayoutEffect(() => {
    const el = innerRef.current;
    if (activeSeg === null || !el || document.activeElement !== el) return;
    const [a, b] = MONTH_SEGMENTS[activeSeg];
    if (el.value.length >= b) el.setSelectionRange(a, b);
  }, [display, activeSeg]);

  const selectSegment = (seg: number) => {
    const el = innerRef.current;
    if (!el) return;
    setActiveSeg(seg);
    const [a, b] = MONTH_SEGMENTS[seg];
    // すぐに選ぶ（続けて押したキーが前の区画に効かないように）。値を変えたときの描き直しの後は下の effect で選び直す
    if (el.value.length >= b) el.setSelectionRange(a, b);
  };

  const openPicker = () => {
    setYearCenter(year);
    setOpen(true);
  };
  const pick = (y: number, m: number, seg?: number) => {
    setDraft(null);
    setInvalid(false);
    onChange(`${y}-${pad2(m)}`);
    // 選んだ区画にカーソルを置く。続けて Enter・→ で月・次の欄へ進めるように
    if (seg !== undefined && document.activeElement === innerRef.current) selectSegment(seg);
  };
  const drumColumns: DrumColumn[] = [
    {
      key: "y",
      label: "年",
      items: Array.from({ length: 31 }, (_, i) => yearCenter - 15 + i).map((v) => ({ value: v, label: `${v}` })),
      selected: year,
      onSelect: (v) => pick(v, month, 0),
      active: open && activeSeg === 0,
    },
    {
      key: "m",
      label: "月",
      items: Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: `${i + 1}月` })),
      selected: month,
      onSelect: (v) => pick(year, v, 1),
      active: open && activeSeg === 1,
    },
  ];

  const wheelHighlight = useSegmentWheel(innerRef, {
    text: display || `${year}/${pad2(month)}`,
    segments: MONTH_SEGMENTS,
    enabled: draft === null && (!isEmpty || wheelFromEmpty),
    onStep: adjust,
  });

  return (
    <div ref={wrapperRef} className={`relative inline-flex items-center ${wrapperClassName}`}>
      <input
        ref={innerRef}
        type="text"
        inputMode="numeric"
        value={display}
        placeholder={placeholder ?? (allowEmpty ? "未指定" : "YYYY/MM")}
        onChange={(e) => {
          setDraft(e.target.value);
          setInvalid(false);
          setActiveSeg(null);
        }}
        onKeyDown={(e) => {
          if ((e.nativeEvent as KeyboardEvent).isComposing) return;
          if (e.key === "ArrowDown" && e.altKey) {
            e.preventDefault();
            openPicker();
          } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            if (!commitDraft()) {
              setDraft(null);
              setInvalid(false);
            }
            // 区画を選んでいなければ年から選び始める
            const seg = segmentAtCaret() ?? 0;
            adjust(e.key === "ArrowUp" ? 1 : -1, seg);
            if (!isEmpty) selectSegment(seg);
            if (!open) openPicker();
          } else if (draft === null && !isEmpty && (e.key === "Enter" || e.key === "ArrowLeft" || e.key === "ArrowRight")) {
            // 年 → 月 → 次の欄 の順に選ぶ
            const move = segmentNav(e.key, e.shiftKey, segmentAtCaret(), 2);
            if (move?.kind === "select") {
              e.preventDefault();
              selectSegment(move.seg);
              if (!open) openPicker();
            } else {
              setOpen(false);
              setActiveSeg(null);
              if (move) moveCaretToEdge(innerRef.current, move.dir);
            }
          } else if (e.key === "Enter" || e.key === "Tab") {
            setOpen(false);
            if (!commitDraft() && e.key === "Enter") e.preventDefault();
          } else if (e.key === "Escape" && open) {
            e.preventDefault();
            setOpen(false);
          } else if (e.key === "Escape" && draft !== null) {
            e.preventDefault();
            setDraft(null);
            setInvalid(false);
          }
        }}
        onClick={() => {
          if (!open) openPicker();
        }}
        onBlur={() => {
          setOpen(false);
          setActiveSeg(null);
          commitDraft();
        }}
        onFocus={(e) => {
          e.currentTarget.select();
          setActiveSeg(null);
        }}
        onMouseUp={(e) => {
          if (draft === null) {
            e.preventDefault();
            e.currentTarget.select();
            setActiveSeg(null);
          }
        }}
        aria-invalid={invalid || undefined}
        title={
          invalid
            ? "年月として読み取れません。202604 / 2026/4 / 4 のように入力してください"
            : "年・月の上でマウスホイールを回すと、クリックせずに変えられます（クリックで選択パネル）"
        }
        className={(className ?? "") + (invalid ? " !border-destructive ring-2 ring-destructive/40" : "")}
      />
      <SegmentHighlight at={wheelHighlight} />

      <button
        type="button"
        tabIndex={-1}
        title="年・月を選ぶ"
        onMouseDown={(e) => {
          e.preventDefault();
          if (open) setOpen(false);
          else {
            innerRef.current?.focus();
            openPicker();
          }
        }}
        className="absolute right-0.5 p-0.5 rounded text-foreground/70 hover:text-foreground hover:bg-muted"
      >
        <ChevronDown className={"size-3.5 transition-transform " + (open ? "rotate-180" : "")} />
      </button>

      <DrumPicker
        anchorRef={wrapperRef}
        open={open}
        onClose={() => setOpen(false)}
        columns={drumColumns}
        footer={
          <>
            <DrumFooterButton onClick={() => pick(now.getFullYear(), now.getMonth() + 1)}>今月</DrumFooterButton>
            {allowEmpty && (
              <DrumFooterButton
                onClick={() => {
                  setDraft(null);
                  setInvalid(false);
                  onChange("");
                  setOpen(false);
                }}
              >
                クリア
              </DrumFooterButton>
            )}
            <DrumFooterButton onClick={() => setOpen(false)}>閉じる</DrumFooterButton>
          </>
        }
      />
    </div>
  );
});
