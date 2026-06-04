"use client";

import { useState, useRef, useEffect, useCallback, memo } from "react";
import { cn } from "@/lib/utils";
import { matchesAccountQuery, toHalfWidth } from "@/lib/account-reading";
import { getAccountReadings } from "@/actions/account-readings";

// カスタム読み（設定画面で登録）を1回だけ取得してキャッシュ。全AccountLookupで共有。
let cachedReadings: Record<string, string> | null = null;
let readingsPromise: Promise<Record<string, string>> | null = null;
function loadCustomReadings(): Promise<Record<string, string>> {
  if (cachedReadings) return Promise.resolve(cachedReadings);
  if (!readingsPromise) {
    readingsPromise = getAccountReadings()
      .then((m) => {
        cachedReadings = m;
        return m;
      })
      .catch(() => ({}));
  }
  return readingsPromise;
}

export interface AccountOption {
  id: string;
  code: string;
  name: string;
  categoryType: string;
  categoryName: string;
  reading?: string | null;
}

const categoryOrder = ["assets", "liabilities", "equity", "revenue", "expenses"];
const categoryLabels: Record<string, string> = {
  assets: "資産",
  liabilities: "負債",
  equity: "純資産",
  revenue: "収益",
  expenses: "費用",
};

interface AccountLookupProps {
  value: string;
  onChange: (id: string) => void;
  accounts: AccountOption[];
  inputRef?: (el: HTMLInputElement | null) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}

export const AccountLookup = memo(function AccountLookup({
  value,
  onChange,
  accounts,
  inputRef,
  onKeyDown,
}: AccountLookupProps) {
  const selected = accounts.find((a) => a.id === value);
  const [query, setQuery] = useState(selected ? `${selected.code} ${selected.name}` : "");
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const innerInputRef = useRef<HTMLInputElement | null>(null);
  const [extraReadings, setExtraReadings] = useState<Record<string, string>>(cachedReadings ?? {});

  // カスタム読みを読み込み（キャッシュ済みなら即時）
  useEffect(() => {
    loadCustomReadings().then(setExtraReadings);
  }, []);

  // Sync display text when value changes externally
  useEffect(() => {
    const a = accounts.find((a) => a.id === value);
    if (a) setQuery(`${a.code} ${a.name}`);
    else if (!value) setQuery("");
  }, [value, accounts]);

  // Filter accounts by query (match code or name)
  // Skip filtering when an account is already selected (query matches display text)
  const isSelectedText = selected && query === `${selected.code} ${selected.name}`;
  // コード・名前・よみ仮名・ローマ字（頭文字）でマッチ。例: "g" → 現金/減価償却費
  const filtered = query && open && !isSelectedText
    ? accounts.filter((a) => matchesAccountQuery(query, a, extraReadings))
    : accounts;

  // Build flat list with category groups for rendering
  const groups: { label: string; items: AccountOption[] }[] = [];
  for (const catType of categoryOrder) {
    const items = filtered.filter((a) => a.categoryType === catType);
    if (items.length > 0) {
      groups.push({ label: categoryLabels[catType] ?? catType, items });
    }
  }
  const flatItems = groups.flatMap((g) => g.items);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightIdx < 0 || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${highlightIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [highlightIdx]);

  const selectAccount = useCallback((a: AccountOption) => {
    onChange(a.id);
    setQuery(`${a.code} ${a.name}`);
    setOpen(false);
    setHighlightIdx(-1);
  }, [onChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // IME変換中はナビゲーションしない
    if (e.nativeEvent.isComposing) return;
    if (open) {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setHighlightIdx((prev) => (prev < flatItems.length - 1 ? prev + 1 : prev));
          return;
        case "ArrowUp":
          e.preventDefault();
          setHighlightIdx((prev) => (prev > 0 ? prev - 1 : prev));
          return;
        case "Enter":
          e.preventDefault();
          if (highlightIdx >= 0 && highlightIdx < flatItems.length) {
            selectAccount(flatItems[highlightIdx]);
          } else {
            setOpen(false);
          }
          // Always consume Enter while dropdown is open
          return;
        case "Escape":
          e.preventDefault();
          setOpen(false);
          // Restore display text
          if (selected) setQuery(`${selected.code} ${selected.name}`);
          else setQuery("");
          return;
        case "Tab":
          setOpen(false);
          return;
      }
    }
    // Dropdown closed: ArrowDown opens it
    if (!open && e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlightIdx(0);
      return;
    }
    // Delegate to parent grid navigation
    onKeyDown?.(e);
  }, [open, highlightIdx, flatItems, selectAccount, selected, onKeyDown]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const v = toHalfWidth(e.target.value);
    setQuery(v);
    setOpen(true);
    setHighlightIdx(0);
    // Clear selection if user edits
    if (value) onChange("");
  }, [value, onChange]);

  const handleFocus = useCallback(() => {
    setOpen(true);
    setHighlightIdx(-1);
    // Select all text on focus for easy replacement
    innerInputRef.current?.select();
  }, []);

  // Build a flat index counter for data-idx
  let flatIdx = 0;

  return (
    <div ref={containerRef} className="relative w-full">
      <input
        ref={(el) => {
          innerInputRef.current = el;
          inputRef?.(el);
        }}
        type="text"
        value={query}
        onChange={handleInputChange}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        placeholder="科目検索..."
        className="w-full bg-card border border-border rounded px-2 py-1.5 text-sm"
      />
      {open && groups.length > 0 && (
        <div
          ref={listRef}
          className="absolute left-0 right-0 top-full mt-1 z-50 bg-card border border-border rounded-lg shadow-lg max-h-60 overflow-y-auto"
        >
          {groups.map((group) => (
            <div key={group.label}>
              <div className="px-2 py-1 text-xs font-bold text-muted-foreground bg-muted/50 sticky top-0">
                {group.label}
              </div>
              {group.items.map((a) => {
                const idx = flatIdx++;
                return (
                  <button
                    key={a.id}
                    data-idx={idx}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault(); // prevent input blur
                      selectAccount(a);
                    }}
                    className={cn(
                      "w-full text-left px-3 py-1.5 text-sm transition-colors cursor-pointer",
                      idx === highlightIdx
                        ? "bg-primary/10 text-primary font-semibold"
                        : "hover:bg-muted/50"
                    )}
                  >
                    <span className="font-mono text-muted-foreground mr-2">{a.code}</span>
                    {a.name}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
