"use client";

import { useMemo, useState } from "react";
import { Search, Loader2, Landmark, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { JAPAN_BANKS, type JapanBank } from "@/lib/japan-banks";

// 検索用の正規化: 全角英数→半角、ひらがな→カタカナ、小文字化
function normalize(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[ぁ-ん]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60))
    .toLowerCase()
    .replace(/\s+/g, "");
}

const MAX_RESULTS = 100;

/**
 * 明細アップロード用の口座作成モーダル。
 * 全銀協マスタから金融機関を検索・選択し、管理名を付けて口座を登録する。
 */
export function BankSelectModal({
  open,
  saving = false,
  onClose,
  onSave,
}: {
  open: boolean;
  saving?: boolean;
  onClose: () => void;
  // bank: 選択された金融機関 / managementName: 管理名（任意）
  onSave: (bank: JapanBank, managementName: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [managementName, setManagementName] = useState("");

  const filtered = useMemo(() => {
    const q = normalize(query);
    if (!q) return JAPAN_BANKS.slice(0, MAX_RESULTS);
    return JAPAN_BANKS.filter(
      (b) => normalize(b.n).includes(q) || normalize(b.k).includes(q) || b.c.includes(q)
    ).slice(0, MAX_RESULTS);
  }, [query]);

  const selectedBank = selectedCode ? JAPAN_BANKS.find((b) => b.c === selectedCode) ?? null : null;

  const handleClose = () => {
    setQuery("");
    setSelectedCode(null);
    setManagementName("");
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-card rounded-xl shadow-2xl border border-border w-full max-w-lg max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h3 className="text-base font-bold text-foreground flex items-center gap-2">
            <Landmark className="size-4 text-primary" />
            明細アップロード用の口座作成
          </h3>
          <button onClick={handleClose} className="text-muted-foreground hover:text-foreground">
            <X className="size-5" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4 overflow-y-auto">
          <p className="text-xs text-muted-foreground">
            必要な情報を入力して口座を作成してください。
          </p>

          {/* 登録口座 */}
          <div>
            <label className="flex items-center gap-1.5 text-sm font-bold text-foreground mb-2">
              登録口座
              <span className="text-[10px] font-bold text-white bg-destructive rounded px-1.5 py-0.5">必須</span>
            </label>
            <div className="relative mb-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="金融機関を検索"
                className="w-full rounded-lg border border-border bg-card pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="rounded-lg border border-border max-h-56 overflow-y-auto divide-y divide-border">
              {filtered.map((b) => (
                <label
                  key={b.c}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 text-sm cursor-pointer hover:bg-muted/20",
                    selectedCode === b.c && "bg-primary/5"
                  )}
                >
                  <input
                    type="radio"
                    name="bank"
                    checked={selectedCode === b.c}
                    onChange={() => setSelectedCode(b.c)}
                    className="accent-primary size-4 shrink-0"
                  />
                  <span className="text-foreground">{b.n}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground font-mono">{b.c}</span>
                </label>
              ))}
              {filtered.length === 0 && (
                <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                  該当する金融機関が見つかりません
                </p>
              )}
            </div>
            {filtered.length === MAX_RESULTS && (
              <p className="mt-1 text-[10px] text-muted-foreground">
                先頭{MAX_RESULTS}件を表示しています。検索で絞り込んでください。
              </p>
            )}
          </div>

          {/* 管理名 */}
          <div>
            <label className="block text-sm font-bold text-foreground mb-2">管理名</label>
            <input
              type="text"
              value={managementName}
              onChange={(e) => setManagementName(e.target.value)}
              placeholder="例）本店営業部"
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              支店名など入力すると管理がしやすくなります。
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border shrink-0">
          <Button variant="outline" onClick={handleClose} disabled={saving}>
            キャンセル
          </Button>
          <Button
            onClick={() => selectedBank && onSave(selectedBank, managementName.trim())}
            disabled={!selectedBank || saving}
          >
            {saving && <Loader2 className="size-4 mr-1.5 animate-spin" />}
            保存する
          </Button>
        </div>
      </div>
    </div>
  );
}
