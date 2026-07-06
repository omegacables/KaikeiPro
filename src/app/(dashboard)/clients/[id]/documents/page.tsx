"use client";

import { useCallback, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  FileCheck,
  Receipt,
  FileText,
  FileSpreadsheet,
  ClipboardList,
  UploadCloud,
  Loader2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ReceiptsPageContent } from "../receipts/content";
import { InvoicesPageContent } from "../invoices/content";
import { uploadReceipt } from "@/actions/receipt-storage";
import { processReceiptOcr } from "@/actions/ocr";
import { runFullRaqtoSync, type RaqtoSyncResult } from "@/actions/raqto-sync";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

type DocumentTab = "issued" | "received" | "orders" | "statements";

const tabs: { key: DocumentTab; label: string; icon: typeof Receipt }[] = [
  { key: "issued", label: "領収書・請求書（発行）", icon: FileText },
  { key: "received", label: "領収書・請求書（受領）", icon: Receipt },
  { key: "orders", label: "受発注書類", icon: ClipboardList },
  { key: "statements", label: "明細書", icon: FileSpreadsheet },
];

// 受発注まわりの書類種別（発注書・受領書・見積書・納品書・契約書）は専用タブに集約する
const ORDER_DOC_TYPES = [
  "purchase_order",
  "goods_receipt",
  "estimate",
  "delivery_note",
  "contract",
] as const;

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "application/pdf"];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB（receipt-storage.ts と同一制限）

type UploadItem = {
  id: string;
  name: string;
  status: "pending" | "uploading" | "error";
  error?: string;
};

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-base font-bold text-foreground border-l-4 border-primary pl-3 mb-4 mt-2">
      {children}
    </h2>
  );
}

/**
 * 証憑ドラッグ&ドロップアップロードゾーン。
 * アップロード後はAI-OCRが自動で書類種別（領収書/請求書/受領書/発注書等）と
 * 発行/受領を判定し、該当タブに振り分けられる。
 */
