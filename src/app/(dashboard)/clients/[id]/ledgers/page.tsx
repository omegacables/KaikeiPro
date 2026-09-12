"use client";

import { useState, useEffect, useCallback, useRef, useMemo, Fragment } from "react";
import { useParams, useSearchParams } from "next/navigation";
import {
  BookOpen,
  FileText,
  FileSpreadsheet,
  Calendar,
  X,
  Loader2,
  ArrowDownUp,
  Search,
  Pen,
  Bot,
  Upload,
  Package,
  Wallet,
  ImageIcon,
  Trash2,
  Plus,
  Check,
  AlertTriangle,
  Landmark,
  Building2,
  Car,
  Monitor,
  Code2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { AmountInput } from "@/components/ui/amount-input";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { downloadCSV, printPage } from "@/lib/export";
import {
  getJournalLedger,
  getAccountList,
  getGeneralLedger,
  getJournalEntryDetail,
  type JournalLedgerRow,
  type GeneralLedgerRow,
  type CounterAccountDetail,
  type JournalEntryDetail,
} from "@/actions/ledgers";
import { Badge } from "@/components/ui/badge";
import { AccountLookup } from "@/components/ui/account-lookup";
import { getAccounts } from "@/actions/accounts";
import { getClient } from "@/actions/clients";
import { fiscalRangeFromStartYear, currentFiscalStartYear, toJstDate } from "@/lib/fiscal";
import { beginLoad, endLoad } from "@/lib/loading-bus";
import { getReceiptImageUrl } from "@/actions/receipt-storage";
import { deleteJournalEntries, getDescriptionSuggestions, getJournalEntry, updateJournalEntryWithLines } from "@/actions/journals";
import { getReceipt } from "@/actions/receipts";
import { getAssets } from "@/actions/assets";
import type { Database } from "@/types/database";
import {
  getReceivablesByPartner,
  getAgingReport,
  type PartnerReceivable,
  type AgingReportRow,
  type AgingBuckets,
} from "@/actions/invoices";
import { DateInput } from "@/components/ui/date-input";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LedgerTab =
  | "journal"
  | "general"
  | "cash"
  | "deposit"
  | "receivable"
  | "payable"
  | "assets";

interface CashBookRow {
  date: string;
  id: string;
  description: string;
  counterAccount: string;
  counterAccountDetails?: CounterAccountDetail[];
  inAmount: number;
  outAmount: number;
  balance: number;
}

// Account name mapping for sub-ledgers
const subLedgerAccountMap: Record<string, string> = {
  cash: "現金",
  deposit: "普通預金",
  receivable: "売掛金",
  payable: "買掛金",
};

// ---------------------------------------------------------------------------
// Tab config
// ---------------------------------------------------------------------------

const tabs: { key: LedgerTab; label: string }[] = [
  { key: "journal", label: "仕訳帳" },
  { key: "general", label: "総勘定元帳" },
  { key: "cash", label: "現金出納帳" },
  { key: "deposit", label: "預金出納帳" },
  { key: "receivable", label: "売掛帳" },
  { key: "payable", label: "買掛帳" },
  { key: "assets", label: "固定資産台帳" },
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

type JournalSource = "manual" | "ai" | "import" | "raqto" | "bank" | "card" | "payment" | "closing";


const sourceConfig: Record<JournalSource, { label: string; variant: "muted" | "success" | "warning" | "default" | "destructive" | "accent"; icon: React.ElementType }> = {
  manual: { label: "手動", variant: "muted", icon: Pen },
  ai: { label: "AI", variant: "accent", icon: Bot },
  import: { label: "取込", variant: "default", icon: Upload },
  raqto: { label: "受発注", variant: "default", icon: Package },
  bank: { label: "銀行", variant: "default", icon: Upload },
  card: { label: "カード", variant: "default", icon: Upload },
  payment: { label: "入金消込", variant: "success", icon: Wallet },
  closing: { label: "決算", variant: "warning", icon: Package },
};

function JournalLedgerTable({ data, onRowClick, onReceiptClick, onDelete, selectedIds, onToggleSelect, onToggleSelectAll }: {
  data: JournalLedgerRow[];
  onRowClick?: (row: JournalLedgerRow) => void;
  onReceiptClick?: (receiptId: string) => void;
  onDelete?: (journalEntryId: string) => void;
  selectedIds: Set<string>;
  onToggleSelect: (journalEntryId: string) => void;
  onToggleSelectAll: () => void;
}) {
  const grandDebit = data.reduce((s, r) => s + r.debitAmount, 0);
  const grandCredit = data.reduce((s, r) => s + r.creditAmount, 0);

  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-border p-12 text-center text-muted-foreground">
        データがありません
      </div>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs [&_th]:!py-1 [&_th]:!px-2 [&_td]:!py-1 [&_td]:!px-2">
          <thead>
            <tr className="bg-muted/20 border-b-2 border-border">
              <th rowSpan={2} className="text-center px-2 py-2 border-r border-border w-[40px]">
                <input
                  type="checkbox"
                  checked={data.length > 0 && selectedIds.size === data.length}
                  onChange={(e) => { e.stopPropagation(); onToggleSelectAll(); }}
                  className="size-3.5 cursor-pointer"
                />
              </th>
              <th rowSpan={2} className="text-left px-3 py-2 text-xs font-bold text-muted-foreground border-r border-border w-[110px]">
                <div>取引日</div>
                <div className="text-[10px] font-normal text-muted-foreground/70">登録日</div>
              </th>
              <th colSpan={3} className="text-center px-3 py-1.5 text-xs font-bold text-muted-foreground border-r border-border bg-blue-50/50 dark:bg-blue-950/20">
                借方
              </th>
              <th colSpan={3} className="text-center px-3 py-1.5 text-xs font-bold text-muted-foreground border-r border-border bg-red-50/50 dark:bg-red-950/20">
                貸方
              </th>
              <th rowSpan={2} className="text-left px-3 py-2 text-xs font-bold text-muted-foreground border-r border-border">
                摘要
              </th>
              <th rowSpan={2} className="w-[40px]" />
            </tr>
            <tr className="bg-muted/10 border-b border-border">
              <th className="text-center px-2 py-1 text-xs font-bold text-muted-foreground border-r border-border/50 bg-blue-50/30 dark:bg-blue-950/10 w-[60px]">コード</th>
              <th className="text-left px-3 py-1 text-xs font-bold text-muted-foreground border-r border-border/50 bg-blue-50/30 dark:bg-blue-950/10">勘定科目</th>
              <th className="text-right px-3 py-1 text-xs font-bold text-muted-foreground border-r border-border bg-blue-50/30 dark:bg-blue-950/10 w-[120px]">金額</th>
              <th className="text-center px-2 py-1 text-xs font-bold text-muted-foreground border-r border-border/50 bg-red-50/30 dark:bg-red-950/10 w-[60px]">コード</th>
              <th className="text-left px-3 py-1 text-xs font-bold text-muted-foreground border-r border-border/50 bg-red-50/30 dark:bg-red-950/10">勘定科目</th>
              <th className="text-right px-3 py-1 text-xs font-bold text-muted-foreground border-r border-border bg-red-50/30 dark:bg-red-950/10 w-[120px]">金額</th>
            </tr>
          </thead>
          <tbody>
            {data.map((entry) => {
              const rows = entry.lines;
              const rowCount = rows.length || 1;
              const src = sourceConfig[entry.source as JournalSource];

              return (
                <Fragment key={entry.journalEntryId}>
                  {rows.length === 0 ? (
                    <tr
                      className="border-b border-border/40 hover:bg-muted/10 transition-colors cursor-pointer border-t border-border"
                      onClick={() => onRowClick?.(entry)}
                    >
                      <td className="px-2 py-1.5 text-center border-r border-border" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selectedIds.has(entry.journalEntryId)} onChange={() => onToggleSelect(entry.journalEntryId)} className="size-3.5 cursor-pointer" />
                      </td>
                      <td className="px-3 py-2 text-foreground whitespace-nowrap border-r border-border">
                        <div className="font-medium">{formatDate(entry.date)}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">({formatDate(toJstDate(entry.createdAt))})</div>
                      </td>
                      <td className="px-2 py-1.5 border-r border-border/50" />
                      <td className="px-3 py-1.5 border-r border-border/50" />
                      <td className="px-3 py-1.5 border-r border-border" />
                      <td className="px-2 py-1.5 border-r border-border/50" />
                      <td className="px-3 py-1.5 border-r border-border/50" />
                      <td className="px-3 py-1.5 border-r border-border" />
                      <td className="px-3 py-2 border-r border-border">
                        <div className="font-medium">{entry.description}</div>
                      </td>
                      <td className="px-1 py-1.5 text-center" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => onDelete?.(entry.journalEntryId)} className="text-muted-foreground hover:text-destructive transition-colors" title="削除">
                          <Trash2 className="size-3.5" />
                        </button>
                      </td>
                    </tr>
                  ) : (
                    rows.map((line, idx) => (
                      <tr
                        key={`${entry.journalEntryId}-${idx}`}
                        className={cn(
                          "border-b border-border/40 hover:bg-muted/10 transition-colors cursor-pointer",
                          idx === 0 && "border-t border-border"
                        )}
                        onClick={() => onRowClick?.(entry)}
                      >
                        {idx === 0 && (
                          <td rowSpan={rowCount} className="px-2 py-1.5 text-center border-r border-border align-top" onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" checked={selectedIds.has(entry.journalEntryId)} onChange={() => onToggleSelect(entry.journalEntryId)} className="size-3.5 cursor-pointer" />
                          </td>
                        )}
                        {idx === 0 && (
                          <td
                            rowSpan={rowCount}
                            className="px-3 py-2 text-foreground whitespace-nowrap border-r border-border align-top"
                          >
                            <div className="font-medium">{formatDate(entry.date)}</div>
                            <div className="text-[10px] text-muted-foreground mt-0.5">({formatDate(toJstDate(entry.createdAt))})</div>
                          </td>
                        )}
                        {/* 借方コード */}
                        <td className="px-2 py-1.5 text-center font-mono text-xs text-muted-foreground border-r border-border/50">
                          {line.debitCode}
                        </td>
                        {/* 借方科目 */}
                        <td className="px-3 py-1.5 text-foreground border-r border-border/50">
                          {line.debitAccount}
                        </td>
                        {/* 借方金額 */}
                        <td className="px-3 py-1.5 text-right font-mono border-r border-border">
                          {line.debitAmount > 0 ? formatCurrency(line.debitAmount) : ""}
                        </td>
                        {/* 貸方コード */}
                        <td className="px-2 py-1.5 text-center font-mono text-xs text-muted-foreground border-r border-border/50">
                          {line.creditCode}
                        </td>
                        {/* 貸方科目 */}
                        <td className="px-3 py-1.5 text-foreground border-r border-border/50">
                          {line.creditAccount}
                        </td>
                        {/* 貸方金額 */}
                        <td className="px-3 py-1.5 text-right font-mono border-r border-border">
                          {line.creditAmount > 0 ? formatCurrency(line.creditAmount) : ""}
                        </td>
                        {/* 摘要: 最初の行だけ */}
                        {idx === 0 && (
                          <td
                            rowSpan={rowCount}
                            className="px-3 py-2 text-foreground align-top"
                          >
                            <div className="font-medium">{entry.description}</div>
                            <div className="flex items-center gap-1 mt-1">
                              {src && (
                                <Badge variant={src.variant} className="text-[10px]">
                                  {(() => { const Icon = src.icon; return <Icon className="size-2.5 mr-0.5" />; })()}
                                  {src.label}
                                </Badge>
                              )}
                              {entry.receiptId && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onReceiptClick?.(entry.receiptId!);
                                  }}
                                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold border border-primary/30 bg-primary/5 text-primary hover:bg-primary/15 transition-colors cursor-pointer"
                                  title="領収書を表示"
                                >
                                  <ImageIcon className="size-2.5" />
                                  領収書
                                </button>
                              )}
                            </div>
                          </td>
                        )}
                        {/* 削除ボタン: 最初の行だけ */}
                        {idx === 0 && (
                          <td rowSpan={rowCount} className="px-1 py-1.5 text-center align-top" onClick={(e) => e.stopPropagation()}>
                            <button onClick={() => onDelete?.(entry.journalEntryId)} className="text-muted-foreground hover:text-destructive transition-colors" title="削除">
                              <Trash2 className="size-3.5" />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </Fragment>
              );
            })}
            {/* 合計行 */}
            {data.length > 0 && (
              <tr className="bg-muted/20 border-t-2 border-border font-bold">
                <td className="border-r border-border" />
                <td className="px-3 py-2 text-foreground border-r border-border">合計</td>
                <td className="px-3 py-2 border-r border-border/50" />
                <td className="px-3 py-2 border-r border-border/50" />
                <td className="px-3 py-2 text-right font-mono border-r border-border">{formatCurrency(grandDebit)}</td>
                <td className="px-3 py-2 border-r border-border/50" />
                <td className="px-3 py-2 border-r border-border/50" />
                <td className="px-3 py-2 text-right font-mono border-r border-border">{formatCurrency(grandCredit)}</td>
                <td className="px-3 py-2">
                  <Badge variant={grandDebit === grandCredit ? "success" : "destructive"}>
                    <ArrowDownUp className="size-3 mr-1" />
                    {grandDebit === grandCredit ? "貸借一致" : "貸借不一致"}
                  </Badge>
                </td>
                <td />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function GeneralLedgerTable({
  account,
  onAccountChange,
  accounts,
  accountOptions,
  data,
}: {
  account: string;
  onAccountChange: (a: string) => void;
  accounts: string[];
  accountOptions: { id: string; code: string; name: string; categoryType: string; categoryName: string }[];
  data: GeneralLedgerRow[];
}) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  // AccountLookup用: 選択中のアカウントIDを管理
  const selectedAccountId = accountOptions.find((a) => a.name === account)?.id ?? "";

  if (accounts.length === 0) {
    return (
      <div className="rounded-xl border border-border p-12 text-center text-muted-foreground">
        データがありません
      </div>
    );
  }
  return (
    <div>
      {data.length === 0 ? (
        <div className="rounded-xl border border-border p-12 text-center text-muted-foreground">
          この科目のデータがありません
        </div>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs [&_th]:!py-1 [&_th]:!px-2 [&_td]:!py-1 [&_td]:!px-2">
              <thead>
                <tr className="bg-muted/20 border-b-2 border-border">
                  <th className="text-left px-2 py-2 text-xs font-bold text-muted-foreground border-r border-border w-[90px]">日付</th>
                  <th className="text-left px-2 py-2 text-xs font-bold text-muted-foreground border-r border-border w-[70px]">伝票番号</th>
                  <th className="text-left px-3 py-2 text-xs font-bold text-muted-foreground border-r border-border">摘要</th>
                  <th className="text-left px-2 py-2 text-xs font-bold text-muted-foreground border-r border-border w-[110px]">相手科目</th>
                  <th className="text-right px-2 py-2 text-xs font-bold text-muted-foreground border-r border-border w-[100px]">借方</th>
                  <th className="text-right px-2 py-2 text-xs font-bold text-muted-foreground border-r border-border w-[100px]">貸方</th>
                  <th className="text-right px-2 py-2 text-xs font-bold text-muted-foreground w-[100px]">残高</th>
                </tr>
              </thead>
              <tbody>
                {data.map((row, idx) => (
                  <Fragment key={idx}>
                    <tr
                      className={cn(
                        "border-b border-border/40 hover:bg-muted/10 transition-colors",
                        row.id === "前繰" ? "bg-muted/10 font-medium" : "bg-card"
                      )}
                    >
                      <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap border-r border-border/50 text-xs">{formatDate(row.date)}</td>
                      <td className="px-2 py-1.5 font-mono text-xs text-muted-foreground border-r border-border/50">{row.id}</td>
                      <td className="px-3 py-1.5 text-foreground border-r border-border/50">{row.description}</td>
                      <td className="px-2 py-1.5 text-foreground text-xs border-r border-border/50">
                        {row.counterAccount === "諸口" ? (
                          <button
                            onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
                            className="inline-flex items-center gap-1 text-primary hover:underline cursor-pointer font-medium"
                          >
                            諸口
                            {expandedIdx === idx ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                          </button>
                        ) : (
                          row.counterAccount || "-"
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-xs border-r border-border/50">{row.debit > 0 ? formatCurrency(row.debit) : ""}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-xs border-r border-border/50">{row.credit > 0 ? formatCurrency(row.credit) : ""}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-xs font-bold text-foreground">{formatCurrency(row.balance)}</td>
                    </tr>
                    {expandedIdx === idx && row.counterAccountDetails && (
                      <tr>
                        <td colSpan={7} className="p-0">
                          <div className="bg-muted/10 px-8 py-3 border-b border-border">
                            <p className="text-xs font-bold text-muted-foreground mb-2">相手科目の内訳</p>
                            <table className="w-full text-xs [&_th]:!py-1 [&_th]:!px-2 [&_td]:!py-1 [&_td]:!px-2">
                              <thead>
                                <tr className="border-b border-border/50">
                                  <th className="text-left py-1.5 text-muted-foreground font-bold">勘定科目</th>
                                  <th className="text-right py-1.5 text-muted-foreground font-bold">借方</th>
                                  <th className="text-right py-1.5 text-muted-foreground font-bold">貸方</th>
                                </tr>
                              </thead>
                              <tbody>
                                {row.counterAccountDetails.map((d, i) => (
                                  <tr key={i} className="border-b border-border/30 last:border-0">
                                    <td className="py-1.5 text-foreground">{d.name}</td>
                                    <td className="py-1.5 text-right font-mono">{d.debit > 0 ? formatCurrency(d.debit) : ""}</td>
                                    <td className="py-1.5 text-right font-mono">{d.credit > 0 ? formatCurrency(d.credit) : ""}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function CashBookLedger({
  data,
  inLabel,
  outLabel,
}: {
  data: CashBookRow[];
  inLabel: string;
  outLabel: string;
}) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-border p-12 text-center text-muted-foreground">
        データがありません
      </div>
    );
  }
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs [&_th]:!py-1 [&_th]:!px-2 [&_td]:!py-1 [&_td]:!px-2">
          <thead>
            <tr className="bg-muted/20 border-b-2 border-border">
              <th className="text-left px-3 py-2 text-xs font-bold text-muted-foreground border-r border-border">日付</th>
              <th className="text-left px-3 py-2 text-xs font-bold text-muted-foreground border-r border-border">伝票番号</th>
              <th className="text-left px-3 py-2 text-xs font-bold text-muted-foreground border-r border-border">摘要</th>
              <th className="text-left px-3 py-2 text-xs font-bold text-muted-foreground border-r border-border">相手科目</th>
              <th className="text-right px-3 py-2 text-xs font-bold text-muted-foreground border-r border-border">{inLabel}</th>
              <th className="text-right px-3 py-2 text-xs font-bold text-muted-foreground border-r border-border">{outLabel}</th>
              <th className="text-right px-3 py-2 text-xs font-bold text-muted-foreground">残高</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, idx) => (
              <Fragment key={idx}>
                <tr
                  className={cn(
                    "border-b border-border/40 hover:bg-muted/10 transition-colors",
                    row.id === "前繰" ? "bg-muted/10 font-medium" : "bg-card"
                  )}
                >
                  <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap border-r border-border/50">{formatDate(row.date)}</td>
                  <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground border-r border-border/50">{row.id}</td>
                  <td className="px-3 py-1.5 text-foreground border-r border-border/50">{row.description}</td>
                  <td className="px-3 py-1.5 text-foreground border-r border-border/50">
                    {row.counterAccount === "諸口" ? (
                      <button
                        onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
                        className="inline-flex items-center gap-1 text-primary hover:underline cursor-pointer font-medium"
                      >
                        諸口
                        {expandedIdx === idx ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                      </button>
                    ) : (
                      row.counterAccount || "-"
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono border-r border-border/50">{row.inAmount > 0 ? formatCurrency(row.inAmount) : ""}</td>
                  <td className="px-3 py-1.5 text-right font-mono border-r border-border/50">{row.outAmount > 0 ? formatCurrency(row.outAmount) : ""}</td>
                  <td className="px-3 py-1.5 text-right font-mono font-bold text-foreground">{formatCurrency(row.balance)}</td>
                </tr>
                {expandedIdx === idx && row.counterAccountDetails && (
                  <tr>
                    <td colSpan={7} className="p-0">
                      <div className="bg-muted/10 px-8 py-3 border-b border-border">
                        <p className="text-xs font-bold text-muted-foreground mb-2">相手科目の内訳</p>
                        <table className="w-full text-xs [&_th]:!py-1 [&_th]:!px-2 [&_td]:!py-1 [&_td]:!px-2">
                          <thead>
                            <tr className="border-b border-border/50">
                              <th className="text-left py-1.5 text-muted-foreground font-bold">勘定科目</th>
                              <th className="text-right py-1.5 text-muted-foreground font-bold">借方</th>
                              <th className="text-right py-1.5 text-muted-foreground font-bold">貸方</th>
                            </tr>
                          </thead>
                          <tbody>
                            {row.counterAccountDetails.map((d, i) => (
                              <tr key={i} className="border-b border-border/30 last:border-0">
                                <td className="py-1.5 text-foreground">{d.name}</td>
                                <td className="py-1.5 text-right font-mono">{d.debit > 0 ? formatCurrency(d.debit) : ""}</td>
                                <td className="py-1.5 text-right font-mono">{d.credit > 0 ? formatCurrency(d.credit) : ""}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            <tr className="bg-muted/20 border-t-2 border-border font-bold">
              <td colSpan={4} className="px-3 py-2 text-foreground border-r border-border">合計</td>
              <td className="px-3 py-2 text-right font-mono border-r border-border/50">{formatCurrency(data.reduce((s, r) => s + r.inAmount, 0))}</td>
              <td className="px-3 py-2 text-right font-mono border-r border-border/50">{formatCurrency(data.reduce((s, r) => s + r.outAmount, 0))}</td>
              <td className="px-3 py-2 text-right font-mono font-bold text-foreground">
                {data.length > 0 ? formatCurrency(data[data.length - 1].balance) : formatCurrency(0)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// Convert GeneralLedgerRow to CashBookRow (for sub-ledger tabs)
function toCashBookRows(glRows: GeneralLedgerRow[], isDebitNormal: boolean): CashBookRow[] {
  return glRows.map((r) => ({
    date: r.date,
    id: r.id,
    description: r.description,
    counterAccount: r.counterAccount,
    counterAccountDetails: r.counterAccountDetails,
    inAmount: isDebitNormal ? r.debit : r.credit,
    outAmount: isDebitNormal ? r.credit : r.debit,
    balance: r.balance,
  }));
}

// ---------------------------------------------------------------------------
// Fixed Asset types & helpers
// ---------------------------------------------------------------------------

type AssetCategory = "all" | "building" | "vehicle" | "equipment" | "software";

const assetCategoryOptions: { key: AssetCategory; label: string; icon: typeof Building2 }[] = [
  { key: "all", label: "すべて", icon: Landmark },
  { key: "building", label: "建物", icon: Building2 },
  { key: "vehicle", label: "車両", icon: Car },
  { key: "equipment", label: "器具備品", icon: Monitor },
  { key: "software", label: "ソフトウェア", icon: Code2 },
];

const assetCategoryMap: Record<string, AssetCategory> = {
  "建物": "building",
  "車両運搬具": "vehicle",
  "車両": "vehicle",
  "器具備品": "equipment",
  "ソフトウェア": "software",
};

const assetCategoryLabelMap: Record<AssetCategory, string> = {
  all: "すべて",
  building: "建物",
  vehicle: "車両",
  equipment: "器具備品",
  software: "ソフトウェア",
};

const depMethodLabel: Record<string, string> = {
  straight_line: "定額法",
  declining_balance: "定率法",
};

type AssetRow = Database["public"]["Tables"]["fixed_assets"]["Row"];

type AssetDisplay = {
  id: string;
  name: string;
  category: AssetCategory;
  categoryLabel: string;
  acquisitionDate: string;
  acquisitionCost: number;
  usefulLife: number;
  depreciationMethod: string;
  bookValue: number;
};

function mapAssetRows(rows: AssetRow[]): AssetDisplay[] {
  return rows.map((r) => {
    const cat = assetCategoryMap[r.category ?? ""] ?? "equipment";
    return {
      id: r.id,
      name: r.name,
      category: cat,
      categoryLabel: assetCategoryLabelMap[cat],
      acquisitionDate: r.acquisition_date.replace(/-/g, "/"),
      acquisitionCost: r.acquisition_cost,
      usefulLife: r.useful_life,
      depreciationMethod: depMethodLabel[r.depreciation_method] ?? r.depreciation_method,
      bookValue: r.acquisition_cost,
    };
  });
}

function FixedAssetLedgerTable({ assets }: { assets: AssetDisplay[] }) {
  const [selectedCategory, setSelectedCategory] = useState<AssetCategory>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedAsset, setExpandedAsset] = useState<string | null>(null);

  const filtered = assets.filter((a) => {
    if (selectedCategory !== "all" && a.category !== selectedCategory) return false;
    if (searchQuery) return a.name.toLowerCase().includes(searchQuery.toLowerCase());
    return true;
  });

  const totalAcquisition = filtered.reduce((s, a) => s + a.acquisitionCost, 0);
  const totalBookValue = filtered.reduce((s, a) => s + a.bookValue, 0);

  return (
    <>
      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-2">
            <Landmark className="size-4 text-primary" />
            <span className="text-sm text-muted-foreground">資産総額</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{formatCurrency(totalAcquisition)}</p>
          <p className="text-xs text-muted-foreground mt-1">{filtered.length}件の資産</p>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-2">
            <Building2 className="size-4 text-success" />
            <span className="text-sm text-muted-foreground">期末帳簿価額</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{formatCurrency(totalBookValue)}</p>
          <p className="text-xs text-muted-foreground mt-1">
            償却率: {totalAcquisition > 0 ? ((1 - totalBookValue / totalAcquisition) * 100).toFixed(1) : "0.0"}%
          </p>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-2">
            <Landmark className="size-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">分類別内訳</span>
          </div>
          <div className="flex flex-wrap gap-2 mt-1">
            {(["building", "vehicle", "equipment", "software"] as const).map((cat) => {
              const count = filtered.filter((a) => a.category === cat).length;
              if (count === 0) return null;
              return (
                <Badge key={cat} variant="muted">
                  {assetCategoryLabelMap[cat]}: {count}件
                </Badge>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Filter */}
      <Card className="mb-6 p-4">
        <div className="flex items-center gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="資産名で検索..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-card text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div className="flex gap-1 bg-muted/20 p-1 rounded-lg">
            {assetCategoryOptions.map((opt) => (
              <button
                key={opt.key}
                onClick={() => setSelectedCategory(opt.key)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-all",
                  selectedCategory === opt.key
                    ? "bg-card text-primary shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <opt.icon className="size-3.5" />
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs [&_th]:!py-1 [&_th]:!px-2 [&_td]:!py-1 [&_td]:!px-2">
            <thead>
              <tr className="bg-muted/20 border-b-2 border-border">
                <th className="text-left px-3 py-2 text-xs font-bold text-muted-foreground border-r border-border">資産名</th>
                <th className="text-left px-3 py-2 text-xs font-bold text-muted-foreground border-r border-border">分類</th>
                <th className="text-left px-3 py-2 text-xs font-bold text-muted-foreground border-r border-border">取得日</th>
                <th className="text-right px-3 py-2 text-xs font-bold text-muted-foreground border-r border-border">取得価額</th>
                <th className="text-center px-3 py-2 text-xs font-bold text-muted-foreground border-r border-border">耐用年数</th>
                <th className="text-center px-3 py-2 text-xs font-bold text-muted-foreground border-r border-border">償却方法</th>
                <th className="text-right px-3 py-2 text-xs font-bold text-muted-foreground">帳簿価額</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((asset) => (
                <tr key={asset.id} className="border-b border-border/40 hover:bg-muted/10 transition-colors">
                  <td className="px-3 py-1.5 font-medium text-foreground border-r border-border/50">{asset.name}</td>
                  <td className="px-3 py-1.5 border-r border-border/50"><Badge variant="muted">{asset.categoryLabel}</Badge></td>
                  <td className="px-3 py-1.5 text-muted-foreground border-r border-border/50">{asset.acquisitionDate}</td>
                  <td className="px-3 py-1.5 text-right font-mono border-r border-border/50">{formatCurrency(asset.acquisitionCost)}</td>
                  <td className="px-3 py-1.5 text-center text-muted-foreground border-r border-border/50">{asset.usefulLife}年</td>
                  <td className="px-3 py-1.5 text-center border-r border-border/50">
                    <Badge variant={asset.depreciationMethod === "定額法" ? "default" : "accent"}>
                      {asset.depreciationMethod}
                    </Badge>
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono font-bold">{formatCurrency(asset.bookValue)}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-12 text-center text-muted-foreground">
                    該当する固定資産が見つかりません
                  </td>
                </tr>
              )}
              {filtered.length > 0 && (
                <tr className="bg-muted/20 border-t-2 border-border font-bold">
                  <td className="px-3 py-2 text-foreground border-r border-border">合計</td>
                  <td className="px-3 py-2 border-r border-border/50"></td>
                  <td className="px-3 py-2 border-r border-border/50"></td>
                  <td className="px-3 py-2 text-right font-mono border-r border-border/50">{formatCurrency(totalAcquisition)}</td>
                  <td className="px-3 py-2 border-r border-border/50"></td>
                  <td className="px-3 py-2 border-r border-border/50"></td>
                  <td className="px-3 py-2 text-right font-mono">{formatCurrency(totalBookValue)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function LedgersPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  // デフォルトは今月
  const mm = String(month).padStart(2, "0");
  const monthLastDay = new Date(year, month, 0).getDate();
  const defaultFrom = `${year}-${mm}-01`;
  const defaultTo = `${year}-${mm}-${String(monthLastDay).padStart(2, "0")}`;
  // 決算月（期首月）— 年度セレクタ用。既定4月
  const [fiscalStartMonth, setFiscalStartMonth] = useState(4);

  // URLクエリパラメータ（B/S等からの遷移用）
  const validTabs: LedgerTab[] = ["journal", "general", "cash", "deposit", "receivable", "payable", "assets"];
  const paramTab = searchParams.get("tab") as LedgerTab | null;
  const paramAccount = searchParams.get("account");
  const initialTab: LedgerTab = paramTab && validTabs.includes(paramTab) ? paramTab : "journal";
  const initialAccount = paramAccount ? decodeURIComponent(paramAccount) : "現金";

  const [activeTab, setActiveTab] = useState<LedgerTab>(initialTab);
  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo, setDateTo] = useState(defaultTo);

  // クライアントの決算月を取得（年度セレクタの表示・範囲計算に使用）
  useEffect(() => {
    getClient(id)
      .then((c) => setFiscalStartMonth((c as { fiscal_year_start_month?: number }).fiscal_year_start_month ?? 4))
      .catch(() => {});
  }, [id]);
  const [glAccount, setGlAccount] = useState(initialAccount);
  const [depositAccount, setDepositAccount] = useState("普通預金");

  // 仕訳帳・総勘定元帳共通の拡張フィルター
  const [periodMode, setPeriodMode] = useState<"none" | "year" | "month">("none");
  const [fiscalYear, setFiscalYear] = useState("");
  const [accountFilter, setAccountFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOrder, setSortOrder] = useState<"created_asc" | "created_desc" | "date_asc" | "date_desc">("date_asc");
  const fiscalYearRef = useRef<HTMLSelectElement | null>(null);

  // 摘要の予測候補（過去の摘要から）
  const [descSuggestions, setDescSuggestions] = useState<string[]>([]);
  useEffect(() => {
    getDescriptionSuggestions(id).then(setDescSuggestions).catch(() => setDescSuggestions([]));
  }, [id]);

  // 勘定科目リスト（AccountLookup用）
  const [accountOptions, setAccountOptions] = useState<{ id: string; code: string; name: string; categoryType: string; categoryName: string }[]>([]);

  useEffect(() => {
    getAccounts(id)
      .then((data) =>
        setAccountOptions(
          (data ?? []).map((a) => {
            const cat = a.account_categories as unknown as { type: string; name: string };
            return {
              id: a.id,
              code: a.code,
              name: a.name,
              categoryType: cat?.type ?? "",
              categoryName: cat?.name ?? "",
            };
          })
        )
      )
      .catch(console.error);
  }, [id]);

  const [journalData, setJournalData] = useState<JournalLedgerRow[]>([]);
  const [accountList, setAccountList] = useState<string[]>([]);
  const [glData, setGlData] = useState<GeneralLedgerRow[]>([]);
  const [subLedgerData, setSubLedgerData] = useState<GeneralLedgerRow[]>([]);
  const [partnerReceivables, setPartnerReceivables] = useState<PartnerReceivable[]>([]);
  const [agingReport, setAgingReport] = useState<AgingReportRow[]>([]);

  // タブコンテンツ読み込み状態（テーブルエリアのスピナー用）
  const [tabLoading, setTabLoading] = useState(false);

  // Fixed assets data
  const [assetsData, setAssetsData] = useState<AssetDisplay[]>([]);

  // Detail panel state
  const [selectedRow, setSelectedRow] = useState<JournalLedgerRow | null>(null);
  const [detailData, setDetailData] = useState<JournalEntryDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // 仕訳編集（AI生成・取込仕訳の修正）
  const [editing, setEditing] = useState(false);
  const [editDate, setEditDate] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editLines, setEditLines] = useState<{ account_id: string; debit: string; credit: string }[]>([]);
  const [savingEdit, setSavingEdit] = useState(false);

  const handleStartEdit = async () => {
    if (!selectedRow) return;
    try {
      const entry = await getJournalEntry(selectedRow.journalEntryId);
      const rawLines = ((entry as { journal_entry_lines?: Array<{ account_id: string; debit_amount: number; credit_amount: number; sort_order?: number }> }).journal_entry_lines ?? [])
        .slice()
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
      setEditDate((entry as { entry_date?: string }).entry_date ?? selectedRow.date);
      setEditDesc((entry as { description?: string | null }).description ?? "");
      setEditLines(
        rawLines.length
          ? rawLines.map((l) => ({
              account_id: l.account_id,
              debit: l.debit_amount ? String(l.debit_amount) : "",
              credit: l.credit_amount ? String(l.credit_amount) : "",
            }))
          : [{ account_id: "", debit: "", credit: "" }]
      );
      setEditing(true);
    } catch (e) {
      alert(e instanceof Error ? e.message : "編集データの取得に失敗しました");
    }
  };

  const updateEditLine = (i: number, field: "account_id" | "debit" | "credit", val: string) =>
    setEditLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, [field]: val } : l)));
  const addEditLine = () => setEditLines((prev) => [...prev, { account_id: "", debit: "", credit: "" }]);
  const removeEditLine = (i: number) => setEditLines((prev) => prev.filter((_, idx) => idx !== i));

  const editTotalD = editLines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const editTotalC = editLines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const editBalanced = editTotalD > 0 && editTotalD === editTotalC;

  const handleSaveEdit = async () => {
    if (!selectedRow) return;
    setSavingEdit(true);
    try {
      await updateJournalEntryWithLines(
        selectedRow.journalEntryId,
        { entry_date: editDate, description: editDesc },
        editLines.map((l) => ({
          account_id: l.account_id,
          debit_amount: Number(l.debit) || 0,
          credit_amount: Number(l.credit) || 0,
        }))
      );
      setEditing(false);
      setSelectedRow(null);
      await fetchJournal();
    } catch (e) {
      alert(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSavingEdit(false);
    }
  };


  // Journal deletion state
  const [selectedJournalIds, setSelectedJournalIds] = useState<Set<string>>(new Set());
  const [deletingJournal, setDeletingJournal] = useState(false);

  const handleToggleSelect = (journalEntryId: string) => {
    setSelectedJournalIds((prev) => {
      const next = new Set(prev);
      if (next.has(journalEntryId)) next.delete(journalEntryId);
      else next.add(journalEntryId);
      return next;
    });
  };

  const handleToggleSelectAll = () => {
    if (selectedJournalIds.size === filteredJournalData.length) {
      setSelectedJournalIds(new Set());
    } else {
      setSelectedJournalIds(new Set(filteredJournalData.map((r) => r.journalEntryId)));
    }
  };

  const handleDeleteJournal = async (journalEntryId: string) => {
    if (!confirm("この仕訳を削除しますか？")) return;
    setDeletingJournal(true);
    try {
      await deleteJournalEntries([journalEntryId]);
      setSelectedJournalIds((prev) => { const next = new Set(prev); next.delete(journalEntryId); return next; });
      await fetchJournal();
    } catch (e) {
      alert(e instanceof Error ? e.message : "削除に失敗しました");
    } finally {
      setDeletingJournal(false);
    }
  };

  const handleBulkDeleteJournals = async () => {
    const count = selectedJournalIds.size;
    if (count === 0) return;
    if (!confirm(`${count}件の仕訳を削除しますか？`)) return;
    setDeletingJournal(true);
    try {
      await deleteJournalEntries([...selectedJournalIds]);
      setSelectedJournalIds(new Set());
      await fetchJournal();
    } catch (e) {
      alert(e instanceof Error ? e.message : "削除に失敗しました");
    } finally {
      setDeletingJournal(false);
    }
  };

  // Receipt preview modal state
  const [receiptPreviewUrl, setReceiptPreviewUrl] = useState<string | null>(null);
  const [receiptPreviewMime, setReceiptPreviewMime] = useState<string | null>(null);
  const [receiptPreviewLoading, setReceiptPreviewLoading] = useState(false);

  const handleReceiptPreview = async (receiptId: string) => {
    setReceiptPreviewLoading(true);
    setReceiptPreviewUrl(null);
    setReceiptPreviewMime(null);
    try {
      const receipt = await getReceipt(receiptId);
      if (!receipt?.image_path) throw new Error("画像パスがありません");
      const url = await getReceiptImageUrl(receipt.image_path);
      setReceiptPreviewUrl(url);
      // Raqto連携証憑は常にPDF（mime_type未設定のため画像パスから判定）
      const isPdf =
        receipt.mime_type === "application/pdf" ||
        receipt.image_path.endsWith(".pdf") ||
        receipt.image_path.startsWith("raqto://");
      setReceiptPreviewMime(isPdf ? "application/pdf" : receipt.mime_type ?? null);
    } catch {
      setReceiptPreviewUrl(null);
    } finally {
      setReceiptPreviewLoading(false);
    }
  };

  const closeReceiptPreview = () => {
    setReceiptPreviewUrl(null);
    setReceiptPreviewMime(null);
    setReceiptPreviewLoading(false);
  };

  const handleRowClick = async (row: JournalLedgerRow) => {
    setSelectedRow(row);
    setEditing(false);
    setDetailData(null);
    setDetailLoading(true);
    try {
      const detail = await getJournalEntryDetail(row.journalEntryId);
      setDetailData(detail);
    } catch {
      setDetailData(null);
    } finally {
      setDetailLoading(false);
    }
  };

  // Fetch journal data
  const fetchJournal = useCallback(async () => {
    setTabLoading(true);
    beginLoad();
    try {
      const data = await getJournalLedger(id, dateFrom, dateTo);
      setJournalData(data);
    } catch { /* fallback to empty */ }
    finally { setTabLoading(false); endLoad(); }
  }, [id, dateFrom, dateTo]);

  // Fetch account list
  const fetchAccounts = useCallback(async () => {
    try {
      const data = await getAccountList(id);
      setAccountList(data);
      if (data.length > 0 && !data.includes(glAccount)) {
        setGlAccount(data[0]);
      }
    } catch { /* fallback to empty */ }
  }, [id, glAccount]);

  // Fetch general ledger data
  const fetchGL = useCallback(async () => {
    setTabLoading(true);
    beginLoad();
    try {
      const data = await getGeneralLedger(id, glAccount, dateFrom, dateTo);
      setGlData(data);
    } catch { /* fallback to empty */ }
    finally { setTabLoading(false); endLoad(); }
  }, [id, glAccount, dateFrom, dateTo]);

  // Fetch sub-ledger data (cash, deposit, receivable, payable)
  const fetchSubLedger = useCallback(async () => {
    // deposit タブは動的に選択された口座名を使用
    const accountName = activeTab === "deposit" ? depositAccount : subLedgerAccountMap[activeTab];
    if (!accountName) return;
    setTabLoading(true);
    beginLoad();
    try {
      const data = await getGeneralLedger(id, accountName, dateFrom, dateTo);
      setSubLedgerData(data);
    } catch { setSubLedgerData([]); }
    finally { setTabLoading(false); endLoad(); }
  }, [id, activeTab, dateFrom, dateTo, depositAccount]);

  useEffect(() => {
    if (activeTab === "journal") fetchJournal();
  }, [activeTab, fetchJournal]);

  useEffect(() => {
    if (activeTab === "general") {
      fetchAccounts();
      fetchGL();
    }
  }, [activeTab, fetchAccounts, fetchGL]);

  useEffect(() => {
    if (["cash", "deposit", "receivable", "payable"].includes(activeTab)) {
      fetchSubLedger();
    }
  }, [activeTab, fetchSubLedger]);

  useEffect(() => {
    if (activeTab === "assets") {
      setTabLoading(true);
      beginLoad();
      getAssets(id)
        .then(mapAssetRows)
        .then(setAssetsData)
        .catch(console.error)
        .finally(() => { setTabLoading(false); endLoad(); });
    }
  }, [activeTab, id]);

  useEffect(() => {
    if (activeTab === "receivable") {
      Promise.all([
        getReceivablesByPartner(id).catch(() => [] as PartnerReceivable[]),
        getAgingReport(id).catch(() => [] as AgingReportRow[]),
      ]).then(([partners, aging]) => {
        setPartnerReceivables(partners);
        setAgingReport(aging);
      });
    }
  }, [activeTab, id]);

  // 仕訳帳タブ用のフィルター・ソート
  const filteredJournalData = useMemo(() => {
    let data = journalData;
    // 勘定科目フィルター
    if (accountFilter !== "all") {
      const filterName = accountOptions.find((a) => a.id === accountFilter)?.name;
      if (filterName) {
        data = data.filter(
          (r) => r.debitAccount === filterName || r.creditAccount === filterName
        );
      }
    }
    // 摘要フィルター
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      data = data.filter((r) => r.description.toLowerCase().includes(q));
    }
    // ソート
    data = [...data].sort((a, b) => {
      switch (sortOrder) {
        case "created_desc":
          return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
        case "created_asc":
          return (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
        case "date_desc":
          return b.date.localeCompare(a.date) || (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
        case "date_asc":
          return a.date.localeCompare(b.date) || (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
        default:
          return 0;
      }
    });
    return data;
  }, [journalData, accountFilter, accountOptions, searchQuery, sortOrder]);

  // 総勘定元帳タブ用のソート
  const filteredGlData = useMemo(() => {
    let data = glData;
    if (sortOrder === "date_desc") {
      data = [...data].reverse();
    }
    return data;
  }, [glData, sortOrder]);

  // 現金出納帳・預金出納帳タブ用のソート
  const filteredCashData = useMemo(() => {
    const isDebitNormal = activeTab === "cash" || activeTab === "deposit";
    let data = toCashBookRows(subLedgerData, isDebitNormal);
    if (sortOrder === "date_desc") {
      data = [...data].reverse();
    }
    return data;
  }, [subLedgerData, sortOrder, activeTab]);

  // Presets relative to current date
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevMonthYear = month === 1 ? year - 1 : year;
  const prevMonthLastDay = new Date(prevMonthYear, prevMonth, 0).getDate();

  const thisMonthFrom = `${year}-${String(month).padStart(2, "0")}-01`;
  const thisMonthLastDay = new Date(year, month, 0).getDate();
  const thisMonthTo = `${year}-${String(month).padStart(2, "0")}-${String(thisMonthLastDay).padStart(2, "0")}`;

  // 今年度 = クライアントの決算月基準の会計年度（今月と同一だったバグを修正）
  const currentFiscalRange = fiscalRangeFromStartYear(
    fiscalStartMonth,
    currentFiscalStartYear(fiscalStartMonth)
  );
  const presets = [
    { label: "今年度", from: currentFiscalRange.startDate, to: currentFiscalRange.endDate },
    { label: "今月", from: thisMonthFrom, to: thisMonthTo },
    { label: "前月", from: `${prevMonthYear}-${String(prevMonth).padStart(2, "0")}-01`, to: `${prevMonthYear}-${String(prevMonth).padStart(2, "0")}-${String(prevMonthLastDay).padStart(2, "0")}` },
  ];

  function handleCSVExport() {
    if (activeTab === "journal") {
      downloadCSV(
        `仕訳帳_${dateFrom}_${dateTo}.csv`,
        ["日付", "伝票番号", "摘要", "借方科目", "貸方科目", "借方金額", "貸方金額"],
        filteredJournalData.map((r) => [r.date, r.id, r.description, r.debitAccount, r.creditAccount, r.debitAmount, r.creditAmount])
      );
    } else if (activeTab === "general") {
      downloadCSV(
        `総勘定元帳_${glAccount}.csv`,
        ["日付", "伝票番号", "摘要", "相手科目", "借方", "貸方", "残高"],
        filteredGlData.map((r) => [r.date, r.id, r.description, r.counterAccount, r.debit, r.credit, r.balance])
      );
    } else if (activeTab === "assets") {
      downloadCSV(
        `固定資産台帳.csv`,
        ["資産名", "分類", "取得日", "取得価額", "耐用年数", "償却方法", "帳簿価額"],
        assetsData.map((a) => [a.name, a.categoryLabel, a.acquisitionDate, a.acquisitionCost, `${a.usefulLife}年`, a.depreciationMethod, a.bookValue])
      );
    } else {
      const tabLabel = tabs.find((t) => t.key === activeTab)?.label ?? activeTab;
      const isDebitNormal = activeTab === "cash" || activeTab === "deposit";
      const cashData = toCashBookRows(subLedgerData, isDebitNormal);
      downloadCSV(
        `${tabLabel}.csv`,
        ["日付", "伝票番号", "摘要", "相手科目", "入金", "出金", "残高"],
        cashData.map((r) => [r.date, r.id, r.description, r.counterAccount, r.inAmount, r.outAmount, r.balance])
      );
    }
  }

  return (
    <>
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <BookOpen className="size-6 text-primary" />
            帳簿閲覧
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            仕訳帳・総勘定元帳・補助元帳の閲覧とCSV出力
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleCSVExport}>
            <FileSpreadsheet className="size-4" />
            CSV出力
          </Button>
          <Button variant="outline" size="sm" onClick={() => printPage()}>
            <FileText className="size-4" />
            PDF出力
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-4 overflow-x-auto border-b border-border pb-px">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "px-4 py-2 text-sm font-bold transition-colors whitespace-nowrap border-b-2 -mb-px cursor-pointer",
              activeTab === tab.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Filter (not shown for assets tab which has its own filter) */}
      {activeTab !== "assets" && (
      <Card className="mb-4">
        <CardContent className="py-2.5 px-3">
          {(activeTab === "journal" || activeTab === "general" || activeTab === "cash" || activeTab === "deposit") ? (
            /* 仕訳帳・総勘定元帳・現金出納帳タブ用: 拡張フィルター */
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground font-bold">年度別</label>
                <select
                  ref={fiscalYearRef}
                  value={periodMode === "year" ? fiscalYear : ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setFiscalYear(v);
                    if (!v) {
                      setPeriodMode("none");
                      setDateFrom(defaultFrom);
                      setDateTo(defaultTo);
                      return;
                    }
                    const fy = parseInt(v);
                    const { startDate, endDate } = fiscalRangeFromStartYear(fiscalStartMonth, fy);
                    setDateFrom(startDate);
                    setDateTo(endDate);
                    setPeriodMode("year");
                  }}
                  className="px-3 py-1.5 rounded-lg border border-border bg-card text-foreground text-sm"
                >
                  <option value="">選択なし</option>
                  {Array.from({ length: 5 }, (_, i) => {
                    const y = new Date().getFullYear() - i;
                    const { startDate, endDate } = fiscalRangeFromStartYear(fiscalStartMonth, y);
                    return (
                      <option key={y} value={y}>
                        {y}年度（{startDate.slice(0, 7).replace("-", "/")}〜{endDate.slice(0, 7).replace("-", "/")}）
                      </option>
                    );
                  })}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground font-bold">月別</label>
                <input
                  type="month"
                  value={periodMode === "year" ? "" : dateFrom.slice(0, 7)}
                  onChange={(e) => {
                    if (!e.target.value) {
                      setPeriodMode("none");
                      fiscalYearRef.current?.focus();
                      return;
                    }
                    const [y, m] = e.target.value.split("-").map(Number);
                    const ld = new Date(y, m, 0).getDate();
                    setDateFrom(`${y}-${String(m).padStart(2, "0")}-01`);
                    setDateTo(`${y}-${String(m).padStart(2, "0")}-${String(ld).padStart(2, "0")}`);
                    setPeriodMode("month");
                  }}
                  className="px-3 py-1.5 rounded-lg border border-border bg-card text-foreground text-sm"
                />
              </div>
              {activeTab === "journal" && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground font-bold">勘定科目</label>
                  <AccountLookup
                    accounts={accountOptions}
                    value={accountFilter === "all" ? "" : accountFilter}
                    onChange={(v) => setAccountFilter(v || "all")}
                  />
                </div>
              )}
              {activeTab === "general" && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground font-bold">勘定科目</label>
                  <div className="w-[250px]">
                    <AccountLookup
                      accounts={accountOptions}
                      value={accountOptions.find((a) => a.name === glAccount)?.id ?? ""}
                      onChange={(id) => {
                        const acc = accountOptions.find((a) => a.id === id);
                        if (acc) setGlAccount(acc.name);
                      }}
                    />
                  </div>
                </div>
              )}
              {activeTab === "deposit" && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground font-bold">預金口座</label>
                  <div className="w-[250px]">
                    <AccountLookup
                      accounts={accountOptions.filter((a) => a.categoryType === "assets" && a.name.includes("預金"))}
                      value={accountOptions.find((a) => a.name === depositAccount)?.id ?? ""}
                      onChange={(id) => {
                        const acc = accountOptions.find((a) => a.id === id);
                        if (acc) setDepositAccount(acc.name);
                      }}
                    />
                  </div>
                </div>
              )}
              {activeTab === "journal" && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground font-bold">摘要</label>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="摘要で絞り込み..."
                      list="ledger-memo-suggestions"
                      className="pl-8 pr-3 py-1.5 rounded-lg border border-border bg-card text-foreground text-sm placeholder:text-muted-foreground"
                    />
                    <datalist id="ledger-memo-suggestions">
                      {descSuggestions.map((d) => (
                        <option key={d} value={d} />
                      ))}
                    </datalist>
                  </div>
                </div>
              )}
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground font-bold">並べ替え</label>
                <select
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value as typeof sortOrder)}
                  className="px-3 py-1.5 rounded-lg border border-border bg-card text-foreground text-sm"
                >
                  <option value="date_asc">取引日（古い順）</option>
                  <option value="date_desc">取引日（新しい順）</option>
                  {activeTab === "journal" && <option value="created_desc">登録日（新しい順）</option>}
                  {activeTab === "journal" && <option value="created_asc">登録日（古い順）</option>}
                </select>
              </div>
            </div>
          ) : (
            /* 他のタブ: シンプルな期間フィルター */
            <div className="flex items-center gap-4">
              <Calendar className="size-4 text-muted-foreground" />
              <label className="text-xs text-muted-foreground font-bold">期間:</label>
              <DateInput allowEmpty value={dateFrom}
                onChange={(v) => setDateFrom(v)}
                className="px-3 py-1.5 rounded-lg border border-border bg-card text-foreground text-sm" />
              <span className="text-muted-foreground">〜</span>
              <DateInput allowEmpty value={dateTo}
                onChange={(v) => setDateTo(v)}
                className="px-3 py-1.5 rounded-lg border border-border bg-card text-foreground text-sm" />
              <div className="flex items-center gap-1 ml-4">
                {presets.map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => {
                      setDateFrom(preset.from);
                      setDateTo(preset.to);
                    }}
                    className={cn(
                      "px-2 py-1 rounded text-xs font-bold transition-colors cursor-pointer",
                      dateFrom === preset.from && dateTo === preset.to
                        ? "bg-primary text-cream"
                        : "text-muted-foreground hover:bg-muted/30"
                    )}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {/* タブコンテンツ読み込み中スピナー */}
      {tabLoading && (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card p-12 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          <span className="text-sm">読み込み中...</span>
        </div>
      )}

      {!tabLoading && activeTab === "journal" && (
        <>
          {selectedJournalIds.size > 0 && (
            <div className="mb-3 flex items-center gap-3 p-2.5 rounded-lg bg-destructive/5 border border-destructive/20">
              <span className="text-sm text-foreground font-medium">{selectedJournalIds.size}件選択中</span>
              <Button
                size="sm"
                variant="outline"
                onClick={handleBulkDeleteJournals}
                disabled={deletingJournal}
                className="text-destructive border-destructive/30 hover:bg-destructive/10"
              >
                {deletingJournal ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                まとめて削除
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setSelectedJournalIds(new Set())}
                className="text-primary border-primary/30 hover:bg-primary/10"
              >
                選択解除
              </Button>
            </div>
          )}
          <JournalLedgerTable
            data={filteredJournalData}
            onRowClick={handleRowClick}
            onReceiptClick={handleReceiptPreview}
            onDelete={handleDeleteJournal}
            selectedIds={selectedJournalIds}
            onToggleSelect={handleToggleSelect}
            onToggleSelectAll={handleToggleSelectAll}
          />
        </>
      )}

      {!tabLoading && activeTab === "general" && (
        <GeneralLedgerTable
          account={glAccount}
          onAccountChange={setGlAccount}
          accounts={accountList}
          accountOptions={accountOptions}
          data={filteredGlData}
        />
      )}

      {!tabLoading && activeTab === "cash" && (
        <CashBookLedger
          data={filteredCashData}
          inLabel="入金"
          outLabel="出金"
        />
      )}

      {!tabLoading && activeTab === "deposit" && (
        <CashBookLedger
          data={filteredCashData}
          inLabel="入金"
          outLabel="出金"
        />
      )}

      {!tabLoading && activeTab === "receivable" && (
        <>
          {/* 得意先別売掛残高 */}
          {partnerReceivables.length > 0 && (
            <Card className="mb-6 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-muted/10">
                <Building2 className="size-4 text-primary" />
                <h3 className="text-sm font-bold text-foreground">得意先別売掛残高</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs [&_th]:!py-1 [&_th]:!px-2 [&_td]:!py-1 [&_td]:!px-2">
                  <thead>
                    <tr className="bg-muted/20 border-b border-border">
                      <th className="text-left px-4 py-2 text-xs font-bold text-muted-foreground">得意先</th>
                      <th className="text-right px-4 py-2 text-xs font-bold text-muted-foreground">売掛残高</th>
                      <th className="text-right px-4 py-2 text-xs font-bold text-muted-foreground">うち期日超過</th>
                      <th className="text-right px-4 py-2 text-xs font-bold text-muted-foreground">最大遅延日数</th>
                      <th className="text-center px-4 py-2 text-xs font-bold text-muted-foreground">ステータス</th>
                    </tr>
                  </thead>
                  <tbody>
                    {partnerReceivables.map((p) => (
                      <tr key={p.partnerId} className="border-b border-border last:border-0 hover:bg-muted/10">
                        <td className="px-4 py-2 font-medium text-foreground">{p.partnerName}</td>
                        <td className="px-4 py-2 text-right font-mono font-bold text-foreground">{formatCurrency(p.remaining)}</td>
                        <td className={cn("px-4 py-2 text-right font-mono", p.overdueAmount > 0 ? "text-destructive font-bold" : "text-muted-foreground")}>
                          {p.overdueAmount > 0 ? formatCurrency(p.overdueAmount) : "-"}
                        </td>
                        <td className={cn("px-4 py-2 text-right", p.maxDaysOverdue > 0 ? "text-destructive font-bold" : "text-muted-foreground")}>
                          {p.maxDaysOverdue > 0 ? `${p.maxDaysOverdue}日` : "-"}
                        </td>
                        <td className="px-4 py-2 text-center">
                          {p.overdueAmount > 0
                            ? <Badge variant="destructive">期日超過</Badge>
                            : <Badge variant="success">正常</Badge>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* エージングレポート（年齢表） */}
          {agingReport.length > 0 && (
            <Card className="mb-6 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-muted/10">
                <Calendar className="size-4 text-primary" />
                <h3 className="text-sm font-bold text-foreground">エージングレポート（年齢表）</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs [&_th]:!py-1 [&_th]:!px-2 [&_td]:!py-1 [&_td]:!px-2">
                  <thead>
                    <tr className="bg-muted/20 border-b border-border">
                      <th className="text-left px-3 py-2 text-xs font-bold text-muted-foreground">得意先</th>
                      <th className="text-right px-3 py-2 text-xs font-bold text-muted-foreground">未到来</th>
                      <th className="text-right px-3 py-2 text-xs font-bold text-warning">0〜30日</th>
                      <th className="text-right px-3 py-2 text-xs font-bold text-warning">31〜60日</th>
                      <th className="text-right px-3 py-2 text-xs font-bold text-destructive">61〜90日</th>
                      <th className="text-right px-3 py-2 text-xs font-bold text-destructive">90日超</th>
                      <th className="text-right px-3 py-2 text-xs font-bold text-muted-foreground">合計</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agingReport.map((row) => (
                      <tr key={row.partnerId} className="border-b border-border last:border-0 hover:bg-muted/10">
                        <td className="px-3 py-2 font-medium text-foreground">{row.partnerName}</td>
                        <td className="px-3 py-2 text-right font-mono text-muted-foreground">{row.buckets.current > 0 ? formatCurrency(row.buckets.current) : "-"}</td>
                        <td className={cn("px-3 py-2 text-right font-mono", row.buckets.d0_30 > 0 ? "text-warning" : "text-muted-foreground")}>{row.buckets.d0_30 > 0 ? formatCurrency(row.buckets.d0_30) : "-"}</td>
                        <td className={cn("px-3 py-2 text-right font-mono", row.buckets.d31_60 > 0 ? "text-warning" : "text-muted-foreground")}>{row.buckets.d31_60 > 0 ? formatCurrency(row.buckets.d31_60) : "-"}</td>
                        <td className={cn("px-3 py-2 text-right font-mono", row.buckets.d61_90 > 0 ? "text-destructive" : "text-muted-foreground")}>{row.buckets.d61_90 > 0 ? formatCurrency(row.buckets.d61_90) : "-"}</td>
                        <td className={cn("px-3 py-2 text-right font-mono font-bold", row.buckets.over90 > 0 ? "text-destructive" : "text-muted-foreground")}>{row.buckets.over90 > 0 ? formatCurrency(row.buckets.over90) : "-"}</td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-foreground">{formatCurrency(row.total)}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-border bg-muted/20 font-bold">
                      <td className="px-3 py-2 text-foreground text-xs">合計</td>
                      {(["current", "d0_30", "d31_60", "d61_90", "over90"] as (keyof AgingBuckets)[]).map((k) => {
                        const total = agingReport.reduce((s, r) => s + r.buckets[k], 0);
                        return <td key={k} className="px-3 py-2 text-right font-mono text-xs">{total > 0 ? formatCurrency(total) : "-"}</td>;
                      })}
                      <td className="px-3 py-2 text-right font-mono text-xs">{formatCurrency(agingReport.reduce((s, r) => s + r.total, 0))}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* 売掛帳（総勘定元帳） */}
          <CashBookLedger
            data={toCashBookRows(subLedgerData, true)}
            inLabel="発生"
            outLabel="回収"
          />
        </>
      )}

      {!tabLoading && activeTab === "payable" && (
        <CashBookLedger
          data={toCashBookRows(subLedgerData, false)}
          inLabel="発生"
          outLabel="支払"
        />
      )}

      {!tabLoading && activeTab === "assets" && (
        <FixedAssetLedgerTable assets={assetsData} />
      )}

      {/* Footer info */}
      {activeTab !== "assets" && (
        <div className="mt-4 text-xs text-muted-foreground">
          期間: {dateFrom} 〜 {dateTo}
        </div>
      )}

      {/* Journal Entry Detail Panel (slide-over) */}
      {selectedRow && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setSelectedRow(null)}
          />
          <div className="relative w-full max-w-md bg-card border-l border-border shadow-xl overflow-y-auto">
            <div className="sticky top-0 bg-card border-b border-border px-6 py-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-foreground">仕訳詳細</h3>
              <div className="flex items-center gap-3">
                {!editing && (
                  <button
                    onClick={handleStartEdit}
                    className="text-xs font-bold text-primary inline-flex items-center gap-1 hover:underline"
                  >
                    <Pen className="size-3.5" />
                    編集
                  </button>
                )}
                <button
                  onClick={() => setSelectedRow(null)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="size-5" />
                </button>
              </div>
            </div>

            <div className="px-6 py-6 space-y-6">
              {/* Source badge */}
              <div className="flex items-center gap-2">
                <Badge variant={selectedRow.source === "raqto" ? "accent" : "muted"}>
                  {selectedRow.source === "raqto" ? "Raqto受発注" : selectedRow.source === "bank" ? "銀行" : selectedRow.source === "ai" ? "AI" : "手動"}
                </Badge>
              </div>

              {editing ? (
                <div className="space-y-4">
                  <div>
                    <label className="text-xs text-muted-foreground font-bold">日付</label>
                    <DateInput allowEmpty value={editDate}
                      onChange={(v) => setEditDate(v)}
                      className="w-full mt-1 px-2 py-1.5 rounded-lg border border-border bg-card text-foreground text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground font-bold">摘要</label>
                    <input
                      type="text"
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                      className="w-full mt-1 px-2 py-1.5 rounded-lg border border-border bg-card text-foreground text-sm"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-muted-foreground font-bold">仕訳明細</label>
                      <button
                        onClick={addEditLine}
                        className="text-xs text-primary inline-flex items-center gap-1 hover:underline"
                      >
                        <Plus className="size-3" />
                        行追加
                      </button>
                    </div>
                    {editLines.map((l, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <div className="flex-1 space-y-1">
                          <AccountLookup
                            accounts={accountOptions}
                            value={l.account_id}
                            onChange={(v) => updateEditLine(i, "account_id", v)}
                          />
                          <div className="grid grid-cols-2 gap-1">
                            <AmountInput
                              placeholder="借方"
                              value={l.debit}
                              onChange={(v) => updateEditLine(i, "debit", v)}
                              className="px-2 py-1 rounded border border-border bg-card text-foreground text-xs text-right font-mono"
                            />
                            <AmountInput
                              placeholder="貸方"
                              value={l.credit}
                              onChange={(v) => updateEditLine(i, "credit", v)}
                              className="px-2 py-1 rounded border border-border bg-card text-foreground text-xs text-right font-mono"
                            />
                          </div>
                        </div>
                        {editLines.length > 1 && (
                          <button
                            onClick={() => removeEditLine(i)}
                            className="text-destructive hover:text-destructive/80 mt-2 shrink-0"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <div
                    className={cn(
                      "text-xs font-mono flex justify-between px-1",
                      editBalanced ? "text-success" : "text-destructive"
                    )}
                  >
                    <span>借方 {formatCurrency(editTotalD)}</span>
                    <span>貸方 {formatCurrency(editTotalC)}</span>
                  </div>
                  {!editBalanced && (
                    <p className="text-[11px] text-destructive">
                      貸借が一致していません。借方と貸方の合計を一致させてください。
                    </p>
                  )}
                  <div className="flex gap-2 justify-end pt-1">
                    <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                      キャンセル
                    </Button>
                    <Button size="sm" onClick={handleSaveEdit} disabled={savingEdit || !editBalanced}>
                      {savingEdit ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                      保存
                    </Button>
                  </div>
                </div>
              ) : (
              <>
              {/* Basic info */}
              <div className="space-y-3">
                <div>
                  <span className="text-xs text-muted-foreground">伝票番号</span>
                  <p className="font-mono text-sm text-foreground">{selectedRow.id}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">日付</span>
                  <p className="text-sm text-foreground">{formatDate(selectedRow.date)}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">摘要</span>
                  <p className="text-sm font-medium text-foreground">{selectedRow.description}</p>
                </div>
                {detailData?.partnerName && (
                  <div>
                    <span className="text-xs text-muted-foreground">取引先</span>
                    <p className="text-sm text-foreground">{detailData.partnerName}</p>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-xs text-muted-foreground">借方科目</span>
                    <p className="text-sm text-foreground">{selectedRow.debitAccount}</p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">貸方科目</span>
                    <p className="text-sm text-foreground">{selectedRow.creditAccount}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-xs text-muted-foreground">借方金額</span>
                    <p className="text-lg font-bold font-mono text-foreground">{formatCurrency(selectedRow.debitAmount)}</p>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">貸方金額</span>
                    <p className="text-lg font-bold font-mono text-foreground">{formatCurrency(selectedRow.creditAmount)}</p>
                  </div>
                </div>
              </div>

              {/* Line items */}
              <div className="border-t border-border pt-4">
                <h4 className="text-sm font-bold text-foreground mb-3">品目明細</h4>
                {detailLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="size-5 animate-spin text-muted-foreground" />
                  </div>
                ) : detailData && detailData.items.length > 0 ? (
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-xs [&_th]:!py-1 [&_th]:!px-2 [&_td]:!py-1 [&_td]:!px-2">
                      <thead>
                        <tr className="bg-muted/20 border-b border-border">
                          <th className="text-left px-3 py-2 font-bold text-muted-foreground">品名</th>
                          <th className="text-right px-3 py-2 font-bold text-muted-foreground">数量</th>
                          <th className="text-right px-3 py-2 font-bold text-muted-foreground">単価</th>
                          <th className="text-right px-3 py-2 font-bold text-muted-foreground">税率</th>
                          <th className="text-right px-3 py-2 font-bold text-muted-foreground">小計</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailData.items.map((item, idx) => (
                          <tr key={idx} className="border-b border-border last:border-0">
                            <td className="px-3 py-2 text-foreground">{item.item_name}</td>
                            <td className="px-3 py-2 text-right font-mono text-muted-foreground">{item.quantity}</td>
                            <td className="px-3 py-2 text-right font-mono text-muted-foreground">{formatCurrency(item.unit_price)}</td>
                            <td className="px-3 py-2 text-right font-mono text-muted-foreground">{item.tax_rate != null ? `${item.tax_rate}%` : "-"}</td>
                            <td className="px-3 py-2 text-right font-mono font-bold">{formatCurrency(item.subtotal)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground py-2">
                    品目明細はありません
                  </p>
                )}
              </div>
              </>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Receipt Preview Modal */}
      {(receiptPreviewLoading || receiptPreviewUrl) && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={closeReceiptPreview}
          />
          <div className="relative bg-card rounded-xl shadow-2xl border border-border max-w-2xl w-full mx-4 max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
              <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                <ImageIcon className="size-4 text-primary" />
                領収書プレビュー
              </h3>
              <button
                onClick={closeReceiptPreview}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-5" />
              </button>
            </div>
            {/* Body */}
            <div className="flex-1 overflow-auto p-4 flex items-center justify-center min-h-[300px]">
              {receiptPreviewLoading ? (
                <div className="flex flex-col items-center gap-2 text-muted-foreground">
                  <Loader2 className="size-8 animate-spin" />
                  <p className="text-sm">読み込み中...</p>
                </div>
              ) : receiptPreviewUrl ? (
                receiptPreviewMime === "application/pdf" ? (
                  <iframe
                    src={receiptPreviewUrl}
                    className="w-full h-[75vh] rounded border border-border"
                    title="領収書PDF"
                  />
                ) : (
                  <img
                    src={receiptPreviewUrl}
                    alt="領収書"
                    className="max-h-[75vh] max-w-full object-contain rounded"
                  />
                )
              ) : (
                <p className="text-sm text-muted-foreground">画像を取得できませんでした</p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
