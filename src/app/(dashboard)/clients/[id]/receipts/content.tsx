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
  FileSpreadsheet,
  Sparkles,
  Check,
  Ban,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { useData } from "@/lib/use-data";
import {
  checkInvoiceNumber,
  getReviewReasons,
  reviewReasonLabels,
  type InvoiceCheck,
} from "@/lib/receipt-review";
import { getReceipts, updateReceipt, deleteReceipt, deleteReceipts } from "@/actions/receipts";
import { getClient } from "@/actions/clients";
import { fiscalRangeFromStartYear } from "@/lib/fiscal";
import { getReceiptImageUrl } from "@/actions/receipt-storage";
import { processReceiptOcr, updateOcrResult } from "@/actions/ocr";
import { generateJournalSuggestion, approveJournalSuggestion } from "@/actions/ai-journal";
import {
  getStatementLines,
  extractStatementTransactions,
  setStatementLineStatus,
  createJournalsFromStatementLines,
} from "@/actions/statement-lines";
import type { StatementLine } from "@/types/index";

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
  statementSubtype?: "bank" | "card" | "other";
  ocrConfidence?: number;
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

// インボイス検証・「要確認」判定は共通ロジック（src/lib/receipt-review.ts）を利用。
const invoiceCheckConfig: Record<
  InvoiceCheck,
  { label: string; variant: "success" | "warning" | "muted" }
> = {
  valid: { label: "適格", variant: "success" },
  invalid: { label: "番号不正", variant: "warning" },
  none: { label: "番号なし", variant: "muted" },
};

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

