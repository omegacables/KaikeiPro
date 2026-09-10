"use client";

import { useState, useEffect, useCallback, use } from "react";
import {
  CreditCard,
  Download,
  CheckCircle,
  AlertCircle,
  MinusCircle,
  Loader2,
  X,
  FileText,
  Bot,
  Sparkles,
  Calendar,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  getCardAccounts,
  getCardTransactionsByClient,
  updateCardTransaction,
  createCardTransactions,
  recordCardPayment,
} from "@/actions/cards";
import {
  autoCreateJournalFromCardTransaction,
  autoCreateJournalsFromCardTransactions,
} from "@/actions/ai-journal";
import { formatCurrency } from "@/lib/utils";
import { DateInput } from "@/components/ui/date-input";

type CardAccountInfo = {
  id: string;
  card_company: string;
  card_name: string;
  card_number_masked: string;
};

type TransactionRow = {
  id: string;
  card_account_id: string;
  transaction_date: string;
  description: string;
  amount: number;
  transaction_type: string;
  counterparty: string | null;
  installment_type: string | null;
  installment_count: number | null;
  statement_month: string | null;
  match_status: string;
  match_confidence: number | null;
  suggested_account_id: string | null;
  card_accounts: { id: string; card_company: string; card_name: string; card_number_masked: string };
  accounts: { id: string; name: string } | null;
};

const matchStatusConfig = {
  unmatched: { label: "未仕訳", variant: "warning" as const, icon: AlertCircle },
  matched: { label: "仕訳済", variant: "success" as const, icon: CheckCircle },
  ignored: { label: "無視", variant: "muted" as const, icon: MinusCircle },
};

const installmentLabel: Record<string, string> = {
  lump: "一括",
  installment: "分割",
  revolving: "リボ",
  bonus: "ボーナス",
};

type FilterType = "all" | "unmatched" | "matched" | "ignored";

