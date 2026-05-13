"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import {
  CreditCard,
  Plus,
  ArrowRight,
  CheckCircle,
  Zap,
  Clock,
  Link2,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency } from "@/lib/utils";
import { useData } from "@/lib/use-data";
import { getPayments, createPayment, allocatePayment, autoMatchBankDeposits } from "@/actions/payments";
import { getPartners } from "@/actions/partners";
import { getUnpaidInvoices } from "@/actions/invoices";

type UnmatchedPayment = {
  id: string;
  date: string;
  payer: string;
  amount: number;
  bankName: string;
  matchSuggestion: string | null;
};

type UnpaidInvoice = {
  id: string;
  invoiceNumber: string;
  partnerName: string;
  dueDate: string;
  amount: number;
  matchSuggestion: string | null;
};

type AllocationRecord = {
  id: number;
  date: string;
  paymentPayer: string;
  invoiceNumber: string;
  amount: number;
  allocatedAt: string;
};

export default function PaymentsPage() {
  const { id } = useParams<{ id: string }>();
  const [selectedPayment, setSelectedPayment] = useState<string | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [autoMatching, setAutoMatching] = useState(false);
  const [partnerList, setPartnerList] = useState<{ id: string; name: string }[]>([]);
  const [newPayment, setNewPayment] = useState({
    payment_date: "",
    amount: "",
    business_partner_id: "",
    payment_method: "bank_transfer",
    memo: "",
  });

  async function loadPartners() {
    try {
      const ps = await getPartners(id);
      setPartnerList(ps.map((p) => ({ id: p.id, name: p.name })));
    } catch { /* ignore */ }
  }

  async function handleAutoMatch() {
    if (!confirm("銀行入金データから自動消込を実行しますか？")) return;
    setAutoMatching(true);
    try {
      const result = await autoMatchBankDeposits(id);
      if (result.matched > 0) {
        alert(`${result.matched}件を自動消込しました。${result.skipped > 0 ? `（${result.skipped}件はマッチなし）` : ""}`);
      } else {
        alert("自動消込できる入金データが見つかりませんでした。");
      }
      refetch();
      refetchInvoices();
    } catch (err) {
      alert(err instanceof Error ? err.message : "自動消込に失敗しました");
    } finally {
      setAutoMatching(false);
    }
  }

  async function handleCreatePayment(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await createPayment({
        client_id: id,
        payment_date: newPayment.payment_date,
        amount: Number(newPayment.amount),
        business_partner_id: newPayment.business_partner_id,
        payment_method: newPayment.payment_method,
        memo: newPayment.memo || undefined,
      });
      setShowNewForm(false);
      setNewPayment({ payment_date: "", amount: "", business_partner_id: "", payment_method: "bank_transfer", memo: "" });
      refetch();
      if (typeof refetchInvoices === 'function') refetchInvoices();
    } catch (err) {
      alert(err instanceof Error ? err.message : "登録に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  const { data: dbPayments, refetch } = useData(
    () => getPayments(id),
    null
  );

  const { data: dbUnpaidInvoices, refetch: refetchInvoices } = useData(
    () => getUnpaidInvoices(id),
    null
  );

  const unmatchedPayments: UnmatchedPayment[] = dbPayments
    ? dbPayments
        .filter((p) => {
          const allocs = (p as any).payment_allocations ?? [];
          const allocatedTotal = allocs.reduce((sum: number, a: any) => sum + (a.allocated_amount ?? 0), 0);
          return allocatedTotal < p.amount;
        })
        .map((p) => {
          const allocs = (p as any).payment_allocations ?? [];
          const allocatedTotal = allocs.reduce((sum: number, a: any) => sum + (a.allocated_amount ?? 0), 0);
          const remaining = p.amount - allocatedTotal;
          const partner = (p as any).business_partners;
          return {
            id: p.id,
            date: p.payment_date.replace(/-/g, "/"),
            payer: partner?.name ?? "",
            amount: remaining,
            bankName: p.payment_method ?? "",
            matchSuggestion: null as string | null,
          };
        })
    : [];

  const unpaidInvoices: UnpaidInvoice[] = dbUnpaidInvoices
    ? dbUnpaidInvoices.map((inv: any) => {
        const partner = inv.business_partners;
        const invAllocated = (inv.payment_allocations ?? [])
          .reduce((s: number, a: any) => s + (a.allocated_amount ?? 0), 0);
        const remaining = inv.total_amount - invAllocated;
        return {
          id: inv.id,
          invoiceNumber: inv.invoice_number,
          partnerName: partner?.name ?? "",
          dueDate: (inv.due_date ?? inv.issued_date ?? "").replace(/-/g, "/"),
          amount: remaining,
          matchSuggestion: null as string | null,
        };
      })
    : [];

  // Auto-match: partner + amount match
  for (const p of unmatchedPayments) {
    const dbPayment = dbPayments?.find((dp) => dp.id === p.id);
    if (!dbPayment) continue;
    const match = dbUnpaidInvoices?.find((inv: any) => {
      const invAllocated = (inv.payment_allocations ?? [])
        .reduce((s: number, a: any) => s + (a.allocated_amount ?? 0), 0);
      const invRemaining = inv.total_amount - invAllocated;
      return inv.business_partner_id === dbPayment.business_partner_id
        && Math.abs(invRemaining - p.amount) < 1;
    });
    if (match) p.matchSuggestion = match.id;
  }
  for (const inv of unpaidInvoices) {
    const matchPayment = unmatchedPayments.find((p) => p.matchSuggestion === inv.id);
    if (matchPayment) inv.matchSuggestion = matchPayment.id;
  }

  // Use DB data to build allocation history when available
  const currentAllocations = dbPayments
    ? dbPayments
        .filter((p) => {
          const allocs = (p as unknown as { payment_allocations?: unknown[] }).payment_allocations;
          return allocs && allocs.length > 0;
        })
        .flatMap((p) => {
          const allocs = (p as unknown as { payment_allocations?: Array<{ id: string; allocated_amount: number; invoices?: { invoice_number: string } | null }> }).payment_allocations ?? [];
          const partner = (p as unknown as { business_partners?: { name: string } }).business_partners;
          return allocs.map((a, i) => ({
            id: i + 1,
            date: p.payment_date.replace(/-/g, "/"),
            paymentPayer: partner?.name ?? "",
            invoiceNumber: a.invoices?.invoice_number ?? "",
            amount: a.allocated_amount,
            allocatedAt: p.payment_date.replace(/-/g, "/"),
          }));
        })
    : [];

  const unmatchedPaymentTotal = unmatchedPayments.reduce(
    (sum, p) => sum + p.amount,
    0
  );
  const unpaidInvoiceTotal = unpaidInvoices.reduce(
    (sum, inv) => sum + inv.amount,
    0
  );
  const allocatedCount = currentAllocations.length;

  const matchingPayments = unmatchedPayments.filter(
    (p) => p.matchSuggestion !== null
  );

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">入金消込</h1>
          <p className="text-muted-foreground text-sm mt-1">
            入金と請求書の照合・消込処理
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleAutoMatch} disabled={autoMatching}>
            {autoMatching ? <Loader2 className="size-4 animate-spin" /> : <Zap className="size-4" />}
            銀行入金から自動消込
          </Button>
          <Button onClick={() => { setShowNewForm(!showNewForm); if (!showNewForm) loadPartners(); }}>
            <Plus className="size-4" />
            入金登録
          </Button>
        </div>
      </div>

      {showNewForm && (
        <Card className="mb-6 p-6">
          <h3 className="text-sm font-bold text-foreground mb-4">新規入金登録</h3>
          <form onSubmit={handleCreatePayment} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-muted-foreground mb-1">入金日 *</label>
              <input type="date" required value={newPayment.payment_date} onChange={(e) => setNewPayment({ ...newPayment, payment_date: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm" />
            </div>
            <div>
              <label className="block text-xs font-bold text-muted-foreground mb-1">金額 *</label>
              <input type="number" required min="1" value={newPayment.amount} onChange={(e) => setNewPayment({ ...newPayment, amount: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm" />
            </div>
            <div>
              <label className="block text-xs font-bold text-muted-foreground mb-1">取引先 *</label>
              <select required value={newPayment.business_partner_id} onChange={(e) => setNewPayment({ ...newPayment, business_partner_id: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm">
                <option value="">選択してください</option>
                {partnerList.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-muted-foreground mb-1">支払方法</label>
              <select value={newPayment.payment_method} onChange={(e) => setNewPayment({ ...newPayment, payment_method: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm">
                <option value="bank_transfer">銀行振込</option>
                <option value="cash">現金</option>
                <option value="card">カード</option>
                <option value="e_money">電子マネー</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-muted-foreground mb-1">メモ</label>
              <input type="text" value={newPayment.memo} onChange={(e) => setNewPayment({ ...newPayment, memo: e.target.value })} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm" />
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

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-2">
            <CreditCard className="size-4 text-warning" />
            <span className="text-sm text-muted-foreground">未消込入金合計</span>
          </div>
          <p className="text-2xl font-bold text-foreground">
            {formatCurrency(unmatchedPaymentTotal)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {unmatchedPayments.length}件
          </p>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="size-4 text-primary-light" />
            <span className="text-sm text-muted-foreground">未入金請求合計</span>
          </div>
          <p className="text-2xl font-bold text-foreground">
            {formatCurrency(unpaidInvoiceTotal)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {unpaidInvoices.length}件
          </p>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-2">
            <CheckCircle className="size-4 text-success" />
            <span className="text-sm text-muted-foreground">消込済件数</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{allocatedCount}件</p>
          <p className="text-xs text-muted-foreground mt-1">直近30日間</p>
        </Card>
      </div>

      {/* Auto-matching suggestions */}
      {matchingPayments.length > 0 && (
        <Card className="mb-6 p-5 border-primary/30">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="size-4 text-primary" />
            <span className="text-sm font-bold text-foreground">
              自動マッチング候補
            </span>
            <Badge variant="default">{matchingPayments.length}件</Badge>
          </div>
          <div className="space-y-3">
            {matchingPayments.map((payment) => {
              const matchedInvoice = unpaidInvoices.find(
                (inv) => inv.id === payment.matchSuggestion
              );
              if (!matchedInvoice) return null;
              return (
                <div
                  key={payment.id}
                  className="flex items-center gap-4 p-3 rounded-lg bg-primary/5 border border-primary/20"
                >
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground">
                      {payment.payer}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {payment.date} / {payment.bankName}
                    </p>
                    <p className="text-sm font-mono font-bold text-foreground mt-1">
                      {formatCurrency(payment.amount)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link2 className="size-4 text-primary" />
                    <ArrowRight className="size-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-foreground">
                      {matchedInvoice.partnerName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {matchedInvoice.invoiceNumber} / 期限: {matchedInvoice.dueDate}
                    </p>
                    <p className="text-sm font-mono font-bold text-foreground mt-1">
                      {formatCurrency(matchedInvoice.amount)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {payment.amount === matchedInvoice.amount && (
                      <Badge variant="success">金額一致</Badge>
                    )}
                    <Button size="sm" onClick={async () => {
                      try {
                        await allocatePayment(payment.id, matchedInvoice.id, Math.min(payment.amount, matchedInvoice.amount));
                        refetch();
                        if (typeof refetchInvoices === 'function') refetchInvoices();
                      } catch (err) {
                        alert(err instanceof Error ? err.message : "消込に失敗しました");
                      }
                    }}>消込実行</Button>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Two-panel layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Left: Unmatched payments */}
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="size-4 text-warning" />
              未消込入金一覧
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/20 border-b border-border">
                    <th className="text-left px-3 py-2 text-xs font-bold text-muted-foreground">
                      日付
                    </th>
                    <th className="text-left px-3 py-2 text-xs font-bold text-muted-foreground">
                      振込人
                    </th>
                    <th className="text-right px-3 py-2 text-xs font-bold text-muted-foreground">
                      金額
                    </th>
                    <th className="text-center px-3 py-2 text-xs font-bold text-muted-foreground">
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {unmatchedPayments.map((payment) => (
                    <tr
                      key={payment.id}
                      onClick={() =>
                        setSelectedPayment(
                          selectedPayment === payment.id ? null : payment.id
                        )
                      }
                      className={cn(
                        "border-b border-border last:border-0 cursor-pointer transition-colors",
                        selectedPayment === payment.id
                          ? "bg-primary/10"
                          : "hover:bg-muted/10",
                        payment.matchSuggestion !== null && "border-l-2 border-l-primary"
                      )}
                    >
                      <td className="px-3 py-3 text-muted-foreground text-xs">
                        {payment.date}
                      </td>
                      <td className="px-3 py-3">
                        <p className="font-medium text-foreground text-xs">
                          {payment.payer}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {payment.bankName}
                        </p>
                      </td>
                      <td className="px-3 py-3 text-right font-mono font-bold text-foreground text-xs">
                        {formatCurrency(payment.amount)}
                      </td>
                      <td className="px-3 py-3 text-center">
                        {payment.matchSuggestion !== null && (
                          <Zap className="size-3.5 text-primary inline-block" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Right: Unpaid invoices */}
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="size-4 text-primary-light" />
              未入金請求書一覧
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/20 border-b border-border">
                    <th className="text-left px-3 py-2 text-xs font-bold text-muted-foreground">
                      請求番号
                    </th>
                    <th className="text-left px-3 py-2 text-xs font-bold text-muted-foreground">
                      取引先
                    </th>
                    <th className="text-left px-3 py-2 text-xs font-bold text-muted-foreground">
                      期限
                    </th>
                    <th className="text-right px-3 py-2 text-xs font-bold text-muted-foreground">
                      金額
                    </th>
                    <th className="text-center px-3 py-2 text-xs font-bold text-muted-foreground">
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {unpaidInvoices.map((inv) => {
                    const isOverdue =
                      new Date(inv.dueDate.replace(/\//g, "-")) < new Date();
                    return (
                      <tr
                        key={inv.id}
                        onClick={() =>
                          setSelectedInvoice(
                            selectedInvoice === inv.id ? null : inv.id
                          )
                        }
                        className={cn(
                          "border-b border-border last:border-0 cursor-pointer transition-colors",
                          selectedInvoice === inv.id
                            ? "bg-primary/10"
                            : "hover:bg-muted/10",
                          inv.matchSuggestion !== null && "border-l-2 border-l-primary"
                        )}
                      >
                        <td className="px-3 py-3 font-mono text-primary text-xs">
                          {inv.invoiceNumber}
                        </td>
                        <td className="px-3 py-3 font-medium text-foreground text-xs">
                          {inv.partnerName}
                        </td>
                        <td
                          className={cn(
                            "px-3 py-3 text-xs",
                            isOverdue
                              ? "text-destructive font-bold"
                              : "text-muted-foreground"
                          )}
                        >
                          {inv.dueDate}
                          {isOverdue && (
                            <AlertCircle className="size-3 inline-block ml-1" />
                          )}
                        </td>
                        <td className="px-3 py-3 text-right font-mono font-bold text-foreground text-xs">
                          {formatCurrency(inv.amount)}
                        </td>
                        <td className="px-3 py-3 text-center">
                          {inv.matchSuggestion !== null && (
                            <Zap className="size-3.5 text-primary inline-block" />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Manual allocation button */}
      {selectedPayment !== null && selectedInvoice !== null && (
        <Card className="mb-6 p-4 border-primary/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div>
                <p className="text-xs text-muted-foreground">選択中の入金</p>
                <p className="text-sm font-bold text-foreground">
                  {unmatchedPayments.find((p) => p.id === selectedPayment)?.payer} -{" "}
                  {formatCurrency(
                    unmatchedPayments.find((p) => p.id === selectedPayment)?.amount || 0
                  )}
                </p>
              </div>
              <ArrowRight className="size-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">選択中の請求書</p>
                <p className="text-sm font-bold text-foreground">
                  {unpaidInvoices.find((i) => i.id === selectedInvoice)?.invoiceNumber} -{" "}
                  {formatCurrency(
                    unpaidInvoices.find((i) => i.id === selectedInvoice)?.amount || 0
                  )}
                </p>
              </div>
            </div>
            <Button onClick={async () => {
              const selPay = unmatchedPayments.find((p) => p.id === selectedPayment);
              const selInv = unpaidInvoices.find((i) => i.id === selectedInvoice);
              if (!selPay || !selInv) return;
              try {
                await allocatePayment(selPay.id, selInv.id, Math.min(selPay.amount, selInv.amount));
                setSelectedPayment(null);
                setSelectedInvoice(null);
                refetch();
                if (typeof refetchInvoices === 'function') refetchInvoices();
              } catch (err) {
                alert(err instanceof Error ? err.message : "消込に失敗しました");
              }
            }}>
              <Link2 className="size-4" />
              消込実行
            </Button>
          </div>
        </Card>
      )}

      {/* Allocation history */}
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="size-4 text-success" />
            消込履歴
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/20 border-b border-border">
                  <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground">
                    入金日
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground">
                    振込人
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground">
                    請求書番号
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-bold text-muted-foreground">
                    消込金額
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground">
                    消込日時
                  </th>
                </tr>
              </thead>
              <tbody>
                {currentAllocations.map((record) => (
                  <tr
                    key={record.id}
                    className="border-b border-border last:border-0 hover:bg-muted/10"
                  >
                    <td className="px-4 py-3 text-muted-foreground">
                      {record.date}
                    </td>
                    <td className="px-4 py-3 font-medium text-foreground">
                      {record.paymentPayer}
                    </td>
                    <td className="px-4 py-3 font-mono text-primary">
                      {record.invoiceNumber}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-foreground">
                      {formatCurrency(record.amount)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {record.allocatedAt}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
