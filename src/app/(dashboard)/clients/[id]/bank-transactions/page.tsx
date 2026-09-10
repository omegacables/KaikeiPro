"use client";

import { useState, useEffect, useCallback, use } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Banknote,
  Download,
  CheckCircle,
  AlertCircle,
  MinusCircle,
  Search,
  ArrowUpRight,
  ArrowDownLeft,
  Loader2,
  X,
  FileText,
  Bot,
  Sparkles,
  Link2,
  Link2Off,
  RefreshCw,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  getBankAccounts,
  getBankTransactionsByClient,
  updateBankTransaction,
  createBankTransactions,
} from "@/actions/bank";
import {
  getMoneytreeConnection,
  disconnectMoneytree,
  syncMoneytreeAccounts,
  syncAllMoneytreeTransactions,
} from "@/actions/moneytree";
import {
  autoCreateJournalFromBankTransaction,
  autoCreateJournalsFromBankTransactions,
} from "@/actions/ai-journal";

type BankAccountInfo = {
  id: string;
  bank_name: string;
  branch_name: string | null;
  account_number: string;
};

type TransactionRow = {
  id: string;
  bank_account_id: string;
  transaction_date: string;
  description: string;
  amount: number;
  balance_after: number | null;
  transaction_type: string;
  counterparty: string | null;
  match_status: string;
  match_confidence: number | null;
  suggested_account_id: string | null;
  bank_accounts: { id: string; bank_name: string; branch_name: string | null; account_number: string };
  accounts: { id: string; name: string } | null;
};

const matchStatusConfig = {
  unmatched: { label: "未照合", variant: "warning" as const, icon: AlertCircle },
  matched: { label: "照合済", variant: "success" as const, icon: CheckCircle },
  ignored: { label: "無視", variant: "muted" as const, icon: MinusCircle },
};

type FilterType = "all" | "unmatched" | "matched" | "ignored";

