"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import {
  Handshake,
  Plus,
  Search,
  Check,
  X,
  Phone,
  Mail,
  TrendingUp,
  TrendingDown,
  Building2,
  Loader2,
  RefreshCw,
  Package,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import { createPartner, deletePartner, deleteAllPartners } from "@/actions/partners";
import { syncRaqtoPartners, type RaqtoSyncResult } from "@/actions/raqto-sync";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency } from "@/lib/utils";
import { useData } from "@/lib/use-data";
import { getPartners } from "@/actions/partners";

type PartnerFilter = "all" | "customer" | "supplier";
type PartnerType = "customer" | "supplier" | "both";

type Partner = {
  id: string;
  name: string;
  type: PartnerType;
  phone: string;
  email: string;
  invoiceRegistrationNumber: string;
  isInvoiceRegistered: boolean;
  totalSales: number;
  totalPurchases: number;
  address: string;
};

const filterOptions: { key: PartnerFilter; label: string }[] = [
  { key: "all", label: "すべて" },
  { key: "customer", label: "得意先" },
  { key: "supplier", label: "仕入先" },
];

const typeConfig: Record<
  PartnerType,
  { label: string; variant: "default" | "success" | "warning" | "destructive" | "muted" | "accent" }
> = {
  customer: { label: "得意先", variant: "default" },
  supplier: { label: "仕入先", variant: "accent" },
  both: { label: "両方", variant: "warning" },
};