function DocumentDropzone({ clientId, onUploaded }: { clientId: string; onUploaded: () => void }) {
  const [dragOver, setDragOver] = useState(false);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [summary, setSummary] = useState<{ done: number; failed: number } | null>(null);
  const [ocrError, setOcrError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // 連続ドロップの同時実行防止は state ではなく ref で判定する
  //（state はクロージャに古い値が残り、再レンダー前の2回目ドロップをすり抜けるため）
  const uploadingRef = useRef(false);

  const uploadFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0 || uploadingRef.current) return;
      uploadingRef.current = true;
      setSummary(null);
      setOcrError(null);

      const newItems: UploadItem[] = files.map((f) => ({
        id: crypto.randomUUID(),
        name: f.name,
        status: "pending",
      }));
      setItems((prev) => [...prev.filter((p) => p.status === "error"), ...newItems]);
      setUploading(true);

      let done = 0;
      let failed = 0;

      // 順次処理（並列実行はVercel Functionタイムアウト/レート制限の原因になるため避ける）
      for (let i = 0; i < files.length; i++) {
        let file = files[i];
        const item = newItems[i];

        // D&D経由では file.type が空になることがある（ネットワーク共有・メールクライアント等）。
        // その場合は拡張子からMIMEを補完する（サーバー側バリデーションは file.type を見るため）。
        if (!file.type) {
          const extMime: Record<string, string> = {
            pdf: "application/pdf",
            jpg: "image/jpeg",
            jpeg: "image/jpeg",
            png: "image/png",
          };
          const inferred = extMime[file.name.split(".").pop()?.toLowerCase() ?? ""];
          if (inferred) file = new File([file], file.name, { type: inferred });
        }

        if (!ACCEPTED_TYPES.includes(file.type)) {
          setItems((prev) =>
            prev.map((p) => (p.id === item.id ? { ...p, status: "error", error: "対応形式: JPG / PNG / PDF" } : p))
          );
          failed++;
          continue;
        }
        if (file.size > MAX_FILE_SIZE) {
          setItems((prev) =>
            prev.map((p) => (p.id === item.id ? { ...p, status: "error", error: "10MBを超えています" } : p))
          );
          failed++;
          continue;
        }

        setItems((prev) =>
          prev.map((p) => (p.id === item.id ? { ...p, status: "uploading" } : p))
        );

        try {
          const formData = new FormData();
          formData.append("file", file);
          formData.append("client_id", clientId);
          const result = await uploadReceipt(formData);

          // OCR・自動分類はバックグラウンド（await しない）。
          // 完了すると一覧の自動リフレッシュで該当タブに表示される。
          processReceiptOcr(result.id).catch((err) => {
            const msg = err instanceof Error ? err.message : "OCR処理に失敗しました";
            console.error("OCR/分類エラー:", msg);
            setOcrError(msg);
          });

          setItems((prev) => prev.filter((p) => p.id !== item.id));
          done++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : "アップロードに失敗しました";
          setItems((prev) =>
            prev.map((p) => (p.id === item.id ? { ...p, status: "error", error: msg } : p))
          );
          failed++;
        }
      }

      setSummary({ done, failed });
      uploadingRef.current = false;
      setUploading(false);
      if (done > 0) onUploaded();
    },
    [clientId, onUploaded]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      if (e.dataTransfer.files) uploadFiles(Array.from(e.dataTransfer.files));
    },
    [uploadFiles]
  );

  const errorItems = items.filter((i) => i.status === "error");
  const activeItems = items.filter((i) => i.status !== "error");

  return (
    <div className="mb-6">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          // 子要素への移動でも dragleave が発火するため、ゾーン外に出た時だけ解除する
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setDragOver(false);
          }
        }}
        onDrop={handleDrop}
        onClick={() => !uploading && inputRef.current?.click()}
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors cursor-pointer",
          dragOver
            ? "border-primary bg-primary/5"
            : "border-border bg-card hover:border-primary/40"
        )}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,application/pdf"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) uploadFiles(Array.from(e.target.files));
            e.target.value = "";
          }}
        />
        {uploading ? (
          <Loader2 className="size-8 text-primary animate-spin" />
        ) : (
          <UploadCloud className={cn("size-8", dragOver ? "text-primary" : "text-muted-foreground")} />
        )}
        <div className="text-sm font-bold text-foreground">
          証憑をドラッグ&ドロップ、またはクリックして選択
        </div>
        <p className="text-xs text-muted-foreground">
          領収書・請求書・受領書・発注書などをAIが自動判別して各タブに振り分けます（JPG / PNG / PDF、10MBまで・複数可）
        </p>
        {activeItems.length > 0 && (
          <div className="text-xs text-muted-foreground">
            アップロード中... 残り{activeItems.length}件
          </div>
        )}
      </div>

      {summary && (
        <div className="mt-2 text-xs text-muted-foreground">
          {summary.done > 0 && (
            <span>
              {summary.done}件をアップロードしました。読み取り・自動分類が完了すると該当タブに表示されます（処理中は「処理中」欄で確認できます）。
            </span>
          )}
          {summary.failed > 0 && (
            <span className="text-destructive ml-2">{summary.failed}件が失敗しました。</span>
          )}
        </div>
      )}

      {ocrError && (
        <div className="mt-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-1.5 text-xs text-destructive">
          読み取り・自動分類でエラーが発生しました: {ocrError}
          （該当の証憑は「処理中」または「アップロード済」のまま残ります。証憑一覧からOCRを再実行できます）
        </div>
      )}

      {errorItems.length > 0 && (
        <div className="mt-2 space-y-1">
          {errorItems.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-1.5 text-xs"
            >
              <span className="text-foreground truncate">
                {item.name}
                <span className="text-destructive ml-2">{item.error}</span>
              </span>
              <button
                onClick={() => setItems((prev) => prev.filter((p) => p.id !== item.id))}
                className="text-muted-foreground hover:text-foreground shrink-0 ml-2"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DocumentsPage() {
  const { id } = useParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState<DocumentTab>("issued");
  // アップロード完了時にインクリメントし、タブ内容を再マウントして一覧を再取得させる
  const [refreshKey, setRefreshKey] = useState(0);

  // Raqto受発注からの証憑取込
  const [raqtoSyncing, setRaqtoSyncing] = useState(false);
  const [raqtoResult, setRaqtoResult] = useState<RaqtoSyncResult | null>(null);

  const handleRaqtoSync = async () => {
    setRaqtoSyncing(true);
    setRaqtoResult(null);
    try {
      const result = await runFullRaqtoSync(id);
      setRaqtoResult(result);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setRaqtoResult({
        success: false,
        syncedAt: new Date().toISOString(),
        counts: { partners: 0, salesOrders: 0, purchaseOrders: 0, payments: 0, receipts: 0, documents: 0, statusUpdates: 0 },
        errors: [e instanceof Error ? e.message : "Raqto取込に失敗しました"],
      });
    } finally {
      setRaqtoSyncing(false);
    }
  };

  return (
    <>
      {/* Page Header */}
      <div className="flex items-center justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <FileCheck className="size-6 text-primary" />
            証憑管理
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            領収書・請求書を「発行（自社）／受領（取引先）」に分けて管理。発行タブから請求書を新規作成・発行できます。
          </p>
        </div>
        <Button variant="outline" onClick={handleRaqtoSync} disabled={raqtoSyncing} className="shrink-0">
          <RefreshCw className={cn("size-4 mr-1.5", raqtoSyncing && "animate-spin")} />
          {raqtoSyncing ? "取込中..." : "Raqtoから取込"}
        </Button>
      </div>

      {/* Raqto取込結果 */}
      {raqtoResult && (
        <div
          className={cn(
            "mb-4 rounded-lg border px-4 py-2.5 text-xs",
            raqtoResult.success
              ? "border-border bg-muted/10 text-muted-foreground"
              : "border-destructive/30 bg-destructive/5 text-destructive"
          )}
        >
          {raqtoResult.success && (
            <span>
              Raqto受発注から取込みました — 請求書(受注): {raqtoResult.counts.salesOrders}件 / 領収書: {raqtoResult.counts.receipts}件 / 証憑（発注書・納品書・契約書）: {raqtoResult.counts.documents}件 / ステータス更新: {raqtoResult.counts.statusUpdates}件
            </span>
          )}
          {raqtoResult.errors.map((err, i) => (
            <p key={i}>{err}</p>
          ))}
        </div>
      )}

      {/* ドラッグ&ドロップアップロード（AIが書類種別・発行/受領を自動判定） */}
      <DocumentDropzone clientId={id} onUploaded={() => setRefreshKey((k) => k + 1)} />

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-6 overflow-x-auto border-b border-border pb-px">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 text-sm font-bold transition-colors whitespace-nowrap border-b-2 -mb-px cursor-pointer",
              activeTab === tab.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <tab.icon className="size-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* ===== 発行（自社）: 請求書 + 領収書 ===== */}
      {activeTab === "issued" && (
        <div className="space-y-10">
          <section>
            <SectionHeading>請求書（発行）</SectionHeading>
            <InvoicesPageContent hideHeader lockedDirection="sales" />
          </section>
          <section>
            <SectionHeading>領収書（発行）</SectionHeading>
            {/* 処理中（発行/受領 未確定）の証憑はどちらのタブでも確認できるよう表示する */}
            <ReceiptsPageContent
              hideHeader
              lockedDirection="issued"
              excludeDocTypes={["statement", ...ORDER_DOC_TYPES]}
              refreshToken={refreshKey}
            />
          </section>
        </div>
      )}

      {/* ===== 受領（取引先）: 請求書 + 領収書 ===== */}
      {activeTab === "received" && (
        <div className="space-y-10">
          <section>
            <SectionHeading>請求書（受領）</SectionHeading>
            <InvoicesPageContent hideHeader lockedDirection="purchase" />
          </section>
          <section>
            <SectionHeading>領収書（受領）</SectionHeading>
            <ReceiptsPageContent
              hideHeader
              lockedDirection="received"
              excludeDocTypes={["statement", ...ORDER_DOC_TYPES]}
              refreshToken={refreshKey}
            />
          </section>
        </div>
      )}

      {/* ===== 受発注書類: 発注書・受領書・見積書・納品書・契約書 ===== */}
      {activeTab === "orders" && (
        <ReceiptsPageContent
          hideHeader
          onlyDocTypes={[...ORDER_DOC_TYPES]}
          refreshToken={refreshKey}
        />
      )}

      {/* ===== 明細書 ===== */}
      {activeTab === "statements" && (
        <ReceiptsPageContent
          hideHeader
          lockedDocType="statement"
          hideProcessingSection
          refreshToken={refreshKey}
        />
      )}
    </>
  );
}
