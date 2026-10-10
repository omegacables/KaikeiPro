"use client";

import { useState, useEffect, useCallback, useMemo, Fragment, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import type { PlClassification } from "@/types/database";
import {
  BarChart3,
  FileText,
  Calendar,
  Building2,
  TrendingUp,
  TrendingDown,
  Minus,
  Plus,
  Trash2,
  Loader2,
  FileSpreadsheet,
  AlertTriangle,
} from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AmountInput } from "@/components/ui/amount-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency } from "@/lib/utils";
import { printPage, downloadCSV } from "@/lib/export";
import {
  getTrialBalance,
  getNeedsReviewSummary,
  getMonthlyTrend,
  getInventorySchedule,
  type TrialBalanceRow,
  type MonthlyTrendRow,
  type MonthlyTrendMode,
  type InventoryScheduleRow,
} from "@/actions/statements";
import {
  getInventoryCounts,
  createInventoryCount,
  updateInventoryCount,
  deleteInventoryCount,
} from "@/actions/inventory";
import { getClient } from "@/actions/clients";
import { fiscalPeriodContaining, type FiscalPeriodRow } from "@/lib/fiscal";
import { getFiscalPeriodRows } from "@/actions/fiscal-month";
import { beginLoad, endLoad } from "@/lib/loading-bus";
import { DateInput } from "@/components/ui/date-input";
import { formatYen } from "@/lib/wareki";
import { YearMonthDayInput } from "@/components/ui/year-month-day-input";
import { handleBarKeyNav } from "@/lib/key-nav";
import {
  MONTH_METRICS,
  isRatioMetric,
  monthValue,
  summaryColumns,
  sumSeries,
  subtractSeries,
  isEmptySeries,
  type MonthMetric,
  type TrendSeries,
} from "@/lib/monthly-trend";


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StatementTab = "trial_balance" | "bs" | "pl" | "settlement" | "monthly_trend" | "inventory";

interface BSItem {
  name: string;
  amount: number;
}

interface PLItem {
  name: string;
  amount: number;
  prevAmount?: number;
  children?: PLItem[];
}

// ---------------------------------------------------------------------------
// Tab config
// ---------------------------------------------------------------------------

const tabConfig: { key: StatementTab; label: string }[] = [
  { key: "trial_balance", label: "合計残高試算表" },
  { key: "bs", label: "貸借対照表（B/S）" },
  { key: "pl", label: "損益計算書（P/L）" },
  { key: "settlement", label: "決算書" },
  { key: "monthly_trend", label: "月次推移表" },
  { key: "inventory", label: "棚卸表" },
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

// 合計残高試算表（教科書レイアウト: 借方残高｜借方合計｜勘定科目｜貸方合計｜貸方残高）。
// 前期繰越は開始残高として借方/貸方の合計に畳み込み、残高はマイナスを使わず借方/貸方に振り分ける。
function trialBalanceColumns(row: TrialBalanceRow) {
  const openingDebit = row.prevBalance > 0 ? row.prevBalance : 0;
  const openingCredit = row.prevBalance < 0 ? -row.prevBalance : 0;
  return {
    debitBalance: row.debitBalance,
    debitTotal: row.debitTotal + openingDebit,
    creditTotal: row.creditTotal + openingCredit,
    creditBalance: row.creditBalance,
  };
}

function TrialBalance({ data }: { data: TrialBalanceRow[] }) {
  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-border p-12 text-center text-muted-foreground">
        データがありません
      </div>
    );
  }
  let debitBalanceAll = 0;
  let debitTotalAll = 0;
  let creditTotalAll = 0;
  let creditBalanceAll = 0;
  for (const r of data) {
    const c = trialBalanceColumns(r);
    debitBalanceAll += c.debitBalance;
    debitTotalAll += c.debitTotal;
    creditTotalAll += c.creditTotal;
    creditBalanceAll += c.creditBalance;
  }
  const balanced = debitTotalAll === creditTotalAll && debitBalanceAll === creditBalanceAll;

  return (
    <div className="paper w-fit max-w-full overflow-x-auto rounded-lg border border-neutral-300 bg-white">
      <table className="w-auto text-sm tabular-nums bg-white text-foreground [&_th]:border-r [&_th]:border-neutral-200 [&_td]:border-r [&_td]:border-neutral-200 [&_th:last-child]:border-r-0 [&_td:last-child]:border-r-0">
        <thead>
          <tr className="border-b-2 border-neutral-400">
            <th className="text-right px-3 py-1.5 text-xs font-bold">借方残高</th>
            <th className="text-right px-3 py-1.5 text-xs font-bold">借方合計</th>
            <th className="text-center px-3 py-1.5 text-xs font-bold">勘定科目</th>
            <th className="text-right px-3 py-1.5 text-xs font-bold">貸方合計</th>
            <th className="text-right px-3 py-1.5 text-xs font-bold">貸方残高</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => {
            const c = trialBalanceColumns(row);
            return (
              <tr key={row.code} className="border-b border-neutral-200">
                <td className="px-3 py-1.5 text-right font-mono">{c.debitBalance > 0 ? formatCurrency(c.debitBalance) : ""}</td>
                <td className="px-3 py-1.5 text-right font-mono">{c.debitTotal > 0 ? formatCurrency(c.debitTotal) : ""}</td>
                <td className="px-3 py-1.5 whitespace-nowrap">
                  {row.name}<span className="font-mono text-xs text-muted-foreground">（{row.code}）</span>
                </td>
                <td className="px-3 py-1.5 text-right font-mono">{c.creditTotal > 0 ? formatCurrency(c.creditTotal) : ""}</td>
                <td className="px-3 py-1.5 text-right font-mono">{c.creditBalance > 0 ? formatCurrency(c.creditBalance) : ""}</td>
              </tr>
            );
          })}
          <tr className="font-bold border-t-2 border-neutral-400">
            <td className="px-3 py-2 text-right font-mono">{formatCurrency(debitBalanceAll)}</td>
            <td className="px-3 py-2 text-right font-mono">{formatCurrency(debitTotalAll)}</td>
            <td className="px-3 py-2 text-center">
              合計
            </td>
            <td className="px-3 py-2 text-right font-mono">{formatCurrency(creditTotalAll)}</td>
            <td className="px-3 py-2 text-right font-mono">{formatCurrency(creditBalanceAll)}</td>
          </tr>
          <tr>
            <td colSpan={5} className="px-3 py-1.5 text-center">
              <Badge variant={balanced ? "success" : "destructive"}>
                {balanced ? "貸借一致" : "貸借不一致"}
              </Badge>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function BSSection({
  items,
  depth = 0,
  onAccountClick,
}: {
  items: BSItem[];
  depth?: number;
  onAccountClick?: (name: string) => void;
}) {
  return (
    <>
      {items.map((item) => {
        const clickable = !!onAccountClick && item.name !== "当期純利益";
        return (
          <div
            key={item.name}
            className={cn(
              "flex items-center justify-between py-1.5 border-b border-border/30",
              depth === 0 && "font-bold text-foreground",
              depth === 1 && "font-medium text-foreground",
              depth >= 2 && "text-muted-foreground",
              clickable && "cursor-pointer hover:bg-muted/30 rounded transition-colors"
            )}
            style={{ paddingLeft: `${depth * 20 + 16}px`, paddingRight: "16px" }}
            onClick={() => clickable && onAccountClick!(item.name)}
            title={clickable ? `${item.name} の元帳を表示` : undefined}
          >
            <span className="text-sm">{item.name}</span>
            <span className="font-mono text-sm">{formatCurrency(item.amount)}</span>
          </div>
        );
      })}
    </>
  );
}

