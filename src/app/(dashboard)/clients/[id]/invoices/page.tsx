"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import {
  FileText,
  Plus,
  Search,
  AlertCircle,
  Clock,
  CheckCircle,
  Send,
  Ban,
  Filter,
  Loader2,
  X,
  Trash2,
  RefreshCw,
  Package,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency } from "@/lib/utils";
import { useData } from "@/lib/use-data";
import { getInvoices, createInvoice, deleteInvoice, deleteAllInvoices, issueInvoiceWithJournal } from "@/actions/invoices";
import { getPartners } from "@/actions/partners";
import { importRaqtoSalesOrders, type RaqtoSyncResult } from "@/actions/raqto-sync";

type InvoiceStatus = "all" | "draft" | "issued" | "sent" | "paid" | "overdue" | "void";

const statusTabs: { key: InvoiceStatus; label: string }[] = [
  { key: "all", label: "すべて" },
  { key: "draft", label: "下書き" },
  { key: "issued", label: "発行済" },
  { key: "sent", label: "送付済" },
  { key: "paid", label: "入金済" },
  { key: "overdue", label: "期限超過" },
  { key: "void", label: "無効" },
];

type Invoice = {
  id: string;
  invoiceNumber: string;
  partnerName: string;
  issuedDate: string;
  dueDate: string;
  subtotal10: number;
  tax10: number;
  subtotal8: number;
  tax8: number;
  totalAmount: number;
  status: Exclude<InvoiceStatus, "all">;
  raqtoOrderStatus: string | null;
};

const raqtoStatusLabels: Record<string, { label: string; variant: "default" | "success" | "warning" | "destructive" | "muted" | "accent" }> = {
  draft: { label: "下書き", variant: "muted" },
  confirmed: { label: "確定", variant: "default" },
  sent: { label: "送付済", variant: "accent" },
  delivered: { label: "納品済", variant: "default" },
  payment_pending: { label: "入金待ち", variant: "warning" },
  payment_completed: { label: "入金済", variant: "success" },
  completed: { label: "完了", variant: "success" },
  canceled: { label: "キャンセル", variant: "destructive" },
  order: { label: "受注", variant: "muted" },
  document: { label: "書類", variant: "accent" },
};


const statusConfig: Record<
  Exclude<InvoiceStatus, "all">,
  { label: string; variant: "default" | "success" | "warning" | "destructive" | "muted" | "accent"; icon: typeof FileText }
> = {
  draft: { label: "下書き", variant: "muted", icon: FileText },
  issued: { label: "発行済", variant: "default", icon: CheckCircle },
  sent: { label: "送付済", variant: "accent", icon: Send },
  paid: { label: "入金済", variant: "success", icon: CheckCircle },
  overdue: { label: "期限超過", variant: "destructive", icon: AlertCircle },
  void: { label: "無効", variant: "muted", icon: Ban },
};

