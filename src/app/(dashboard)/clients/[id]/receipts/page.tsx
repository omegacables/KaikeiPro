"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import {
  Receipt,
  Upload,
  Grid3X3,
  List,
  Search,
  CreditCard,
  Banknote,
  Smartphone,
  Eye,
  Clock,
  ScanLine,
  FileCheck,
  BookOpen,
  Loader2,
  X,
  Trash2,
  FileText,
  Pencil,
  Save,
  RefreshCw,
  Globe,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { useData } from "@/lib/use-data";
import { getReceipts, updateReceipt, deleteReceipt, deleteReceipts } from "@/actions/receipts";
import { getClient } from "@/actions/clients";
import { fiscalRangeFromStartYear } from "@/lib/fiscal";
import { getReceiptImageUrl } from "@/actions/receipt-storage";
import { processReceiptOcr, updateOcrResult } from "@/actions/ocr";
import { generateJournalSuggestion, approveJournalSuggestion } from "@/actions/ai-journal";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ReceiptStatus =
  | "uploaded"
  | "processing"
  | "ocr_done"
  | "reviewed"
  | "journalized";

type PaymentMethod = "cash" | "card" | "bank_transfer" | "e_money";

interface ReceiptItem {
  item_name: string;
  quantity: number;
  unit_price: number;
  tax_rate?: number;
  subtotal: number;
  tax_amount?: number;
}

interface ReceiptOcrRaw {
  source?: string;
  document_number?: string;
  subtotal?: number;
  tax_amount?: number;
  raqto_document_id?: string;
}

interface ReceiptData {
  id: string;
  vendor: string;
  date: string;
  amount: number;
  paymentMethod: PaymentMethod;
  status: ReceiptStatus;
  direction: "issued" | "received";
  category?: string;
  memo?: string;
  items: (ReceiptItem | string)[];
  ocrRaw?: ReceiptOcrRaw;
  imagePath?: string;
  mimeType?: string;
  aiSuggestion?: import("@/types/index").AiJournalSuggestion;
  needsReview: boolean;
  // 多通貨
  currency?: string;
  originalAmount?: number;
  exchangeRate?: number;
  amountJpy?: number;
  taxAmount?: number;
  taxExcluded?: number;
  taxRate?: number;
  invoiceNumber?: string;
  documentType?: "qualified_invoice" | "category_invoice" | "receipt" | "statement" | "delivery_note" | "estimate" | "contract" | "other";
  folderId?: string | null;
}


// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const statusConfig: Record<
  ReceiptStatus,
  { label: string; variant: "muted" | "success" | "warning" | "default" | "destructive" | "accent"; icon: React.ElementType; step: number }
> = {
  uploaded: { label: "アップロード済", variant: "muted", icon: Upload, step: 1 },
  processing: { label: "処理中", variant: "warning", icon: Clock, step: 2 },
  ocr_done: { label: "OCR完了", variant: "accent", icon: ScanLine, step: 3 },
  reviewed: { label: "確認待ち", variant: "default", icon: FileCheck, step: 4 },
  journalized: { label: "仕訳済", variant: "success", icon: BookOpen, step: 5 },
};

const paymentMethodConfig: Record<
  PaymentMethod,
  { label: string; icon: React.ElementType }
> = {
  cash: { label: "現金", icon: Banknote },
  card: { label: "クレジットカード", icon: CreditCard },
  bank_transfer: { label: "銀行振込", icon: CreditCard },
  e_money: { label: "電子マネー", icon: Smartphone },
};

const defaultPaymentConfig = { label: "不明", icon: Banknote };

type DocumentType = "qualified_invoice" | "category_invoice" | "receipt" | "statement" | "delivery_note" | "estimate" | "contract" | "other";

const documentTypeConfig: Record<DocumentType, { label: string; variant: "success" | "accent" | "muted" | "default" | "warning" }> = {
  qualified_invoice: { label: "適格請求書", variant: "success" },
  category_invoice: { label: "区分記載請求書", variant: "accent" },
  receipt: { label: "領収書", variant: "muted" },
  statement: { label: "明細書", variant: "default" },
  delivery_note: { label: "納品書", variant: "default" },
  estimate: { label: "見積書", variant: "warning" },
  contract: { label: "契約書", variant: "warning" },
  other: { label: "その他", variant: "muted" },
};


// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ReceiptsPageContent({ hideHeader = false, lockedDirection }: { hideHeader?: boolean; lockedDirection?: "received" | "issued" }) {
  const { id } = useParams<{ id: string }>();

  // Fetch real data
  const { data: dbReceipts, refetch } = useData(
    () =>
      getReceipts(id).then((recs) =>
        recs.map((r) => {
          const ocr = r.ocr_result as {
            source?: string;
            document_number?: string;
            vendor_name?: string;
            amount_total?: number;
            total_amount?: number;
            subtotal?: number;
            tax_amount?: number;
            amount_tax_excluded?: number;
            tax_rate?: number;
            date?: string;
            issued_date?: string;
            items?: ReceiptItem[] | string[];
            raqto_document_id?: string;
            invoice_number?: string;
            currency?: string;
            original_amount?: number;
            exchange_rate?: number;
            amount_jpy?: number;
          } | null;
          return {
            id: r.id,
            vendor: ocr?.vendor_name ?? "不明",
            date: ocr?.date ?? ocr?.issued_date ?? r.uploaded_at.split("T")[0],
            amount: ocr?.amount_total ?? ocr?.total_amount ?? 0,
            paymentMethod: (r.payment_method ?? "cash") as PaymentMethod,
            status: r.status as ReceiptStatus,
            direction: ((r as { direction?: "issued" | "received" }).direction ?? "received"),
            category: undefined as string | undefined,
            items: ocr?.items ?? [],
            ocrRaw: ocr ? {
              source: ocr.source,
              document_number: ocr.document_number,
              subtotal: ocr.subtotal,
              tax_amount: ocr.tax_amount,
              raqto_document_id: ocr.raqto_document_id,
            } : undefined,
            imagePath: r.image_path,
            mimeType: r.mime_type ?? undefined,
            aiSuggestion: r.ai_journal_suggestion as unknown as import("@/types/index").AiJournalSuggestion | undefined,
            currency: ocr?.currency,
            originalAmount: ocr?.original_amount,
            exchangeRate: ocr?.exchange_rate,
            amountJpy: ocr?.amount_jpy,
            taxAmount: ocr?.tax_amount,
            taxExcluded: ocr?.amount_tax_excluded,
            taxRate: ocr?.tax_rate,
            invoiceNumber: ocr?.invoice_number,
            needsReview: r.needs_review ?? false,
            documentType: (r as { document_type?: string }).document_type as "qualified_invoice" | "category_invoice" | "receipt" | "statement" | "delivery_note" | "estimate" | "contract" | "other" | undefined,
            folderId: (r as { folder_id?: string | null }).folder_id ?? null,
          };
        })
      ),
    null
  );

  // null = まだ取得前（ローディング中）
  const receiptsLoading = dbReceipts === null;
  const receipts: ReceiptData[] = dbReceipts ?? [];

  // Detail / status change / delete
  const [selectedReceipt, setSelectedReceipt] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleToggleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((r) => r.id)));
    }
  };

  const handleBulkDelete = async () => {
    const count = selectedIds.size;
    if (count === 0) return;
    if (!confirm(`${count}件の領収書を削除しますか？紐づく仕訳も削除されます。`)) return;
    setBulkDeleting(true);
    try {
      await deleteReceipts([...selectedIds]);
      setSelectedIds(new Set());
      if (selectedReceipt && selectedIds.has(selectedReceipt)) setSelectedReceipt(null);
      refetch();
    } catch (e) {
      alert(e instanceof Error ? e.message : "削除に失敗しました");
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleDelete = async (receiptId: string) => {
    if (!confirm("この領収書を削除しますか？")) return;
    setDeletingId(receiptId);
    try {
      await deleteReceipt(receiptId);
      if (selectedReceipt === receiptId) setSelectedReceipt(null);
      refetch();
    } catch (e) {
      alert(e instanceof Error ? e.message : "削除に失敗しました");
    } finally {
      setDeletingId(null);
    }
  };

  const handleStatusChange = async (receiptId: string, newStatus: ReceiptStatus) => {
    setUpdatingStatus(true);
    try {
      await updateReceipt(receiptId, { status: newStatus });
      refetch();
      setSelectedReceipt(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "ステータス更新に失敗しました");
    } finally {
      setUpdatingStatus(false);
    }
  };

  const [updatingDirection, setUpdatingDirection] = useState(false);
  const handleDirectionChange = async (receiptId: string, dir: "received" | "issued") => {
    setUpdatingDirection(true);
    try {
      await updateReceipt(receiptId, { direction: dir });
      refetch();
    } catch (e) {
      alert(e instanceof Error ? e.message : "区分の更新に失敗しました");
    } finally {
      setUpdatingDirection(false);
    }
  };

  const [runningOcr, setRunningOcr] = useState(false);
  const handleRunOcr = async (receiptId: string) => {
    setRunningOcr(true);
    try {
      await processReceiptOcr(receiptId);
      refetch();
    } catch (e) {
      alert(e instanceof Error ? e.message : "OCR処理に失敗しました");
    } finally {
      setRunningOcr(false);
    }
  };

  const [generatingSuggestion, setGeneratingSuggestion] = useState(false);
  const handleGenerateSuggestion = async (receiptId: string) => {
    setGeneratingSuggestion(true);
    try {
      await generateJournalSuggestion(receiptId);
      refetch();
    } catch (e) {
      alert(e instanceof Error ? e.message : "仕訳提案の生成に失敗しました");
    } finally {
      setGeneratingSuggestion(false);
    }
  };

  const [approvingSuggestion, setApprovingSuggestion] = useState(false);
  const handleApproveSuggestion = async (receiptId: string) => {
    setApprovingSuggestion(true);
    try {
      await approveJournalSuggestion(receiptId);
      refetch();
      setSelectedReceipt(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "仕訳の作成に失敗しました");
    } finally {
      setApprovingSuggestion(false);
    }
  };

  const selectedData = selectedReceipt ? receipts.find((r) => r.id === selectedReceipt) : null;

  // OCR結果編集モード
  const [editingOcr, setEditingOcr] = useState(false);
  const [editForm, setEditForm] = useState({
    vendor_name: "",
    date: "",
    amount_total: 0,
    tax_amount: 0,
    tax_rate: 0,
    exchange_rate: 0,
    original_amount: 0,
    currency: "JPY",
    invoice_number: "",
  });
  const [savingOcr, setSavingOcr] = useState(false);

  const startEditOcr = () => {
    if (!selectedData) return;
    setEditForm({
      vendor_name: selectedData.vendor ?? "",
      date: selectedData.date ?? "",
      amount_total: selectedData.amount ?? 0,
      tax_amount: selectedData.taxAmount ?? 0,
      tax_rate: selectedData.taxRate ? selectedData.taxRate * 100 : 0,
      exchange_rate: selectedData.exchangeRate ?? 0,
      original_amount: selectedData.originalAmount ?? selectedData.amount ?? 0,
      currency: selectedData.currency ?? "JPY",
      invoice_number: selectedData.invoiceNumber ?? "",
    });
    setEditingOcr(true);
  };

  const handleSaveOcr = async () => {
    if (!selectedData) return;
    setSavingOcr(true);
    try {
      const isForex = editForm.currency !== "JPY";
      await updateOcrResult(selectedData.id, {
        vendor_name: editForm.vendor_name,
        date: editForm.date,
        amount_total: isForex && editForm.exchange_rate > 0
          ? Math.round(editForm.original_amount * editForm.exchange_rate)
          : editForm.amount_total,
        tax_amount: editForm.tax_amount || undefined,
        tax_rate: editForm.tax_rate ? editForm.tax_rate / 100 : undefined,
        currency: editForm.currency,
        original_amount: isForex ? editForm.original_amount : undefined,
        exchange_rate: isForex ? editForm.exchange_rate : undefined,
        amount_jpy: isForex && editForm.exchange_rate > 0
          ? Math.round(editForm.original_amount * editForm.exchange_rate)
          : editForm.amount_total,
        invoice_number: editForm.invoice_number || undefined,
      });
      setEditingOcr(false);
      refetch();
    } catch (e) {
      alert(e instanceof Error ? e.message : "OCR結果の保存に失敗しました");
    } finally {
      setSavingOcr(false);
    }
  };

  // 編集モードを閉じる
  useEffect(() => {
    setEditingOcr(false);
  }, [selectedReceipt]);

  const [documentTypeFilter, setDocumentTypeFilter] = useState<DocumentType | "all">("all");
  const [directionFilter, setDirectionFilter] = useState<"all" | "received" | "issued">("all");
  const [receiptFiscalStartMonth, setReceiptFiscalStartMonth] = useState(4);
  useEffect(() => {
    getClient(id)
      .then((c) => setReceiptFiscalStartMonth((c as { fiscal_year_start_month?: number }).fiscal_year_start_month ?? 4))
      .catch(() => {});
  }, [id]);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const [periodMode, setPeriodMode] = useState<"none" | "year" | "month">("none");
  const [fiscalYear, setFiscalYear] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  // 画像URL管理（詳細パネル用）
  const [detailImageUrl, setDetailImageUrl] = useState<string | null>(null);
  const [loadingImage, setLoadingImage] = useState(false);

  // 詳細パネルを開いた時に画像URLを取得
  useEffect(() => {
    if (!selectedData?.imagePath) {
      setDetailImageUrl(null);
      return;
    }
    setLoadingImage(true);
    getReceiptImageUrl(selectedData.imagePath)
      .then((url) => setDetailImageUrl(url))
      .catch(() => setDetailImageUrl(null))
      .finally(() => setLoadingImage(false));
  }, [selectedData?.id, selectedData?.imagePath]);

  // 書類種別ごとの件数（フォルダ・方向フィルター適用前の全件から集計）
  const docTypeCounts = receipts.reduce<Record<string, number>>((acc, r) => {
    const key = r.documentType ?? "unknown";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  // Filtered
  const effectiveDirection = lockedDirection ?? directionFilter;
  const filtered = receipts.filter((r) => {
    if (effectiveDirection !== "all" && r.direction !== effectiveDirection) return false;
    // 書類種別フィルター
    if (documentTypeFilter !== "all") {
      if (r.documentType !== documentTypeFilter) return false;
    }
    // 日付範囲フィルター
    if (dateFrom && r.date < dateFrom) return false;
    if (dateTo && r.date > dateTo) return false;
    // テキスト検索（取引先、会社名、支払い方法、金額、メモ等）
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const paymentLabel = (paymentMethodConfig[r.paymentMethod]?.label ?? "").toLowerCase();
      if (
        !r.vendor.toLowerCase().includes(q) &&
        !r.id.toLowerCase().includes(q) &&
        !r.date.includes(q) &&
        !String(r.amount).includes(q) &&
        !paymentLabel.includes(q) &&
        !r.paymentMethod.toLowerCase().includes(q) &&
        !(r.invoiceNumber || "").toLowerCase().includes(q) &&
        !(r.category || "").toLowerCase().includes(q) &&
        !(r.memo || "").toLowerCase().includes(q)
      )
        return false;
    }
    return true;
  });

  return (
    <>
      {/* Page Header */}
      {!hideHeader && (
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Receipt className="size-6 text-primary" />
              領収書管理
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              クライアントID: {id}
            </p>
          </div>
        </div>
      )}

      <div>

      {/* Document Type Filter Tabs */}
      <div className="flex gap-1.5 mb-4 flex-wrap">
        {/* すべて */}
        <button
          onClick={() => setDocumentTypeFilter("all")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all",
            documentTypeFilter === "all"
              ? "bg-primary text-cream border-primary"
              : "bg-card text-muted-foreground border-border hover:border-primary/40 hover:text-foreground"
          )}
        >
          すべて
          <span className={cn(
            "rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none",
            documentTypeFilter === "all" ? "bg-white/20 text-cream" : "bg-muted/40 text-muted-foreground"
          )}>
            {receipts.length}
          </span>
        </button>
        {/* 各書類種別（1件以上ある場合のみ表示） */}
        {(Object.entries(documentTypeConfig) as [DocumentType, typeof documentTypeConfig[DocumentType]][]).map(([type, cfg]) => {
          const count = docTypeCounts[type] ?? 0;
          if (count === 0) return null;
          const isActive = documentTypeFilter === type;
          return (
            <button
              key={type}
              onClick={() => setDocumentTypeFilter(type)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all",
                isActive
                  ? "bg-primary text-cream border-primary"
                  : "bg-card text-muted-foreground border-border hover:border-primary/40 hover:text-foreground"
              )}
            >
              {cfg.label}
              <span className={cn(
                "rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none",
                isActive ? "bg-white/20 text-cream" : "bg-muted/40 text-muted-foreground"
              )}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Filter Bar */}
      <div className="flex items-center justify-between mb-4 gap-4">
        {/* 発行/受領フィルター（区分固定時は非表示） */}
        {!lockedDirection && (
        <div className="inline-flex gap-1 bg-muted/20 p-1 rounded-lg shrink-0">
          {([["all", "すべて"], ["received", "受領"], ["issued", "発行"]] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setDirectionFilter(key)}
              className={cn(
                "px-2.5 py-1 rounded-md text-xs font-bold transition-colors whitespace-nowrap",
                directionFilter === key ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>
        )}

        {/* Period filter + search + view toggle */}
        <div className="flex items-center gap-2">
          <select
            value={periodMode === "year" ? fiscalYear : ""}
            onChange={(e) => {
              const v = e.target.value;
              setFiscalYear(v);
              if (!v) { setPeriodMode("none"); setDateFrom(""); setDateTo(""); return; }
              const fy = parseInt(v);
              const { startDate, endDate } = fiscalRangeFromStartYear(receiptFiscalStartMonth, fy);
              setDateFrom(startDate);
              setDateTo(endDate);
              setPeriodMode("year");
            }}
            className="px-2 py-1.5 rounded-lg border border-border bg-card text-foreground text-xs"
          >
            <option value="">年度</option>
            {Array.from({ length: 5 }, (_, i) => {
              const y = new Date().getFullYear() - i;
              return <option key={y} value={y}>{y}年度</option>;
            })}
          </select>
          <input
            type="month"
            value={periodMode === "year" ? "" : (dateFrom ? dateFrom.slice(0, 7) : "")}
            onChange={(e) => {
              if (!e.target.value) { setPeriodMode("none"); setDateFrom(""); setDateTo(""); return; }
              const [y, m] = e.target.value.split("-").map(Number);
              const ld = new Date(y, m, 0).getDate();
              setDateFrom(`${y}-${String(m).padStart(2, "0")}-01`);
              setDateTo(`${y}-${String(m).padStart(2, "0")}-${String(ld).padStart(2, "0")}`);
              setPeriodMode("month");
            }}
            className="px-2 py-1.5 rounded-lg border border-border bg-card text-foreground text-xs"
          />
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="取引先・支払方法で検索..."
              className="pl-9 pr-3 py-1.5 rounded-lg border border-border bg-card text-foreground text-sm placeholder:text-muted-foreground w-56"
            />
          </div>
          <div className="flex items-center border border-border rounded-lg overflow-hidden">
            <button
              onClick={() => setViewMode("grid")}
              className={cn(
                "p-2 transition-colors cursor-pointer",
                viewMode === "grid"
                  ? "bg-primary text-cream"
                  : "text-muted-foreground hover:bg-muted/30"
              )}
            >
              <Grid3X3 className="size-4" />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={cn(
                "p-2 transition-colors cursor-pointer",
                viewMode === "list"
                  ? "bg-primary text-cream"
                  : "text-muted-foreground hover:bg-muted/30"
              )}
            >
              <List className="size-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Bulk action bar */}
      <div className="flex items-center gap-3 mb-4">
        <input
          type="checkbox"
          checked={filtered.length > 0 && selectedIds.size === filtered.length}
          onChange={handleToggleSelectAll}
          className="size-4 cursor-pointer"
        />
        <span className="text-xs text-muted-foreground">
          {selectedIds.size > 0 ? `${selectedIds.size}件選択中` : "全選択"}
        </span>
        {selectedIds.size > 0 && (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={handleBulkDelete}
              disabled={bulkDeleting}
              className="text-destructive border-destructive/30 hover:bg-destructive/10"
            >
              {bulkDeleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
              まとめて削除
            </Button>
            <button onClick={() => setSelectedIds(new Set())} className="text-xs text-primary hover:underline">
              選択解除
            </button>
          </>
        )}
      </div>

      {/* Receipt Cards / List */}
      {receiptsLoading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card p-12 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          <span className="text-sm">読み込み中...</span>
        </div>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-muted-foreground">条件に一致する領収書がありません</p>
        </Card>
      ) : viewMode === "grid" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((receipt) => {
            const sCfg = statusConfig[receipt.status];
            const pCfg = paymentMethodConfig[receipt.paymentMethod] ?? defaultPaymentConfig;
            const SIcon = sCfg.icon;
            const PIcon = pCfg.icon;

            return (
              <Card
                key={receipt.id}
                className="overflow-hidden hover:shadow-md transition-all hover:border-primary/30 cursor-pointer group"
                onClick={() => setSelectedReceipt(receipt.id)}
              >
                {/* Thumbnail with document info */}
                <div className="aspect-[4/3] bg-muted/20 flex flex-col items-center justify-center border-b border-border relative p-4">
                  <div className="absolute top-2 left-2 z-10 flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selectedIds.has(receipt.id)} onChange={() => handleToggleSelect(receipt.id)} className="size-4 cursor-pointer" />
                    {receipt.documentType && documentTypeConfig[receipt.documentType] && (
                      <Badge variant={documentTypeConfig[receipt.documentType].variant} className="text-[9px] px-1 py-0">
                        {documentTypeConfig[receipt.documentType].label}
                      </Badge>
                    )}
                  </div>
                  {receipt.ocrRaw?.source === "raqto" ? (
                    <>
                      <FileText className="size-8 text-primary/40 mb-1" />
                      {receipt.ocrRaw.document_number && (
                        <span className="text-xs font-mono text-muted-foreground">{receipt.ocrRaw.document_number}</span>
                      )}
                      <span className="text-sm font-bold text-foreground mt-1 truncate max-w-full">{receipt.vendor}</span>
                      <span className="text-lg font-bold font-mono text-primary mt-0.5">{formatCurrency(receipt.amount)}</span>
                    </>
                  ) : (
                    <>
                      <Receipt className="size-8 text-muted-foreground/30 mb-1" />
                      <span className="text-sm font-bold text-foreground mt-1 truncate max-w-full">{receipt.vendor}</span>
                      {receipt.amount > 0 && (
                        <span className="text-lg font-bold font-mono text-primary mt-0.5">{formatCurrency(receipt.amount)}</span>
                      )}
                    </>
                  )}
                  <div className="absolute top-2 right-2">
                    <Badge variant={sCfg.variant} className="text-[10px]">
                      <SIcon className="size-3 mr-1" />
                      {sCfg.label}
                    </Badge>
                  </div>
                </div>

                <CardContent className="pt-3 pb-4">
                  <Badge variant={receipt.direction === "issued" ? "accent" : "muted"} className="text-[10px] mb-1">
                    {receipt.direction === "issued" ? "発行" : "受領"}
                  </Badge>
                  <h4 className="text-sm font-bold text-foreground truncate">
                    {receipt.vendor}
                  </h4>
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatDate(receipt.date)}
                  </p>
                  <p className="text-lg font-bold font-mono text-foreground mt-2">
                    {formatCurrency(receipt.amount)}
                  </p>
                  <div className="flex items-center justify-between mt-3">
                    <Badge variant="muted" className="text-[10px]">
                      <PIcon className="size-3 mr-1" />
                      {pCfg.label}
                    </Badge>
                    {receipt.category && (
                      <span className="text-[10px] text-muted-foreground">
                        {receipt.category}
                      </span>
                    )}
                  </div>
                  {receipt.memo && (
                    <p className="text-[10px] text-muted-foreground mt-2 truncate">
                      {receipt.memo}
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        /* List view */
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/20 border-b border-border">
                  <th className="px-2 py-3 w-[40px]" />
                  <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    ID
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    取引先
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    日付
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    金額
                  </th>
                  <th className="text-center px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    支払方法
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    書類種別
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    科目
                  </th>
                  <th className="text-center px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    ステータス
                  </th>
                  <th className="w-8 px-2 py-3" />
                  <th className="w-8 px-2 py-3" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((receipt) => {
                  const sCfg = statusConfig[receipt.status];
                  const pCfg = paymentMethodConfig[receipt.paymentMethod] ?? defaultPaymentConfig;
                  const SIcon = sCfg.icon;
                  const PIcon = pCfg.icon;

                  return (
                    <tr
                      key={receipt.id}
                      className="border-b border-border last:border-0 hover:bg-muted/10 transition-colors cursor-pointer"
                      onClick={() => setSelectedReceipt(receipt.id)}
                    >
                      <td className="px-2 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selectedIds.has(receipt.id)} onChange={() => handleToggleSelect(receipt.id)} className="size-4 cursor-pointer" />
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {receipt.id}
                      </td>
                      <td className="px-4 py-3 font-medium text-foreground">
                        {receipt.vendor}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {formatDate(receipt.date)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold">
                        {formatCurrency(receipt.amount)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge variant="muted" className="text-[10px]">
                          <PIcon className="size-3 mr-1" />
                          {pCfg.label}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        {receipt.documentType && documentTypeConfig[receipt.documentType] ? (
                          <Badge variant={documentTypeConfig[receipt.documentType].variant} className="text-[10px]">
                            {documentTypeConfig[receipt.documentType].label}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {receipt.category || "-"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge variant={sCfg.variant}>
                          <SIcon className="size-3 mr-1" />
                          {sCfg.label}
                        </Badge>
                      </td>
                      <td className="px-2 py-3">
                        <Eye className="size-4 text-muted-foreground" />
                      </td>
                      <td className="px-2 py-3">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(receipt.id); }}
                          disabled={deletingId === receipt.id}
                          className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                        >
                          {deletingId === receipt.id ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Summary */}
      <div className="mt-4 flex justify-between items-center text-xs text-muted-foreground">
        <span>{filtered.length}件の領収書を表示</span>
        <span>
          合計金額:{" "}
          <span className="font-mono font-bold text-foreground">
            {formatCurrency(filtered.reduce((s, r) => s + r.amount, 0))}
          </span>
        </span>
      </div>

      </div>

      {/* Detail Panel (slide-over) */}
      {selectedData && (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setSelectedReceipt(null)}
          />
          {/* Panel */}
          <div className="relative w-full max-w-md bg-card border-l border-border shadow-xl overflow-y-auto">
            {/* Header */}
            <div className="sticky top-0 bg-card border-b border-border px-6 py-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-foreground">領収書詳細</h3>
              <button
                onClick={() => setSelectedReceipt(null)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="px-6 py-6 space-y-6">
              {/* Receipt image */}
              {selectedData.imagePath && !selectedData.imagePath.startsWith("receipts/") && (
                <div className="rounded-lg border border-border overflow-hidden bg-muted/10">
                  {loadingImage ? (
                    <div className="h-48 flex items-center justify-center">
                      <Loader2 className="size-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : detailImageUrl ? (
                    selectedData.mimeType === "application/pdf" || selectedData.imagePath?.endsWith(".pdf") ? (
                      <iframe
                        src={detailImageUrl}
                        title="領収書PDF"
                        className="w-full h-96 border-0"
                      />
                    ) : (
                      <img
                        src={detailImageUrl}
                        alt="領収書画像"
                        className="w-full max-h-72 object-contain"
                      />
                    )
                  ) : (
                    <div className="h-32 flex items-center justify-center">
                      <Receipt className="size-8 text-muted-foreground/30" />
                    </div>
                  )}
                </div>
              )}

              {/* Status badge */}
              {(() => {
                const sCfg = statusConfig[selectedData.status];
                const SIcon = sCfg.icon;
                return (
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={sCfg.variant} className="text-sm px-3 py-1">
                      <SIcon className="size-4 mr-1.5" />
                      {sCfg.label}
                    </Badge>
                    {selectedData.documentType && documentTypeConfig[selectedData.documentType] && (
                      <Badge variant={documentTypeConfig[selectedData.documentType].variant} className="text-sm px-3 py-1">
                        {documentTypeConfig[selectedData.documentType].label}
                      </Badge>
                    )}
                  </div>
                );
              })()}

              {/* 発行/受領 区分（AI判定・手動修正可） */}
              <div>
                <label className="text-xs text-muted-foreground block mb-1">区分（AI判定・修正可）</label>
                <div className="inline-flex gap-1 bg-muted/20 p-1 rounded-lg">
                  {([["received", "受領"], ["issued", "発行"]] as const).map(([dir, label]) => (
                    <button
                      key={dir}
                      onClick={() => handleDirectionChange(selectedData.id, dir)}
                      disabled={updatingDirection}
                      className={cn(
                        "px-3 py-1.5 rounded-md text-xs font-bold transition-all",
                        selectedData.direction === dir ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Details — 表示モード / 編集モード */}
              {editingOcr ? (
                <div className="space-y-3 bg-muted/10 rounded-lg p-4 border border-primary/20">
                  <div className="flex items-center justify-between mb-1">
                    <h4 className="text-sm font-bold text-primary flex items-center gap-1"><Pencil className="size-3.5" /> OCR結果を編集</h4>
                    <button onClick={() => setEditingOcr(false)} className="text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">取引先</label>
                    <input
                      className="w-full mt-0.5 px-2 py-1.5 text-sm border border-border rounded bg-background"
                      value={editForm.vendor_name}
                      onChange={(e) => setEditForm((f) => ({ ...f, vendor_name: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">日付</label>
                    <input
                      type="date"
                      className="w-full mt-0.5 px-2 py-1.5 text-sm border border-border rounded bg-background"
                      value={editForm.date}
                      onChange={(e) => setEditForm((f) => ({ ...f, date: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">通貨</label>
                    <select
                      className="w-full mt-0.5 px-2 py-1.5 text-sm border border-border rounded bg-background"
                      value={editForm.currency}
                      onChange={(e) => setEditForm((f) => ({ ...f, currency: e.target.value }))}
                    >
                      <option value="JPY">JPY（日本円）</option>
                      <option value="USD">USD（米ドル）</option>
                      <option value="EUR">EUR（ユーロ）</option>
                      <option value="GBP">GBP（英ポンド）</option>
                      <option value="CNY">CNY（人民元）</option>
                      <option value="KRW">KRW（韓国ウォン）</option>
                      <option value="TWD">TWD（台湾ドル）</option>
                      <option value="AUD">AUD（豪ドル）</option>
                      <option value="CAD">CAD（カナダドル）</option>
                      <option value="SGD">SGD（シンガポールドル）</option>
                      <option value="THB">THB（タイバーツ）</option>
                    </select>
                  </div>
                  {editForm.currency !== "JPY" ? (
                    <>
                      <div>
                        <label className="text-xs text-muted-foreground">原通貨金額</label>
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className="text-xs text-muted-foreground font-mono">{editForm.currency}</span>
                          <input
                            type="number"
                            step="0.01"
                            className="flex-1 px-2 py-1.5 text-sm border border-border rounded bg-background font-mono"
                            value={editForm.original_amount || ""}
                            onChange={(e) => setEditForm((f) => ({ ...f, original_amount: parseFloat(e.target.value) || 0 }))}
                          />
                        </div>
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">為替レート（1 {editForm.currency} = ? JPY）</label>
                        <input
                          type="number"
                          step="0.01"
                          className="w-full mt-0.5 px-2 py-1.5 text-sm border border-border rounded bg-background font-mono"
                          value={editForm.exchange_rate || ""}
                          onChange={(e) => setEditForm((f) => ({ ...f, exchange_rate: parseFloat(e.target.value) || 0 }))}
                        />
                      </div>
                      <div className="bg-primary/5 rounded p-2">
                        <span className="text-xs text-muted-foreground">円換算額</span>
                        <p className="text-lg font-bold font-mono text-primary">
                          ¥{editForm.exchange_rate > 0
                            ? Math.round(editForm.original_amount * editForm.exchange_rate).toLocaleString()
                            : "—"}
                        </p>
                      </div>
                    </>
                  ) : (
                    <div>
                      <label className="text-xs text-muted-foreground">合計金額（税込）</label>
                      <input
                        type="number"
                        className="w-full mt-0.5 px-2 py-1.5 text-sm border border-border rounded bg-background font-mono"
                        value={editForm.amount_total || ""}
                        onChange={(e) => setEditForm((f) => ({ ...f, amount_total: parseInt(e.target.value) || 0 }))}
                      />
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-muted-foreground">税額</label>
                      <input
                        type="number"
                        className="w-full mt-0.5 px-2 py-1.5 text-sm border border-border rounded bg-background font-mono"
                        value={editForm.tax_amount || ""}
                        onChange={(e) => setEditForm((f) => ({ ...f, tax_amount: parseInt(e.target.value) || 0 }))}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">税率 (%)</label>
                      <input
                        type="number"
                        step="0.1"
                        className="w-full mt-0.5 px-2 py-1.5 text-sm border border-border rounded bg-background font-mono"
                        value={editForm.tax_rate || ""}
                        onChange={(e) => setEditForm((f) => ({ ...f, tax_rate: parseFloat(e.target.value) || 0 }))}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">インボイス番号</label>
                    <input
                      className="w-full mt-0.5 px-2 py-1.5 text-sm border border-border rounded bg-background font-mono"
                      placeholder="T1234567890123"
                      value={editForm.invoice_number}
                      onChange={(e) => setEditForm((f) => ({ ...f, invoice_number: e.target.value }))}
                    />
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button className="flex-1" onClick={handleSaveOcr} disabled={savingOcr}>
                      {savingOcr ? <Loader2 className="size-4 mr-1 animate-spin" /> : <Save className="size-4 mr-1" />}
                      保存
                    </Button>
                    <Button variant="ghost" onClick={() => setEditingOcr(false)}>キャンセル</Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">ID</span>
                    {selectedData.status !== "journalized" && selectedData.ocrRaw?.source !== "raqto" && (
                      <button onClick={startEditOcr} className="text-xs text-primary hover:underline flex items-center gap-0.5">
                        <Pencil className="size-3" /> 編集
                      </button>
                    )}
                  </div>
                  <p className="font-mono text-sm text-foreground -mt-2">{selectedData.id}</p>
                  <div>
                    <span className="text-xs text-muted-foreground">取引先</span>
                    <p className="text-sm font-medium text-foreground">{selectedData.vendor}</p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">日付</span>
                    <p className="text-sm text-foreground">{formatDate(selectedData.date)}</p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">金額</span>
                    <p className="text-xl font-bold font-mono text-foreground">
                      {formatCurrency(selectedData.amount)}
                    </p>
                    {/* 外貨の場合、原通貨情報を表示 */}
                    {selectedData.currency && selectedData.currency !== "JPY" && selectedData.originalAmount && (
                      <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Globe className="size-3" />
                        <span className="font-mono">
                          {selectedData.currency} {selectedData.originalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </span>
                        {selectedData.exchangeRate && (
                          <span>@ {selectedData.exchangeRate}</span>
                        )}
                      </div>
                    )}
                  </div>
                  {selectedData.taxAmount != null && selectedData.taxAmount > 0 && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-xs text-muted-foreground">税額</span>
                        <p className="text-sm font-mono text-foreground">{formatCurrency(selectedData.taxAmount)}</p>
                      </div>
                      {selectedData.taxRate != null && (
                        <div>
                          <span className="text-xs text-muted-foreground">税率</span>
                          <p className="text-sm font-mono text-foreground">{(selectedData.taxRate * 100).toFixed(1)}%</p>
                        </div>
                      )}
                    </div>
                  )}
                  {selectedData.invoiceNumber && (
                    <div>
                      <span className="text-xs text-muted-foreground">インボイス番号</span>
                      <p className="text-sm font-mono text-foreground">{selectedData.invoiceNumber}</p>
                    </div>
                  )}
                  <div>
                    <span className="text-xs text-muted-foreground">支払方法</span>
                    <p className="text-sm text-foreground">
                      {(paymentMethodConfig[selectedData.paymentMethod] ?? defaultPaymentConfig).label}
                    </p>
                  </div>
                  {selectedData.category && (
                    <div>
                      <span className="text-xs text-muted-foreground">勘定科目</span>
                      <p className="text-sm text-foreground">{selectedData.category}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Document preview (Raqto source info) */}
              {selectedData.ocrRaw?.source === "raqto" && (
                <div className="border-t border-border pt-4">
                  <h4 className="text-sm font-bold text-foreground mb-3">書類情報</h4>
                  <div className="bg-muted/10 rounded-lg p-4 space-y-2">
                    {selectedData.ocrRaw.document_number && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">書類番号</span>
                        <span className="font-mono text-foreground">{selectedData.ocrRaw.document_number}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">ソース</span>
                      <Badge variant="accent" className="text-[10px]">Raqto受発注</Badge>
                    </div>
                    {selectedData.ocrRaw.subtotal != null && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">小計</span>
                        <span className="font-mono text-foreground">{formatCurrency(selectedData.ocrRaw.subtotal)}</span>
                      </div>
                    )}
                    {selectedData.ocrRaw.tax_amount != null && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">消費税</span>
                        <span className="font-mono text-foreground">{formatCurrency(selectedData.ocrRaw.tax_amount)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm border-t border-border pt-2">
                      <span className="text-muted-foreground font-bold">合計</span>
                      <span className="font-mono font-bold text-foreground">{formatCurrency(selectedData.amount)}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Line items */}
              {selectedData.items.length > 0 && (
                <div className="border-t border-border pt-4">
                  <h4 className="text-sm font-bold text-foreground mb-3">品目明細</h4>
                  {typeof selectedData.items[0] === "string" ? (
                    /* OCR結果の品目リスト（文字列配列） */
                    <div className="space-y-1">
                      {(selectedData.items as string[]).map((item, idx) => (
                        <div key={idx} className="flex items-start gap-2 text-sm">
                          <span className="text-muted-foreground">•</span>
                          <span className="text-foreground">{item}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    /* Raqto連携の品目構造体 */
                    <div className="overflow-x-auto rounded-lg border border-border">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-muted/20 border-b border-border">
                            <th className="text-left px-3 py-2 font-bold text-muted-foreground">品名</th>
                            <th className="text-right px-3 py-2 font-bold text-muted-foreground">数量</th>
                            <th className="text-right px-3 py-2 font-bold text-muted-foreground">単価</th>
                            <th className="text-right px-3 py-2 font-bold text-muted-foreground">小計</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(selectedData.items as ReceiptItem[]).map((item, idx) => (
                            <tr key={idx} className="border-b border-border last:border-0">
                              <td className="px-3 py-2 text-foreground">{item.item_name}</td>
                              <td className="px-3 py-2 text-right font-mono text-muted-foreground">{item.quantity}</td>
                              <td className="px-3 py-2 text-right font-mono text-muted-foreground">{formatCurrency(item.unit_price)}</td>
                              <td className="px-3 py-2 text-right font-mono font-bold">{formatCurrency(item.subtotal)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* OCR actions */}
              {selectedData.imagePath && !selectedData.imagePath.startsWith("receipts/") && !selectedData.imagePath.startsWith("raqto://") && (
                <div className="border-t border-border pt-4">
                  <h4 className="text-sm font-bold text-foreground mb-3">AI OCR</h4>
                  <div className="space-y-2">
                    {(selectedData.status === "uploaded" || selectedData.status === "processing") && (
                      <Button
                        className="w-full justify-start"
                        onClick={() => handleRunOcr(selectedData.id)}
                        disabled={runningOcr}
                      >
                        {runningOcr ? <Loader2 className="size-4 mr-2 animate-spin" /> : <ScanLine className="size-4 mr-2" />}
                        {runningOcr ? "OCR処理中..." : "OCR実行"}
                      </Button>
                    )}
                    {(selectedData.status === "ocr_done" || selectedData.status === "reviewed") && (
                      <Button
                        className="w-full justify-start"
                        variant="ghost"
                        onClick={() => handleRunOcr(selectedData.id)}
                        disabled={runningOcr}
                      >
                        {runningOcr ? <Loader2 className="size-4 mr-2 animate-spin" /> : <ScanLine className="size-4 mr-2" />}
                        再OCR実行
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {/* AI Journal Suggestion */}
              {(selectedData.status === "ocr_done" || selectedData.status === "reviewed" || selectedData.aiSuggestion) && (
                <div className="border-t border-border pt-4">
                  <h4 className="text-sm font-bold text-foreground mb-3">AI仕訳提案</h4>
                  {selectedData.aiSuggestion ? (
                    <div className="space-y-3">
                      {/* 摘要 */}
                      <div className="bg-muted/10 rounded-lg p-3">
                        <p className="text-xs text-muted-foreground mb-1">摘要</p>
                        <p className="text-sm font-medium text-foreground">{selectedData.aiSuggestion.description}</p>
                      </div>

                      {/* 仕訳明細テーブル */}
                      <div className="overflow-x-auto rounded-lg border border-border">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="bg-primary/5 border-b border-border">
                              <th className="text-left px-3 py-2 font-bold text-muted-foreground">勘定科目</th>
                              <th className="text-right px-3 py-2 font-bold text-muted-foreground">借方</th>
                              <th className="text-right px-3 py-2 font-bold text-muted-foreground">貸方</th>
                            </tr>
                          </thead>
                          <tbody>
                            {selectedData.aiSuggestion.lines.map((line, idx) => (
                              <tr key={idx} className="border-b border-border last:border-0">
                                <td className="px-3 py-2 text-foreground">
                                  {line.account_name}
                                  {line.account_code && <span className="text-muted-foreground ml-1">({line.account_code})</span>}
                                </td>
                                <td className="px-3 py-2 text-right font-mono">
                                  {line.debit_amount > 0 ? formatCurrency(line.debit_amount) : ""}
                                </td>
                                <td className="px-3 py-2 text-right font-mono">
                                  {line.credit_amount > 0 ? formatCurrency(line.credit_amount) : ""}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* 信頼度 + 理由 */}
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground">信頼度:</span>
                        <Badge variant={selectedData.aiSuggestion.confidence >= 0.8 ? "success" : selectedData.aiSuggestion.confidence >= 0.5 ? "warning" : "destructive"}>
                          {Math.round(selectedData.aiSuggestion.confidence * 100)}%
                        </Badge>
                      </div>
                      {selectedData.aiSuggestion.reasoning && (
                        <p className="text-xs text-muted-foreground bg-muted/10 rounded-lg p-2">
                          {selectedData.aiSuggestion.reasoning}
                        </p>
                      )}

                      {/* 承認・再生成ボタン */}
                      {selectedData.status !== "journalized" && (
                        <div className="flex gap-2">
                          <Button
                            className="flex-1"
                            onClick={() => handleApproveSuggestion(selectedData.id)}
                            disabled={approvingSuggestion}
                          >
                            {approvingSuggestion ? <Loader2 className="size-4 mr-1 animate-spin" /> : <BookOpen className="size-4 mr-1" />}
                            仕訳を作成
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => handleGenerateSuggestion(selectedData.id)}
                            disabled={generatingSuggestion}
                          >
                            {generatingSuggestion ? <Loader2 className="size-4 animate-spin" /> : <ScanLine className="size-4" />}
                          </Button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <Button
                      className="w-full justify-start"
                      variant="ghost"
                      onClick={() => handleGenerateSuggestion(selectedData.id)}
                      disabled={generatingSuggestion}
                    >
                      {generatingSuggestion ? <Loader2 className="size-4 mr-2 animate-spin" /> : <BookOpen className="size-4 mr-2" />}
                      {generatingSuggestion ? "仕訳提案を生成中..." : "仕訳提案を生成"}
                    </Button>
                  )}
                </div>
              )}

              {/* Status change actions */}
              <div className="border-t border-border pt-4">
                <h4 className="text-sm font-bold text-foreground mb-3">ステータス変更</h4>
                <div className="space-y-2">
                  {selectedData.status === "uploaded" && (
                    <Button
                      className="w-full justify-start"
                      variant="ghost"
                      onClick={() => handleStatusChange(selectedData.id, "ocr_done")}
                      disabled={updatingStatus}
                    >
                      {updatingStatus ? <Loader2 className="size-4 mr-2 animate-spin" /> : <ScanLine className="size-4 mr-2" />}
                      OCR完了にする
                    </Button>
                  )}
                  {(selectedData.status === "ocr_done" || selectedData.status === "uploaded") && (
                    <Button
                      className="w-full justify-start"
                      variant="ghost"
                      onClick={() => handleStatusChange(selectedData.id, "reviewed")}
                      disabled={updatingStatus}
                    >
                      {updatingStatus ? <Loader2 className="size-4 mr-2 animate-spin" /> : <FileCheck className="size-4 mr-2" />}
                      確認待ちにする
                    </Button>
                  )}
                  {(selectedData.status === "reviewed" || selectedData.status === "ocr_done") && (
                    <Button
                      className="w-full justify-start"
                      variant="ghost"
                      onClick={() => handleStatusChange(selectedData.id, "journalized")}
                      disabled={updatingStatus}
                    >
                      {updatingStatus ? <Loader2 className="size-4 mr-2 animate-spin" /> : <BookOpen className="size-4 mr-2" />}
                      仕訳済にする
                    </Button>
                  )}
                  {selectedData.status === "journalized" && (
                    <p className="text-xs text-muted-foreground py-2">
                      この領収書は仕訳済です。
                    </p>
                  )}
                </div>
              </div>

              {/* Delete */}
              <div className="border-t border-border pt-4">
                <Button
                  variant="ghost"
                  className="w-full justify-center text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => handleDelete(selectedData.id)}
                  disabled={deletingId === selectedData.id}
                >
                  {deletingId === selectedData.id ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Trash2 className="size-4 mr-2" />}
                  この領収書を削除
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function ReceiptsPage() {
  return <ReceiptsPageContent />;
}
