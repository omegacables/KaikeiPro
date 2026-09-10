"use client";

import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** 何をするボタンかを表す言葉。ホバー時の吹き出しと読み上げの両方に使う */
  label: string;
  /** 処理中は使えないようにし、くるくるを出す */
  busy?: boolean;
  tone?: "default" | "primary" | "destructive";
  /** 吹き出しを出す向き。表の下端では上に出すと見切れることがある */
  placement?: "top" | "bottom";
}

const toneClass = {
  default: "text-foreground hover:bg-muted",
  primary: "text-primary hover:bg-primary/10",
  destructive: "text-destructive hover:bg-destructive/10",
} as const;

/**
 * アイコンだけのボタン。
 *
 * ブラウザ標準の title は表示まで1秒ほどかかり、気づかないまま押してしまう。
 * ゴミ箱と仕訳取り消しのように「押すと戻せない操作」が並ぶ場所では危険なので、
 * ホバー・フォーカスした時点ですぐ言葉が出るようにする。
 * キーボード操作でも出るので、Tabで辿ったときにも何のボタンか分かる。
 */
export function IconButton({
  label,
  busy = false,
  tone = "default",
  placement = "top",
  className,
  children,
  disabled,
  ...rest
}: IconButtonProps) {
  return (
    <span className="relative inline-flex group/iconbtn">
      <button
        type="button"
        aria-label={label}
        disabled={disabled || busy}
        className={cn(
          "p-1.5 rounded transition-colors disabled:opacity-50",
          toneClass[tone],
          className
        )}
        {...rest}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : children}
      </button>

      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute left-1/2 -translate-x-1/2 z-50",
          "whitespace-nowrap rounded px-2 py-1 text-[13px] font-medium",
          "bg-foreground text-background shadow",
          "opacity-0 group-hover/iconbtn:opacity-100 group-focus-within/iconbtn:opacity-100",
          "transition-opacity",
          placement === "top" ? "bottom-full mb-1" : "top-full mt-1"
        )}
      >
        {label}
      </span>
    </span>
  );
}
