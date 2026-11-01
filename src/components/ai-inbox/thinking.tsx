"use client";

/**
 * AIが考えている・答えているときの表示（thinking-orbs の点の球）。
 * 色は画面のテーマ（html[data-theme]）に合わせ、ブランドの緑で塗る。
 * 動きを減らす設定（prefers-reduced-motion）の人には止めて出す。
 */

import { useEffect, useState } from "react";
import { ThinkingOrb, type OrbState } from "thinking-orbs";
import { cn } from "@/lib/utils";

export type DocTheme = "light" | "dark";

/** 画面のテーマ（ヘッダーの切り替えで変わる）を見張る */
export function useDocTheme(): DocTheme {
  const [theme, setTheme] = useState<DocTheme>("light");
  useEffect(() => {
    const el = document.documentElement;
    const read = () => setTheme(el.getAttribute("data-theme") === "dark" ? "dark" : "light");
    read();
    const mo = new MutationObserver(read);
    mo.observe(el, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);
  return theme;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const read = () => setReduced(mq.matches);
    read();
    mq.addEventListener("change", read);
    return () => mq.removeEventListener("change", read);
  }, []);
  return reduced;
}

/** 処理の段階ごとの動き */
export const STAGE_ORB: Record<string, OrbState> = {
  upload: "connecting",
  triage: "searching",
  read: "solving",
  journal: "composing",
  question: "weaving",
  answer: "composing",
  listen: "listening",
  idle: "breathing",
};

export function AiOrb({
  state = "working",
  size = 64,
  paused,
  className,
  label,
}: {
  state?: OrbState;
  size?: 64 | 32 | 20;
  paused?: boolean;
  className?: string;
  label?: string;
}) {
  const theme = useDocTheme();
  const reduced = useReducedMotion();
  return (
    <ThinkingOrb
      state={state}
      size={size}
      theme={theme}
      color={theme === "dark" ? "#9ccc4a" : "#527120"}
      paused={paused || reduced}
      aria-label={label}
      className={cn("shrink-0", className)}
    />
  );
}

/** 「AIエージェントが回答中…」の行（小さな球＋文字） */
export function AiWorkingLine({ text, state = "composing", className }: { text: string; state?: OrbState; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2 text-sm text-muted-foreground", className)} role="status" aria-live="polite">
      <AiOrb state={state} size={20} label={text} />
      <span className="ai-shimmer font-bold">{text}</span>
    </div>
  );
}
