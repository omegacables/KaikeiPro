"use client";

import { useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** 何をするボタンかを表す言葉。吹き出しと読み上げの両方に使う */
  label: string;
  /** 処理中は使えないようにし、くるくるを出す */
  busy?: boolean;
  tone?: "default" | "primary" | "destructive";
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
 *
 * 吹き出しは画面の一番上の層（portal）に出す。表の中に描くと、
 * 横スクロールする表や枠に切り取られて読めなくなるため。
 */
export function IconButton({
  label,
  busy = false,
  tone = "default",
  className,
  children,
  disabled,
  ...rest
}: IconButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const [tip, setTip] = useState<{ left: number; top: number } | null>(null);

  const show = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // ボタンの真上に出す。画面の上端に近いときは下に回す
    const above = r.top > 40;
    setTip({ left: r.left + r.width / 2, top: above ? r.top - 6 : r.bottom + 6 });
  }, []);

  const hide = useCallback(() => setTip(null), []);

  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label={label}
        disabled={disabled || busy}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className={cn(
          "p-1.5 rounded transition-colors disabled:opacity-50",
          toneClass[tone],
          className
        )}
        {...rest}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : children}
      </button>

      {tip !== null &&
        typeof document !== "undefined" &&
        createPortal(
          <span
            role="tooltip"
            style={{
              left: tip.left,
              top: tip.top,
              transform: `translate(-50%, ${tip.top < 40 ? "0" : "-100%"})`,
            }}
            className="pointer-events-none fixed z-[100] whitespace-nowrap rounded px-2 py-1 text-[13px] font-medium bg-foreground text-background shadow-lg"
          >
            {label}
          </span>,
          document.body
        )}
    </>
  );
}
