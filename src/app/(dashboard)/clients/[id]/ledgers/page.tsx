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
  Landmark,
  Building2,
  Car,
  Monitor,
  Code2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { downloadCSV, printPage } from "@/lib/export";
import { getJournalLedger, type JournalLedgerRow } from "@/actions/ledgers";
import { getSubAccounts, type SubAccount } from "@/actions/sub-accounts";
import { JournalEntryPanel } from "@/components/journal/journal-entry-panel";
import { TaxBadge } from "@/components/journal/tax-badge";
import { YearMonthDayInput } from "@/components/ui/year-month-day-input";
import { handleBarKeyNav } from "@/lib/key-nav";
import { GeneralLedgerView, type CsvSpec } from "@/components/ledgers/general-ledger-view";
import { SubLedgerView } from "@/components/ledgers/sub-ledger-view";
import { UnassignedPartnerLinesCard } from "@/components/ledgers/unassigned-partner-lines";
import { TaxCategoryView } from "@/components/ledgers/tax-category-view";
import { Badge } from "@/components/ui/badge";
import { AccountLookup } from "@/components/ui/account-lookup";
import { getAccounts } from "@/actions/accounts";
import { getClient } from "@/actions/clients";
import { fiscalPeriodOptions, toJstDate, type FiscalPeriodRow } from "@/lib/fiscal";
import { getFiscalPeriodRows } from "@/actions/fiscal-month";
import { beginLoad, endLoad } from "@/lib/loading-bus";
import { getReceiptImageUrl } from "@/actions/receipt-storage";
import { deleteJournalEntries, getDescriptionSuggestions } from "@/actions/journals";
import { getReceipt } from "@/actions/receipts";
import { getDepreciationBook, type DepreciationAsset } from "@/actions/assets";
import type { Database } from "@/types/database";
import { getAgingReport, type AgingReportRow, type AgingBuckets } from "@/actions/invoices";
import { MonthInput } from "@/components/ui/month-input";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LedgerTab =
  | "journal"
  | "general"
  | "subledger"
  | "receivable"
  | "payable"
  | "tax"
  | "assets";

// ---------------------------------------------------------------------------
// Tab config
// ---------------------------------------------------------------------------

