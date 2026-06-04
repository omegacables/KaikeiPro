"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { subscribeLoad } from "@/lib/loading-bus";

// データ取得中（useData 等）に画面右上へ「読み込み中...」を表示する非ブロッキングなインジケーター。
export function GlobalLoading() {
  const [active, setActive] = useState(0);

  useEffect(() => subscribeLoad(setActive), []);

  if (active <= 0) return null;

  return (
    <div className="fixed top-3 right-3 z-[100] flex items-center gap-2 px-3 py-1.5 rounded-full bg-card border border-border shadow-md text-sm text-muted-foreground pointer-events-none">
      <Loader2 className="size-4 animate-spin" />
      読み込み中...
    </div>
  );
}