export default function BankTransactionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [selectedAccount, setSelectedAccount] = useState<string>("all");
  const [filter, setFilter] = useState<FilterType>("all");

  const [bankAccountsList, setBankAccountsList] = useState<BankAccountInfo[]>([]);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [showImportForm, setShowImportForm] = useState(false);
  const [importAccountId, setImportAccountId] = useState<string>("");
  const [moneytreeConnected, setMoneytreeConnected] = useState(false);
  const [mtSyncing, setMtSyncing] = useState(false);
  const [aiProcessing, setAiProcessing] = useState<string | null>(null);
  const [bulkAiProcessing, setBulkAiProcessing] = useState(false);
  const [csvText, setCsvText] = useState("");
  const [importing, setImporting] = useState(false);
  const [parsedRows, setParsedRows] = useState<{ date: string; description: string; amount: number; balance: number }[]>([]);

  const parseCSV = (text: string) => {
    const lines = text.trim().split("\n").filter((l) => l.trim());
    const rows: { date: string; description: string; amount: number; balance: number }[] = [];
    for (const line of lines) {
      const cols = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      if (cols.length >= 3) {
        const date = cols[0];
        const description = cols[1];
        const amount = Number(cols[2]) || 0;
        const balance = Number(cols[3]) || 0;
        if (date && description) {
          rows.push({ date, description, amount, balance });
        }
      }
    }
    setParsedRows(rows);
  };

  const handleImport = async () => {
    if (parsedRows.length === 0 || !importAccountId) {
      alert("対象口座を選択してください");
      return;
    }
    setImporting(true);
    try {
      await createBankTransactions(
        importAccountId,
        parsedRows.map((r) => ({
          transaction_date: r.date,
          description: r.description,
          amount: r.amount,
          balance_after: r.balance || undefined,
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
      await autoCreateJournalFromBankTransaction(txnId);
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
      const result = await autoCreateJournalsFromBankTransactions(unmatchedIds);
      const msg = `完了: ${result.success}件成功${result.failed > 0 ? `、${result.failed}件失敗` : ""}`;
      alert(msg);
      fetchData();
    } catch (e) {
      alert(e instanceof Error ? e.message : "一括処理に失敗しました");
    } finally {
      setBulkAiProcessing(false);
    }
  };

  const handleMoneytreeSync = async () => {
    setMtSyncing(true);
    try {
      await syncMoneytreeAccounts(id);
      await syncAllMoneytreeTransactions(id);
      fetchData();
    } catch (e) {
      alert(e instanceof Error ? e.message : "同期に失敗しました");
    } finally {
      setMtSyncing(false);
    }
  };

  const handleMoneytreeDisconnect = async () => {
    if (!confirm("Moneytree連携を解除しますか？")) return;
    try {
      await disconnectMoneytree(id);
      setMoneytreeConnected(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : "連携解除に失敗しました");
    }
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [accounts, txns, mtConn] = await Promise.all([
        getBankAccounts(id),
        getBankTransactionsByClient(id),
        getMoneytreeConnection(id),
      ]);
      setBankAccountsList(
        accounts.map((a) => ({
          id: a.id,
          bank_name: a.bank_name,
          branch_name: a.branch_name,
          account_number: a.account_number,
        }))
      );
      setTransactions(txns as TransactionRow[]);
      setMoneytreeConnected(!!mtConn);
    } catch {
      // DB not available
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filteredTransactions = transactions.filter((t) => {
    if (selectedAccount !== "all" && t.bank_account_id !== selectedAccount) return false;
    if (filter !== "all" && t.match_status !== filter) return false;
    return true;
  });

  const unmatchedCount = transactions.filter((t) => t.match_status === "unmatched").length;
  const matchedCount = transactions.filter((t) => t.match_status === "matched").length;

  const handleMatch = async (txId: string) => {
    setUpdating(txId);
    try {
      const updated = await updateBankTransaction(txId, {
        match_status: "matched" as const,
        match_confidence: 1.0,
      });
      setTransactions((prev) =>
        prev.map((t) => (t.id === txId ? (updated as TransactionRow) : t))
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : "照合に失敗しました");
    } finally {
      setUpdating(null);
    }
  };

  const handleIgnore = async (txId: string) => {
    setUpdating(txId);
    try {
      const updated = await updateBankTransaction(txId, {
        match_status: "ignored" as const,
      });
      setTransactions((prev) =>
        prev.map((t) => (t.id === txId ? (updated as TransactionRow) : t))
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : "更新に失敗しました");
    } finally {
      setUpdating(null);
    }
  };

  const handleRestore = async (txId: string) => {
    setUpdating(txId);
    try {
      const updated = await updateBankTransaction(txId, {
        match_status: "unmatched" as const,
      });
      setTransactions((prev) =>
        prev.map((t) => (t.id === txId ? (updated as TransactionRow) : t))
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : "更新に失敗しました");
    } finally {
      setUpdating(null);
    }
  };

  return (
    <>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <Link href={`/clients/${id}`}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="size-4" />
            </Button>
          </Link>
          <Banknote className="size-6 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">口座取引</h1>
        </div>
        <div className="flex items-center gap-2">
          {moneytreeConnected ? (
            <>
              <Button onClick={handleMoneytreeSync} disabled={mtSyncing} variant="outline" size="sm">
                {mtSyncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                Moneytree同期
              </Button>
              <Button onClick={handleMoneytreeDisconnect} variant="ghost" size="sm" className="text-destructive">
                <Link2Off className="size-4" />
                連携解除
              </Button>
            </>
          ) : (
            <a
              href={`/api/moneytree/authorize?client_id=${id}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-sm font-medium hover:bg-muted/20 transition-colors"
            >
              <Link2 className="size-4" />
              Moneytree連携
            </a>
          )}
          <Button onClick={() => setShowImportForm((v) => !v)}>
            <Download className="size-4" />
            データ取込
          </Button>
        </div>
      </div>

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
            <label className="text-xs text-muted-foreground font-bold mr-2">対象口座:</label>
            <select
              value={importAccountId}
              onChange={(e) => setImportAccountId(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-border bg-card text-foreground text-sm"
            >
              <option value="">口座を選択...</option>
              {bankAccountsList.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.bank_name} {a.branch_name ?? ""} ({a.account_number})
                </option>
              ))}
            </select>
          </div>
          <p className="text-sm text-muted-foreground mb-3">
            CSV形式（日付,摘要,金額,残高）のデータを貼り付けてください。
          </p>
          <textarea
            value={csvText}
            onChange={(e) => {
              setCsvText(e.target.value);
              parseCSV(e.target.value);
            }}
            placeholder="2024/01/15,NTTコミュニケーションズ,-8640,1234567&#10;2024/01/14,㈱山田商事,550000,1784567"
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
                      <th className="text-left px-3 py-2">日付</th>
                      <th className="text-left px-3 py-2">摘要</th>
                      <th className="text-right px-3 py-2">金額</th>
                      <th className="text-right px-3 py-2">残高</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedRows.map((row, idx) => (
                      <tr key={idx} className="border-b border-border/50">
                        <td className="px-3 py-1.5 text-muted-foreground">{row.date}</td>
                        <td className="px-3 py-1.5 text-foreground">{row.description}</td>
                        <td className={`px-3 py-1.5 text-right font-mono ${row.amount >= 0 ? "text-success" : "text-destructive"}`}>
                          ¥{Math.abs(row.amount).toLocaleString()}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-foreground">
                          {row.balance ? `¥${row.balance.toLocaleString()}` : "-"}
                        </td>
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
            <span className="text-muted-foreground text-xs">未照合取引</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{unmatchedCount}件</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle className="size-4 text-success" />
            <span className="text-muted-foreground text-xs">照合済取引</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{matchedCount}件</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <Banknote className="size-4 text-primary" />
            <span className="text-muted-foreground text-xs">登録口座数</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{bankAccountsList.length}口座</p>
        </Card>
      </div>

      {/* Bulk AI journal button */}
      {unmatchedCount > 0 && (
        <div className="mb-4 flex items-center gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20">
          <Sparkles className="size-4 text-primary" />
          <span className="text-sm text-foreground">
            未照合 <span className="font-bold">{unmatchedCount}件</span> の取引をAIで自動仕訳
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

      {/* Account filter tabs */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setSelectedAccount("all")}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
            selectedAccount === "all"
              ? "bg-primary text-cream"
              : "bg-muted/20 text-muted-foreground hover:bg-muted/40"
          }`}
        >
          全口座
        </button>
        {bankAccountsList.map((acc) => (
          <button
            key={acc.id}
            onClick={() => setSelectedAccount(acc.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
              selectedAccount === acc.id
                ? "bg-primary text-cream"
                : "bg-muted/20 text-muted-foreground hover:bg-muted/40"
            }`}
          >
            {acc.bank_name} {acc.branch_name}
          </button>
        ))}
      </div>

      {/* Status filter */}
      <div className="flex gap-2 mb-6">
        {([
          { key: "all", label: "全件" },
          { key: "unmatched", label: "未照合" },
          { key: "matched", label: "照合済" },
          { key: "ignored", label: "無視" },
        ] as const).map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer ${
              filter === f.key
                ? "bg-foreground text-card"
                : "bg-muted/20 text-muted-foreground hover:bg-muted/40"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Transactions table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/20 border-b border-border">
                <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground">日付</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground">摘要</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground">取引先</th>
                <th className="text-right px-4 py-3 text-xs font-bold text-muted-foreground">入金</th>
                <th className="text-right px-4 py-3 text-xs font-bold text-muted-foreground">出金</th>
                <th className="text-right px-4 py-3 text-xs font-bold text-muted-foreground">残高</th>
                <th className="text-center px-4 py-3 text-xs font-bold text-muted-foreground">照合</th>
                <th className="text-center px-4 py-3 text-xs font-bold text-muted-foreground">推定科目</th>
                <th className="text-center px-4 py-3 text-xs font-bold text-muted-foreground">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-muted-foreground">
                    <Loader2 className="size-8 mx-auto mb-2 animate-spin opacity-50" />
                    <p>読み込み中...</p>
                  </td>
                </tr>
              ) : filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-muted-foreground">
                    <Search className="size-8 mx-auto mb-2 opacity-50" />
                    <p>該当する取引がありません</p>
                  </td>
                </tr>
              ) : (
                filteredTransactions.map((tx) => {
                  const status = tx.match_status as keyof typeof matchStatusConfig;
                  const statusConf = matchStatusConfig[status] ?? matchStatusConfig.unmatched;
                  const StatusIcon = statusConf.icon;
                  const isIgnored = tx.match_status === "ignored";
                  const isUpdating = updating === tx.id;
                  const suggestedName = tx.accounts?.name ?? null;
                  return (
                    <tr
                      key={tx.id}
                      className={`border-b border-border last:border-0 hover:bg-muted/10 ${
                        isIgnored ? "opacity-50" : ""
                      }`}
                    >
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {tx.transaction_date.replace(/-/g, "/")}
                      </td>
                      <td className="px-4 py-3 font-medium text-foreground">
                        <div className="flex items-center gap-2">
                          {tx.transaction_type === "deposit" ? (
                            <ArrowDownLeft className="size-4 text-success shrink-0" />
                          ) : (
                            <ArrowUpRight className="size-4 text-destructive shrink-0" />
                          )}
                          {tx.description}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{tx.counterparty ?? "-"}</td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-success">
                        {tx.amount > 0 ? `¥${tx.amount.toLocaleString()}` : ""}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-destructive">
                        {tx.amount < 0 ? `¥${Math.abs(tx.amount).toLocaleString()}` : ""}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-foreground">
                        {tx.balance_after != null ? `¥${tx.balance_after.toLocaleString()}` : "-"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge variant={statusConf.variant}>
                          <StatusIcon className="size-3" />
                          {statusConf.label}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {suggestedName ? (
                          <div>
                            <span className="text-xs text-foreground">{suggestedName}</span>
                            {tx.match_confidence != null && (
                              <span className="text-[10px] text-muted-foreground ml-1">
                                ({Math.round(tx.match_confidence * 100)}%)
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-xs">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
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
                              variant="outline"
                              size="sm"
                              onClick={() => handleMatch(tx.id)}
                              className="text-xs"
                            >
                              照合
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