function BalanceSheet({ trialData, clientId }: { trialData: TrialBalanceRow[]; clientId?: string }) {
  const router = useRouter();

  const handleAccountClick = clientId
    ? (name: string) => {
        router.push(`/clients/${clientId}/ledgers?tab=general&account=${encodeURIComponent(name)}`);
      }
    : undefined;

  const bsAssets = trialData
    .filter((r) => r.category === "asset")
    .map((r) => ({ name: r.name, amount: r.debitBalance - r.creditBalance }));

  const bsLiabilities = trialData
    .filter((r) => r.category === "liability")
    .map((r) => ({ name: r.name, amount: r.creditBalance - r.debitBalance }));

  const bsEquity = trialData
    .filter((r) => r.category === "equity")
    .map((r) => ({ name: r.name, amount: r.creditBalance - r.debitBalance }));

  if (bsAssets.length === 0 && bsLiabilities.length === 0 && bsEquity.length === 0) {
    return (
      <div className="rounded-xl border border-border p-12 text-center text-muted-foreground">
        データがありません
      </div>
    );
  }

  const totalAssets = bsAssets.reduce((s, i) => s + i.amount, 0);
  const totalLiabilities = bsLiabilities.reduce((s, i) => s + i.amount, 0);
  const totalEquity = bsEquity.reduce((s, i) => s + i.amount, 0);

  // Add current period profit/loss to equity
  const revenue = trialData.filter((r) => r.category === "revenue").reduce((s, r) => s + (r.creditBalance - r.debitBalance), 0);
  const expenses = trialData.filter((r) => r.category === "expense").reduce((s, r) => s + (r.debitBalance - r.creditBalance), 0);
  const currentProfit = revenue - expenses;
  const equityWithProfit = [...bsEquity, { name: "当期純利益", amount: currentProfit }];
  const totalEquityWithProfit = totalEquity + currentProfit;
  const totalLE = totalLiabilities + totalEquityWithProfit;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span>資産の部</span>
            <span className="font-mono text-primary">{formatCurrency(totalAssets)}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <BSSection items={bsAssets} onAccountClick={handleAccountClick} />
          <div className="flex items-center justify-between pt-3 mt-3 border-t-2 border-border font-bold text-foreground">
            <span>資産合計</span>
            <span className="font-mono text-lg">{formatCurrency(totalAssets)}</span>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <span>負債の部</span>
              <span className="font-mono text-destructive">{formatCurrency(totalLiabilities)}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <BSSection items={bsLiabilities} onAccountClick={handleAccountClick} />
            <div className="flex items-center justify-between pt-3 mt-3 border-t border-border font-bold text-foreground text-sm">
              <span>負債合計</span>
              <span className="font-mono">{formatCurrency(totalLiabilities)}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <span>純資産の部</span>
              <span className="font-mono text-primary">{formatCurrency(totalEquityWithProfit)}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <BSSection items={equityWithProfit} onAccountClick={handleAccountClick} />
            <div className="flex items-center justify-between pt-3 mt-3 border-t border-border font-bold text-foreground text-sm">
              <span>純資産合計</span>
              <span className="font-mono">{formatCurrency(totalEquityWithProfit)}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-muted/10">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between font-bold text-foreground">
              <span>負債及び純資産合計</span>
              <span className="font-mono text-lg">{formatCurrency(totalLE)}</span>
            </div>
            <div className="mt-2 text-center">
              <Badge variant={totalAssets === totalLE ? "success" : "destructive"}>
                {totalAssets === totalLE ? "貸借一致" : "貸借不一致"}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

interface PLItemRow {
  code: string;
  name: string;
  amount: number;
}

// 損益計算書の区分（Ⅰ売上高 など）：見出し＋明細行
function PLSectionRows({
  numeral,
  title,
  items,
  total,
}: {
  numeral: string;
  title: string;
  items: PLItemRow[];
  total: number;
}) {
  return (
    <>
      <div className="flex items-center justify-between gap-8 py-1 px-2 font-bold text-foreground border-b border-border">
        <span>{numeral ? `${numeral} ` : ""}{title}</span>
        <span className="font-mono">{formatCurrency(total)}</span>
      </div>
      {items.map((it) => (
        <div
          key={it.code}
          className="flex items-center justify-between gap-8 py-0.5 border-b border-border/30 text-muted-foreground"
          style={{ paddingLeft: "24px", paddingRight: "8px" }}
        >
          <span>{it.name}</span>
          <span className="font-mono">{formatCurrency(it.amount)}</span>
        </div>
      ))}
    </>
  );
}

// 段階利益の行（売上総利益・営業利益・経常利益・税引前当期純利益・当期純利益）
function PLProfitRow({
  label,
  amount,
  emphasize = false,
}: {
  label: string;
  amount: number;
  emphasize?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-8 px-2 font-bold text-foreground",
        emphasize
          ? "py-1.5 my-1 bg-primary/10 border-y-2 border-primary/30 rounded"
          : "py-1 mt-1 border-y border-border bg-muted/30"
      )}
    >
      <span>{label}</span>
      <span className={cn("font-mono", amount >= 0 ? "text-success" : "text-destructive")}>
        {formatCurrency(amount)}
      </span>
    </div>
  );
}

