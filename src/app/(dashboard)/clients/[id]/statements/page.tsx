"use client";

import { useState, useEffect, useCallback, useMemo, Fragment, type ReactNode } from "react";
import { useParams } from "next/navigation";
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
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency } from "@/lib/utils";
import { printPage, downloadCSV } from "@/lib/export";
import {
  getTrialBalance,
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
import { getFiscalPeriod } from "@/lib/fiscal";
import { beginLoad, endLoad } from "@/lib/loading-bus";

type TrendMetric = "amount" | "yoy" | "mom" | "composition";

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
    <div className="w-fit max-w-full overflow-x-auto rounded-lg border border-neutral-300 bg-white">
      <table className="w-auto text-sm tabular-nums bg-white text-neutral-900 [&_th]:border-r [&_th]:border-neutral-200 [&_td]:border-r [&_td]:border-neutral-200 [&_th:last-child]:border-r-0 [&_td:last-child]:border-r-0">
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
                  {row.name}<span className="font-mono text-xs text-neutral-500">（{row.code}）</span>
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
}: {
  items: BSItem[];
  depth?: number;
}) {
  return (
    <>
      {items.map((item) => (
        <div
          key={item.name}
          className={cn(
            "flex items-center justify-between py-1.5 border-b border-border/30",
            depth === 0 && "font-bold text-foreground",
            depth === 1 && "font-medium text-foreground",
            depth >= 2 && "text-muted-foreground"
          )}
          style={{ paddingLeft: `${depth * 20 + 16}px`, paddingRight: "16px" }}
        >
          <span className="text-sm">{item.name}</span>
          <span className="font-mono text-sm">{formatCurrency(item.amount)}</span>
        </div>
      ))}
    </>
  );
}

