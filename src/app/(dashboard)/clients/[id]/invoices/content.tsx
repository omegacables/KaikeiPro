"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  FileText,
  Plus,
  Printer,
  Search,
  AlertCircle,
  Clock,
  CheckCircle,
  Send,
  Ban,
  Loader2,
  X,
  Trash2,
  Package,
  AlertTriangle,
  Download,
  CreditCard,
  ReceiptText,
  ChevronDown,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency } from "@/lib/utils";
import { useData } from "@/lib/use-data";
import { getInvoices, createInvoice, updateInvoice, deleteInvoice, deleteAllInvoices, issueInvoiceWithJournal } from "@/actions/invoices";
import { getPartners } from "@/actions/partners";
import { getClient } from "@/actions/clients";
import { fiscalRangeFromStartYear } from "@/lib/fiscal";
import { importRaqtoSalesOrders, exportRaqtoPaymentStatus, type RaqtoSyncResult } from "@/actions/raqto-sync";

// ---------------------------------------------------------------------------
// Types & config
// ---------------------------------------------------------------------------

type InvoiceStatus = "all" | "draft" | "issued" | "sent" | "paid" | "overdue" | "void";
type Direction = "sales" | "purchase";

// 発行（売上）用ステータス設定
const salesStatusConfig: Record<
  Exclude<InvoiceStatus, "all">,
  { label: string; variant: "default" | "success" | "warning" | "destructive" | "muted" | "accent"; icon: typeof FileText }
> = {
  draft:   { label: "下書き",   variant: "muted",        icon: FileText    },
  issued:  { label: "発行済",   variant: "default",      icon: CheckCircle },
  sent:    { label: "送付済",   variant: "accent",       icon: Send        },
  paid:    { label: "入金済",   variant: "success",      icon: CheckCircle },
  overdue: { label: "期限超過", variant: "destructive",  icon: AlertCircle },
  void:    { label: "無効",     variant: "muted",        icon: Ban         },
};

// 受領（仕入）用ステータス設定
const purchaseStatusConfig: Record<
  Exclude<InvoiceStatus, "all">,
  { label: string; variant: "default" | "success" | "warning" | "destructive" | "muted" | "accent"; icon: typeof FileText }
> = {
  draft:   { label: "未処理",   variant: "muted",        icon: FileText    },
  issued:  { label: "受領済",   variant: "default",      icon: ReceiptText },
  sent:    { label: "確認済",   variant: "accent",       icon: CheckCircle },
  paid:    { label: "支払済",   variant: "success",      icon: CreditCard  },
  overdue: { label: "期限超過", variant: "destructive",  icon: AlertCircle },
  void:    { label: "無効",     variant: "muted",        icon: Ban         },
};

const salesStatusTabs:    { key: InvoiceStatus; label: string }[] = [
  { key: "all",     label: "すべて"   },
  { key: "draft",   label: "下書き"   },
  { key: "issued",  label: "発行済"   },
  { key: "sent",    label: "送付済"   },
  { key: "paid",    label: "入金済"   },
  { key: "overdue", label: "期限超過" },
  { key: "void",    label: "無効"     },
];

const purchaseStatusTabs: { key: InvoiceStatus; label: string }[] = [
  { key: "all",     label: "すべて"   },
  { key: "draft",   label: "未処理"   },
  { key: "issued",  label: "受領済"   },
  { key: "sent",    label: "確認済"   },
  { key: "paid",    label: "支払済"   },
  { key: "overdue", label: "期限超過" },
  { key: "void",    label: "無効"     },
];

const raqtoStatusLabels: Record<string, { label: string; variant: "default" | "success" | "warning" | "destructive" | "muted" | "accent" }> = {
  draft:              { label: "下書き",   variant: "muted"       },
  confirmed:          { label: "確定",     variant: "default"     },
  sent:               { label: "送付済",   variant: "accent"      },
  delivered:          { label: "納品済",   variant: "default"     },
  payment_pending:    { label: "入金待ち", variant: "warning"     },
  payment_completed:  { label: "入金済",   variant: "success"     },
  completed:          { label: "完了",     variant: "success"     },
  canceled:           { label: "キャンセル", variant: "destructive" },
  order:              { label: "受注",     variant: "muted"       },
  document:           { label: "書類",     variant: "accent"      },
};

