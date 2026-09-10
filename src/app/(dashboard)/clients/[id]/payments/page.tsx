"use client";

import { useState, useRef } from "react";
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
  Upload,
  FileSpreadsheet,
  Sparkles,
  X,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency } from "@/lib/utils";
import { useData } from "@/lib/use-data";
import { getPayments, createPayment, allocatePayment, reconcileDeposits } from "@/actions/payments";
import { analyzeDepositsRows, analyzeDepositsPdf, type DepositSuggestion } from "@/actions/deposit-csv-ai";
import { parseTabularFile } from "@/lib/parse-tabular";
import { getPartners } from "@/actions/partners";
import { getUnpaidInvoices } from "@/actions/invoices";
import { getBankAccounts, createBankAccount } from "@/actions/bank";
import { BankSelectModal } from "@/components/bank-select-modal";
import type { JapanBank } from "@/lib/japan-banks";
import { DateInput } from "@/components/ui/date-input";

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

// 大きなファイルでもスタックを溢れさせずに ArrayBuffer を base64 化する。
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export default function PaymentsPage() {
  const { id } = useParams<{ id: string }>();
  const [selectedPayment, setSelectedPayment] = useState<string | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [partnerList, setPartnerList] = useState<{ id: string; name: string }[]>([]);
  const [newPayment, setNewPayment] = useState({
    payment_date: "",
    amount: "",
    business_partner_id: "",
    payment_method: "bank_transfer",
    memo: "",
  });

  // 入金登録: ファイル取込（CSV/Excel/PDF）の状態
  type EditableDeposit = DepositSuggestion & { selected: boolean; business_partner_id: string };
  const [showImport, setShowImport] = useState(false);
  const [importAnalyzing, setImportAnalyzing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [deposits, setDeposits] = useState<EditableDeposit[]>([]);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const [importFileName, setImportFileName] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  async function loadPartners() {
    try {
      const ps = await getPartners(id);
      setPartnerList(ps.map((p) => ({ id: p.id, name: p.name })));
    } catch { /* ignore */ }
  }

  // 取込口座（どの口座の明細かを payments.bank_account に記録する）
  type BankAccountOption = { id: string; bank_name: string; branch_name: string | null };
  const [bankAccountList, setBankAccountList] = useState<BankAccountOption[]>([]);
  const [selectedBankAccountId, setSelectedBankAccountId] = useState<string>("");
  const [showBankModal, setShowBankModal] = useState(false);
  const [bankSaving, setBankSaving] = useState(false);

  async function loadBankAccounts() {
    try {
      const rows = await getBankAccounts(id);
      setBankAccountList(
        rows
          .filter((r) => r.is_active !== false)
          .map((r) => ({ id: r.id, bank_name: r.bank_name, branch_name: r.branch_name }))
      );
    } catch { /* ignore */ }
  }

  function bankAccountLabel(accountId: string): string | null {
    const acc = bankAccountList.find((a) => a.id === accountId);
    if (!acc) return null;
    return `${acc.bank_name}${acc.branch_name ? ` ${acc.branch_name}` : ""}`;
  }

  async function handleCreateBankAccount(bank: JapanBank, managementName: string) {
    setBankSaving(true);
    try {
      const created = await createBankAccount({
        client_id: id,
        bank_name: bank.n,
        branch_name: managementName || null,
        account_number: "",
        provider: "manual",
        settings: { source: "deposit_upload", zengin_code: bank.c },
      });
      await loadBankAccounts();
      setSelectedBankAccountId(created.id);
      setShowBankModal(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : "口座の作成に失敗しました");
    } finally {
      setBankSaving(false);
    }
  }

  function clearImport() {
    setDeposits([]);
    setImportWarnings([]);
    setImportError(null);
    setImportFileName(null);
    if (importInputRef.current) importInputRef.current.value = "";
  }

  async function handleDepositFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFileName(file.name);
    setImportError(null);
    setImportWarnings([]);
    setDeposits([]);
    setImportAnalyzing(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase();
      let analysis;
      if (ext === "pdf" || file.type.startsWith("image/")) {
        const base64 = arrayBufferToBase64(await file.arrayBuffer());
        const mime: "application/pdf" | "image/jpeg" | "image/png" =
          ext === "pdf" ? "application/pdf" : file.type === "image/png" ? "image/png" : "image/jpeg";
        analysis = await analyzeDepositsPdf(id, base64, mime);
      } else {
        const { header, rows } = await parseTabularFile(file);
        if (rows.length === 0) throw new Error("有効なデータ行が見つかりません");
        analysis = await analyzeDepositsRows(id, header, rows);
      }
      setDeposits(
        analysis.suggestions.map((s) => ({
          ...s,
          selected: s.amount > 0,
          business_partner_id: s.suggestedPartnerId ?? "",
        }))
      );
      setImportWarnings(analysis.warnings);
      if (analysis.suggestions.length === 0) {
        setImportError("入金明細を抽出できませんでした。フォーマットをご確認ください。");
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "取込に失敗しました");
    } finally {
      setImportAnalyzing(false);
      e.target.value = "";
    }
  }

  async function handleRunReconcile() {
    const selected = deposits.filter((d) => d.selected);
    if (selected.length === 0) return;
    const missing = selected.filter((d) => !d.business_partner_id);
    if (missing.length > 0) {
      alert(`取引先が未選択の行が ${missing.length} 件あります。取引先を選択してください。`);
      return;
    }
    setImporting(true);
    try {
      const result = await reconcileDeposits(
        id,
        selected.map((d) => ({
          payment_date: d.date,
          amount: d.amount,
          business_partner_id: d.business_partner_id,
          memo: d.memo || d.payer || null,
        })),
        { bankAccount: selectedBankAccountId ? bankAccountLabel(selectedBankAccountId) : null }
      );
      alert(
        `${result.created}件を入金登録し、うち${result.matched}件を自動消込しました。\n` +
          `入金仕訳 ${result.journalsCreated}件を計上、請求書 ${result.invoicesPaid}件を「入金済」に更新しました。` +
          (result.errors.length ? `\n（${result.errors.length}件エラー）` : "")
      );
      clearImport();
      setShowImport(false);
      refetch();
      refetchInvoices();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "登録に失敗しました");
    } finally {
      setImporting(false);
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
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">入金消込</h1>
          <p className="text-muted-foreground text-sm mt-1">
            入金と請求書の照合・消込処理
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => { setShowImport(!showImport); if (!showImport) { loadPartners(); loadBankAccounts(); } }}>
            <Upload className="size-4" />
            ファイルから取込
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
              <DateInput allowEmpty value={newPayment.payment_date} onChange={(v) => setNewPayment({ ...newPayment, payment_date: v })} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm pr-7" />
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

      {/* ファイルから入金登録（CSV / Excel / PDF） */}
      {showImport && (
        <Card className="mb-6 p-6 border-dashed border-primary/40">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
              <FileSpreadsheet className="size-4 text-primary" />
              ファイルから入金登録
              <span className="inline-flex items-center gap-1 text-xs font-normal text-primary bg-primary/10 rounded px-1.5 py-0.5">
                <Sparkles className="size-3" />
                AI解析
              </span>
            </h3>
            <button
              onClick={() => { setShowImport(false); clearImport(); }}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* 取込口座の選択（INVOY風: 全銀マスタから検索して口座を作成） */}
          <div className="mb-4 flex items-center gap-2 flex-wrap">
            <label className="text-xs font-bold text-muted-foreground shrink-0">取込口座</label>
            <select
              value={selectedBankAccountId}
              onChange={(e) => setSelectedBankAccountId(e.target.value)}
              className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">口座を指定しない</option>
              {bankAccountList.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.bank_name}{a.branch_name ? ` ${a.branch_name}` : ""}
                </option>
              ))}
            </select>
            <Button size="sm" variant="outline" onClick={() => setShowBankModal(true)} className="text-xs gap-1">
              <Plus className="size-3.5" />
              口座を追加
            </Button>
            <span className="text-[10px] text-muted-foreground">
              選択すると、取込んだ入金にどの口座の明細かが記録されます
            </span>
          </div>

          <input
            ref={importInputRef}
            type="file"
            accept=".csv,.xlsx,.xlsm,application/pdf,image/jpeg,image/png"
            onChange={handleDepositFileSelect}
            className="hidden"
          />

          {!importFileName ? (
            <div
              onClick={() => importInputRef.current?.click()}
              className="flex items-center justify-center gap-3 p-6 cursor-pointer rounded-lg border-2 border-dashed border-muted-foreground/30 bg-muted/20 hover:border-primary/50 hover:bg-muted/30"
            >
              <div className="size-10 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
                <Upload className="size-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">クリックして CSV / Excel / PDF を選択</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  銀行入金明細・通帳・振込リスト等。AIが入金行を抽出し取引先を推定します。
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/30">
              <FileSpreadsheet className="size-6 text-primary shrink-0" />
              <p className="text-sm flex-1 truncate">
                {importFileName}
                {importAnalyzing && " / AI解析中..."}
                {!importAnalyzing && deposits.length > 0 && ` / ${deposits.length}件の入金候補`}
              </p>
              {!importAnalyzing && !importing && (
                <button onClick={clearImport} className="text-muted-foreground hover:text-foreground">
                  <X className="size-4" />
                </button>
              )}
            </div>
          )}

          {importAnalyzing && (
            <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              AIが入金明細を解析中... (10〜30秒)
            </div>
          )}

          {deposits.length > 0 && (
            <>
              <div className="mt-4 overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/30">
                    <tr>
                      <th className="px-2 py-1.5 w-8">
                        <input
                          type="checkbox"
                          checked={deposits.every((d) => d.selected)}
                          onChange={(e) => setDeposits((prev) => prev.map((d) => ({ ...d, selected: e.target.checked })))}
                        />
                      </th>
                      <th className="text-left px-2 py-1.5 font-bold text-muted-foreground">入金日</th>
                      <th className="text-right px-2 py-1.5 font-bold text-muted-foreground">金額</th>
                      <th className="text-left px-2 py-1.5 font-bold text-muted-foreground">振込人</th>
                      <th className="text-left px-2 py-1.5 font-bold text-muted-foreground">取引先（消込先）</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deposits.map((d) => (
                      <tr key={d.rowIdx} className={cn("border-t border-border/50", !d.selected && "opacity-50")}>
                        <td className="px-2 py-1 text-center">
                          <input
                            type="checkbox"
                            checked={d.selected}
                            onChange={(e) => setDeposits((prev) => prev.map((x) => (x.rowIdx === d.rowIdx ? { ...x, selected: e.target.checked } : x)))}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <DateInput allowEmpty value={d.date}
                            onChange={(v) => setDeposits((prev) => prev.map((x) => (x.rowIdx === d.rowIdx ? { ...x, date: v } : x)))}
                            className="bg-transparent border-0 text-xs w-28 pr-7" />
                        </td>
                        <td className="px-2 py-1 text-right font-mono">{formatCurrency(d.amount)}</td>
                        <td className="px-2 py-1">{d.payer || "—"}</td>
                        <td className="px-2 py-1">
                          <select
                            value={d.business_partner_id}
                            onChange={(e) => setDeposits((prev) => prev.map((x) => (x.rowIdx === d.rowIdx ? { ...x, business_partner_id: e.target.value } : x)))}
                            className={cn(
                              "bg-card border rounded px-1.5 py-1 text-xs w-full",
                              d.business_partner_id ? "border-border" : "border-destructive/50"
                            )}
                          >
                            <option value="">選択してください</option>
                            {partnerList.map((p) => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  金額が請求残額と一致する取引先の入金は自動で消込されます。一致しないものは未消込で登録され、下の一覧から手動消込できます。
                </p>
                <Button size="sm" onClick={handleRunReconcile} disabled={importing || deposits.filter((d) => d.selected).length === 0}>
                  {importing ? (
                    <><Loader2 className="size-4 animate-spin" />登録中...</>
                  ) : (
                    <><Plus className="size-4" />選択行を入金登録（{deposits.filter((d) => d.selected).length}件）</>
                  )}
                </Button>
              </div>
            </>
          )}

          {importWarnings.length > 0 && (
            <div className="mt-3 p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/20 max-h-40 overflow-y-auto">
              <p className="text-xs font-bold text-amber-700 dark:text-amber-400 mb-1">注意:</p>
              <ul className="text-xs text-amber-700 dark:text-amber-400 space-y-0.5">
                {importWarnings.map((w, i) => (<li key={i}>・{w}</li>))}
              </ul>
            </div>
          )}
          {importError && (
            <div className="mt-3 p-2.5 rounded-lg bg-destructive/10 border border-destructive/20">
              <p className="text-sm text-destructive">{importError}</p>
            </div>
          )}
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

      {/* 明細アップロード用の口座作成モーダル */}
      <BankSelectModal
        open={showBankModal}
        saving={bankSaving}
        onClose={() => setShowBankModal(false)}
        onSave={handleCreateBankAccount}
      />
    </>
  );
}