// 現金出納帳・預金出納帳は総勘定元帳（現金・預金の科目）で見られるため置いていない
const tabs: { key: LedgerTab; label: string }[] = [
  { key: "journal", label: "仕訳帳" },
  { key: "general", label: "総勘定元帳" },
  { key: "subledger", label: "補助元帳" },
  { key: "receivable", label: "売掛帳（相手先別）" },
  { key: "payable", label: "買掛帳（相手先別）" },
  { key: "tax", label: "税区分別" },
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
                          {line.debitIsPl && <TaxBadge code={line.debitTax} missing className="ml-1.5" />}
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
                          {line.creditIsPl && <TaxBadge code={line.creditTax} missing className="ml-1.5" />}
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

// ---------------------------------------------------------------------------

type AssetCategory = "all" | "building" | "vehicle" | "equipment" | "software";

const assetCategoryOptions: { key: AssetCategory; label: string; icon: typeof Building2 }[] = [
  { key: "all", label: "すべて", icon: Landmark },
  { key: "building", label: "建物", icon: Building2 },
  { key: "vehicle", label: "車両", icon: Car },
  { key: "equipment", label: "器具備品", icon: Monitor },
  { key: "software", label: "ソフトウェア", icon: Code2 },
];

const assetCategoryLabelMap: Record<AssetCategory, string> = {
  all: "すべて",
  building: "建物",
  vehicle: "車両",
  equipment: "器具備品",
  software: "ソフトウェア",
};

/** 科目名から絞り込みの分類を決める */
function assetCategoryOf(accountName: string): AssetCategory {
  if (/建物|構築物/.test(accountName)) return "building";
  if (/車両|運搬具/.test(accountName)) return "vehicle";
  if (/ソフトウェア/.test(accountName)) return "software";
  return "equipment";
}

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

/** 固定資産台帳の計算（当期末の帳簿価額）を表示用にする */
function mapAssetRows(assets: DepreciationAsset[]): AssetDisplay[] {
  return assets
    .filter((a) => !a.disposedAt)
    .map((a) => ({
      id: a.id,
      name: a.name,
      category: assetCategoryOf(a.accountName),
      categoryLabel: a.accountName || "その他",
      acquisitionDate: a.acquisitionDate.replace(/-/g, "/"),
      acquisitionCost: a.acquisitionCost,
      usefulLife: a.usefulLife,
      depreciationMethod: a.kindLabel,
      bookValue: a.closingBook,
    }));
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
  // 記録された事業年度（決算月を変えた年の変則期間）
  const [fiscalRows, setFiscalRows] = useState<FiscalPeriodRow[]>([]);

  // URLクエリパラメータ（B/S等からの遷移用）
  const validTabs: LedgerTab[] = ["journal", "general", "subledger", "receivable", "payable", "tax", "assets"];
  const paramTab = searchParams.get("tab");
  const paramAccount = searchParams.get("account");
  // 以前の現金出納帳・預金出納帳へのリンクは、総勘定元帳の現金・普通預金で開く
  const legacyAccount = paramTab === "cash" ? "現金" : paramTab === "deposit" ? "普通預金" : null;
  const initialTab: LedgerTab = legacyAccount
    ? "general"
    : paramTab && validTabs.includes(paramTab as LedgerTab)
      ? (paramTab as LedgerTab)
      : "journal";
  const initialAccount = paramAccount ? decodeURIComponent(paramAccount) : legacyAccount ?? "現金";

  const [activeTab, setActiveTab] = useState<LedgerTab>(initialTab);
  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo, setDateTo] = useState(defaultTo);

  // クライアントの決算月を取得（年度セレクタの表示・範囲計算に使用）
  useEffect(() => {
    getClient(id)
      .then((c) => setFiscalStartMonth((c as { fiscal_year_start_month?: number }).fiscal_year_start_month ?? 4))
      .catch(() => {});
    getFiscalPeriodRows(id).then(setFiscalRows).catch(() => {});
  }, [id]);
  // 年度の選択肢: 今日を含む期から5期さかのぼる（変則期間は記録どおり）
  const fiscalPeriodOptionList = useMemo(
    () => fiscalPeriodOptions(fiscalRows, fiscalStartMonth, toJstDate(new Date().toISOString()), { past: 4 }),
    [fiscalRows, fiscalStartMonth]
  );
  // 総勘定元帳と補助元帳で表示する科目（名前で持ち、科目一覧からIDを引く）
  const [glAccount, setGlAccount] = useState(initialAccount);
  const [subLedgerAccount, setSubLedgerAccount] = useState("売掛金");

  // 仕訳帳・総勘定元帳共通の拡張フィルター
  // 期間の選び方: 年度・月・自分で指定（開始日〜終了日）
  const [periodMode, setPeriodMode] = useState<"none" | "year" | "month" | "custom">("none");
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
  const [agingReport, setAgingReport] = useState<AgingReportRow[]>([]);

  // 補助科目（仕訳の修正で候補に出す）
  const [subAccounts, setSubAccounts] = useState<SubAccount[]>([]);
  const loadSubAccounts = useCallback(() => {
    getSubAccounts(id).then(setSubAccounts).catch(() => setSubAccounts([]));
  }, [id]);
  useEffect(loadSubAccounts, [loadSubAccounts]);

  // 開いている仕訳（詳細・修正パネル）と、修正後に元帳を読み直すための番号
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // 元帳・補助元帳・税区分別のCSV出力の中身（各表示が作って渡す）
  const [csvSpec, setCsvSpec] = useState<CsvSpec | null>(null);
  // 期間指定で選べる年（来年から7年前まで）
  const periodYears = Array.from({ length: 8 }, (_, i) => year + 1 - i);
  const accountIdByName = (name: string) => accountOptions.find((a) => a.name === name)?.id ?? "";

  // 指定した日付の月を表示期間にする（証憑や仕訳の詳細から移ってきたとき）
  const showMonthOf = (date: string) => {
    const [y, m] = date.split("-").map(Number);
    if (!y || !m) return;
    const last = new Date(y, m, 0).getDate();
    setDateFrom(`${y}-${String(m).padStart(2, "0")}-01`);
    setDateTo(`${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`);
    setPeriodMode("month");
  };

  // 証憑の画面から ?entry=仕訳ID&date=日付 で来たら、その月を表示して仕訳を開く
  useEffect(() => {
    const entry = searchParams.get("entry");
    const date = searchParams.get("date");
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) showMonthOf(date);
    if (entry) setOpenEntryId(entry);
    // 最初に開いたときだけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // タブコンテンツ読み込み状態（テーブルエリアのスピナー用）
  const [tabLoading, setTabLoading] = useState(false);

  // Fixed assets data
  const [assetsData, setAssetsData] = useState<AssetDisplay[]>([]);

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

  const handleRowClick = (row: JournalLedgerRow) => setOpenEntryId(row.journalEntryId);

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

  useEffect(() => {
    if (activeTab === "journal") fetchJournal();
  }, [activeTab, fetchJournal]);

  // タブを切り替えたら、前のタブのCSVの中身は使わない
  useEffect(() => setCsvSpec(null), [activeTab]);

  useEffect(() => {
    if (activeTab === "assets") {
      setTabLoading(true);
      beginLoad();
      getDepreciationBook(id)
        .then((b) => mapAssetRows(b.assets))
        .then(setAssetsData)
        .catch(console.error)
        .finally(() => { setTabLoading(false); endLoad(); });
    }
  }, [activeTab, id]);

  useEffect(() => {
    if (activeTab === "receivable") {
      getAgingReport(id)
        .catch(() => [] as AgingReportRow[])
        .then(setAgingReport);
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

  function handleCSVExport() {
    if (activeTab === "journal") {
      downloadCSV(
        `仕訳帳_${dateFrom}_${dateTo}.csv`,
        ["日付", "伝票番号", "摘要", "借方科目", "貸方科目", "借方金額", "貸方金額"],
        filteredJournalData.map((r) => [r.date, r.id, r.description, r.debitAccount, r.creditAccount, r.debitAmount, r.creditAmount])
      );
    } else if (activeTab === "assets") {
      downloadCSV(
        `固定資産台帳.csv`,
        ["資産名", "分類", "取得日", "取得価額", "耐用年数", "償却方法", "帳簿価額"],
        assetsData.map((a) => [a.name, a.categoryLabel, a.acquisitionDate, a.acquisitionCost, `${a.usefulLife}年`, a.depreciationMethod, a.bookValue])
      );
    } else if (csvSpec) {
      downloadCSV(csvSpec.filename, csvSpec.headers, csvSpec.rows);
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
          {(
            /* 期間（年度・月・期間指定）・科目・並べ替え。Enter／←→ で隣の欄へ移れる */
            <div className="flex flex-wrap items-end gap-4" onKeyDown={handleBarKeyNav}>
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
                    // 値は期の開始日
                    const p = fiscalPeriodOptionList.find((o) => o.key === v);
                    if (!p) return;
                    setDateFrom(p.startDate);
                    setDateTo(p.endDate);
                    setPeriodMode("year");
                  }}
                  className="px-3 py-1.5 rounded-lg border border-border bg-card text-foreground text-sm"
                >
                  <option value="">選択なし</option>
                  {fiscalPeriodOptionList.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground font-bold">月別</label>
                <MonthInput
                  allowEmpty wheelFromEmpty wrapperClassName="w-36"
                  value={periodMode === "month" || periodMode === "none" ? dateFrom.slice(0, 7) : ""}
                  onChange={(v) => {
                    if (!v) {
                      setPeriodMode("none");
                      fiscalYearRef.current?.focus();
                      return;
                    }
                    const [y, m] = v.split("-").map(Number);
                    const ld = new Date(y, m, 0).getDate();
                    setDateFrom(`${y}-${String(m).padStart(2, "0")}-01`);
                    setDateTo(`${y}-${String(m).padStart(2, "0")}-${String(ld).padStart(2, "0")}`);
                    setPeriodMode("month");
                  }}
                  className="px-3 py-1.5 rounded-lg border border-border bg-card text-foreground text-sm w-full pr-7"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-muted-foreground font-bold">
                  期間指定 <span className="font-normal">（年は選択・月日は入力 例: 4/1）</span>
                </label>
                <div className="flex items-center gap-1.5">
                  <YearMonthDayInput
                    label="開始日"
                    value={dateFrom}
                    years={periodYears}
                    onChange={(v) => {
                      setDateFrom(v);
                      if (v > dateTo) setDateTo(v);
                      setPeriodMode("custom");
                    }}
                  />
                  <span className="text-muted-foreground">〜</span>
                  <YearMonthDayInput
                    label="終了日"
                    value={dateTo}
                    years={periodYears}
                    onChange={(v) => {
                      setDateTo(v);
                      if (v < dateFrom) setDateFrom(v);
                      setPeriodMode("custom");
                    }}
                  />
                </div>
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
              {activeTab === "subledger" && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground font-bold">勘定科目（補助科目で分けて見る）</label>
                  <div className="w-[250px]">
                    <AccountLookup
                      accounts={accountOptions}
                      value={accountIdByName(subLedgerAccount)}
                      onChange={(id) => {
                        const acc = accountOptions.find((a) => a.id === id);
                        if (acc) setSubLedgerAccount(acc.name);
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

      {activeTab === "general" && (
        <GeneralLedgerView
          clientId={id}
          accountId={accountIdByName(glAccount)}
          dateFrom={dateFrom}
          dateTo={dateTo}
          descending={sortOrder === "date_desc"}
          reloadKey={reloadKey}
          onOpenEntry={setOpenEntryId}
          onCsv={setCsvSpec}
        />
      )}

      {activeTab === "subledger" && (
        <SubLedgerView
          clientId={id}
          accountId={accountIdByName(subLedgerAccount)}
          dateFrom={dateFrom}
          dateTo={dateTo}
          descending={sortOrder === "date_desc"}
          reloadKey={reloadKey}
          onOpenEntry={setOpenEntryId}
          onCsv={setCsvSpec}
        />
      )}

      {(activeTab === "receivable" || activeTab === "payable") && (
        <UnassignedPartnerLinesCard
          key={`unassigned-${activeTab}`}
          clientId={id}
          accountName={activeTab === "receivable" ? "売掛金" : "買掛金"}
          reloadKey={reloadKey}
          onAssigned={() => {
            setReloadKey((k) => k + 1);
            loadSubAccounts();
          }}
          onOpenEntry={setOpenEntryId}
        />
      )}

      {(activeTab === "receivable" || activeTab === "payable") && (
        <SubLedgerView
          key={activeTab}
          clientId={id}
          accountId={accountIdByName(activeTab === "receivable" ? "売掛金" : "買掛金")}
          dateFrom={dateFrom}
          dateTo={dateTo}
          descending={sortOrder === "date_desc"}
          reloadKey={reloadKey}
          onOpenEntry={setOpenEntryId}
          onCsv={setCsvSpec}
        />
      )}

      {activeTab === "receivable" && agingReport.length > 0 && (
        /* エージングレポート（年齢表）は請求書の入金期日から作る */
        <Card className="mt-6 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-muted/10">
            <Calendar className="size-4 text-primary" />
            <h3 className="text-sm font-bold text-foreground">エージングレポート（請求書の入金期日からの経過）</h3>
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

      {activeTab === "tax" && (
        <TaxCategoryView
          clientId={id}
          dateFrom={dateFrom}
          dateTo={dateTo}
          descending={sortOrder === "date_desc"}
          reloadKey={reloadKey}
          onOpenEntry={setOpenEntryId}
          onCsv={setCsvSpec}
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

      {/* 仕訳の詳細・修正（どのタブから開いても同じパネル） */}
      {openEntryId && (
        <JournalEntryPanel
          clientId={id}
          entryId={openEntryId}
          accounts={accountOptions}
          subAccounts={subAccounts}
          onClose={() => setOpenEntryId(null)}
          onSaved={() => {
            setReloadKey((k) => k + 1);
            loadSubAccounts();
            if (activeTab === "journal") fetchJournal();
          }}
          onReceiptClick={handleReceiptPreview}
          onOpenAccount={(accountId, entryDate) => {
            const acc = accountOptions.find((a) => a.id === accountId);
            if (!acc) return;
            setGlAccount(acc.name);
            showMonthOf(entryDate);
            setActiveTab("general");
            setOpenEntryId(null);
          }}
        />
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
