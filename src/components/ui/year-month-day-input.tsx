"use client";

/**
 * 日付の入力欄。年は選択、月日は手入力（4/1・0401 など）。
 * キーボードだけで素早く入れられるようにする（帳簿閲覧の期間指定など）。
 * 月日は Enter・フォーカスを外したときに確定し、読めない入力は元に戻す。
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { toIsoDate, monthDayText } from "@/lib/month-day";

export function YearMonthDayInput({
  value,
  onChange,
  years,
  label,
  className,
}: {
  /** YYYY-MM-DD */
  value: string;
  onChange: (iso: string) => void;
  years: number[];
  /** 読み上げ用の名前（例: 開始日） */
  label: string;
  className?: string;
}) {
  const year = Number(value.slice(0, 4)) || years[0];
  const [md, setMd] = useState(monthDayText(value));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setMd(monthDayText(value));
    setInvalid(false);
  }, [value]);

  const commit = (y: number, text: string) => {
    const iso = toIsoDate(y, text);
    if (!iso) {
      setInvalid(text.trim() !== "");
      if (!text.trim()) setMd(monthDayText(value));
      return;
    }
    setInvalid(false);
    setMd(monthDayText(iso));
    if (iso !== value) onChange(iso);
  };

  return (
    <div className={cn("inline-flex items-center gap-1", className)}>
      <select
        aria-label={`${label}の年`}
        value={year}
        onChange={(e) => commit(Number(e.target.value), md)}
        className="px-2 py-1.5 rounded-lg border border-border bg-card text-foreground text-sm"
      >
        {years.map((y) => (
          <option key={y} value={y}>
            {y}年
          </option>
        ))}
      </select>
      <input
        aria-label={`${label}の月日`}
        value={md}
        inputMode="numeric"
        placeholder="月/日"
        onChange={(e) => {
          setMd(e.target.value);
          setInvalid(false);
        }}
        onBlur={() => commit(year, md)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) commit(year, md);
        }}
        title="例: 4/1、0401"
        className={cn(
          "w-[72px] px-2 py-1.5 rounded-lg border bg-card text-foreground text-sm text-center tabular-nums",
          invalid ? "border-destructive" : "border-border"
        )}
      />
    </div>
  );
}