export default function CardTransactionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [selectedCard, setSelectedCard] = useState<string>("all");
  const [filter, setFilter] = useState<FilterType>("all");

  const [cardAccountsList, setCardAccountsList] = useState<CardAccountInfo[]>([]);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [showImportForm, setShowImportForm] = useState(false);
  const [importCardId, setImportCardId] = useState<string>("");
  const [csvText, setCsvText] = useState("");
  const [importing, setImporting] = useState(false);
  const [parsedRows, setParsedRows] = useState<{ date: string; description: string; amount: number }[]>([]);
  const [aiProcessing, setAiProcessing] = useState<string | null>(null);
  const [bulkAiProcessing, setBulkAiProcessing] = useState(false);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentCardId, setPaymentCardId] = useState("");
  const [paymentStatementMonth, setPaymentStatementMonth] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  const [paymentProcessing, setPaymentProcessing] = useState(false);

  const parseCSV = (text: string) => {
    const lines = text.trim().split("\n").filter((l) => l.trim());
    const rows: { date: string; description: string; amount: number }[] = [];
    for (const line of lines) {
      const cols = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      if (cols.length >= 3) {
        const date = cols[0];
        const description = cols[1];
        const amount = Number(cols[2]) || 0;
        if (date && description) {
          rows.push({ date, description, amount });
        }
      }
    }
    setParsedRows(rows);
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [cards, txns] = await Promise.all([
        getCardAccounts(id),
        getCardTransactionsByClient(id),
      ]);
      setCardAccountsList(
        cards.map((c) => ({
          id: c.id,
          card_company: c.card_company,
          card_name: c.card_name,
          card_number_masked: c.card_number_masked,
        }))
      );
      setTransactions(txns as unknown as TransactionRow[]);
    } catch {
      // DB not available
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleImport = async () => {
    if (parsedRows.length === 0 || !importCardId) {
      alert("対象カードを選択してください");
      return;
    }
    setImporting(true);
    try {
      await createCardTransactions(
        importCardId,
        parsedRows.map((r) => ({
          transaction_date: r.date,
          description: r.description,
          amount: r.amount,
        }))
      );
      setShowImportForm(false);
      setCsvText("");
      setParsedRows([]);
      fetchData();
    } catch (e) {
      alert(e instanceof Error ? e.message : "取込に失敗しました");
    } finally {
      setImporting(false);
    }
  };

  const handleAiJournal = async (txnId: string) => {
    setAiProcessing(txnId);
    try {
      await autoCreateJournalFromCardTransaction(txnId);
      fetchData();
    } catch (e) {
      alert(e instanceof Error ? e.message : "AI仕訳作成に失敗しました");
    } finally {
      setAiProcessing(null);
    }
  };

  const handleBulkAiJournal = async () => {
    const unmatchedIds = filteredTransactions
      .filter((t) => t.match_status === "unmatched")
      .map((t) => t.id);
    if (unmatchedIds.length === 0) return;
    setBulkAiProcessing(true);
    try {
      const result = await autoCreateJournalsFromCardTransactions(unmatchedIds);
      const msg = `完了: ${result.success}件成功${result.failed > 0 ? `、${result.failed}件失敗` : ""}`;
      alert(msg);
      fetchData();
    } catch (e) {
      alert(e instanceof Error ? e.message : "一括処理に失敗しました");
    } finally {
      setBulkAiProcessing(false);
    }
  };

  const handleIgnore = async (txId: string) => {
    setUpdating(txId);
    try {
      await updateCardTransaction(txId, { match_status: "ignored" as const });
      fetchData();
    } catch (e) {
      alert(e instanceof Error ? e.message : "更新に失敗しました");
    } finally {
      setUpdating(null);
    }
  };

  const handleRestore = async (txId: string) => {
    setUpdating(txId);
    try {
      await updateCardTransaction(txId, { match_status: "unmatched" as const });
      fetchData();
    } catch (e) {
      alert(e instanceof Error ? e.message : "更新に失敗しました");
    } finally {
      setUpdating(null);
    }
  };

  const handleRecordPayment = async () => {
    if (!paymentCardId || !paymentStatementMonth || !paymentDate) {
      alert("カード、対象月、支払日を入力してください");
      return;
    }
    setPaymentProcessing(true);
    try {
      await recordCardPayment(paymentCardId, paymentStatementMonth, paymentDate);
      alert("月次引き落とし仕訳を作成しました");
      setShowPaymentForm(false);
      setPaymentCardId("");
      setPaymentStatementMonth("");
      setPaymentDate("");
      fetchData();
    } catch (e) {
      alert(e instanceof Error ? e.message : "仕訳作成に失敗しました");
    } finally {
      setPaymentProcessing(false);
    }
  };

  const filteredTransactions = transactions.filter((tx) => {
    if (selectedCard !== "all" && tx.card_account_id !== selectedCard) return false;
    if (filter !== "all" && tx.match_status !== filter) return false;
    return true;
  });

  const unmatchedCount = transactions.filter((t) => t.match_status === "unmatched").length;
  const matchedCount = transactions.filter((t) => t.match_status === "matched").length;

  // 今月の利用合計
  const currentMonthTotal = transactions
    .filter((t) => {
      const d = new Date(t.transaction_date);
      const now = new Date();
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    })
    .reduce((sum, t) => sum + t.amount, 0);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <CreditCard className="size-6 text-primary" />
            カード取引
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            クレジットカード利用明細の取込・AI自動仕訳
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowPaymentForm((v) => !v)}>
            <Calendar className="size-4" />
            月次引き落とし仕訳
          </Button>
          <Button onClick={() => setShowImportForm((v) => !v)}>
            <Download className="size-4" />
            データ取込
          </Button>
        </div>
      </div>

      {/* Payment form */}
      {showPaymentForm && (
        <Card className="mb-6 border-primary/30 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
              <Calendar className="size-5 text-primary" />
              月次引き落とし仕訳（未払金 / 普通預金）
            </h3>
            <button onClick={() => setShowPaymentForm(false)} className="text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div>
              <label className="text-xs text-muted-foreground font-bold block mb-1">カード</label>
              <select
                value={paymentCardId}
                onChange={(e) => setPaymentCardId(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg border border-border bg-card text-foreground text-sm"
              >
                <option value="">選択...</option>
                {cardAccountsList.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.card_company} {c.card_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground font-bold block mb-1">対象月</label>
              <input
                type="month"
                value={paymentStatementMonth ? paymentStatementMonth.slice(0, 7) : ""}
                onChange={(e) => setPaymentStatementMonth(e.target.value ? `${e.target.value}-01` : "")}
                className="w-full px-3 py-1.5 rounded-lg border border-border bg-card text-foreground text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground font-bold block mb-1">支払日</label>
              <DateInput allowEmpty value={paymentDate}
                onChange={(v) => setPaymentDate(v)}
                className="w-full px-3 py-1.5 rounded-lg border border-border bg-card text-foreground text-sm pr-7" />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setShowPaymentForm(false)}>
              キャンセル
            </Button>
            <Button onClick={handleRecordPayment} disabled={paymentProcessing}>
              {paymentProcessing && <Loader2 className="size-4 animate-spin" />}
              仕訳作成
            </Button>
          </div>
        </Card>
      )}

      {/* Import form */}
      {showImportForm && (
        <Card className="mb-6 border-primary/30 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
              <FileText className="size-5 text-primary" />
              CSVデータ取込
            </h3>
            <button onClick={() => setShowImportForm(false)} className="text-muted-foreground hover:text-foreground">
              <X className="size-4" />
            </button>
          </div>
          <div className="mb-3">
            <label className="text-xs text-muted-foreground font-bold mr-2">対象カード:</label>
            <select
              value={importCardId}
              onChange={(e) => setImportCardId(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-border bg-card text-foreground text-sm"
            >
              <option value="">カードを選択...</option>
              {cardAccountsList.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.card_company} {c.card_name} ({c.card_number_masked})
                </option>
              ))}
            </select>
          </div>
          <p className="text-sm text-muted-foreground mb-3">
            CSV形式（利用日,利用店舗,利用金額）のデータを貼り付けてください。
          </p>
          <textarea
            value={csvText}
            onChange={(e) => {
              setCsvText(e.target.value);
              parseCSV(e.target.value);
            }}
            placeholder="2026-02-15,Amazon,5800&#10;2026-02-14,スターバックス,680"
            rows={6}
            className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm font-mono mb-4 resize-none"
          />
          {parsedRows.length > 0 && (
            <div className="mb-4">
              <p className="text-sm font-bold text-foreground mb-2">プレビュー（{parsedRows.length}件）</p>
              <div className="overflow-x-auto max-h-48 overflow-y-auto border border-border rounded-lg">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted/20 border-b border-border sticky top-0">
                      <th className="text-left px-3 py-2">利用日</th>
                      <th className="text-left px-3 py-2">利用店舗</th>
                      <th className="text-right px-3 py-2">金額</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedRows.map((row, idx) => (
                      <tr key={idx} className="border-b border-border/50">
                        <td className="px-3 py-1.5 text-muted-foreground">{row.date}</td>
                        <td className="px-3 py-1.5 text-foreground">{row.description}</td>
                        <td className="px-3 py-1.5 text-right font-mono">¥{row.amount.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => { setShowImportForm(false); setCsvText(""); setParsedRows([]); }}>
              キャンセル
            </Button>
            <Button onClick={handleImport} disabled={importing || parsedRows.length === 0}>
              {importing && <Loader2 className="size-4 animate-spin" />}
              {parsedRows.length}件を取込
            </Button>
          </div>
        </Card>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <AlertCircle className="size-4 text-warning" />
            <span className="text-muted-foreground text-xs">未仕訳取引</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{unmatchedCount}件</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle className="size-4 text-success" />
            <span className="text-muted-foreground text-xs">仕訳済取引</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{matchedCount}件</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <CreditCard className="size-4 text-primary" />
            <span className="text-muted-foreground text-xs">今月利用合計</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{formatCurrency(currentMonthTotal)}</p>
        </Card>
      </div>

      {/* Bulk AI journal button */}
      {unmatchedCount > 0 && (
        <div className="mb-4 flex items-center gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20">
          <Sparkles className="size-4 text-primary" />
          <span className="text-sm text-foreground">
            未仕訳 <span className="font-bold">{unmatchedCount}件</span> の取引をAIで自動仕訳
          </span>
          <Button
            size="sm"
            onClick={handleBulkAiJournal}
            disabled={bulkAiProcessing}
            className="ml-auto"
          >
            {bulkAiProcessing ? <Loader2 className="size-4 animate-spin" /> : <Bot className="size-4" />}
            一括AI仕訳作成
          </Button>
        </div>
      )}

      {/* Card filter tabs */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <button
          onClick={() => setSelectedCard("all")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
            selectedCard === "all"
              ? "bg-primary text-cream"
              : "bg-muted/20 text-muted-foreground hover:bg-muted/40"
          }`}
        >
          全カード
        </button>
        {cardAccountsList.map((c) => (
          <button
            key={c.id}
            onClick={() => setSelectedCard(c.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
              selectedCard === c.id
                ? "bg-primary text-cream"
                : "bg-muted/20 text-muted-foreground hover:bg-muted/40"
            }`}
          >
            {c.card_company} {c.card_name}
          </button>
        ))}
      </div>

      {/* Status filter */}
      <div className="flex gap-1 mb-4 border-b border-border">
        {[
          { key: "all", label: "すべて" },
          { key: "unmatched", label: "未仕訳" },
          { key: "matched", label: "仕訳済" },
          { key: "ignored", label: "無視" },
        ].map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key as FilterType)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px cursor-pointer ${
              filter === f.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Transaction table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/20 border-b-2 border-border">
                <th className="text-left px-3 py-2 text-xs font-bold text-muted-foreground border-r border-border">利用日</th>
                <th className="text-left px-3 py-2 text-xs font-bold text-muted-foreground border-r border-border">利用店舗</th>
                <th className="text-center px-3 py-2 text-xs font-bold text-muted-foreground border-r border-border">区分</th>
                <th className="text-right px-3 py-2 text-xs font-bold text-muted-foreground border-r border-border">金額</th>
                <th className="text-center px-3 py-2 text-xs font-bold text-muted-foreground border-r border-border">状態</th>
                <th className="text-left px-3 py-2 text-xs font-bold text-muted-foreground border-r border-border">推定科目</th>
                <th className="text-center px-3 py-2 text-xs font-bold text-muted-foreground">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                    読み込み中...
                  </td>
                </tr>
              ) : filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                    取引データがありません
                  </td>
                </tr>
              ) : (
                filteredTransactions.map((tx) => {
                  const statusCfg = matchStatusConfig[tx.match_status as keyof typeof matchStatusConfig] ?? matchStatusConfig.unmatched;
                  const StatusIcon = statusCfg.icon;
                  const isUpdating = updating === tx.id;
                  return (
                    <tr key={tx.id} className="border-b border-border/40 hover:bg-muted/10 transition-colors">
                      <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap border-r border-border/50 text-xs">
                        {tx.transaction_date}
                      </td>
                      <td className="px-3 py-1.5 text-foreground border-r border-border/50">
                        <div>{tx.description}</div>
                        {tx.counterparty && <div className="text-xs text-muted-foreground">{tx.counterparty}</div>}
                      </td>
                      <td className="px-3 py-1.5 text-center text-xs text-muted-foreground border-r border-border/50">
                        {installmentLabel[tx.installment_type ?? "lump"] ?? "-"}
                        {tx.installment_count ? `${tx.installment_count}回` : ""}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono border-r border-border/50">
                        {tx.amount >= 0 ? (
                          <span className="text-destructive">{formatCurrency(tx.amount)}</span>
                        ) : (
                          <span className="text-success">{formatCurrency(Math.abs(tx.amount))} (返)</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-center border-r border-border/50">
                        <Badge variant={statusCfg.variant} className="gap-1">
                          <StatusIcon className="size-3" />
                          {statusCfg.label}
                        </Badge>
                      </td>
                      <td className="px-3 py-1.5 text-xs text-muted-foreground border-r border-border/50">
                        {tx.accounts?.name ?? "-"}
                        {tx.match_confidence && ` (${Math.round(tx.match_confidence * 100)}%)`}
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        {isUpdating ? (
                          <Loader2 className="size-4 animate-spin mx-auto text-muted-foreground" />
                        ) : tx.match_status === "unmatched" ? (
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleAiJournal(tx.id)}
                              disabled={aiProcessing === tx.id}
                              className="text-xs text-primary border-primary/30"
                            >
                              {aiProcessing === tx.id ? <Loader2 className="size-3 animate-spin" /> : <Bot className="size-3" />}
                              AI仕訳
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleIgnore(tx.id)}
                              className="text-xs text-muted-foreground"
                            >
                              無視
                            </Button>
                          </div>
                        ) : tx.match_status === "matched" ? (
                          <span className="text-success text-xs">済</span>
                        ) : tx.match_status === "ignored" ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRestore(tx.id)}
                            className="text-xs text-muted-foreground"
                          >
                            戻す
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