export function InvoicesPageContent({ hideHeader = false }: { hideHeader?: boolean }) {
  const { id } = useParams<{ id: string }>();
  const [activeStatus, setActiveStatus] = useState<InvoiceStatus>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showNewForm, setShowNewForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [partnerList, setPartnerList] = useState<{ id: string; name: string }[]>([]);
  const [newInvoice, setNewInvoice] = useState({
    invoice_number: "",
    business_partner_id: "",
    issued_date: new Date().toISOString().split("T")[0],
    due_date: "",
  });
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<RaqtoSyncResult | null>(null);
  const [newItems, setNewItems] = useState([
    { description: "", quantity: 1, unit_price: 0, tax_rate: 10 },
  ]);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [issuingId, setIssuingId] = useState<string | null>(null);
  const [clearingAll, setClearingAll] = useState(false);

  const handleIssueInvoice = async (invoiceId: string) => {
    if (!confirm("この請求書を発行し、売掛金の仕訳を自動作成しますか？")) return;
    setIssuingId(invoiceId);
    try {
      await issueInvoiceWithJournal(invoiceId);
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : "発行に失敗しました");
    } finally {
      setIssuingId(null);
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
    if (!confirm("すべての請求書を一括削除しますか？この操作は元に戻せません。")) return;
    setClearingAll(true);
    try {
      await deleteAllInvoices(id);
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : "一括削除に失敗しました");
    } finally {
      setClearingAll(false);
    }
  };

  const openNewForm = async () => {
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
    } catch {
      // ignore
    } finally {
      setImporting(false);
    }
  };

  const addItem = () => setNewItems((prev) => [...prev, { description: "", quantity: 1, unit_price: 0, tax_rate: 10 }]);
  const removeItem = (idx: number) => setNewItems((prev) => prev.filter((_, i) => i !== idx));
  const updateItem = (idx: number, field: string, value: string | number) =>
    setNewItems((prev) => prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item)));

  const itemsSubtotal = newItems.reduce((s, item) => s + item.quantity * item.unit_price, 0);
  const itemsTax = newItems.reduce((s, item) => s + Math.floor(item.quantity * item.unit_price * item.tax_rate / 100), 0);
  const itemsTotal = itemsSubtotal + itemsTax;

  const handleCreateInvoice = async () => {
    if (!newInvoice.invoice_number || !newInvoice.business_partner_id) return;
    setSaving(true);
    try {
      await createInvoice(
        {
          client_id: id,
          invoice_number: newInvoice.invoice_number,
          business_partner_id: newInvoice.business_partner_id,
          issued_date: newInvoice.issued_date || new Date().toISOString().split("T")[0],
          due_date: newInvoice.due_date || null,
          subtotal: itemsSubtotal,
          tax_amount: itemsTax,
          total_amount: itemsTotal,
          status: "draft",
        },
        newItems.filter((item) => item.description).map((item) => ({
          item_name: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
          tax_rate: item.tax_rate,
          subtotal: item.quantity * item.unit_price,
          tax_amount: Math.floor(item.quantity * item.unit_price * item.tax_rate / 100),
        }))
      );
      window.location.reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : "請求書の作成に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const { data: invoices, refetch } = useData(
    () =>
      getInvoices(id).then((rows) =>
        rows.map((r) => ({
          id: r.id,
          invoiceNumber: r.invoice_number,
          partnerName: (r as unknown as { business_partners?: { name?: string } }).business_partners?.name ?? "",
          issuedDate: r.issued_date?.replace(/-/g, "/") ?? "",
          dueDate: r.due_date?.replace(/-/g, "/") ?? "",
          subtotal10: r.subtotal,
          tax10: r.tax_amount,
          subtotal8: 0,
          tax8: 0,
          totalAmount: r.total_amount,
          status: r.status as Exclude<InvoiceStatus, "all">,
          raqtoOrderStatus: r.raqto_order_status ?? null,
        }))
      ),
    [] as Invoice[]
  );

  const filteredInvoices = invoices.filter((inv) => {
    if (activeStatus !== "all" && inv.status !== activeStatus) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        inv.invoiceNumber.toLowerCase().includes(q) ||
        inv.partnerName.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const unpaidTotal = invoices
    .filter((inv) => ["issued", "sent", "overdue"].includes(inv.status))
    .reduce((sum, inv) => sum + inv.totalAmount, 0);

  const now = new Date();
  const thisMonthPrefix = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}`;
  const thisMonthCount = invoices.filter(
    (inv) => inv.issuedDate.startsWith(thisMonthPrefix)
  ).length;

  const overdueCount = invoices.filter(
    (inv) => inv.status === "overdue"
  ).length;

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        {!hideHeader ? (
          <div>
            <h1 className="text-2xl font-bold text-foreground">請求書管理</h1>
            <p className="text-muted-foreground text-sm mt-1">
              請求書の作成・発行・管理
            </p>
          </div>
        ) : <div />}
        <div className="flex gap-2">
          {invoices.length > 0 && (
            <Button variant="outline" onClick={handleClearAll} disabled={clearingAll} className="text-destructive border-destructive/30 hover:bg-destructive/10">
              {clearingAll ? <Loader2 className="size-4 animate-spin" /> : <AlertTriangle className="size-4" />}
              一括クリア
            </Button>
          )}
          <Button variant="outline" onClick={handleRaqtoImport} disabled={importing}>
            {importing ? <Loader2 className="size-4 animate-spin" /> : <Package className="size-4" />}
            受発注から取込
          </Button>
          <Button onClick={openNewForm}>
            <Plus className="size-4" />
            新規請求書
          </Button>
        </div>
      </div>

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
            <Button variant="ghost" size="sm" onClick={() => setImportResult(null)}>
              <X className="size-4" />
            </Button>
          </div>
        </Card>
      )}

      {showNewForm && (
        <Card className="mb-6 border-primary/30 overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>新規請求書</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setShowNewForm(false)}>
              <X className="size-4" />
            </Button>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">請求書番号</label>
                <input
                  type="text"
                  value={newInvoice.invoice_number}
                  onChange={(e) => setNewInvoice({ ...newInvoice, invoice_number: e.target.value })}
                  placeholder="INV-2024-XXXX"
                  className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">取引先</label>
                <select
                  value={newInvoice.business_partner_id}
                  onChange={(e) => setNewInvoice({ ...newInvoice, business_partner_id: e.target.value })}
                  className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">選択してください</option>
                  {partnerList.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">発行日</label>
                <input
                  type="date"
                  value={newInvoice.issued_date}
                  onChange={(e) => setNewInvoice({ ...newInvoice, issued_date: e.target.value })}
                  className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">支払期限</label>
                <input
                  type="date"
                  value={newInvoice.due_date}
                  onChange={(e) => setNewInvoice({ ...newInvoice, due_date: e.target.value })}
                  className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>

            <h4 className="text-sm font-bold text-foreground mb-2">明細</h4>
            <table className="w-full text-sm mb-4">
              <thead>
                <tr className="border-b border-border">
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
                      <input
                        type="text"
                        value={item.description}
                        onChange={(e) => updateItem(idx, "description", e.target.value)}
                        placeholder="品目名"
                        className="w-full bg-card border border-border rounded px-2 py-1.5 text-sm"
                      />
                    </td>
                    <td className="py-2 px-2">
                      <input
                        type="number"
                        value={item.quantity}
                        onChange={(e) => updateItem(idx, "quantity", Number(e.target.value) || 0)}
                        className="w-full bg-card border border-border rounded px-2 py-1.5 text-sm text-right"
                      />
                    </td>
                    <td className="py-2 px-2">
                      <input
                        type="number"
                        value={item.unit_price || ""}
                        onChange={(e) => updateItem(idx, "unit_price", Number(e.target.value) || 0)}
                        placeholder="0"
                        className="w-full bg-card border border-border rounded px-2 py-1.5 text-sm text-right font-mono"
                      />
                    </td>
                    <td className="py-2 px-2">
                      <select
                        value={item.tax_rate}
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
                <Plus className="size-3" />
                行追加
              </Button>
              <div className="text-right space-y-1">
                <p className="text-sm text-muted-foreground">小計: <span className="font-mono font-bold text-foreground">¥{itemsSubtotal.toLocaleString()}</span></p>
                <p className="text-sm text-muted-foreground">消費税: <span className="font-mono font-bold text-foreground">¥{itemsTax.toLocaleString()}</span></p>
                <p className="text-base font-bold text-foreground">合計: <span className="font-mono">¥{itemsTotal.toLocaleString()}</span></p>
              </div>
            </div>

            <div className="mt-4 flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setShowNewForm(false)}>キャンセル</Button>
              <Button onClick={handleCreateInvoice} disabled={saving || !newInvoice.invoice_number || !newInvoice.business_partner_id}>
                {saving && <Loader2 className="size-4 animate-spin" />}
                請求書を作成
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="size-4 text-warning" />
            <span className="text-sm text-muted-foreground">未入金合計</span>
          </div>
          <p className="text-2xl font-bold text-foreground">
            {formatCurrency(unpaidTotal)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {invoices.filter((inv) =>
              ["issued", "sent", "overdue"].includes(inv.status)
            ).length}
            件
          </p>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-2">
            <FileText className="size-4 text-primary" />
            <span className="text-sm text-muted-foreground">今月発行数</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{thisMonthCount}件</p>
          <p className="text-xs text-muted-foreground mt-1">{now.getFullYear()}年{now.getMonth() + 1}月</p>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="size-4 text-destructive" />
            <span className="text-sm text-muted-foreground">期限超過数</span>
          </div>
          <p className={cn("text-2xl font-bold", overdueCount > 0 ? "text-destructive" : "text-foreground")}>
            {overdueCount}件
          </p>
          <p className="text-xs text-muted-foreground mt-1">要対応</p>
        </Card>
      </div>

      {/* Search */}
      <Card className="mb-4 p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="請求書番号・取引先名で検索..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-card text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
      </Card>

      {/* Status filter tabs */}
      <div className="flex gap-1 mb-6 bg-muted/20 p-1 rounded-lg overflow-x-auto">
        {statusTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveStatus(tab.key)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-bold transition-all whitespace-nowrap",
              activeStatus === tab.key
                ? "bg-card text-primary shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Invoice table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/20 border-b border-border">
                <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground">
                  請求書番号
                </th>
                <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground">
                  取引先
                </th>
                <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground">
                  発行日
                </th>
                <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground">
                  支払期限
                </th>
                <th className="text-right px-4 py-3 text-xs font-bold text-muted-foreground">
                  税抜10%
                </th>
                <th className="text-right px-4 py-3 text-xs font-bold text-muted-foreground">
                  税抜8%
                </th>
                <th className="text-right px-4 py-3 text-xs font-bold text-muted-foreground">
                  合計金額(税込)
                </th>
                <th className="text-center px-4 py-3 text-xs font-bold text-muted-foreground">
                  ステータス
                </th>
                <th className="text-center px-4 py-3 text-xs font-bold text-muted-foreground">
                  受発注
                </th>
                <th className="text-center px-4 py-3 text-xs font-bold text-muted-foreground">
                  発行
                </th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody>
              {filteredInvoices.map((inv) => {
                const config = statusConfig[inv.status];
                return (
                  <tr
                    key={inv.id}
                    className="border-b border-border last:border-0 hover:bg-muted/10 cursor-pointer"
                  >
                    <td className="px-4 py-3 font-mono font-medium text-primary">
                      {inv.invoiceNumber}
                    </td>
                    <td className="px-4 py-3 font-medium text-foreground">
                      {inv.partnerName}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {inv.issuedDate || "-"}
                    </td>
                    <td
                      className={cn(
                        "px-4 py-3",
                        inv.status === "overdue"
                          ? "text-destructive font-bold"
                          : "text-muted-foreground"
                      )}
                    >
                      {inv.dueDate}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                      {inv.subtotal10 > 0 ? formatCurrency(inv.subtotal10) : "-"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                      {inv.subtotal8 > 0 ? formatCurrency(inv.subtotal8) : "-"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-foreground">
                      {formatCurrency(inv.totalAmount)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge variant={config.variant}>{config.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {inv.raqtoOrderStatus ? (() => {
                        const rs = raqtoStatusLabels[inv.raqtoOrderStatus] ?? { label: inv.raqtoOrderStatus, variant: "muted" as const };
                        return <Badge variant={rs.variant}>{rs.label}</Badge>;
                      })() : <span className="text-muted-foreground">-</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {inv.status === "draft" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={issuingId === inv.id}
                          onClick={(e) => { e.stopPropagation(); handleIssueInvoice(inv.id); }}
                          className="text-xs"
                        >
                          {issuingId === inv.id ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                          発行
                        </Button>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteInvoice(inv.id); }}
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
                  <td
                    colSpan={11}
                    className="px-4 py-12 text-center text-muted-foreground"
                  >
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

export default function InvoicesPage() {
  return <InvoicesPageContent />;
}