function BalanceSheet({ trialData }: { trialData: TrialBalanceRow[] }) {
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
          <BSSection items={bsAssets} />
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
            <BSSection items={bsLiabilities} />
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
            <BSSection items={equityWithProfit} />
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
const TREND_METRICS: { key: TrendMetric; label: string }[] = [
  { key: "amount", label: "金額" },
  { key: "yoy", label: "前年同月比" },
  { key: "mom", label: "前月比増減率" },
  { key: "composition", label: "構成比" },
];

const fmtPct = (n: number) => `${n.toFixed(1)}%`;

// 依存ライブラリなしの軽量な棒グラフ
function MiniBarChart({
  labels,
  values,
  colorize = false,
}: {
  labels: string[];
  values: number[];
  colorize?: boolean;
}) {
  const maxAbs = Math.max(1, ...values.map((v) => Math.abs(v)));
  const hasNeg = values.some((v) => v < 0);
  const H = 120;
  const zero = hasNeg ? H / 2 : H - 4;
  const usable = (hasNeg ? H / 2 : H) - 8;
  const barW = 26;
  const gap = 10;
  const W = values.length * (barW + gap) + gap;
  return (
    <svg width={W} height={H + 18} className="text-primary">
      <line x1={0} y1={zero} x2={W} y2={zero} stroke="#d1d5db" />
      {values.map((v, i) => {
        const h = (Math.abs(v) / maxAbs) * usable;
        const x = gap + i * (barW + gap);
        const y = v >= 0 ? zero - h : zero;
        const fill = colorize ? (v >= 0 ? "#16a34a" : "#dc2626") : "currentColor";
        return <rect key={i} x={x} y={y} width={barW} height={Math.max(0, h)} fill={fill} rx={2} />;
      })}
      {labels.map((l, i) => (
        <text
          key={i}
          x={gap + i * (barW + gap) + barW / 2}
          y={H + 14}
          textAnchor="middle"
          fontSize="9"
          fill="#9ca3af"
        >
          {l}
        </text>
      ))}
    </svg>
  );
}

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
  metric: TrendMetric;
  onModeChange: (m: MonthlyTrendMode) => void;
  onMetricChange: (m: TrendMetric) => void;
}) {
  const groups = mode === "pl" ? PL_GROUPS : BS_GROUPS;
  const summaryLabel = mode === "pl" ? "累計" : "期末残高";

  const rowsOf = (cat: string) => data.filter((r) => r.category === cat);
  const colSum = (rows: MonthlyTrendRow[], idx: number) => rows.reduce((s, r) => s + r.months[idx], 0);
  const totalSum = (rows: MonthlyTrendRow[]) => rows.reduce((s, r) => s + r.total, 0);

  // 月セルの表示値（指標に応じて切替）。groupRows は構成比の分母。
  const cell = (row: MonthlyTrendRow, idx: number, groupRows: MonthlyTrendRow[]): string => {
    const v = row.months[idx];
    if (metric === "amount") return v !== 0 ? formatCurrency(v) : "-";
    if (metric === "yoy") {
      const p = row.prevMonths[idx];
      return p !== 0 ? fmtPct((v / p) * 100) : "-";
    }
    if (metric === "mom") {
      if (idx === 0) return "-";
      const p = row.months[idx - 1];
      return p !== 0 ? fmtPct(((v - p) / Math.abs(p)) * 100) : "-";
    }
    const t = colSum(groupRows, idx); // composition
    return t !== 0 ? fmtPct((v / t) * 100) : "-";
  };

  // グラフ系列
  const chartValues =
    mode === "pl"
      ? monthLabels.map((_, i) => colSum(rowsOf("revenue"), i) - colSum(rowsOf("expense"), i))
      : monthLabels.map((_, i) => colSum(rowsOf("asset"), i));
  const chartTitle = mode === "pl" ? "差引損益の推移" : "資産合計の推移";

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

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex gap-1 bg-muted/20 p-1 rounded-lg">
          <Toggle active={mode === "pl"} onClick={() => onModeChange("pl")}>損益（PL）</Toggle>
          <Toggle active={mode === "bs"} onClick={() => onModeChange("bs")}>残高（BS）</Toggle>
        </div>
        <div className="inline-flex gap-1 bg-muted/20 p-1 rounded-lg">
          {TREND_METRICS.map((o) => (
            <Toggle key={o.key} active={metric === o.key} onClick={() => onMetricChange(o.key)}>
              {o.label}
            </Toggle>
          ))}
        </div>
      </div>

      {data.length === 0 ? (
        <div className="rounded-xl border border-border p-12 text-center text-muted-foreground">
          データがありません
        </div>
      ) : (
        <>
          {/* Chart */}
          <div className="rounded-xl border border-border p-3 overflow-x-auto">
            <div className="text-xs font-bold text-muted-foreground mb-2">{chartTitle}</div>
            <MiniBarChart labels={monthLabels} values={chartValues} colorize={mode === "pl"} />
          </div>

          {/* Table */}
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/20 border-b border-border">
                  <th className="text-left px-3 py-2 text-xs font-bold text-muted-foreground sticky left-0 bg-muted/20 min-w-[140px]">
                    科目
                  </th>
                  {monthLabels.map((m) => (
                    <th key={m} className="text-right px-2 py-2 text-xs font-bold text-muted-foreground min-w-[85px]">
                      {m}
                    </th>
                  ))}
                  <th className="text-right px-3 py-2 text-xs font-bold text-muted-foreground min-w-[100px] bg-muted/10">
                    {summaryLabel}
                  </th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => {
                  const rows = rowsOf(g.key);
                  if (rows.length === 0) return null;
                  return (
                    <Fragment key={g.key}>
                      <tr className="bg-muted/10 border-t border-border">
                        <td colSpan={monthLabels.length + 2} className="px-3 py-1.5 text-xs font-bold text-primary">
                          {g.label}
                        </td>
                      </tr>
                      {rows.map((row) => (
                        <tr key={row.code} className="border-b border-border/50 bg-card hover:bg-muted/10 transition-colors">
                          <td className="px-3 py-1.5 text-foreground font-medium sticky left-0 bg-card">{row.name}</td>
                          {monthLabels.map((_, idx) => (
                            <td key={idx} className="px-2 py-1.5 text-right font-mono text-muted-foreground">
                              {cell(row, idx, rows)}
                            </td>
                          ))}
                          <td className="px-3 py-1.5 text-right font-mono font-bold text-foreground bg-muted/10">
                            {formatCurrency(row.total)}
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-muted/20 border-y border-border font-bold">
                        <td className="px-3 py-1.5 sticky left-0 bg-muted/20">{g.label}合計</td>
                        {monthLabels.map((_, idx) => (
                          <td key={idx} className="px-2 py-1.5 text-right font-mono">
                            {formatCurrency(colSum(rows, idx))}
                          </td>
                        ))}
                        <td className="px-3 py-1.5 text-right font-mono bg-muted/10">{formatCurrency(totalSum(rows))}</td>
                      </tr>
                    </Fragment>
                  );
                })}
                {mode === "pl" && (
                  <tr className="bg-primary/5 border-t-2 border-primary/30 font-bold">
                    <td className="px-3 py-2 text-foreground sticky left-0 bg-primary/5">差引損益</td>
                    {monthLabels.map((_, idx) => {
                      const profit = colSum(rowsOf("revenue"), idx) - colSum(rowsOf("expense"), idx);
                      return (
                        <td key={idx} className={cn("px-2 py-2 text-right font-mono", profit >= 0 ? "text-success" : "text-destructive")}>
                          {profit !== 0 ? formatCurrency(profit) : "-"}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-right font-mono bg-muted/10">
                      {(() => {
                        const p = totalSum(rowsOf("revenue")) - totalSum(rowsOf("expense"));
                        return <span className={p >= 0 ? "text-success" : "text-destructive"}>{formatCurrency(p)}</span>;
                      })()}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {metric !== "amount" && (
            <p className="text-xs text-muted-foreground">
              ※ 月の各セルは「{TREND_METRICS.find((o) => o.key === metric)?.label}」表示です。{summaryLabel}列・小計は金額（円）を表示しています。
            </p>
          )}
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
      <div className="w-fit max-w-full overflow-x-auto rounded-lg border border-neutral-300 bg-white">
        <table className="w-auto text-sm tabular-nums bg-white text-neutral-900">
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
                <td colSpan={6} className="px-3 py-8 text-center text-neutral-500">
                  品目がありません。「行を追加」で入力してください。
                </td>
              </tr>
            )}
            {rows.map((row, idx) => {
              const amount = (Number(row.quantity) || 0) * (Number(row.unit_price) || 0);
              return (
                <tr key={row.id ?? `draft-${idx}`} className="border-b border-neutral-200">
                  <td className="px-3 py-1.5">
                    <input
                      type="date"
                      value={row.count_date}
                      onChange={(e) => setField(idx, { count_date: e.target.value })}
                      className={inputCls}
                    />
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
                    <input
                      type="number"
                      value={row.unit_price}
                      onChange={(e) => setField(idx, { unit_price: e.target.value === "" ? 0 : Number(e.target.value) })}
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
}: {
  data: TrialBalanceRow[];
  clientName: string;
  fiscalYearStart: string;
  fiscalYearEnd: string;
}) {
  const hasData = data.length > 0;

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
        <Button variant="outline" size="sm" onClick={() => printPage()}>
          <FileText className="size-4" />
          PDF出力
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
          <BalanceSheet trialData={data} />
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

export default function StatementsPage() {
  const { id } = useParams<{ id: string }>();

  // デフォルト: 今月
  const now = new Date();
  const defaultYear = now.getFullYear();
  const defaultMonth = now.getMonth() + 1;

  const [activeTab, setActiveTab] = useState<StatementTab>("trial_balance");
  const [period, setPeriod] = useState(`${defaultYear}-${String(defaultMonth).padStart(2, "0")}`);

  const [trialData, setTrialData] = useState<TrialBalanceRow[]>([]);
  const [trialLoading, setTrialLoading] = useState(false);
  const [trendData, setTrendData] = useState<MonthlyTrendRow[]>([]);
  const [trendMonthLabels, setTrendMonthLabels] = useState<string[]>([]);
  const [trendMode, setTrendMode] = useState<MonthlyTrendMode>("pl");
  const [trendMetric, setTrendMetric] = useState<TrendMetric>("amount");
  const [inventoryData, setInventoryData] = useState<InventoryScheduleRow[]>([]);
  const [inventoryMode, setInventoryMode] = useState<"physical" | "journal">("physical");

  // クライアントの決算月（期首月）・名称を取得（既定4月）
  const [fiscalStartMonth, setFiscalStartMonth] = useState(4);
  const [clientName, setClientName] = useState("");
  useEffect(() => {
    getClient(id)
      .then((c) => {
        setFiscalStartMonth((c as { fiscal_year_start_month?: number }).fiscal_year_start_month ?? 4);
        setClientName((c as { name?: string }).name ?? "");
      })
      .catch(() => setFiscalStartMonth(4));
  }, [id]);

  // 決算書データ（会計年度の全期間で集計）
  const [settlementData, setSettlementData] = useState<TrialBalanceRow[]>([]);
  const [settlementLoading, setSettlementLoading] = useState(false);

  // 会計年度の期間（クライアントの決算月基準）
  const fiscalYearStart = useMemo(() => {
    const [y, m] = period.split("-").map(Number);
    return getFiscalPeriod(fiscalStartMonth, y, m).startDate;
  }, [period, fiscalStartMonth]);

  // 試算表/BS/PL: 会計年度開始〜選択月末の累計
  const startDate = useMemo(() => fiscalYearStart, [fiscalYearStart]);
  const endDate = useMemo(() => {
    const [y, m] = period.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    return `${period}-${String(lastDay).padStart(2, "0")}`;
  }, [period]);

  // 月次推移: 会計年度（決算月基準の12ヶ月）
  const fiscalYearEnd = useMemo(() => {
    const [y, m] = period.split("-").map(Number);
    return getFiscalPeriod(fiscalStartMonth, y, m).endDate;
  }, [period, fiscalStartMonth]);

  const fetchTrialBalance = useCallback(async () => {
    setTrialLoading(true);
    try {
      const data = await getTrialBalance(id, startDate, endDate);
      setTrialData(data);
    } catch (e) {
      console.error("Trial balance fetch error:", e);
      setTrialData([]);
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
    if (activeTab === "settlement") fetchSettlement();
  }, [activeTab, fetchSettlement]);

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
    if (activeTab === "trial_balance" || activeTab === "bs" || activeTab === "pl") {
      fetchTrialBalance();
    }
  }, [activeTab, fetchTrialBalance]);

  useEffect(() => {
    if (activeTab === "monthly_trend") {
      fetchMonthlyTrend();
    }
  }, [activeTab, fetchMonthlyTrend]);

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
    if (activeTab === "inventory") {
      fetchInventory();
    }
  }, [activeTab, fetchInventory]);

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
            クライアントID: {id}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => printPage()}>
          <FileText className="size-4" />
          PDF出力
        </Button>
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
          <div className="flex items-center gap-2">
            <Calendar className="size-4 text-muted-foreground" />
            <label className="text-xs text-muted-foreground font-bold">期間:</label>
            <input
              type="month"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="px-2 py-1 rounded-lg border border-border bg-card text-foreground text-sm"
            />
          </div>
        </CardContent>
      </Card>

      {/* Content */}
      {(activeTab === "trial_balance" || activeTab === "bs" || activeTab === "pl") && trialLoading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-border p-12 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          <span className="text-sm">読み込み中...</span>
        </div>
      ) : (
        <>
          {activeTab === "trial_balance" && <TrialBalance data={trialData} />}
          {activeTab === "bs" && <BalanceSheet trialData={trialData} />}
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
          対象期間: {startDate} 〜 {endDate}（会計年度: {fiscalYearStart} 〜 {fiscalYearEnd}）
        </span>
      </div>
    </>
  );
}
