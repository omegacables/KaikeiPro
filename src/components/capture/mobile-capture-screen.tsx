"use client";

// スマホ向けの最小機能画面。税理士アプリ(ダッシュボード)はPC前提のため、
// スマホでは閲覧・編集を行わず「レシート・請求書の撮影/アップロード」だけを提供する。
// 読み取り・仕訳の確認はPCで行う。

import { useEffect, useRef, useState } from "react";
import {
  Camera,
  Upload,
  Loader2,
  Check,
  AlertTriangle,
  Monitor,
  FileText,
} from "lucide-react";
import { getClients } from "@/actions/clients";
import { uploadReceipt } from "@/actions/receipt-storage";
import { processReceiptOcr } from "@/actions/ocr";
import { cn } from "@/lib/utils";

type UploadItem = {
  id: string;
  name: string;
  status: "uploading" | "done" | "error";
  error?: string;
};

export function MobileCaptureScreen() {
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [clientId, setClientId] = useState("");
  const [direction, setDirection] = useState<"received" | "issued">("received");
  const [items, setItems] = useState<UploadItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [loadingClients, setLoadingClients] = useState(true);
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getClients()
      .then((cs) => {
        const list = (cs ?? []).map((c) => ({ id: c.id, name: c.name }));
        setClients(list);
        if (list.length) setClientId(list[0].id);
      })
      .catch(() => {})
      .finally(() => setLoadingClients(false));
  }, []);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (!clientId) {
      alert("クライアントを選択してください");
      return;
    }
    setBusy(true);
    for (const file of Array.from(files)) {
      const itemId = crypto.randomUUID();
      setItems((p) => [{ id: itemId, name: file.name, status: "uploading" }, ...p]);
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("client_id", clientId);
        fd.append("direction", direction);
        const res = await uploadReceipt(fd);
        if (file.type.startsWith("image/") || file.type === "application/pdf") {
          processReceiptOcr(res.id).catch(() => {});
        }
        setItems((p) => p.map((it) => (it.id === itemId ? { ...it, status: "done" } : it)));
      } catch (e) {
        setItems((p) =>
          p.map((it) =>
            it.id === itemId
              ? { ...it, status: "error", error: e instanceof Error ? e.message : "失敗" }
              : it
          )
        );
      }
    }
    setBusy(false);
  };

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <header className="sticky top-0 z-10 bg-charcoal text-cream px-4 py-3">
        <h1 className="text-base font-bold">Raqto会計</h1>
        <p className="text-sage text-[10px]">スマホでは撮影のみ対応</p>
      </header>

      <main className="flex-1 p-4 space-y-4 pb-24">
        <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
          <Monitor className="size-4 shrink-0 mt-0.5 text-primary" />
          <p>
            閲覧・仕訳・編集などはPCでご利用ください。スマホではレシート・請求書の撮影／アップロードのみ行えます。読み取り結果はPCで確認できます。
          </p>
        </div>

        {/* クライアント選択 */}
        <div>
          <label className="block text-xs font-bold text-muted-foreground mb-1">対象クライアント</label>
          {loadingClients ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="size-4 animate-spin" />
              読み込み中...
            </div>
          ) : clients.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">利用可能なクライアントがありません。</p>
          ) : (
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-border bg-card text-foreground text-sm"
            >
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
        </div>

        {/* 区分 */}
        <div>
          <label className="block text-xs font-bold text-muted-foreground mb-1">区分</label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setDirection("received")}
              className={cn(
                "px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors",
                direction === "received"
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground"
              )}
            >
              受領（経費・仕入）
            </button>
            <button
              onClick={() => setDirection("issued")}
              className={cn(
                "px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors",
                direction === "issued"
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground"
              )}
            >
              発行（自社の請求書）
            </button>
          </div>
        </div>

        {/* 撮影・アップロード */}
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
          className="hidden"
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,application/pdf"
          multiple
          onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
          className="hidden"
        />

        <div className="space-y-2 pt-1">
          <button
            onClick={() => cameraRef.current?.click()}
            disabled={busy || !clientId}
            className="w-full flex items-center justify-center gap-2 p-4 rounded-xl bg-primary text-primary-foreground font-bold text-base disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-5 animate-spin" /> : <Camera className="size-5" />}
            写真を撮る
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy || !clientId}
            className="w-full flex items-center justify-center gap-2 p-3 rounded-xl border border-primary/40 bg-primary/5 text-primary font-medium disabled:opacity-50"
          >
            <Upload className="size-4" />
            ファイルから選択（PDF可・複数可）
          </button>
        </div>

        {/* アップロード状況 */}
        {items.length > 0 && (
          <ul className="space-y-2 pt-2">
            {items.map((it) => (
              <li
                key={it.id}
                className={cn(
                  "flex items-center gap-3 p-2.5 rounded-lg border text-sm",
                  it.status === "done"
                    ? "border-emerald-500/30 bg-emerald-500/5"
                    : it.status === "error"
                    ? "border-destructive/30 bg-destructive/5"
                    : "border-primary/30 bg-primary/5"
                )}
              >
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 min-w-0 truncate">{it.name}</span>
                {it.status === "uploading" ? (
                  <Loader2 className="size-4 animate-spin text-primary shrink-0" />
                ) : it.status === "done" ? (
                  <Check className="size-4 text-emerald-600 shrink-0" />
                ) : (
                  <AlertTriangle className="size-4 text-destructive shrink-0" />
                )}
              </li>
            ))}
          </ul>
        )}
        {items.some((i) => i.status === "done") && (
          <p className="text-xs text-muted-foreground text-center pt-1">
            アップロード済みです。読み取り・仕訳の確認はPCの「証憑管理」で行えます。
          </p>
        )}
      </main>
    </div>
  );
}