function ProfitAndLoss({ trialData }: { trialData: TrialBalanceRow[] }) {
  const hasData = trialData.some((r) => r.category === "revenue" || r.category === "expense");
  if (!hasData) {
    return (
      <div className="rounded-xl border border-border p-12 text-center text-muted-foreground">
        データがありません
      </div>
    );
  }

  const amountOf = (r: TrialBalanceRow) =>
    r.category === "revenue"
      ? r.creditBalance - r.debitBalance
      : r.debitBalance - r.creditBalance;
  const itemsOf = (cls: PlClassification): PLItemRow[] =>
    trialData
      .filter((r) => r.plClassification === cls)
      .map((r) => ({ code: r.code, name: r.name, amount: amountOf(r) }));
  const sum = (items: PLItemRow[]) => items.reduce((s, i) => s + i.amount, 0);

  const sales = itemsOf("sales");
  const cogs = itemsOf("cogs");
  const sga = itemsOf("sga");
  const nonOpRev = itemsOf("non_op_revenue");
  const nonOpExp = itemsOf("non_op_expense");
  const extraGain = itemsOf("extraordinary_gain");
  const extraLoss = itemsOf("extraordinary_loss");
  const tax = itemsOf("tax");

  const salesT = sum(sales);
  const cogsT = sum(cogs);
  const sgaT = sum(sga);
  const nonOpRevT = sum(nonOpRev);
  const nonOpExpT = sum(nonOpExp);
  const extraGainT = sum(extraGain);
  const extraLossT = sum(extraLoss);
  const taxT = sum(tax);

  const grossProfit = salesT - cogsT;          // 売上総利益
  const operatingProfit = grossProfit - sgaT;  // 営業利益
  const ordinaryProfit = operatingProfit + nonOpRevT - nonOpExpT; // 経常利益
  const pretaxProfit = ordinaryProfit + extraGainT - extraLossT;  // 税引前当期純利益
  const netProfit = pretaxProfit - taxT;       // 当期純利益

  const nums = ["Ⅰ", "Ⅱ", "Ⅲ", "Ⅳ", "Ⅴ", "Ⅵ", "Ⅶ", "Ⅷ"];
  let ni = 0;
  const blocks: ReactNode[] = [];

  blocks.push(<PLSectionRows key="sales" numeral={nums[ni++]} title="売上高" items={sales} total={salesT} />);
  if (cogs.length > 0) {
    blocks.push(<PLSectionRows key="cogs" numeral={nums[ni++]} title="売上原価" items={cogs} total={cogsT} />);
  }
  blocks.push(<PLProfitRow key="gp" label="売上総利益" amount={grossProfit} />);
  if (sga.length > 0) {
    blocks.push(<PLSectionRows key="sga" numeral={nums[ni++]} title="販売費及び一般管理費" items={sga} total={sgaT} />);
  }
  blocks.push(<PLProfitRow key="op" label="営業利益" amount={operatingProfit} />);
  if (nonOpRev.length > 0) {
    blocks.push(<PLSectionRows key="nor" numeral={nums[ni++]} title="営業外収益" items={nonOpRev} total={nonOpRevT} />);
  }
  if (nonOpExp.length > 0) {
    blocks.push(<PLSectionRows key="noe" numeral={nums[ni++]} title="営業外費用" items={nonOpExp} total={nonOpExpT} />);
  }
  blocks.push(<PLProfitRow key="ord" label="経常利益" amount={ordinaryProfit} />);
  if (extraGain.length > 0) {
    blocks.push(<PLSectionRows key="eg" numeral={nums[ni++]} title="特別利益" items={extraGain} total={extraGainT} />);
  }
  if (extraLoss.length > 0) {
    blocks.push(<PLSectionRows key="el" numeral={nums[ni++]} title="特別損失" items={extraLoss} total={extraLossT} />);
  }
  blocks.push(<PLProfitRow key="pre" label="税引前当期純利益" amount={pretaxProfit} />);
  if (tax.length > 0) {
    blocks.push(<PLSectionRows key="tax" numeral={nums[ni++]} title="法人税等" items={tax} total={taxT} />);
  }
  blocks.push(<PLProfitRow key="net" label="当期純利益" amount={netProfit} emphasize />);

  return (
    <Card className="w-fit max-w-full">
      <CardHeader className="px-3 pt-3 pb-2">
        <CardTitle className="text-sm flex items-center gap-2">損益計算書</CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 text-sm">
        {blocks}
        <div className="mt-2 px-2 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground">
          <span>
            営業利益率:{" "}
            <span className={cn("font-bold", operatingProfit >= 0 ? "text-success" : "text-destructive")}>
              {salesT > 0 ? ((operatingProfit / salesT) * 100).toFixed(1) : 0}%
            </span>
          </span>
          <span>
            経常利益率:{" "}
            <span className={cn("font-bold", ordinaryProfit >= 0 ? "text-success" : "text-destructive")}>
              {salesT > 0 ? ((ordinaryProfit / salesT) * 100).toFixed(1) : 0}%
            </span>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

const PL_GROUPS: { key: string; label: string }[] = [
  { key: "revenue", label: "収益" },
  { key: "expense", label: "費用" },
];
const BS_GROUPS: { key: string; label: string }[] = [
  { key: "asset", label: "資産" },
  { key: "liability", label: "負債" },
  { key: "equity", label: "純資産" },
];
/** 月次推移表の金額。マイナスは会計慣行の△で表す */
const yen = (n: number) => (n === 0 ? "-" : formatYen(n));
const pct = (n: number | null) => (n == null ? "-" : `${n < 0 ? "△" : ""}${Math.abs(n).toFixed(1)}%`);

/**
 * 月次推移表（全科目）。
 * 月の欄は 金額・前月との差額・前年同月との差額・前年同月比・構成比 を切り替え、
 * 右側に 当期（累計／期末残高）・前期・差額・前期比・構成比 を出す。
 * 構成比の分母は、損益は売上高（収益合計）、残高は総資産。計算は src/lib/monthly-trend.ts。
 */
function MonthlyTrendTable({
  data,
  monthLabels,
  mode,
  metric,
  onModeChange,
  onMetricChange,
}: {
  data: MonthlyTrendRow[];
  monthLabels: string[];
  mode: MonthlyTrendMode;
  metric: MonthMetric;
  onModeChange: (m: MonthlyTrendMode) => void;
  onMetricChange: (m: MonthMetric) => void;
}) {
  const [hideEmpty, setHideEmpty] = useState(false);
  const groups = mode === "pl" ? PL_GROUPS : BS_GROUPS;
  const curLabel = mode === "pl" ? "当期累計" : "期末残高";
  const prevLabel = mode === "pl" ? "前期累計" : "前期末残高";

  const rowsOf = (cat: string) => data.filter((r) => r.category === cat && !(hideEmpty && isEmptySeries(r)));
  const groupSeries = (cat: string) => sumSeries(data.filter((r) => r.category === cat));
  // 構成比の分母（損益=売上高、残高=総資産）
  const base = groupSeries(mode === "pl" ? "revenue" : "asset");
  const baseLabel = mode === "pl" ? "売上高比" : "総資産比";

  const monthCell = (series: TrendSeries, idx: number) => {
    const v = monthValue(series, idx, metric, base);
    if (v == null) return "-";
    return isRatioMetric(metric) ? pct(v) : yen(v);
  };

  const Toggle = ({
    active,
    onClick,
    children,
  }: {
    active: boolean;
    onClick: () => void;
    children: ReactNode;
  }) => (
    <button
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 rounded-md text-xs font-bold transition-all",
        active ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  );

  const SummaryCells = ({ series, strong }: { series: TrendSeries; strong?: boolean }) => {
    const c = summaryColumns(series, mode, base);
    const cls = cn("px-2 py-1.5 text-right font-mono whitespace-nowrap", strong && "font-bold");
    return (
      <>
        <td className={cn(cls, "bg-muted/10 border-l border-border text-foreground")}>{yen(c.current)}</td>
        <td className={cn(cls, "text-muted-foreground")}>{yen(c.prev)}</td>
        <td className={cn(cls, c.diff < 0 ? "text-destructive" : c.diff > 0 ? "text-success" : "text-muted-foreground")}>
          {yen(c.diff)}
        </td>
        <td className={cn(cls, "text-muted-foreground")}>{pct(c.prevRatio)}</td>
        <td className={cn(cls, "text-muted-foreground")}>{pct(c.composition)}</td>
      </>
    );
  };

  const profit = subtractSeries(groupSeries("revenue"), groupSeries("expense"));
  // 残高では、資産合計と並べて確かめられるよう 負債・純資産合計 を出す
  const liabilitiesAndEquity = sumSeries([groupSeries("liability"), groupSeries("equity")]);
  const colCount = monthLabels.length + 6;

  return (
    <div className="space-y-4">
      {/* 切り替え */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex gap-1 bg-muted/20 p-1 rounded-lg">
          <Toggle active={mode === "pl"} onClick={() => onModeChange("pl")}>損益（PL）</Toggle>
          <Toggle active={mode === "bs"} onClick={() => onModeChange("bs")}>残高（BS）</Toggle>
        </div>
        <div className="inline-flex flex-wrap gap-1 bg-muted/20 p-1 rounded-lg">
          {MONTH_METRICS.map((o) => (
            <Toggle key={o.key} active={metric === o.key} onClick={() => onMetricChange(o.key)}>
              {o.label}
            </Toggle>
          ))}
        </div>
        <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
          <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} className="size-3.5" />
          動きのない科目を隠す
        </label>
      </div>

      {data.length === 0 ? (
        <div className="rounded-xl border border-border p-12 text-center text-muted-foreground">
          データがありません
        </div>
      ) : (
        <>
          {/* 全科目を出すと縦に長いので、表の中でスクロールし見出しの行を上に残す */}
          <div className="overflow-auto max-h-[75vh] rounded-xl border border-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border [&>th]:sticky [&>th]:top-0 [&>th]:z-20 [&>th]:bg-muted">
                  <th className="text-left px-3 py-2 text-xs font-bold text-muted-foreground sticky left-0 !z-30 bg-muted min-w-[150px]">
                    科目
                  </th>
                  {monthLabels.map((m) => (
                    <th key={m} className="text-right px-2 py-2 text-xs font-bold text-muted-foreground min-w-[90px]">
                      {m}
                    </th>
                  ))}
                  <th className="text-right px-2 py-2 text-xs font-bold text-foreground min-w-[100px] bg-muted/10 border-l border-border">
                    {curLabel}
                  </th>
                  <th className="text-right px-2 py-2 text-xs font-bold text-muted-foreground min-w-[100px]">{prevLabel}</th>
                  <th className="text-right px-2 py-2 text-xs font-bold text-muted-foreground min-w-[100px]">差額</th>
                  <th className="text-right px-2 py-2 text-xs font-bold text-muted-foreground min-w-[70px]">前期比</th>
                  <th className="text-right px-2 py-2 text-xs font-bold text-muted-foreground min-w-[70px]">
                    構成比
                    <div className="font-normal text-[10px]">（{baseLabel}）</div>
                  </th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => {
                  const rows = rowsOf(g.key);
                  const all = data.filter((r) => r.category === g.key);
                  if (all.length === 0) return null;
                  const subtotal = sumSeries(all);
                  return (
                    <Fragment key={g.key}>
                      <tr className="bg-muted/10 border-t border-border">
                        <td colSpan={colCount} className="px-3 py-1.5 text-xs font-bold text-primary sticky left-0">
                          {g.label}
                        </td>
                      </tr>
                      {rows.map((row) => (
                        <tr
                          key={row.code}
                          className={cn(
                            "border-b border-border/50 bg-card hover:bg-muted/10 transition-colors",
                            isEmptySeries(row) && "text-muted-foreground/60"
                          )}
                        >
                          <td className="px-3 py-1.5 font-medium sticky left-0 z-10 bg-card whitespace-nowrap">
                            <span className="text-muted-foreground font-mono mr-1.5">{row.code}</span>
                            {row.name}
                          </td>
                          {monthLabels.map((_, idx) => (
                            <td key={idx} className="px-2 py-1.5 text-right font-mono text-muted-foreground whitespace-nowrap">
                              {monthCell(row, idx)}
                            </td>
                          ))}
                          <SummaryCells series={row} />
                        </tr>
                      ))}
                      <tr className="bg-muted/20 border-y border-border font-bold">
                        <td className="px-3 py-1.5 sticky left-0 z-10 bg-muted">{g.label}合計</td>
                        {monthLabels.map((_, idx) => (
                          <td key={idx} className="px-2 py-1.5 text-right font-mono whitespace-nowrap">
                            {monthCell(subtotal, idx)}
                          </td>
                        ))}
                        <SummaryCells series={subtotal} strong />
                      </tr>
                    </Fragment>
                  );
                })}
                {mode === "pl" && (
                  <tr className="bg-primary/5 border-t-2 border-primary/30 font-bold">
                    <td className="px-3 py-2 text-foreground sticky left-0 z-10 bg-card">差引損益</td>
                    {monthLabels.map((_, idx) => {
                      const v = monthValue(profit, idx, metric, base);
                      return (
                        <td
                          key={idx}
                          className={cn(
                            "px-2 py-2 text-right font-mono whitespace-nowrap",
                            v != null && v < 0 ? "text-destructive" : "text-success"
                          )}
                        >
                          {monthCell(profit, idx)}
                        </td>
                      );
                    })}
                    <SummaryCells series={profit} strong />
                  </tr>
                )}
                {mode === "bs" && (
                  <tr className="bg-primary/5 border-t-2 border-primary/30 font-bold">
                    <td className="px-3 py-2 text-foreground sticky left-0 z-10 bg-card">負債・純資産合計</td>
                    {monthLabels.map((_, idx) => (
                      <td key={idx} className="px-2 py-2 text-right font-mono whitespace-nowrap">
                        {monthCell(liabilitiesAndEquity, idx)}
                      </td>
                    ))}
                    <SummaryCells series={liabilitiesAndEquity} strong />
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-muted-foreground">
            月の欄は「{MONTH_METRICS.find((o) => o.key === metric)?.label}」を表示しています。右側の
            {curLabel}・{prevLabel}・差額は金額、前期比は{curLabel}÷{prevLabel}、構成比は{baseLabel}です。
            前期は1年前の同じ月です。要確認の仕訳は含めていません。
          </p>
        </>
      )}
    </div>
  );
}

function InventorySchedule({ data }: { data: InventoryScheduleRow[] }) {
  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-border p-12 text-center text-muted-foreground">
        棚卸資産のデータがありません
      </div>
    );
  }

  const totalOpening = data.reduce((s, r) => s + r.openingBalance, 0);
  const totalIncrease = data.reduce((s, r) => s + r.increase, 0);
  const totalDecrease = data.reduce((s, r) => s + r.decrease, 0);
  const totalClosing = data.reduce((s, r) => s + r.closingBalance, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          棚卸表
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/20 border-b border-border">
                <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground">コード</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground">勘定科目</th>
                <th className="text-right px-4 py-3 text-xs font-bold text-muted-foreground">期首棚卸高</th>
                <th className="text-right px-4 py-3 text-xs font-bold text-muted-foreground">当期仕入高</th>
                <th className="text-right px-4 py-3 text-xs font-bold text-muted-foreground">当期払出高</th>
                <th className="text-right px-4 py-3 text-xs font-bold text-muted-foreground">期末棚卸高</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.code} className="border-b border-border/50 bg-card hover:bg-muted/10 transition-colors">
                  <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{row.code}</td>
                  <td className="px-4 py-2 text-foreground">{row.name}</td>
                  <td className="px-4 py-2 text-right font-mono">{row.openingBalance !== 0 ? formatCurrency(row.openingBalance) : "-"}</td>
                  <td className="px-4 py-2 text-right font-mono">{row.increase > 0 ? formatCurrency(row.increase) : "-"}</td>
                  <td className="px-4 py-2 text-right font-mono">{row.decrease > 0 ? formatCurrency(row.decrease) : "-"}</td>
                  <td className="px-4 py-2 text-right font-mono font-bold">{formatCurrency(row.closingBalance)}</td>
                </tr>
              ))}
              <tr className="bg-primary/5 font-bold border-t-2 border-primary/30">
                <td colSpan={2} className="px-4 py-3 text-foreground text-sm">合計</td>
                <td className="px-4 py-3 text-right font-mono">{formatCurrency(totalOpening)}</td>
                <td className="px-4 py-3 text-right font-mono">{formatCurrency(totalIncrease)}</td>
                <td className="px-4 py-3 text-right font-mono">{formatCurrency(totalDecrease)}</td>
                <td className="px-4 py-3 text-right font-mono">{formatCurrency(totalClosing)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

interface InventoryDraft {
  id?: string;
  count_date: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  saving?: boolean;
}

// 実地棚卸表（品目別・手入力）: 棚卸日・商品名・数量・単価・金額（=数量×単価）
function PhysicalInventory({ clientId }: { clientId: string }) {
  const [rows, setRows] = useState<InventoryDraft[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getInventoryCounts(clientId)
      .then((data) => {
        if (!active) return;
        setRows(
          data.map((d) => ({
            id: d.id,
            count_date: d.count_date,
            product_name: d.product_name,
            quantity: d.quantity,
            unit_price: d.unit_price,
          }))
        );
      })
      .catch((e) => console.error("Inventory counts fetch error:", e))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [clientId]);

  const today = new Date().toISOString().slice(0, 10);
  const addRow = () =>
    setRows((r) => [...r, { count_date: today, product_name: "", quantity: 0, unit_price: 0 }]);
  const setField = (idx: number, patch: Partial<InventoryDraft>) =>
    setRows((r) => r.map((row, i) => (i === idx ? { ...row, ...patch } : row)));

  async function saveRow(idx: number) {
    const row = rows[idx];
    if (!row.product_name.trim()) {
      alert("商品名を入力してください");
      return;
    }
    setField(idx, { saving: true });
    const input = {
      count_date: row.count_date,
      product_name: row.product_name.trim(),
      quantity: Number(row.quantity) || 0,
      unit_price: Number(row.unit_price) || 0,
    };
    try {
      if (row.id) {
        await updateInventoryCount(row.id, input);
      } else {
        const created = await createInventoryCount(clientId, input);
        setField(idx, { id: created.id });
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setField(idx, { saving: false });
    }
  }

  async function removeRow(idx: number) {
    const row = rows[idx];
    if (row.id) {
      if (!confirm("この行を削除しますか？")) return;
      try {
        await deleteInventoryCount(row.id);
      } catch (e) {
        alert(e instanceof Error ? e.message : "削除に失敗しました");
        return;
      }
    }
    setRows((r) => r.filter((_, i) => i !== idx));
  }

  const total = rows.reduce((s, r) => s + (Number(r.quantity) || 0) * (Number(r.unit_price) || 0), 0);

  if (loading) {
    return (
      <div className="rounded-xl border border-border p-12 text-center text-muted-foreground">
        読み込み中...
      </div>
    );
  }

  const inputCls = "w-full px-2 py-1 rounded border border-neutral-300 text-sm";

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={addRow}>
          <Plus className="size-4" />
          行を追加
        </Button>
      </div>
      <div className="paper w-fit max-w-full overflow-x-auto rounded-lg border border-neutral-300 bg-white">
        <table className="w-auto text-sm tabular-nums bg-white text-foreground">
          <thead>
            <tr className="border-b-2 border-neutral-400">
              <th className="text-left px-3 py-1.5 text-xs font-bold">棚卸日</th>
              <th className="text-left px-3 py-1.5 text-xs font-bold">商品名</th>
              <th className="text-right px-3 py-1.5 text-xs font-bold">数量</th>
              <th className="text-right px-3 py-1.5 text-xs font-bold">単価</th>
              <th className="text-right px-3 py-1.5 text-xs font-bold">金額</th>
              <th className="text-center px-3 py-1.5 text-xs font-bold">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  品目がありません。「行を追加」で入力してください。
                </td>
              </tr>
            )}
            {rows.map((row, idx) => {
              const amount = (Number(row.quantity) || 0) * (Number(row.unit_price) || 0);
              return (
                <tr key={row.id ?? `draft-${idx}`} className="border-b border-neutral-200">
                  <td className="px-3 py-1.5">
                    <DateInput allowEmpty value={row.count_date}
                      onChange={(v) => setField(idx, { count_date: v })}
                      className={inputCls} />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      type="text"
                      value={row.product_name}
                      onChange={(e) => setField(idx, { product_name: e.target.value })}
                      placeholder="商品名"
                      className={cn(inputCls, "min-w-[160px]")}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <input
                      type="number"
                      value={row.quantity}
                      onChange={(e) => setField(idx, { quantity: e.target.value === "" ? 0 : Number(e.target.value) })}
                      className={cn(inputCls, "text-right w-24")}
                    />
                  </td>
                  <td className="px-3 py-1.5">
                    <AmountInput
                      value={row.unit_price ? String(row.unit_price) : ""}
                      onChange={(v) => setField(idx, { unit_price: v === "" ? 0 : Number(v) })}
                      className={cn(inputCls, "text-right w-28")}
                    />
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono font-bold whitespace-nowrap">
                    {formatCurrency(amount)}
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center justify-center gap-1">
                      <Button size="sm" variant="outline" onClick={() => saveRow(idx)} disabled={row.saving}>
                        {row.saving ? <Loader2 className="size-4 animate-spin" /> : "保存"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => removeRow(idx)} disabled={row.saving}>
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
            <tr className="font-bold border-t-2 border-neutral-400">
              <td colSpan={4} className="px-3 py-2 text-right">合計</td>
              <td className="px-3 py-2 text-right font-mono">{formatCurrency(total)}</td>
              <td className="px-3 py-2" />
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        ※ 金額は「数量 × 単価」で自動計算されます。各行は「保存」で確定してください。
      </p>
    </div>
  );
}

// 決算書（会計年度のB/S＋P/Lをまとめた帳票）
function SettlementReport({
  data,
  clientName,
  fiscalYearStart,
  fiscalYearEnd,
  clientId,
}: {
  data: TrialBalanceRow[];
  clientName: string;
  fiscalYearStart: string;
  fiscalYearEnd: string;
  clientId?: string;
}) {
  const hasData = data.length > 0;
  const reportRouter = useRouter();

  function handleCsv() {
    const rows: (string | number)[][] = [];
    // 貸借対照表
    const assets = data.filter((r) => r.category === "asset");
    const liabilities = data.filter((r) => r.category === "liability");
    const equity = data.filter((r) => r.category === "equity");
    const bsVal = (r: TrialBalanceRow, debitNature: boolean) =>
      debitNature ? r.debitBalance - r.creditBalance : r.creditBalance - r.debitBalance;
    for (const r of assets) rows.push(["貸借対照表/資産", r.name, bsVal(r, true)]);
    rows.push(["貸借対照表/資産", "資産合計", assets.reduce((s, r) => s + bsVal(r, true), 0)]);
    for (const r of liabilities) rows.push(["貸借対照表/負債", r.name, bsVal(r, false)]);
    rows.push(["貸借対照表/負債", "負債合計", liabilities.reduce((s, r) => s + bsVal(r, false), 0)]);
    for (const r of equity) rows.push(["貸借対照表/純資産", r.name, bsVal(r, false)]);
    const revenue = data.filter((r) => r.category === "revenue").reduce((s, r) => s + (r.creditBalance - r.debitBalance), 0);
    const expenses = data.filter((r) => r.category === "expense").reduce((s, r) => s + (r.debitBalance - r.creditBalance), 0);
    rows.push(["貸借対照表/純資産", "当期純利益", revenue - expenses]);

    // 損益計算書
    const plAmt = (r: TrialBalanceRow) =>
      r.category === "revenue" ? r.creditBalance - r.debitBalance : r.debitBalance - r.creditBalance;
    for (const r of data.filter((r) => r.category === "revenue" || r.category === "expense")) {
      rows.push(["損益計算書", r.name, plAmt(r)]);
    }
    rows.push(["損益計算書", "当期純利益", revenue - expenses]);

    downloadCSV(
      `決算書_${clientName || "client"}_${fiscalYearStart}_${fiscalYearEnd}.csv`,
      ["区分", "科目", "金額"],
      rows
    );
  }

  if (!hasData) {
    return (
      <div className="rounded-xl border border-border p-12 text-center text-muted-foreground">
        データがありません
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2 print:hidden">
        <Button variant="outline" size="sm" onClick={handleCsv}>
          <FileSpreadsheet className="size-4" />
          CSV出力
        </Button>
        <Button
          size="sm"
          onClick={() =>
            clientId &&
            reportRouter.push(`/clients/${clientId}/statements/report/${fiscalYearStart}`)
          }
          disabled={!clientId}
        >
          <FileText className="size-4" />
          表紙付き決算書を出力
        </Button>
      </div>

      <div className="rounded-xl border border-border bg-card p-6 space-y-8">
        <div className="text-center">
          <h2 className="text-xl font-bold text-foreground">決算書</h2>
          {clientName && <p className="text-foreground mt-1">{clientName}</p>}
          <p className="text-sm text-muted-foreground mt-1">会計年度: {fiscalYearStart} 〜 {fiscalYearEnd}</p>
        </div>

        <div>
          <h3 className="text-lg font-bold text-foreground mb-3">貸借対照表（B/S）</h3>
          <BalanceSheet trialData={data} clientId={clientId} />
        </div>

        <div>
          <h3 className="text-lg font-bold text-foreground mb-3">損益計算書（P/L）</h3>
          <ProfitAndLoss trialData={data} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

const pad2 = (n: number) => String(n).padStart(2, "0");
const toYmd = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const monthStart = (d: Date) => toYmd(new Date(d.getFullYear(), d.getMonth(), 1));
const monthEnd = (d: Date) => toYmd(new Date(d.getFullYear(), d.getMonth() + 1, 0));
const slash = (ymd: string) => ymd.replaceAll("-", "/");
/** 日付（YYYY-MM-DD）が属する会計年度（決算月を変えた年の変則期間は記録どおり） */
type FiscalBasis = { startMonth: number; rows: FiscalPeriodRow[] };
function fiscalPeriodOf(basis: FiscalBasis, ymd: string) {
  return fiscalPeriodContaining(basis.rows, basis.startMonth, ymd);
}

export default function StatementsPage() {
  const { id } = useParams<{ id: string }>();

  const [activeTab, setActiveTab] = useState<StatementTab>("trial_balance");
  // 期間指定で選べる年（来年から7年前まで）
  const periodYears = Array.from({ length: 8 }, (_, i) => new Date().getFullYear() + 1 - i);
  // 集計期間（開始日〜終了日）。既定は「期首〜今月末」。
  // 開始日は決算月を読み込んでから決める（それまで空）
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState(() => monthEnd(new Date()));

  // URLの ?tab= で初期タブを指定可能にする（例: ダッシュボードの月次推移グラフから遷移）
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && tabConfig.some((c) => c.key === t)) {
      setActiveTab(t as StatementTab);
    }
  }, []);

  const [trialData, setTrialData] = useState<TrialBalanceRow[]>([]);
  const [trialLoading, setTrialLoading] = useState(false);
  const [trendData, setTrendData] = useState<MonthlyTrendRow[]>([]);
  const [trendMonthLabels, setTrendMonthLabels] = useState<string[]>([]);
  const [trendMode, setTrendMode] = useState<MonthlyTrendMode>("pl");
  const [trendMetric, setTrendMetric] = useState<MonthMetric>("amount");
  const [inventoryData, setInventoryData] = useState<InventoryScheduleRow[]>([]);
  const [inventoryMode, setInventoryMode] = useState<"physical" | "journal">("physical");

  // クライアントの決算月（期首月）・名称を取得。
  // null = 未ロード。ロード前に既定4月で計算すると、4月以外が決算期首の顧問先で
  // 対象期間が誤表示・誤集計されるため、ロード完了まで計算・取得を保留する。
  // 記録された事業年度（変則期間）も一緒に読み込む
  const [fiscalBasis, setFiscalBasis] = useState<FiscalBasis | null>(null);
  const [clientName, setClientName] = useState("");
  useEffect(() => {
    Promise.all([getClient(id), getFiscalPeriodRows(id).catch(() => [] as FiscalPeriodRow[])])
      .then(([c, rows]) => {
        setFiscalBasis({ startMonth: (c as { fiscal_year_start_month?: number }).fiscal_year_start_month ?? 4, rows });
        setClientName((c as { name?: string }).name ?? "");
      })
      .catch(() => setFiscalBasis({ startMonth: 4, rows: [] }));
  }, [id]);

  // 決算書データ（会計年度の全期間で集計）
  const [settlementData, setSettlementData] = useState<TrialBalanceRow[]>([]);
  const [settlementLoading, setSettlementLoading] = useState(false);

  // 決算月が分かったら、開始日の既定を「終了日が属する会計年度の期首」にする
  useEffect(() => {
    if (fiscalBasis === null || rangeStart) return;
    setRangeStart(fiscalPeriodOf(fiscalBasis, rangeEnd).startDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fiscalBasis]);

  // ホイールで日付を回している間に毎回集計し直さないよう、止まってから反映する
  const [appliedRange, setAppliedRange] = useState({ start: "", end: "" });
  useEffect(() => {
    const t = setTimeout(() => setAppliedRange({ start: rangeStart, end: rangeEnd }), 400);
    return () => clearTimeout(t);
  }, [rangeStart, rangeEnd]);

  // 終了日が属する会計年度（決算書・月次推移・棚卸の期首に使う）。決算月ロード前は null で保留。
  const fiscalOfEnd = useMemo(() => {
    if (fiscalBasis === null || !appliedRange.end) return null;
    return fiscalPeriodOf(fiscalBasis, appliedRange.end);
  }, [fiscalBasis, appliedRange.end]);
  const fiscalYearStart = fiscalOfEnd?.startDate ?? "";
  const fiscalYearEnd = fiscalOfEnd?.endDate ?? "";

  // 期間の誤り。1つの会計年度の中に収める（年度をまたぐと、年度初めの
  // 繰越仕訳が当期の動きに混ざり損益が正しく出ないため）
  const rangeError = useMemo(() => {
    const { start, end } = appliedRange;
    if (!start || !end || !fiscalOfEnd) return null;
    if (start > end) return "開始日が終了日より後になっています";
    if (start < fiscalOfEnd.startDate)
      return `期間は1つの会計年度の中で選んでください（この年度は ${slash(fiscalOfEnd.startDate)} 〜 ${slash(fiscalOfEnd.endDate)}）`;
    return null;
  }, [appliedRange, fiscalOfEnd]);

  // 試算表/BS/PL・棚卸: 選んだ開始日〜終了日。期間が正しくない間は集計しない
  const startDate = rangeError ? "" : appliedRange.start;
  const endDate = rangeError || !fiscalOfEnd ? "" : appliedRange.end;

  const applyPreset = (preset: "ytd" | "month" | "prev") => {
    if (fiscalBasis === null) return;
    const today = new Date();
    if (preset === "ytd") {
      const end = monthEnd(today);
      setRangeStart(fiscalPeriodOf(fiscalBasis, end).startDate);
      setRangeEnd(end);
    } else if (preset === "month") {
      setRangeStart(monthStart(today));
      setRangeEnd(monthEnd(today));
    } else {
      const cur = fiscalPeriodOf(fiscalBasis, monthEnd(today));
      const [y, m, d] = cur.startDate.split("-").map(Number);
      const prevEnd = toYmd(new Date(y, m - 1, d - 1));
      setRangeStart(fiscalPeriodOf(fiscalBasis, prevEnd).startDate);
      setRangeEnd(prevEnd);
    }
  };

  // 集計から除いた「要確認」の仕訳。数字を黙って落とすと、
  // 帳簿の一覧と決算書が合わない理由が分からないため画面で知らせる
  const [needsReview, setNeedsReview] = useState<{ entryCount: number; amount: number } | null>(
    null
  );

  const fetchTrialBalance = useCallback(async () => {
    setTrialLoading(true);
    try {
      const [data, review] = await Promise.all([
        getTrialBalance(id, startDate, endDate),
        getNeedsReviewSummary(id, startDate, endDate),
      ]);
      setTrialData(data);
      setNeedsReview(review);
    } catch (e) {
      console.error("Trial balance fetch error:", e);
      setTrialData([]);
      setNeedsReview(null);
    } finally {
      setTrialLoading(false);
    }
  }, [id, startDate, endDate]);

  const fetchSettlement = useCallback(async () => {
    setSettlementLoading(true);
    try {
      setSettlementData(await getTrialBalance(id, fiscalYearStart, fiscalYearEnd));
    } catch (e) {
      console.error("Settlement fetch error:", e);
      setSettlementData([]);
    } finally {
      setSettlementLoading(false);
    }
  }, [id, fiscalYearStart, fiscalYearEnd]);

  useEffect(() => {
    if (activeTab === "settlement" && fiscalYearStart) fetchSettlement();
  }, [activeTab, fetchSettlement, fiscalYearStart]);

  const fetchMonthlyTrend = useCallback(async () => {
    beginLoad();
    try {
      const { rows, monthLabels } = await getMonthlyTrend(id, fiscalYearStart, fiscalYearEnd, trendMode);
      setTrendData(rows);
      setTrendMonthLabels(monthLabels);
    } catch (e) {
      console.error("Monthly trend fetch error:", e);
      setTrendData([]);
      setTrendMonthLabels([]);
    } finally {
      endLoad();
    }
  }, [id, fiscalYearStart, fiscalYearEnd, trendMode]);

  useEffect(() => {
    if ((activeTab === "trial_balance" || activeTab === "bs" || activeTab === "pl") && startDate && endDate) {
      fetchTrialBalance();
    }
  }, [activeTab, fetchTrialBalance, startDate, endDate]);

  useEffect(() => {
    if (activeTab === "monthly_trend" && fiscalYearStart) {
      fetchMonthlyTrend();
    }
  }, [activeTab, fetchMonthlyTrend, fiscalYearStart]);

  const fetchInventory = useCallback(async () => {
    beginLoad();
    try {
      const data = await getInventorySchedule(id, fiscalYearStart, endDate);
      setInventoryData(data);
    } catch (e) {
      console.error("Inventory schedule fetch error:", e);
      setInventoryData([]);
    } finally {
      endLoad();
    }
  }, [id, fiscalYearStart, endDate]);

  useEffect(() => {
    if (activeTab === "inventory" && fiscalYearStart && endDate) {
      fetchInventory();
    }
  }, [activeTab, fetchInventory, fiscalYearStart, endDate]);

  return (
    <>
      {/* Page Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <BarChart3 className="size-6 text-primary" />
            試算表・財務諸表
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            合計残高試算表・貸借対照表・損益計算書・月次推移・棚卸表
          </p>
        </div>
        {activeTab !== "settlement" && (
          <Button variant="outline" size="sm" onClick={() => printPage()}>
            <FileText className="size-4" />
            PDF出力
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-6 overflow-x-auto border-b border-border pb-px">
        {tabConfig.map((tab) => (
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

      {/* Controls */}
      <Card className="mb-4 w-fit">
        <CardContent className="py-2 px-3">
          {/* 期間: 年は選択・月日は入力（例 4/1）。Enter／←→ で隣の欄へ移れる */}
          <div className="flex flex-wrap items-center gap-2" onKeyDown={handleBarKeyNav}>
            <Calendar className="size-4 text-muted-foreground" />
            <label className="text-sm text-foreground font-bold">期間</label>
            <YearMonthDayInput label="開始日" value={rangeStart} onChange={setRangeStart} years={periodYears} />
            <span className="text-foreground">〜</span>
            <YearMonthDayInput label="終了日" value={rangeEnd} onChange={setRangeEnd} years={periodYears} />
            <div className="flex gap-1">
              {([
                ["ytd", "当期累計"],
                ["month", "当月"],
                ["prev", "前期"],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => applyPreset(key)}
                  className="px-2.5 py-1 rounded-lg border border-border text-sm text-foreground hover:bg-muted/40 cursor-pointer"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {rangeError ? (
            <p className="mt-1.5 text-sm text-destructive">{rangeError}</p>
          ) : (
            fiscalYearStart &&
            appliedRange.start > fiscalYearStart &&
            (activeTab === "trial_balance" || activeTab === "bs" || activeTab === "pl") && (
              <p className="mt-1.5 text-sm text-foreground/80">
                開始日より前の当期の損益（{slash(fiscalYearStart)}〜）は、繰越利益剰余金に含めて表示しています
              </p>
            )
          )}
          {(activeTab === "settlement" || activeTab === "monthly_trend") && fiscalYearStart && (
            <p className="mt-1.5 text-sm text-foreground/80">
              {activeTab === "settlement" ? "決算書" : "月次推移"}は、終了日を含む会計年度（
              {slash(fiscalYearStart)} 〜 {slash(fiscalYearEnd)}）で表示します
            </p>
          )}
        </CardContent>
      </Card>

      {/* 集計から除いた「要確認」の仕訳を知らせる。
          AIの読み取りで信頼度が低い・貸借が合わない・証憑の合計と金額が
          合わない仕訳は、人の目を通すまで決算書の数字に入れない。
          帳簿の一覧には出ているので、除いたことを伝えないと
          「一覧と決算書が合わない」という不審な差になる */}
      {needsReview && needsReview.entryCount > 0 &&
        (activeTab === "trial_balance" || activeTab === "bs" || activeTab === "pl") && (
          <div className="mb-4 flex flex-wrap items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 p-4">
            <AlertTriangle className="size-5 shrink-0 text-warning mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-foreground">
                要確認の仕訳 {needsReview.entryCount}件
                {/* 金額が0の仕訳（AIが金額を読めなかった等）では「¥0」を出さない。
                    除外によって金額が減ったかのように読めてしまうため */}
                {needsReview.amount > 0 && `（${formatCurrency(needsReview.amount)}）`}
                をこの集計に含めていません
              </p>
              <p className="mt-1 text-sm text-foreground">
                AIの読み取りで信頼度が低い、貸借が合わない、証憑の合計と金額が合わない仕訳です。
                {needsReview.amount === 0 && "金額が読み取れていない仕訳のため、金額の差はありません。"}
                内容を確認して直すと、この表の金額に反映されます。
              </p>
            </div>
            <Link
              href={`/clients/${id}/journals`}
              className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-sm font-bold text-foreground hover:bg-muted/30"
            >
              仕訳を確認する
            </Link>
          </div>
        )}

      {/* Content */}
      {(activeTab === "trial_balance" || activeTab === "bs" || activeTab === "pl") && trialLoading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-border p-12 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          <span className="text-sm">読み込み中...</span>
        </div>
      ) : (
        <>
          {activeTab === "trial_balance" && <TrialBalance data={trialData} />}
          {activeTab === "bs" && <BalanceSheet trialData={trialData} clientId={id} />}
          {activeTab === "pl" && <ProfitAndLoss trialData={trialData} />}
        </>
      )}
      {activeTab === "settlement" && (
        settlementLoading ? (
          <div className="flex items-center justify-center gap-2 rounded-xl border border-border p-12 text-muted-foreground">
            <Loader2 className="size-5 animate-spin" />
            <span className="text-sm">読み込み中...</span>
          </div>
        ) : (
          <SettlementReport
            data={settlementData}
            clientName={clientName}
            fiscalYearStart={fiscalYearStart}
            fiscalYearEnd={fiscalYearEnd}
            clientId={id}
          />
        )
      )}
      {activeTab === "monthly_trend" && (
        <MonthlyTrendTable
          data={trendData}
          monthLabels={trendMonthLabels}
          mode={trendMode}
          metric={trendMetric}
          onModeChange={setTrendMode}
          onMetricChange={setTrendMetric}
        />
      )}
      {activeTab === "inventory" && (
        <div className="space-y-4">
          <div className="inline-flex gap-1 bg-muted/20 p-1 rounded-lg">
            <button
              onClick={() => setInventoryMode("physical")}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-bold transition-all",
                inventoryMode === "physical" ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              実地棚卸（品目別）
            </button>
            <button
              onClick={() => setInventoryMode("journal")}
              className={cn(
                "px-3 py-1.5 rounded-md text-xs font-bold transition-all",
                inventoryMode === "journal" ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              仕訳集計（金額）
            </button>
          </div>
          {inventoryMode === "physical" ? (
            <PhysicalInventory clientId={id} />
          ) : (
            <InventorySchedule data={inventoryData} />
          )}
        </div>
      )}

      {/* Footer */}
      <div className="mt-4 flex justify-between items-center text-xs text-muted-foreground">
        <span>
          {startDate && endDate
            ? `対象期間: ${startDate} 〜 ${endDate}（会計年度: ${fiscalYearStart} 〜 ${fiscalYearEnd}）`
            : "対象期間: 読み込み中…"}
        </span>
      </div>
    </>
  );
}