export function ReceiptsPageContent({
  hideHeader = false,
  lockedDirection,
  processingOnly = false,
  hideProcessingSection = false,
  lockedDocType,
  excludeDocTypes,
}: {
  hideHeader?: boolean;
  lockedDirection?: "received" | "issued";
  // 「処理中」タブ用：処理中（OCR待ち）の証憑だけを表示し、他のフィルタ・一覧は隠す
  processingOnly?: boolean;
  // 区分タブ用：処理中はタブ側で集約するため、インラインの処理中セクションを隠す
  hideProcessingSection?: boolean;
  // 「明細書」タブ用：指定した書類種別だけを表示（区分・書類種別フィルタは隠す）
  lockedDocType?: DocumentType;
  // 領収書タブ用：指定した書類種別を一覧から除外（明細書は専用タブに集約）
  excludeDocTypes?: DocumentType[];
}) {
  const { id } = useParams<{ id: string }>();

  // 区分に応じた用語・機能の出し分け（発行=自社の売上側 / 受領=経費・仕入側）
  const isIssued = lockedDirection === "issued";
  const isReceived = lockedDirection === "received";
  // インボイス番号の確認は受領（仕入税額控除）側で重要。発行側・明細書では強調しない。
  const showInvoiceCheck = !isIssued && !lockedDocType;
  const partnerLabel = isIssued ? "宛先" : isReceived ? "支払先" : "取引先";
  const payLabel = isIssued ? "入金方法" : "支払方法";

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
            confidence?: number;
            statement_subtype?: "bank" | "card" | "other";
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
            documentType: ((): DocumentType | undefined => {
              const dt = (r as { document_type?: string }).document_type as DocumentType | undefined;
              // 既存データ救済: 登録番号(T+13)が無いのに適格請求書になっている書類は
              // 区分記載請求書として表示する（非インボイス登録事業者対応）。
              if (dt === "qualified_invoice" && checkInvoiceNumber(ocr?.invoice_number) !== "valid") {
                return "category_invoice";
              }
              return dt;
            })(),
            statementSubtype: ocr?.statement_subtype,
            ocrConfidence: typeof ocr?.confidence === "number" ? ocr.confidence : undefined,
            folderId: (r as { folder_id?: string | null }).folder_id ?? null,
          };
        })
      ),
    null
  );

  // null = まだ取得前（ローディング中）
  const receiptsLoading = dbReceipts === null;
  const receipts: ReceiptData[] = dbReceipts ?? [];

  // OCR処理中のレシートがある間は10秒ごとに自動リフレッシュ
  const hasProcessing = receipts.some(
    (r) => r.status === "processing" || r.status === "uploaded"
  );
  useEffect(() => {
    if (!hasProcessing) return;
    const timer = setInterval(() => { refetch(); }, 10000);
    return () => clearInterval(timer);
  }, [hasProcessing, refetch]);

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
  // インボイス登録番号フィルター（受領側でのみ使用）
  const [invoiceFilter, setInvoiceFilter] = useState<"all" | "registered" | "unregistered">("all");
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

  // 処理中（アップロード直後・OCR待ち）の証憑は発行／受領が未確定のため、
  // 方向タブには振り分けず専用の「処理中」セクションに一時表示する。
  // OCR完了後に発行／受領が確定すると、自動的に該当タブへ移動する。
  const processingReceipts = receipts.filter(
    (r) => r.status === "uploaded" || r.status === "processing"
  );
  // 処理中を除いた確定済みの証憑（一覧・件数集計の対象）
  // 書類種別固定（明細書タブ等）・除外（受領/発行から明細書を除く等）・区分固定（受領/発行タブ）を
  // ここで先に適用し、「全○件」やステータス集計が区分ごとに正しく分かれるようにする。
  const classifiedReceipts = receipts.filter(
    (r) =>
      r.status !== "uploaded" &&
      r.status !== "processing" &&
      (!lockedDirection || r.direction === lockedDirection) &&
      (!lockedDocType || r.documentType === lockedDocType) &&
      !(excludeDocTypes && r.documentType && excludeDocTypes.includes(r.documentType))
  );

  // 書類種別ごとの件数（フォルダ・方向フィルター適用前の全件から集計）
  const docTypeCounts = classifiedReceipts.reduce<Record<string, number>>((acc, r) => {
    const key = r.documentType ?? "unknown";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  // Filtered
  // 明細書タブなど書類種別固定時は区分（発行/受領）の概念がないため "all" に固定
  const effectiveDirection = lockedDocType ? "all" : (lockedDirection ?? directionFilter);
  const filtered = classifiedReceipts.filter((r) => {
    if (effectiveDirection !== "all" && r.direction !== effectiveDirection) return false;
    // 書類種別フィルター
    if (documentTypeFilter !== "all") {
      if (r.documentType !== documentTypeFilter) return false;
    }
    // インボイス登録番号フィルター（受領側）
    if (showInvoiceCheck && invoiceFilter !== "all") {
      const ic = checkInvoiceNumber(r.invoiceNumber);
      if (invoiceFilter === "registered" && ic !== "valid") return false;
      if (invoiceFilter === "unregistered" && ic === "valid") return false;
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
              領収書のアップロード・AI読取（OCR）・仕訳化
            </p>
          </div>
        </div>
      )}

      <div>

      {/* Document Type Filter Tabs（明細書など書類種別固定タブでも「全○件」は表示） */}
      {!processingOnly && (
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
          全{classifiedReceipts.length}件
        </button>
        {/* 各書類種別（書類種別固定タブでは不要・1件以上ある場合のみ表示） */}
        {!lockedDocType && (Object.entries(documentTypeConfig) as [DocumentType, typeof documentTypeConfig[DocumentType]][]).map(([type, cfg]) => {
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
      )}

      {/* Filter Bar */}
      {!processingOnly && (
      <div className="flex items-center justify-between mb-4 gap-4">
        {/* 左側フィルター群（発行/受領・インボイス） */}
        <div className="flex items-center gap-2 flex-wrap shrink-0">
        {/* 発行/受領フィルター（区分固定時・書類種別固定時は非表示） */}
        {!lockedDirection && !lockedDocType && (
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

        {/* インボイス登録番号フィルター（受領＝仕入税額控除の確認用） */}
        {showInvoiceCheck && (
        <div className="inline-flex gap-1 bg-muted/20 p-1 rounded-lg shrink-0">
          {([["all", "インボイス：全て"], ["registered", "適格のみ"], ["unregistered", "未登録のみ"]] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setInvoiceFilter(key)}
              className={cn(
                "px-2.5 py-1 rounded-md text-xs font-bold transition-colors whitespace-nowrap",
                invoiceFilter === key ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {label}
            </button>
          ))}
        </div>
        )}
        </div>

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
              placeholder={`${partnerLabel}・${payLabel}で検索...`}
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
      )}

      {/* Bulk action bar */}
      {!processingOnly && (
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
              削除
            </Button>
          </>
        )}
      </div>
      )}

      {/* 処理中セクション（発行／受領が未確定の証憑を一時表示）
          ・通常タブ: インライン表示（区分タブでは hideProcessingSection で抑制）
          ・処理中タブ(processingOnly): このセクションが主役。0件時は専用の空表示。 */}
      {(processingOnly || !hideProcessingSection) && processingReceipts.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <Loader2 className="size-4 animate-spin text-amber-600" />
            <h3 className="text-sm font-bold text-amber-700">
              処理中（{processingReceipts.length}件）
            </h3>
            <span className="text-xs text-muted-foreground">
              AIが内容を読み取り、発行／受領を判定しています。完了すると自動的に各タブへ振り分けられます。
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {processingReceipts.map((r) => (
              <button
                key={r.id}
                onClick={() => setSelectedReceipt(r.id)}
                className="flex items-center gap-2 p-2 rounded-lg bg-card border border-border text-left hover:border-primary/30 transition-colors"
              >
                <div className="size-8 rounded bg-muted/30 flex items-center justify-center shrink-0">
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-foreground truncate">
                    {r.vendor && r.vendor !== "不明" ? r.vendor : "読み取り中…"}
                  </p>
                  <p className="text-[10px] text-muted-foreground">{formatDate(r.date)}</p>
                </div>
                <Badge variant="warning" className="text-[10px] shrink-0">
                  {statusConfig[r.status].label}
                </Badge>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 処理中タブの空状態 */}
      {processingOnly && (
        receiptsLoading ? (
          <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card p-12 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
            <span className="text-sm">読み込み中...</span>
          </div>
        ) : processingReceipts.length === 0 ? (
          <Card className="p-12 text-center">
            <p className="text-muted-foreground">処理中の証憑はありません</p>
          </Card>
        ) : null
      )}

      {/* Receipt Cards / List */}
      {!processingOnly && (receiptsLoading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card p-12 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          <span className="text-sm">読み込み中...</span>
        </div>
      ) : filtered.length === 0 ? (
        processingReceipts.length > 0 ? null : (
          <Card className="p-12 text-center">
            <p className="text-muted-foreground">条件に一致する領収書がありません</p>
          </Card>
        )
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
                  <div className="flex items-center gap-1 mb-1 flex-wrap">
                    <Badge variant={receipt.direction === "issued" ? "accent" : "muted"} className="text-[10px]">
                      {receipt.direction === "issued" ? "発行" : "受領"}
                    </Badge>
                    {showInvoiceCheck && (() => {
                      const ic = checkInvoiceNumber(receipt.invoiceNumber);
                      // 形式不正は下の「要確認」バッジに集約するため、ここでは適格／番号なしのみ表示
                      if (ic === "invalid") return null;
                      return (
                        <Badge variant={invoiceCheckConfig[ic].variant} className="text-[10px]">
                          {invoiceCheckConfig[ic].label}
                        </Badge>
                      );
                    })()}
                    {getReviewReasons(receipt, showInvoiceCheck).length > 0 && (
                      <Badge variant="warning" className="text-[10px]">
                        <AlertTriangle className="size-3 mr-1" />
                        要確認
                      </Badge>
                    )}
                  </div>
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
                    {partnerLabel}
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    日付
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    金額
                  </th>
                  <th className="text-center px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    {payLabel}
                  </th>
                  {showInvoiceCheck && (
                    <th className="text-center px-4 py-3 text-xs font-bold text-muted-foreground uppercase tracking-wider">
                      インボイス
                    </th>
                  )}
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
                        <div className="flex items-center gap-1.5">
                          <span className="truncate">{receipt.vendor}</span>
                          {getReviewReasons(receipt, showInvoiceCheck).length > 0 && (
                            <Badge variant="warning" className="text-[10px] shrink-0">
                              <AlertTriangle className="size-3 mr-1" />
                              要確認
                            </Badge>
                          )}
                        </div>
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
                      {showInvoiceCheck && (() => {
                        const ic = checkInvoiceNumber(receipt.invoiceNumber);
                        return (
                          <td className="px-4 py-3 text-center">
                            {ic === "invalid" ? (
                              <span className="text-xs text-muted-foreground">-</span>
                            ) : (
                              <Badge variant={invoiceCheckConfig[ic].variant} className="text-[10px]">
                                {invoiceCheckConfig[ic].label}
                              </Badge>
                            )}
                          </td>
                        );
                      })()}
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
      ))}

      {/* Summary */}
      {!processingOnly && (
      <div className="mt-4 flex justify-between items-center text-xs text-muted-foreground">
        <span>{filtered.length}件の領収書を表示</span>
        <span>
          合計金額:{" "}
          <span className="font-mono font-bold text-foreground">
            {formatCurrency(filtered.reduce((s, r) => s + r.amount, 0))}
          </span>
        </span>
      </div>
      )}

      </div>

      {/* Detail Panel (slide-over) */}
      {selectedData && (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setSelectedReceipt(null)}
          />
          {/* Panel（明細書は行テーブルを置くため幅を広げる） */}
          <div className={cn(
            "relative w-full bg-card border-l border-border shadow-xl overflow-y-auto",
            selectedData.documentType === "statement" ? "max-w-3xl" : "max-w-md"
          )}>
            {/* Header */}
            <div className="sticky top-0 bg-card border-b border-border px-6 py-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-foreground">
                {selectedData.documentType === "statement" ? "明細書詳細" : "領収書詳細"}
              </h3>
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

              {/* 要確認: インボイス形式・OCR読取品質などを横断チェック */}
              {(() => {
                const reasons = getReviewReasons(selectedData, showInvoiceCheck);
                if (reasons.length === 0) return null;
                return (
                  <div className="rounded-lg border border-destructive bg-destructive/10 p-3">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <AlertTriangle className="size-4 text-destructive" />
                      <span className="text-sm font-bold text-destructive">要確認</span>
                    </div>
                    <ul className="space-y-1">
                      {reasons.map((rs) => (
                        <li key={rs} className="text-xs text-destructive flex items-start gap-1.5">
                          <span className="mt-0.5">・</span>
                          <span>{reviewReasonLabels[rs]}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-[10px] text-muted-foreground mt-2">
                      ※ 上部の「編集」から原本を確認して修正してください。仕訳済みの場合は下部の「仕訳済を解除」で編集可能に戻せます。
                    </p>
                  </div>
                );
              })()}

              {/* 明細書: 取引行の抽出・仕訳化 */}
              {selectedData.documentType === "statement" && (
                <StatementLinesSection
                  receiptId={selectedData.id}
                  subtype={selectedData.statementSubtype}
                  onChanged={refetch}
                />
              )}

              {/* 発行/受領 区分（AI判定・手動修正可。明細書では非表示） */}
              {selectedData.documentType !== "statement" && (
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
              )}

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
                    <span className="text-xs text-muted-foreground">{partnerLabel}</span>
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
                  {/* インボイス番号：受領側は仕入税額控除の判定に重要なため、番号がなくても確認結果を明示 */}
                  {showInvoiceCheck ? (
                    (() => {
                      const ic = checkInvoiceNumber(selectedData.invoiceNumber);
                      // 要確認＝赤、番号なし＝アンバー で注意喚起。適格は通常色。
                      const boxClass =
                        ic === "invalid"
                          ? "border-destructive bg-destructive/10"
                          : ic === "none"
                          ? "border-amber-500 bg-amber-500/10"
                          : "border-border bg-muted/10";
                      const noteClass =
                        ic === "invalid"
                          ? "text-destructive font-medium"
                          : ic === "none"
                          ? "text-amber-700 dark:text-amber-500 font-medium"
                          : "text-muted-foreground";
                      return (
                        <div className={cn("rounded-lg border p-3", boxClass)}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs text-muted-foreground">インボイス登録番号</span>
                            <Badge variant={invoiceCheckConfig[ic].variant} className="text-[10px]">
                              {invoiceCheckConfig[ic].label}
                            </Badge>
                          </div>
                          {selectedData.invoiceNumber ? (
                            <p className="text-sm font-mono text-foreground">{selectedData.invoiceNumber}</p>
                          ) : (
                            <p className="text-sm text-muted-foreground">未取得</p>
                          )}
                          <p className={cn("text-[10px] mt-1.5", noteClass)}>
                            {ic === "valid"
                              ? "適格請求書発行事業者の登録番号です。仕入税額控除の対象になります。"
                              : ic === "invalid"
                              ? "番号の形式（T＋13桁）が不正です。原本をご確認ください。"
                              : "登録番号がありません。仕入税額控除には経過措置の適用可否をご確認ください。"}
                          </p>
                        </div>
                      );
                    })()
                  ) : (
                    selectedData.invoiceNumber && (
                      <div>
                        <span className="text-xs text-muted-foreground">インボイス番号</span>
                        <p className="text-sm font-mono text-foreground">{selectedData.invoiceNumber}</p>
                      </div>
                    )
                  )}
                  <div>
                    <span className="text-xs text-muted-foreground">{payLabel}</span>
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

              {/* AI Journal Suggestion（明細書は行ごとに仕訳化するため非表示） */}
              {selectedData.documentType !== "statement" && (selectedData.status === "ocr_done" || selectedData.status === "reviewed" || selectedData.aiSuggestion) && (
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
                    <>
                      <Button
                        className="w-full justify-start"
                        variant="ghost"
                        onClick={() => handleStatusChange(selectedData.id, "reviewed")}
                        disabled={updatingStatus}
                      >
                        {updatingStatus ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Pencil className="size-4 mr-2" />}
                        仕訳済を解除して編集可能に戻す
                      </Button>
                      <p className="text-[10px] text-muted-foreground px-1">
                        ※ 解除すると上部に「編集」が表示され、インボイス番号などを修正できます。作成済みの仕訳は削除されません。
                      </p>
                    </>
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

// ---------------------------------------------------------------------------
// 明細書の取引行セクション（抽出 → レビュー → 一括仕訳化）
// ---------------------------------------------------------------------------

const subtypeConfig: Record<"bank" | "card" | "other", { label: string; fixed: string }> = {
  bank: { label: "銀行明細", fixed: "普通預金" },
  card: { label: "クレジットカード明細", fixed: "未払金" },
  other: { label: "その他明細", fixed: "現金" },
};

const lineStatusConfig: Record<
  StatementLine["status"],
  { label: string; variant: "muted" | "success" | "warning" }
> = {
  pending: { label: "未仕訳", variant: "warning" },
  journalized: { label: "仕訳済", variant: "success" },
  ignored: { label: "除外", variant: "muted" },
};

function StatementLinesSection({
  receiptId,
  subtype,
  onChanged,
}: {
  receiptId: string;
  subtype?: "bank" | "card" | "other";
  onChanged?: () => void;
}) {
  const [lines, setLines] = useState<StatementLine[] | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [journalizing, setJournalizing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    getStatementLines(receiptId)
      .then((ls) => setLines(ls))
      .catch(() => setLines([]));
  };

  useEffect(() => {
    setLines(null);
    setSelected(new Set());
    setError(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiptId]);

  const handleExtract = async () => {
    setExtracting(true);
    setError(null);
    try {
      const ls = await extractStatementTransactions(receiptId);
      setLines(ls);
      setSelected(new Set());
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "明細の抽出に失敗しました");
    } finally {
      setExtracting(false);
    }
  };

  const pendingLines = (lines ?? []).filter((l) => l.status === "pending");

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === pendingLines.length) setSelected(new Set());
    else setSelected(new Set(pendingLines.map((l) => l.id)));
  };

  const handleJournalize = async (ids: string[]) => {
    if (ids.length === 0) return;
    setJournalizing(true);
    setError(null);
    try {
      const res = await createJournalsFromStatementLines(ids);
      if (res.failed > 0) {
        setError(
          `${res.success}件を仕訳化、${res.failed}件失敗：${res.errors.slice(0, 3).join(" / ")}`
        );
      }
      setSelected(new Set());
      load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "仕訳化に失敗しました");
    } finally {
      setJournalizing(false);
    }
  };

  const handleIgnore = async (id: string, ignore: boolean) => {
    try {
      await setStatementLineStatus(id, ignore ? "ignored" : "pending");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新に失敗しました");
    }
  };

  const sc = subtypeConfig[subtype ?? "other"];

  return (
    <div className="border-t border-border pt-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-bold text-foreground flex items-center gap-1.5">
          <FileSpreadsheet className="size-4 text-primary" />
          明細から取引を抽出・仕訳化
        </h4>
        {lines !== null && lines.length > 0 && (
          <button
            onClick={handleExtract}
            disabled={extracting}
            className="text-xs text-primary hover:underline flex items-center gap-0.5 disabled:opacity-50"
          >
            {extracting ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
            再抽出
          </button>
        )}
      </div>

      {/* 種別・固定側の注記 */}
      <div className="text-[11px] text-muted-foreground mb-3 bg-muted/10 rounded-md px-3 py-2">
        種別: <span className="font-bold text-foreground">{sc.label}</span> ／ 相手勘定の固定側:{" "}
        <span className="font-bold text-foreground">{sc.fixed}</span>
        <span className="block mt-0.5">仕訳は「確認待ち（下書き）」として作成されます。仕訳入力で内容をご確認ください。</span>
      </div>

      {error && (
        <div className="text-xs text-destructive bg-destructive/10 rounded-md px-3 py-2 mb-3 whitespace-pre-wrap">
          {error}
        </div>
      )}

      {lines === null ? (
        <div className="h-16 flex items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : lines.length === 0 ? (
        <div className="text-center py-4">
          <p className="text-xs text-muted-foreground mb-3">
            まだ明細を抽出していません。OCRで取引行を読み取ります。
          </p>
          <Button onClick={handleExtract} disabled={extracting} className="justify-center">
            {extracting ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Sparkles className="size-4 mr-2" />}
            {extracting ? "抽出中..." : "明細を抽出"}
          </Button>
        </div>
      ) : (
        <>
          {/* 一括操作バー */}
          {pendingLines.length > 0 && (
            <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={selected.size === pendingLines.length && pendingLines.length > 0}
                  onChange={toggleAll}
                  className="size-3.5 cursor-pointer"
                />
                {selected.size > 0 ? `${selected.size}件選択中` : "未仕訳を全選択"}
              </label>
              <div className="flex items-center gap-2">
                {selected.size > 0 && (
                  <Button
                    onClick={() => handleJournalize([...selected])}
                    disabled={journalizing}
                    className="h-8 text-xs"
                  >
                    {journalizing ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <Check className="size-3.5 mr-1.5" />}
                    選択を仕訳化
                  </Button>
                )}
                <Button
                  variant="ghost"
                  onClick={() => handleJournalize(pendingLines.map((l) => l.id))}
                  disabled={journalizing}
                  className="h-8 text-xs"
                >
                  全て仕訳化
                </Button>
              </div>
            </div>
          )}

          {/* 明細行テーブル */}
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/20 border-b border-border">
                  <th className="w-8 px-2 py-2"></th>
                  <th className="text-left px-2 py-2 font-bold text-muted-foreground">日付</th>
                  <th className="text-left px-2 py-2 font-bold text-muted-foreground">摘要</th>
                  <th className="text-right px-2 py-2 font-bold text-muted-foreground">入金</th>
                  <th className="text-right px-2 py-2 font-bold text-muted-foreground">出金</th>
                  <th className="text-center px-2 py-2 font-bold text-muted-foreground">状態</th>
                  <th className="w-8 px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const isDeposit = l.direction === "deposit";
                  const abs = Math.abs(l.amount);
                  const st = lineStatusConfig[l.status];
                  return (
                    <tr
                      key={l.id}
                      className={cn(
                        "border-b border-border last:border-0",
                        l.status === "ignored" && "opacity-50"
                      )}
                    >
                      <td className="px-2 py-2 text-center">
                        {l.status === "pending" && (
                          <input
                            type="checkbox"
                            checked={selected.has(l.id)}
                            onChange={() => toggle(l.id)}
                            className="size-3.5 cursor-pointer"
                          />
                        )}
                      </td>
                      <td className="px-2 py-2 text-foreground whitespace-nowrap">
                        {l.line_date ?? "—"}
                      </td>
                      <td className="px-2 py-2 text-foreground">
                        <span className="block">{l.description || "—"}</span>
                        {l.counterparty && (
                          <span className="block text-[10px] text-muted-foreground">{l.counterparty}</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right font-mono text-green-600">
                        {isDeposit ? formatCurrency(abs) : ""}
                      </td>
                      <td className="px-2 py-2 text-right font-mono text-foreground">
                        {!isDeposit ? formatCurrency(abs) : ""}
                      </td>
                      <td className="px-2 py-2 text-center">
                        <Badge variant={st.variant} className="text-[10px]">{st.label}</Badge>
                      </td>
                      <td className="px-2 py-2 text-center">
                        {l.status === "pending" && (
                          <button
                            onClick={() => handleIgnore(l.id, true)}
                            title="除外"
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <Ban className="size-3.5" />
                          </button>
                        )}
                        {l.status === "ignored" && (
                          <button
                            onClick={() => handleIgnore(l.id, false)}
                            title="除外を解除"
                            className="text-muted-foreground hover:text-primary"
                          >
                            <RefreshCw className="size-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

