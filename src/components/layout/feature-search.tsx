"use client";

/**
 * ヘッダーの「機能を探す」。言葉（ひらがな・ローマ字・言い換えも可）で画面・タブを探して移る。
 * Ctrl+K（Mac は ⌘K）でも開く。候補は ↑↓ で選び Enter で移る、Esc で閉じる。
 * 探す対象と言葉の一覧は src/lib/feature-search.ts。
 */

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { loadClients } from "@/lib/client-cache";
import { searchFeatures, featureHref, type Feature } from "@/lib/feature-search";

export function FeatureSearch() {
  const pathname = usePathname();
  const router = useRouter();
  const clientId = pathname.match(/^\/clients\/([^/]+)/)?.[1] ?? null;
  const [entityType, setEntityType] = useState<"individual" | "corporation" | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!clientId) return setEntityType(null);
    loadClients().then((cs) => setEntityType(cs.find((c) => c.id === clientId)?.entity_type ?? null));
  }, [clientId]);

  // Ctrl+K / ⌘K で開く
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const results = searchFeatures(query, { entityType, inClient: !!clientId });

  const go = (f: Feature) => {
    const href = featureHref(f, clientId);
    setOpen(false);
    // 同じ画面の別のタブへは、画面を読み直して移る（タブは開いたときの URL で決まる画面が多いため）
    if (href.split("?")[0] === pathname) window.location.href = href;
    else router.push(href);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-2.5 py-2 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors cursor-pointer"
        title="画面・機能を言葉で探す（Ctrl+K）"
        aria-label="機能を探す"
      >
        <Search className="size-4 shrink-0" />
        <span className="hidden md:inline">機能を探す</span>
        <kbd className="hidden md:inline rounded border border-border px-1 text-[10px]">Ctrl K</kbd>
      </button>

      {open && (
        <div className="fixed inset-0 z-[90] flex items-start justify-center bg-black/30 px-4 pt-[12vh]" onMouseDown={() => setOpen(false)}>
          <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl overflow-hidden" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search className="size-4 text-muted-foreground shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return;
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActive((a) => Math.min(a + 1, results.length - 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActive((a) => Math.max(a - 1, 0));
                  } else if (e.key === "Enter" && results[active]) {
                    e.preventDefault();
                    go(results[active]);
                  } else if (e.key === "Escape") {
                    setOpen(false);
                  }
                }}
                placeholder="例: 消費税集計表、元帳、減価償却、しわけ"
                className="w-full bg-transparent py-3 text-[15px] text-foreground outline-none"
                aria-label="探す言葉"
              />
            </div>
            <ul role="listbox" className="max-h-[50vh] overflow-y-auto py-1">
              {query && results.length === 0 && (
                <li className="px-4 py-3 text-sm text-muted-foreground">
                  {clientId ? "見つかりませんでした。別の言葉で試してください。" : "顧問先を選ぶと、顧問先の中の画面も探せます。"}
                </li>
              )}
              {results.map((f, k) => (
                <li
                  key={f.path}
                  role="option"
                  aria-selected={k === active}
                  onMouseEnter={() => setActive(k)}
                  onClick={() => go(f)}
                  className={cn("cursor-pointer px-4 py-2", k === active ? "bg-primary/10" : "hover:bg-muted/40")}
                >
                  <div className={cn("text-[15px] font-bold", k === active ? "text-primary" : "text-foreground")}>{f.label}</div>
                  <div className="text-xs text-muted-foreground">{f.where}</div>
                </li>
              ))}
              {!query && (
                <li className="px-4 py-3 text-xs text-muted-foreground">
                  画面の名前や、中身の言葉（例: 内訳、BS、家事按分、登録番号）で探せます。ひらがな・ローマ字でも探せます。
                </li>
              )}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
