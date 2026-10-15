"use client";

import { useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * 中身にマウスを重ねると、すぐ言葉を出す（吹き出し）。ボタンの中のアイコンなど、
 * IconButton を使えない場所に使う（ボタンの中にボタンは置けないため）。
 * ブラウザ標準の title は表示まで1秒ほどかかり、気づかれないことが多い。
 * 吹き出しは画面の一番上の層（portal）に出し、表や枠で切り取られないようにする。
 */
export function HoverTip({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [tip, setTip] = useState<{ left: number; top: number; below: boolean } | null>(null);
  const show = useCallback(() => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    // 真上に出す。画面の上端に近いときは下に回す
    const below = r.top < 40;
    setTip({ left: r.left + r.width / 2, top: below ? r.bottom + 6 : r.top - 6, below });
  }, []);
  const hide = useCallback(() => setTip(null), []);
  return (
    <>
      <span ref={ref} onMouseEnter={show} onMouseLeave={hide} aria-label={label} className={cn("inline-flex", className)}>
        {children}
      </span>
      {tip !== null &&
        typeof document !== "undefined" &&
        createPortal(
          <span
            role="tooltip"
            style={{ left: tip.left, top: tip.top, transform: `translate(-50%, ${tip.below ? "0" : "-100%"})` }}
            className="pointer-events-none fixed z-[100] whitespace-nowrap rounded px-2 py-1 text-[13px] font-medium bg-foreground text-background shadow-lg"
          >
            {label}
          </span>,
          document.body
        )}
    </>
  );
}