export default function PartnersPage() {
  const { id } = useParams<{ id: string }>();
  const [filter, setFilter] = useState<PartnerFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showNewForm, setShowNewForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [raqtoSyncing, setRaqtoSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<RaqtoSyncResult | null>(null);
  const [newPartner, setNewPartner] = useState({
    name: "",
    type: "customer" as "customer" | "vendor" | "both",
    telephone: "",
    email: "",
    address: "",
    invoice_registration_number: "",
  });

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [clearingAll, setClearingAll] = useState(false);

  const handleDeletePartner = async (partnerId: string) => {
    if (!confirm("この取引先を削除しますか？")) return;
    setDeletingId(partnerId);
    try {
      await deletePartner(partnerId);
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : "削除に失敗しました（請求書が紐付いている可能性があります）");
    } finally {
      setDeletingId(null);
    }
  };

  const handleClearAll = async () => {
    if (!confirm("すべての取引先と関連する請求書を一括削除しますか？この操作は元に戻せません。")) return;
    setClearingAll(true);
    try {
      await deleteAllPartners(id);
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : "一括削除に失敗しました");
    } finally {
      setClearingAll(false);
    }
  };

  const handleRaqtoSync = async () => {
    setRaqtoSyncing(true);
    setSyncResult(null);
    try {
      const result = await syncRaqtoPartners(id);
      setSyncResult(result);
      if (result.counts.partners > 0) {
        setTimeout(() => window.location.reload(), 2000);
      }
    } catch {
      // ignore
    } finally {
      setRaqtoSyncing(false);
    }
  };

  async function handleCreatePartner(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await createPartner({
        client_id: id,
        name: newPartner.name,
        type: newPartner.type,
        telephone: newPartner.telephone || undefined,
        email: newPartner.email || undefined,
        address: newPartner.address || undefined,
        invoice_registration_number: newPartner.invoice_registration_number || undefined,
        is_invoice_registered: !!newPartner.invoice_registration_number,
      });
      setShowNewForm(false);
      setNewPartner({ name: "", type: "customer", telephone: "", email: "", address: "", invoice_registration_number: "" });
      window.location.reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : "登録に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  const { data: partners, refetch } = useData(
    () =>
      getPartners(id).then((rows) =>
        rows.map((r) => ({
          id: r.id,
          name: r.name,
          type: (r.type === "vendor" ? "supplier" : r.type) as PartnerType,
          phone: r.telephone ?? "",
          email: r.email ?? "",
          invoiceRegistrationNumber: r.invoice_registration_number ?? "",
          isInvoiceRegistered: r.is_invoice_registered,
          totalSales: 0,
          totalPurchases: 0,
          address: r.address ?? "",
        }))
      ),
    [] as Partner[]
  );

  const filteredPartners = partners.filter((partner) => {
    if (filter === "customer" && partner.type === "supplier") return false;
    if (filter === "supplier" && partner.type === "customer") return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        partner.name.toLowerCase().includes(q) ||
        partner.phone.includes(q) ||
        partner.email.toLowerCase().includes(q) ||
        partner.invoiceRegistrationNumber.includes(q)
      );
    }
    return true;
  });

  const customerCount = partners.filter(
    (p) => p.type === "customer" || p.type === "both"
  ).length;
  const supplierCount = partners.filter(
    (p) => p.type === "supplier" || p.type === "both"
  ).length;
  const invoiceRegisteredCount = partners.filter(
    (p) => p.isInvoiceRegistered
  ).length;

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">取引先管理</h1>
          <p className="text-muted-foreground text-sm mt-1">
            得意先・仕入先の管理とインボイス登録状況
          </p>
        </div>
        <div className="flex gap-2">
          {partners.length > 0 && (
            <Button variant="outline" onClick={handleClearAll} disabled={clearingAll} className="text-destructive border-destructive/30 hover:bg-destructive/10">
              {clearingAll ? <Loader2 className="size-4 animate-spin" /> : <AlertTriangle className="size-4" />}
              一括クリア
            </Button>
          )}
          <Button variant="outline" onClick={handleRaqtoSync} disabled={raqtoSyncing}>
            {raqtoSyncing ? <Loader2 className="size-4 animate-spin" /> : <Package className="size-4" />}
            受発注と同期
          </Button>
          <Button onClick={() => setShowNewForm(!showNewForm)}>
            <Plus className="size-4" />
            取引先登録
          </Button>
        </div>
      </div>

      {syncResult && (
        <Card className={`mb-4 p-4 border-l-4 ${syncResult.success ? "border-l-success bg-success/5" : "border-l-destructive bg-destructive/5"}`}>
          <div className="flex items-center gap-3">
            <Package className={`size-5 ${syncResult.success ? "text-success" : "text-destructive"}`} />
            <div className="flex-1">
              <p className="font-bold text-foreground text-sm">
                {syncResult.success
                  ? `Raqto受発注管理から ${syncResult.counts.partners}件の取引先を同期しました`
                  : "同期に失敗しました"}
              </p>
              {syncResult.errors.length > 0 && (
                <p className="text-xs text-destructive mt-1">{syncResult.errors.join(", ")}</p>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={() => setSyncResult(null)}>
              <X className="size-4" />
            </Button>
          </div>
        </Card>
      )}

      {showNewForm && (
        <Card className="mb-6 p-6">
          <h3 className="text-sm font-bold text-foreground mb-4">新規取引先登録</h3>
          <form onSubmit={handleCreatePartner} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-muted-foreground mb-1">取引先名 *</label>
              <input type="text" required value={newPartner.name} onChange={(e) => setNewPartner({ ...newPartner, name: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm" />
            </div>
            <div>
              <label className="block text-xs font-bold text-muted-foreground mb-1">区分 *</label>
              <select value={newPartner.type} onChange={(e) => setNewPartner({ ...newPartner, type: e.target.value as "customer" | "vendor" | "both" })} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm">
                <option value="customer">得意先</option>
                <option value="vendor">仕入先</option>
                <option value="both">両方</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-muted-foreground mb-1">電話番号</label>
              <input type="tel" value={newPartner.telephone} onChange={(e) => setNewPartner({ ...newPartner, telephone: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm" />
            </div>
            <div>
              <label className="block text-xs font-bold text-muted-foreground mb-1">メールアドレス</label>
              <input type="email" value={newPartner.email} onChange={(e) => setNewPartner({ ...newPartner, email: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-muted-foreground mb-1">住所</label>
              <input type="text" value={newPartner.address} onChange={(e) => setNewPartner({ ...newPartner, address: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-muted-foreground mb-1">適格請求書登録番号</label>
              <input type="text" value={newPartner.invoice_registration_number} onChange={(e) => setNewPartner({ ...newPartner, invoice_registration_number: e.target.value })} placeholder="T1234567890123" className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm" />
            </div>
            <div className="md:col-span-2 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setShowNewForm(false)}>キャンセル</Button>
              <Button type="submit" disabled={saving}>
                {saving ? <><Loader2 className="size-4 animate-spin" />保存中...</> : "登録"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <Handshake className="size-4 text-primary" />
            <span className="text-xs text-muted-foreground">取引先総数</span>
          </div>
          <p className="text-2xl font-bold text-foreground">
            {partners.length}件
          </p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="size-4 text-success" />
            <span className="text-xs text-muted-foreground">得意先</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{customerCount}件</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <TrendingDown className="size-4 text-primary-light" />
            <span className="text-xs text-muted-foreground">仕入先</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{supplierCount}件</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <Building2 className="size-4 text-warning" />
            <span className="text-xs text-muted-foreground">インボイス登録済</span>
          </div>
          <p className="text-2xl font-bold text-foreground">
            {invoiceRegisteredCount}/{partners.length}
          </p>
        </Card>
      </div>

      {/* Search and filter */}
      <Card className="mb-6 p-4">
        <div className="flex items-center gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="取引先名・電話番号・メール・登録番号で検索..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-card text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div className="flex gap-1 bg-muted/20 p-1 rounded-lg">
            {filterOptions.map((opt) => (
              <button
                key={opt.key}
                onClick={() => setFilter(opt.key)}
                className={cn(
                  "px-4 py-1.5 rounded-md text-sm font-bold transition-all",
                  filter === opt.key
                    ? "bg-card text-primary shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* Partners table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/20 border-b border-border">
                <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground">
                  取引先名
                </th>
                <th className="text-center px-4 py-3 text-xs font-bold text-muted-foreground">
                  区分
                </th>
                <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground">
                  電話番号
                </th>
                <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground">
                  メールアドレス
                </th>
                <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground">
                  適格請求書登録番号
                </th>
                <th className="text-center px-4 py-3 text-xs font-bold text-muted-foreground">
                  登録
                </th>
                <th className="text-right px-4 py-3 text-xs font-bold text-muted-foreground">
                  売上高
                </th>
                <th className="text-right px-4 py-3 text-xs font-bold text-muted-foreground">
                  仕入高
                </th>
                <th className="w-12" />
              </tr>
            </thead>
            <tbody>
              {filteredPartners.map((partner) => {
                const config = typeConfig[partner.type];
                return (
                  <tr
                    key={partner.id}
                    className="border-b border-border last:border-0 hover:bg-muted/10 cursor-pointer"
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">{partner.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {partner.address}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge variant={config.variant}>{config.label}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <Phone className="size-3" />
                        {partner.phone}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1.5 text-muted-foreground">
                        <Mail className="size-3" />
                        {partner.email}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {partner.invoiceRegistrationNumber || "-"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {partner.isInvoiceRegistered ? (
                        <span className="inline-flex items-center justify-center size-6 rounded-full bg-green-500/10">
                          <Check className="size-4 text-success" />
                        </span>
                      ) : (
                        <span className="inline-flex items-center justify-center size-6 rounded-full bg-destructive/10">
                          <X className="size-4 text-destructive" />
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {partner.totalSales > 0 ? (
                        <span className="text-foreground font-medium">
                          {formatCurrency(partner.totalSales)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {partner.totalPurchases > 0 ? (
                        <span className="text-foreground font-medium">
                          {formatCurrency(partner.totalPurchases)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeletePartner(partner.id); }}
                        disabled={deletingId === partner.id}
                        className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                      >
                        {deletingId === partner.id ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filteredPartners.length === 0 && (
                <tr>
                  <td
                    colSpan={9}
                    className="px-4 py-12 text-center text-muted-foreground"
                  >
                    該当する取引先が見つかりません
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
