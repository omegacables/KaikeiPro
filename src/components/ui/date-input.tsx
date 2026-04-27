"use client";

import { useRef, useCallback, memo } from "react";

interface DateInputProps {
  value: string; // YYYY-MM-DD
  onChange: (value: string) => void;
  inputRef?: (el: HTMLInputElement | null) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  className?: string;
}

/** Pad number to 2 digits */
const pad2 = (n: number) => String(n).padStart(2, "0");

/** Clamp day to valid range for given year/month */
function clampDay(y: number, m: number, d: number) {
  const maxDay = new Date(y, m, 0).getDate(); // last day of month
  return Math.min(Math.max(d, 1), maxDay);
}

/** Format date parts to YYYY-MM-DD */
function format(y: number, m: number, d: number) {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/**
 * Custom date input that avoids native browser date picker.
 * Displays as YYYY/MM/DD text. Arrow up/down adjusts the segment
 * (year, month, or day) at the cursor position.
 */
export const DateInput = memo(function DateInput({
  value,
  onChange,
  inputRef,
  onKeyDown,
  className,
}: DateInputProps) {
  const innerRef = useRef<HTMLInputElement | null>(null);

  // Parse current value
  const parts = value.split("-");
  const year = Number(parts[0]) || new Date().getFullYear();
  const month = Number(parts[1]) || 1;
  const day = Number(parts[2]) || 1;

  // Display as YYYY/MM/DD
  const display = `${year}/${pad2(month)}/${pad2(day)}`;

  // Determine which segment the cursor is in: 0=year, 1=month, 2=day
  const getSegment = (): number => {
    const pos = innerRef.current?.selectionStart ?? 0;
    if (pos <= 4) return 0;     // YYYY
    if (pos <= 7) return 1;     // /MM
    return 2;                    // /DD
  };

  // Select the segment text for visual feedback
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

  const adjust = useCallback((delta: number) => {
    const seg = getSegment();
    let y = year, m = month, d = day;
    switch (seg) {
      case 0: y += delta; break;
      case 1:
        m += delta;
        if (m > 12) { m = 1; y++; }
        if (m < 1) { m = 12; y--; }
        break;
      case 2:
        d += delta;
        const maxDay = new Date(y, m, 0).getDate();
        if (d > maxDay) { d = 1; m++; if (m > 12) { m = 1; y++; } }
        if (d < 1) { m--; if (m < 1) { m = 12; y--; } d = new Date(y, m, 0).getDate(); }
        break;
    }
    d = clampDay(y, m, d);
    onChange(format(y, m, d));
    selectSegment(seg);
  }, [year, month, day, onChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        adjust(1);
        return;
      case "ArrowDown":
        e.preventDefault();
        adjust(-1);
        return;
      case "ArrowLeft": {
        const seg = getSegment();
        if (seg > 0) {
          e.preventDefault();
          selectSegment(seg - 1);
          return;
        }
        break;
      }
      case "ArrowRight": {
        const seg = getSegment();
        if (seg < 2) {
          e.preventDefault();
          selectSegment(seg + 1);
          return;
        }
        break;
      }
    }
    onKeyDown?.(e);
  }, [adjust, onKeyDown]);

  const handleFocus = useCallback(() => {
    selectSegment(2); // Default select day segment
  }, []);

  return (
    <input
      ref={(el) => {
        innerRef.current = el;
        inputRef?.(el);
      }}
      type="text"
      readOnly
      value={display}
      onKeyDown={handleKeyDown}
      onFocus={handleFocus}
      className={className}
    />
  );
});