type Invoice = {
  id: string;
  invoiceNumber: string;
  partnerName: string;
  issuedDate: string;
  dueDate: string;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  status: Exclude<InvoiceStatus, "all">;
  direction: Direction;
  raqtoOrderStatus: string | null;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function InvoicesPageContent({
  hideHeader = false,
  lockedDirection,
}: {
  hideHeader?: boolean;
  lockedDirection?: Direction;
}) {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [activeStatus, setActiveStatus]   = useState<InvoiceStatus>("all");
  const [searchQuery, setSearchQuery]     = useState("");

  // 期間フィルター（発行日ベース。年度 or 月で絞り込み）
  // デフォルトは今月分を表示（月セレクタを空にすると全期間）
  const initialPeriod = (() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const ld = new Date(y, m, 0).getDate();
    const mm = String(m).padStart(2, "0");
    return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(ld).padStart(2, "0")}` };
  })();
  const [periodMode, setPeriodMode] = useState<"none" | "year" | "month">("month");
  const [fiscalYear, setFiscalYear] = useState("");
  const [dateFrom, setDateFrom] = useState(initialPeriod.from);
  const [dateTo, setDateTo] = useState(initialPeriod.to);
  const [fiscalStartMonth, setFiscalStartMonth] = useState(4);
  useEffect(() => {
    getClient(id)
      .then((c) => setFiscalStartMonth((c as { fiscal_year_start_month?: number }).fiscal_year_start_month ?? 4))
      .catch(() => {});
  }, [id]);
  const [directionFilter, setDirectionFilter] = useState<"all" | Direction>("all");
  const [showNewForm, setShowNewForm]     = useState(false);
  const [saving, setSaving]               = useState(false);
  const [partnerList, setPartnerList]     = useState<{ id: string; name: string }[]>([]);
  const [importing, setImporting]         = useState(false);
  const [importResult, setImportResult]   = useState<RaqtoSyncResult | null>(null);
  const [deletingId, setDeletingId]       = useState<string | null>(null);
  const [issuingId, setIssuingId]         = useState<string | null>(null);
  const [clearingAll, setClearingAll]     = useState(false);

  const [newInvoice, setNewInvoice] = useState({
    invoice_number: "",
    business_partner_id: "",
    issued_date: new Date().toISOString().split("T")[0],
    due_date: "",
    direction: (lockedDirection ?? "sales") as Direction,
  });
  const [newItems, setNewItems] = useState([
    { description: "", quantity: 1, unit_price: 0, tax_rate: 10, transaction_date: "" },
  ]);

  // ---- Derived direction context ----
  const effectiveDirection = lockedDirection ?? directionFilter;
  const isSalesView    = effectiveDirection === "sales";
  const isPurchaseView = effectiveDirection === "purchase";
  const statusConfig   = isPurchaseView ? purchaseStatusConfig : salesStatusConfig;
  const statusTabs     = isPurchaseView ? purchaseStatusTabs   : salesStatusTabs;

  // ---- Data ----
  const { data: invoices, refetch } = useData(
    () =>
      getInvoices(id).then((rows) =>
        rows.map((r) => ({
          id: r.id,
          invoiceNumber: r.invoice_number,
          partnerName: (r as unknown as { business_partners?: { name?: string } }).business_partners?.name ?? "",
          issuedDate:  r.issued_date?.replace(/-/g, "/") ?? "",
          dueDate:     r.due_date?.replace(/-/g, "/") ?? "",
          subtotal:    r.subtotal,
          taxAmount:   r.tax_amount,
          totalAmount: r.total_amount,
          status:      r.status as Exclude<InvoiceStatus, "all">,
          direction:   ((r as { direction?: Direction }).direction ?? "sales"),
          raqtoOrderStatus: r.raqto_order_status ?? null,
        }))
      ),
    [] as Invoice[]
  );

  // ---- Filtered list ----
  const filteredInvoices = invoices.filter((inv) => {
    if (effectiveDirection !== "all" && inv.direction !== effectiveDirection) return false;
    if (activeStatus !== "all" && inv.status !== activeStatus) return false;
    // 期間フィルター（発行日ベース。issuedDate は YYYY/MM/DD 表示形式なので ISO に戻して比較）
    if (dateFrom || dateTo) {
      const iso = inv.issuedDate.replace(/\//g, "-");
      if (dateFrom && iso < dateFrom) return false;
      if (dateTo && iso > dateTo) return false;
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return inv.invoiceNumber.toLowerCase().includes(q) || inv.partnerName.toLowerCase().includes(q);
    }
    return true;
  });

  // ---- Summary metrics ----
  const now = new Date();
  const thisMonthPrefix = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}`;

  // 発行ビュー用
  const unpaidReceivables = invoices
    .filter((inv) => inv.direction === "sales" && ["issued", "sent", "overdue"].includes(inv.status))
    .reduce((s, inv) => s + inv.totalAmount, 0);
  const thisMonthIssued = invoices.filter(
    (inv) => inv.direction === "sales" && inv.issuedDate.startsWith(thisMonthPrefix)
  ).length;
  const salesOverdueCount = invoices.filter(
    (inv) => inv.direction === "sales" && inv.status === "overdue"
  ).length;

  // 受領ビュー用
  const unpaidPayables = invoices
    .filter((inv) => inv.direction === "purchase" && ["draft", "issued", "sent", "overdue"].includes(inv.status))
    .reduce((s, inv) => s + inv.totalAmount, 0);
  const thisMonthReceived = invoices.filter(
    (inv) => inv.direction === "purchase" && inv.issuedDate.startsWith(thisMonthPrefix)
  ).length;
  const purchaseOverdueCount = invoices.filter(
    (inv) => inv.direction === "purchase" && inv.status === "overdue"
  ).length;

  // ---- Handlers ----
  const handleIssueInvoice = async (invoiceId: string, dir: Direction) => {
    const msg = dir === "sales"
      ? "この請求書を計上し、仕訳を自動作成しますか？\n（売掛金 / 売上高 ＋ 仮受消費税）"
      : "この請求書を計上し、仕訳を自動作成しますか？\n（仕入高 ＋ 仮払消費税 / 買掛金）";
    if (!confirm(msg)) return;
    setIssuingId(invoiceId);
    try {
      await issueInvoiceWithJournal(invoiceId);
      // 発行（売上）はインボイス対応プレビューを即座に表示
      if (dir === "sales") {
        router.push(`/clients/${id}/invoices/print/${invoiceId}`);
        return;
      }
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : "計上に失敗しました");
    } finally {
      setIssuingId(null);
    }
  };

  // ステータスのインライン変更（Raqto取込分含む全請求書で変更可能）。
  // 「入金済」に変更すると、次回のRaqto同期で受発注側にも「支払済」が書き戻される。
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);
  const handleStatusChange = async (invoiceId: string, status: Exclude<InvoiceStatus, "all">) => {
    setStatusUpdatingId(invoiceId);
    try {
      await updateInvoice(invoiceId, { status });
      // 入金済にした場合はRaqto受発注側へ即時に支払済を書き戻す（未連携なら静かにスキップ）
      if (status === "paid") {
        exportRaqtoPaymentStatus(id).catch(() => {});
      }
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : "ステータスの更新に失敗しました");
    } finally {
      setStatusUpdatingId(null);
    }
  };

  const handleDeleteInvoice = async (invoiceId: string) => {
    if (!confirm("この請求書を削除しますか？")) return;
    setDeletingId(invoiceId);
    try {
      await deleteInvoice(invoiceId);
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : "削除に失敗しました");
    } finally {
      setDeletingId(null);
    }
  };

  const handleClearAll = async () => {
    const scopeLabel = lockedDirection === "sales"
      ? "発行した請求書"
      : lockedDirection === "purchase"
        ? "受領した請求書"
        : "すべての請求書";
    if (!confirm(`${scopeLabel}を一括削除しますか？この操作は元に戻せません。`)) return;
    setClearingAll(true);
    try {
      await deleteAllInvoices(id, lockedDirection);
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : "一括削除に失敗しました");
    } finally {
      setClearingAll(false);
    }
  };

  const openNewForm = async () => {
    const dir = lockedDirection ?? "sales";
    // 請求書番号の初期値を自動採番（例: INV-20260610-003）。手入力で上書き可能。
    const today = new Date();
    const ymd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
    const prefix = dir === "purchase" ? "RCV" : "INV";
    const seq = invoices.filter((inv) => inv.direction === dir).length + 1;
    setNewInvoice((prev) => ({
      ...prev,
      direction: dir,
      invoice_number: prev.invoice_number || `${prefix}-${ymd}-${String(seq).padStart(3, "0")}`,
    }));
    setShowNewForm(true);
    try {
      const partners = await getPartners(id);
      setPartnerList(partners.map((p) => ({ id: p.id, name: p.name })));
    } catch { /* ignore */ }
  };

  const handleRaqtoImport = async () => {
    setImporting(true);
    setImportResult(null);
    try {
      const result = await importRaqtoSalesOrders(id);
      setImportResult(result);
      if (result.counts.salesOrders > 0) {
        setTimeout(() => window.location.reload(), 2000);
      }
    } catch { /* ignore */ }
    finally { setImporting(false); }
  };

  const addItem    = () => setNewItems((prev) => [...prev, { description: "", quantity: 1, unit_price: 0, tax_rate: 10, transaction_date: "" }]);
  const removeItem = (idx: number) => setNewItems((prev) => prev.filter((_, i) => i !== idx));
  const updateItem = (idx: number, field: string, value: string | number) =>
    setNewItems((prev) => prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item)));

  const itemsSubtotal = newItems.reduce((s, item) => s + item.quantity * item.unit_price, 0);
  const itemsTax      = newItems.reduce((s, item) => s + Math.floor(item.quantity * item.unit_price * item.tax_rate / 100), 0);
  const itemsTotal    = itemsSubtotal + itemsTax;

  const handleCreateInvoice = async () => {
    if (!newInvoice.business_partner_id) return;
    setSaving(true);
    try {
      // 請求書番号が未入力でも保存可能にする。invoice_number は NOT NULL のため、
      // 空の場合のみ自動採番する（非インボイス登録事業者など番号が無い請求書に対応）。
      const today = new Date();
      const ymd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
      const prefix = newInvoice.direction === "purchase" ? "RCV" : "INV";
      const seq = invoices.filter((inv) => inv.direction === newInvoice.direction).length + 1;
      const invoiceNumber =
        newInvoice.invoice_number.trim() || `${prefix}-${ymd}-${String(seq).padStart(3, "0")}`;
      await createInvoice(
        {
          client_id: id,
          invoice_number: invoiceNumber,
          business_partner_id: newInvoice.business_partner_id,
          issued_date: newInvoice.issued_date || new Date().toISOString().split("T")[0],
          due_date: newInvoice.due_date || null,
          subtotal: itemsSubtotal,
          tax_amount: itemsTax,
          total_amount: itemsTotal,
          status: "draft",
          direction: newInvoice.direction,
        },
        newItems.filter((item) => item.description).map((item) => ({
          item_name: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
          tax_rate: item.tax_rate,
          subtotal: item.quantity * item.unit_price,
          tax_amount: Math.floor(item.quantity * item.unit_price * item.tax_rate / 100),
          transaction_date:
            item.transaction_date || newInvoice.issued_date || null,
        }))
      );
      setShowNewForm(false);
      refetch();
    } catch (e) {
      alert(e instanceof Error ? e.message : "請求書の作成に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  // ---- Render ----
  return (
    <>
      {/* ===== ヘッダー ===== */}
      <div className="flex items-center justify-between mb-6">
        {!hideHeader ? (
          <div>
            <h1 className="text-2xl font-bold text-foreground">請求書管理</h1>
            <p className="text-muted-foreground text-sm mt-1">
              {isPurchaseView
                ? "受領した請求書の登録・支払い管理"
                : isSalesView
                  ? "請求書の作成・発行・入金管理"
                  : "請求書の作成・発行・受領管理"}
            </p>
          </div>
        ) : <div />}

        <div className="flex gap-2">
          {invoices.some((inv) => !lockedDirection || inv.direction === lockedDirection) && (
            <Button variant="outline" onClick={handleClearAll} disabled={clearingAll} className="text-destructive border-destructive/30 hover:bg-destructive/10">
              {clearingAll ? <Loader2 className="size-4 animate-spin" /> : <AlertTriangle className="size-4" />}
              一括クリア
            </Button>
          )}
          {/* 発行ビューのみ: 受発注取込 */}
          {!isPurchaseView && (
            <Button variant="outline" onClick={handleRaqtoImport} disabled={importing}>
              {importing ? <Loader2 className="size-4 animate-spin" /> : <Package className="size-4" />}
              受発注から取込
            </Button>
          )}
          <Button onClick={openNewForm}>
            <Plus className="size-4" />
            {isPurchaseView ? "請求書を受領登録" : "新規請求書作成"}
          </Button>
        </div>
      </div>

      {/* Raqto取込結果 */}
      {importResult && (
        <Card className={`mb-4 p-4 border-l-4 ${importResult.success ? "border-l-success bg-success/5" : "border-l-destructive bg-destructive/5"}`}>
          <div className="flex items-center gap-3">
            <Package className={`size-5 ${importResult.success ? "text-success" : "text-destructive"}`} />
            <div className="flex-1">
              <p className="font-bold text-foreground text-sm">
                {importResult.success
                  ? `Raqto受発注管理から ${importResult.counts.salesOrders}件の受注データを取込みました`
                  : "取込に失敗しました"}
              </p>
              {importResult.errors.length > 0 && (
                <p className="text-xs text-destructive mt-1">{importResult.errors.join(", ")}</p>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={() => setImportResult(null)}><X className="size-4" /></Button>
          </div>
        </Card>
      )}

      {/* ===== 新規フォーム ===== */}
      {showNewForm && (
        <Card className="mb-6 border-primary/30 overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>
              {newInvoice.direction === "purchase" ? "受領請求書の登録" : "新規請求書作成"}
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setShowNewForm(false)}>
              <X className="size-4" />
            </Button>
          </CardHeader>
          <CardContent>
            {/* 区分選択（固定でない場合のみ） */}
            {!lockedDirection && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-foreground mb-1">区分</label>
                <div className="inline-flex gap-1 bg-muted/20 p-1 rounded-lg">
                  <button type="button"
                    onClick={() => setNewInvoice({ ...newInvoice, direction: "sales" })}
                    className={cn("px-3 py-1.5 rounded-md text-xs font-bold transition-all",
                      newInvoice.direction === "sales" ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    発行（売上請求書）
                  </button>
                  <button type="button"
                    onClick={() => setNewInvoice({ ...newInvoice, direction: "purchase" })}
                    className={cn("px-3 py-1.5 rounded-md text-xs font-bold transition-all",
                      newInvoice.direction === "purchase" ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    受領（仕入請求書）
                  </button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {newInvoice.direction === "sales"
                    ? "計上時の仕訳: 売掛金 / 売上高（＋仮受消費税）"
                    : "計上時の仕訳: 仕入高（＋仮払消費税）/ 買掛金"}
                </p>
              </div>
            )}
            {/* 固定方向の場合はラベルのみ表示 */}
            {lockedDirection && (
              <div className="mb-4 px-3 py-2 bg-muted/20 rounded-lg text-xs text-muted-foreground">
                {lockedDirection === "sales"
                  ? "発行（売上請求書）— 計上時: 売掛金 / 売上高（＋仮受消費税）"
                  : "受領（仕入請求書）— 計上時: 仕入高（＋仮払消費税）/ 買掛金"}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  {newInvoice.direction === "purchase" ? "先方請求書番号" : "請求書番号"}
                </label>
                <input type="text" value={newInvoice.invoice_number}
                  onChange={(e) => setNewInvoice({ ...newInvoice, invoice_number: e.target.value })}
                  placeholder={newInvoice.direction === "purchase" ? "取引先の請求書番号" : "INV-2024-XXXX"}
                  className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  {newInvoice.direction === "purchase" ? "仕入先" : "請求先（取引先）"}
                </label>
                <select value={newInvoice.business_partner_id}
                  onChange={(e) => setNewInvoice({ ...newInvoice, business_partner_id: e.target.value })}
                  className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">選択してください</option>
                  {partnerList.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  {newInvoice.direction === "purchase" ? "受領日" : "発行日"}
                </label>
                <input type="date" value={newInvoice.issued_date}
                  onChange={(e) => setNewInvoice({ ...newInvoice, issued_date: e.target.value })}
                  className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">支払期限</label>
                <input type="date" value={newInvoice.due_date}
                  onChange={(e) => setNewInvoice({ ...newInvoice, due_date: e.target.value })}
                  className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>

            <h4 className="text-sm font-bold text-foreground mb-2">明細</h4>
            <table className="w-full text-sm mb-4">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 text-xs font-bold text-muted-foreground w-36">取引年月日</th>
                  <th className="text-left py-2 text-xs font-bold text-muted-foreground">品目</th>
                  <th className="text-right py-2 text-xs font-bold text-muted-foreground w-20">数量</th>
                  <th className="text-right py-2 text-xs font-bold text-muted-foreground w-32">単価</th>
                  <th className="text-right py-2 text-xs font-bold text-muted-foreground w-20">税率</th>
                  <th className="text-right py-2 text-xs font-bold text-muted-foreground w-32">金額</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {newItems.map((item, idx) => (
                  <tr key={idx} className="border-b border-border/50">
                    <td className="py-2 pr-2">
                      <input type="date" value={item.transaction_date}
                        onChange={(e) => updateItem(idx, "transaction_date", e.target.value)}
                        className="w-full bg-card border border-border rounded px-2 py-1.5 text-sm"
                      />
                    </td>
                    <td className="py-2 pr-2">
                      <input type="text" value={item.description}
                        onChange={(e) => updateItem(idx, "description", e.target.value)}
                        placeholder="品目名"
                        className="w-full bg-card border border-border rounded px-2 py-1.5 text-sm"
                      />
                    </td>
                    <td className="py-2 px-2">
                      <input type="number" value={item.quantity}
                        onChange={(e) => updateItem(idx, "quantity", Number(e.target.value) || 0)}
                        className="w-full bg-card border border-border rounded px-2 py-1.5 text-sm text-right"
                      />
                    </td>
                    <td className="py-2 px-2">
                      <input type="number" value={item.unit_price || ""}
                        onChange={(e) => updateItem(idx, "unit_price", Number(e.target.value) || 0)}
                        placeholder="0"
                        className="w-full bg-card border border-border rounded px-2 py-1.5 text-sm text-right font-mono"
                      />
                    </td>
                    <td className="py-2 px-2">
                      <select value={item.tax_rate}
                        onChange={(e) => updateItem(idx, "tax_rate", Number(e.target.value))}
                        className="w-full bg-card border border-border rounded px-2 py-1.5 text-sm"
                      >
                        <option value={10}>10%</option>
                        <option value={8}>8%</option>
                        <option value={0}>0%</option>
                      </select>
                    </td>
                    <td className="py-2 px-2 text-right font-mono">
                      ¥{(item.quantity * item.unit_price).toLocaleString()}
                    </td>
                    <td className="py-2 pl-2">
                      {newItems.length > 1 && (
                        <button onClick={() => removeItem(idx)} className="text-destructive hover:text-destructive/80">
                          <Trash2 className="size-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex items-start justify-between">
              <Button variant="outline" size="sm" onClick={addItem}>
                <Plus className="size-3" />行追加
              </Button>
              <div className="text-right space-y-1">
                <p className="text-sm text-muted-foreground">小計: <span className="font-mono font-bold text-foreground">¥{itemsSubtotal.toLocaleString()}</span></p>
                <p className="text-sm text-muted-foreground">消費税: <span className="font-mono font-bold text-foreground">¥{itemsTax.toLocaleString()}</span></p>
                <p className="text-base font-bold text-foreground">合計: <span className="font-mono">¥{itemsTotal.toLocaleString()}</span></p>
              </div>
            </div>

            {newInvoice.direction === "sales" && (
              <p className="mt-3 text-xs text-muted-foreground">
                ※ 作成後、一覧の「発行・計上」で売掛金（未回収金）として計上され、「印刷」からインボイス（適格請求書）対応のレイアウトでPDF出力できます。
              </p>
            )}

            <div className="mt-4 flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setShowNewForm(false)}>キャンセル</Button>
              <Button onClick={handleCreateInvoice} disabled={saving || !newInvoice.business_partner_id}>
                {saving && <Loader2 className="size-4 animate-spin" />}
                {newInvoice.direction === "purchase" ? "受領登録" : "請求書を作成"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ===== サマリーカード ===== */}
      {!isPurchaseView && (
        // 発行ビュー: 売掛金・今月発行・期限超過
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="size-4 text-warning" />
              <span className="text-sm text-muted-foreground">未回収売掛金</span>
            </div>
            <p className="text-2xl font-bold text-foreground">{formatCurrency(unpaidReceivables)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {invoices.filter((inv) => inv.direction === "sales" && ["issued", "sent", "overdue"].includes(inv.status)).length}件 入金待ち
            </p>
          </Card>
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-2">
              <FileText className="size-4 text-primary" />
              <span className="text-sm text-muted-foreground">今月発行数</span>
            </div>
            <p className="text-2xl font-bold text-foreground">{thisMonthIssued}件</p>
            <p className="text-xs text-muted-foreground mt-1">{now.getFullYear()}年{now.getMonth() + 1}月</p>
          </Card>
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="size-4 text-destructive" />
              <span className="text-sm text-muted-foreground">入金期限超過</span>
            </div>
            <p className={cn("text-2xl font-bold", salesOverdueCount > 0 ? "text-destructive" : "text-foreground")}>
              {salesOverdueCount}件
            </p>
            <p className="text-xs text-muted-foreground mt-1">要フォローアップ</p>
          </Card>
        </div>
      )}

      {isPurchaseView && (
        // 受領ビュー: 買掛金・今月受領・支払期限超過
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-2">
              <CreditCard className="size-4 text-warning" />
              <span className="text-sm text-muted-foreground">未払い買掛金</span>
            </div>
            <p className="text-2xl font-bold text-foreground">{formatCurrency(unpaidPayables)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {invoices.filter((inv) => inv.direction === "purchase" && ["draft", "issued", "sent", "overdue"].includes(inv.status)).length}件 支払い待ち
            </p>
          </Card>
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-2">
              <ReceiptText className="size-4 text-primary" />
              <span className="text-sm text-muted-foreground">今月受領数</span>
            </div>
            <p className="text-2xl font-bold text-foreground">{thisMonthReceived}件</p>
            <p className="text-xs text-muted-foreground mt-1">{now.getFullYear()}年{now.getMonth() + 1}月</p>
          </Card>
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="size-4 text-destructive" />
              <span className="text-sm text-muted-foreground">支払期限超過</span>
            </div>
            <p className={cn("text-2xl font-bold", purchaseOverdueCount > 0 ? "text-destructive" : "text-foreground")}>
              {purchaseOverdueCount}件
            </p>
            <p className="text-xs text-muted-foreground mt-1">要支払い処理</p>
          </Card>
        </div>
      )}

      {/* すべてビューのサマリー */}
      {!isSalesView && !isPurchaseView && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="size-4 text-warning" />
              <span className="text-sm text-muted-foreground">未回収売掛金</span>
            </div>
            <p className="text-xl font-bold text-foreground">{formatCurrency(unpaidReceivables)}</p>
          </Card>
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-2">
              <CreditCard className="size-4 text-warning" />
              <span className="text-sm text-muted-foreground">未払い買掛金</span>
            </div>
            <p className="text-xl font-bold text-foreground">{formatCurrency(unpaidPayables)}</p>
          </Card>
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="size-4 text-destructive" />
              <span className="text-sm text-muted-foreground">入金期限超過</span>
            </div>
            <p className={cn("text-xl font-bold", salesOverdueCount > 0 ? "text-destructive" : "text-foreground")}>{salesOverdueCount}件</p>
          </Card>
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="size-4 text-destructive" />
              <span className="text-sm text-muted-foreground">支払期限超過</span>
            </div>
            <p className={cn("text-xl font-bold", purchaseOverdueCount > 0 ? "text-destructive" : "text-foreground")}>{purchaseOverdueCount}件</p>
          </Card>
        </div>
      )}

      {/* ===== 検索 & フィルター ===== */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {/* 発行/受領フィルター（区分固定時は非表示） */}
        {!lockedDirection && (
          <div className="inline-flex gap-1 bg-muted/20 p-1 rounded-lg shrink-0">
            {([["all", "すべて"], ["sales", "発行（売上）"], ["purchase", "受領（仕入）"]] as const).map(([key, label]) => (
              <button key={key} onClick={() => setDirectionFilter(key)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-bold transition-all whitespace-nowrap",
                  directionFilter === key ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* 期間フィルター（年度 / 月。発行日ベース） */}
        <select
          value={periodMode === "year" ? fiscalYear : ""}
          onChange={(e) => {
            const v = e.target.value;
            setFiscalYear(v);
            if (!v) { setPeriodMode("none"); setDateFrom(""); setDateTo(""); return; }
            const fy = parseInt(v);
            const { startDate, endDate } = fiscalRangeFromStartYear(fiscalStartMonth, fy);
            setDateFrom(startDate);
            setDateTo(endDate);
            setPeriodMode("year");
          }}
          className="px-2 py-2 rounded-lg border border-border bg-card text-foreground text-xs shrink-0"
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
          className="px-2 py-2 rounded-lg border border-border bg-card text-foreground text-xs shrink-0"
        />

        {/* 検索 */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input type="text"
            placeholder="請求書番号・取引先名で検索..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-card text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
      </div>

      {/* ステータスタブ */}
      <div className="flex gap-1 mb-6 bg-muted/20 p-1 rounded-lg overflow-x-auto">
        {statusTabs.map((tab) => (
          <button key={tab.key} onClick={() => setActiveStatus(tab.key)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-bold transition-all whitespace-nowrap",
              activeStatus === tab.key ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ===== テーブル ===== */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/20 border-b border-border">
                <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground">請求書番号</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground">
                  {isPurchaseView ? "仕入先" : "請求先"}
                </th>
                <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground">
                  {isPurchaseView ? "受領日" : "発行日"}
                </th>
                <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground">支払期限</th>
                <th className="text-right px-4 py-3 text-xs font-bold text-muted-foreground">税抜金額</th>
                <th className="text-right px-4 py-3 text-xs font-bold text-muted-foreground">合計（税込）</th>
                <th className="text-center px-4 py-3 text-xs font-bold text-muted-foreground">ステータス</th>
                {!lockedDirection && (
                  <th className="text-center px-4 py-3 text-xs font-bold text-muted-foreground">区分</th>
                )}
                <th className="text-center px-4 py-3 text-xs font-bold text-muted-foreground">受発注</th>
                <th className="text-center px-4 py-3 text-xs font-bold text-muted-foreground">
                  {isPurchaseView ? "計上" : "発行・計上"}
                </th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody>
              {filteredInvoices.map((inv) => {
                const cfg = statusConfig[inv.status];
                const StatusIcon = cfg.icon;
                const isPurchaseInv = inv.direction === "purchase";

                return (
                  <tr key={inv.id} className="border-b border-border last:border-0 hover:bg-muted/10">
                    {/* 請求書番号 */}
                    <td className="px-4 py-3 font-mono font-medium text-primary">
                      {inv.invoiceNumber}
                    </td>
                    {/* 取引先 */}
                    <td className="px-4 py-3 font-medium text-foreground">{inv.partnerName}</td>
                    {/* 発行日/受領日 */}
                    <td className="px-4 py-3 text-muted-foreground">{inv.issuedDate || "-"}</td>
                    {/* 支払期限 */}
                    <td className={cn("px-4 py-3", inv.status === "overdue" ? "text-destructive font-bold" : "text-muted-foreground")}>
                      {inv.dueDate || "-"}
                    </td>
                    {/* 税抜金額 */}
                    <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                      {formatCurrency(inv.subtotal)}
                    </td>
                    {/* 合計 */}
                    <td className="px-4 py-3 text-right font-mono font-bold text-foreground">
                      {formatCurrency(inv.totalAmount)}
                    </td>
                    {/* ステータス（クリックで変更可能） */}
                    <td className="px-4 py-3 text-center">
                      <div className="relative inline-flex items-center">
                        <Badge variant={cfg.variant} className="gap-1 pr-4">
                          {statusUpdatingId === inv.id ? (
                            <Loader2 className="size-3 animate-spin" />
                          ) : (
                            <StatusIcon className="size-3" />
                          )}
                          {cfg.label}
                          <ChevronDown className="size-2.5 absolute right-1 opacity-60" />
                        </Badge>
                        <select
                          value={inv.status}
                          disabled={statusUpdatingId === inv.id}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) =>
                            handleStatusChange(inv.id, e.target.value as Exclude<InvoiceStatus, "all">)
                          }
                          className="absolute inset-0 opacity-0 cursor-pointer"
                          title="ステータスを変更"
                        >
                          {(Object.entries(isPurchaseInv ? purchaseStatusConfig : salesStatusConfig) as [Exclude<InvoiceStatus, "all">, { label: string }][])
                            .map(([key, sc]) => (
                              <option key={key} value={key}>{sc.label}</option>
                            ))}
                        </select>
                      </div>
                    </td>
                    {/* 区分バッジ（すべてビューのみ） */}
                    {!lockedDirection && (
                      <td className="px-4 py-3 text-center">
                        <Badge variant={isPurchaseInv ? "accent" : "muted"} className="text-[10px]">
                          {isPurchaseInv ? "受領" : "発行"}
                        </Badge>
                      </td>
                    )}
                    {/* 受発注 */}
                    <td className="px-4 py-3 text-center">
                      {inv.raqtoOrderStatus ? (() => {
                        const rs = raqtoStatusLabels[inv.raqtoOrderStatus] ?? { label: inv.raqtoOrderStatus, variant: "muted" as const };
                        return <Badge variant={rs.variant}>{rs.label}</Badge>;
                      })() : <span className="text-muted-foreground text-xs">-</span>}
                    </td>
                    {/* アクション: 発行・計上 / 計上 / 印刷 */}
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        {inv.status === "draft" && !isPurchaseInv && (
                          <Button size="sm" variant="outline" disabled={issuingId === inv.id}
                            onClick={(e) => { e.stopPropagation(); handleIssueInvoice(inv.id, inv.direction); }}
                            className="text-xs gap-1"
                          >
                            {issuingId === inv.id ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                            発行・計上
                          </Button>
                        )}
                        {(inv.status === "draft" || inv.status === "issued") && isPurchaseInv && (
                          <Button size="sm" variant="outline" disabled={issuingId === inv.id}
                            onClick={(e) => { e.stopPropagation(); handleIssueInvoice(inv.id, inv.direction); }}
                            className="text-xs gap-1 border-accent/50 text-accent hover:bg-accent/10"
                          >
                            {issuingId === inv.id ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                            計上
                          </Button>
                        )}
                        {!isPurchaseInv && (
                          <Button size="sm" variant="ghost"
                            onClick={(e) => { e.stopPropagation(); router.push(`/clients/${id}/invoices/print/${inv.id}`); }}
                            className="text-xs gap-1"
                            title="インボイス対応の請求書を印刷 / PDF保存"
                          >
                            <Printer className="size-3.5" />
                            印刷
                          </Button>
                        )}
                      </div>
                    </td>
                    {/* 削除 */}
                    <td className="px-4 py-3 text-center">
                      <button onClick={(e) => { e.stopPropagation(); handleDeleteInvoice(inv.id); }}
                        disabled={deletingId === inv.id}
                        className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                      >
                        {deletingId === inv.id ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filteredInvoices.length === 0 && (
                <tr>
                  <td colSpan={lockedDirection ? 10 : 11} className="px-4 py-12 text-center text-muted-foreground">
                    該当する請求書が見つかりません
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

