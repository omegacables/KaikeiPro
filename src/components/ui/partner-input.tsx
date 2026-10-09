"use client";

/**
 * 取引先名の入力欄。打ち始めると取引先マスタ（名前・別名）から候補を出す（予測変換）。
 * 候補を選ぶと onSelect が呼ばれ、所在地や登録番号を補える。
 * マスタに無い名前もそのまま入力できる（その場合は onChange だけが呼ばれる）。
 */

import { useEffect, useMemo, useRef, useState, memo } from "react";
import { cn } from "@/lib/utils";

export type PartnerSuggestion = {
  id: string;
  name: string;
  aliases?: string[];
  /** 候補の下に小さく出す補足（所在地など） */
  sub?: string;
};

/** 全角英数を半角に、カタカナをひらがなに寄せ、大文字小文字を区別しない比較用の文字列 */
export function normalizeForSearch(v: string): string {
  return v
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(/\s+/g, "")
    .replace(/株式会社|有限会社|合同会社|\(株\)|\(有\)|\(同\)/g, "");
}

/** 候補を絞り込む。前方一致を先に、部分一致を後に並べる */
export function filterPartners<T extends PartnerSuggestion>(partners: T[], query: string, limit = 8): T[] {
  const q = normalizeForSearch(query);
  if (!q) return partners.slice(0, limit);
  const scored: { p: T; score: number; key: string }[] = [];
  for (const p of partners) {
    let best = -1;
    for (const n of [p.name, ...(p.aliases ?? [])]) {
      const t = normalizeForSearch(n);
      if (t.startsWith(q)) best = Math.max(best, 2);
      else if (t.includes(q)) best = Math.max(best, 1);
    }
    if (best >= 0) scored.push({ p, score: best, key: normalizeForSearch(p.name) });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key, "ja"))
    .slice(0, limit)
    .map((x) => x.p);
}

interface PartnerInputProps<T extends PartnerSuggestion> {
  value: string;
  onChange: (text: string) => void;
  onSelect: (partner: T) => void;
  partners: T[];
  placeholder?: string;
  className?: string;
}

function PartnerInputInner<T extends PartnerSuggestion>({
  value,
  onChange,
  onSelect,
  partners,
  placeholder,
  className,
}: PartnerInputProps<T>) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // 横スクロールする表の中でも候補が切れないよう、画面に対して固定位置で出す
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);

  const candidates = useMemo(() => filterPartners(partners, value), [partners, value]);
  // 入力が候補の名前と完全に同じなら、候補を出し続けない
  const exact = candidates.length === 1 && candidates[0].name === value;
  const show = open && candidates.length > 0 && !exact;

  useEffect(() => {
    if (!show) return;
    const place = () => {
      const r = inputRef.current?.getBoundingClientRect();
      if (r) setPos({ left: r.left, top: r.bottom + 4, width: r.width });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [show]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const pick = (p: T) => {
    onSelect(p);
    setOpen(false);
    setHighlight(-1);
  };

  return (
    <div ref={boxRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={show}
        aria-autocomplete="list"
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setHighlight(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          // 日本語入力の変換中は候補を動かさない
          if (e.nativeEvent.isComposing || !show) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlight((h) => Math.min(h + 1, candidates.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter" && highlight >= 0) {
            e.preventDefault();
            pick(candidates[highlight]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        className={cn(
          "w-full px-2 py-1.5 rounded-md border border-border bg-card text-foreground text-sm",
          className
        )}
      />
      {show && pos && (
        <div
          role="listbox"
          style={{ left: pos.left, top: pos.top, width: Math.max(pos.width, 260) }}
          className="fixed z-50 max-h-64 overflow-y-auto rounded-md border border-border bg-card shadow-lg"
        >
          {candidates.map((p, i) => (
            <button
              key={p.id}
              type="button"
              role="option"
              aria-selected={i === highlight}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(p)}
              className={cn(
                "block w-full text-left px-3 py-1.5 text-sm cursor-pointer",
                i === highlight ? "bg-primary/10 text-primary" : "hover:bg-muted/40"
              )}
            >
              <div className="font-medium">{p.name}</div>
              {p.sub && <div className="text-xs text-muted-foreground truncate">{p.sub}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export const PartnerInput = memo(PartnerInputInner) as typeof PartnerInputInner;
