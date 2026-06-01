"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import {
  BarChart3,
  FileText,
  Calendar,
  Building2,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency } from "@/lib/utils";
import { printPage } from "@/lib/export";
import {
  getTrialBalance,
  getMonthlyTrend,
  getInventorySchedule,
  type TrialBalanceRow,
  type MonthlyTrendRow,
  type InventoryScheduleRow,
} from "@/actions/statements";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StatementTab = "trial_balance" | "bs" | "pl" | "monthly_trend" | "inventory";

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

function ProfitAndLoss({ trialData }: { trialData: TrialBalanceRow[] }) {
  const revenueItems = trialData.filter((r) => r.category === "revenue");
  const expenseItems = trialData.filter((r) => r.category === "expense");

  if (revenueItems.length === 0 && expenseItems.length === 0) {
    return (
      <div className="rounded-xl border border-border p-12 text-center text-muted-foreground">
        データがありません
      </div>
    );
  }

  const totalRevenue = revenueItems.reduce((s, r) => s + (r.creditBalance - r.debitBalance), 0);
  const totalExpenses = expenseItems.reduce((s, r) => s + (r.debitBalance - r.creditBalance), 0);
  const operatingProfit = totalRevenue - totalExpenses;

  return (
    <Card className="w-fit max-w-full">
      <CardHeader className="px-3 pt-3 pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          損益計算書
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 text-sm">
        {/* Revenue */}
        <div className="flex items-center justify-between gap-8 py-1 px-2 font-bold text-foreground border-b border-border">
          <span>売上高</span>
          <span className="font-mono">{formatCurrency(totalRevenue)}</span>
        </div>
        {revenueItems.map((item) => (
          <div key={item.code} className="flex items-center justify-between gap-8 py-0.5 border-b border-border/30 text-muted-foreground" style={{ paddingLeft: "24px", paddingRight: "8px" }}>
            <span>{item.name}</span>
            <span className="font-mono">{formatCurrency(item.creditBalance - item.debitBalance)}</span>
          </div>
        ))}

        {/* Expenses */}
        <div className="flex items-center justify-between gap-8 py-1 px-2 font-bold text-foreground border-b border-border mt-1">
          <span>費用合計</span>
          <span className="font-mono">{formatCurrency(totalExpenses)}</span>
        </div>
        {expenseItems.map((item) => (
          <div key={item.code} className="flex items-center justify-between gap-8 py-0.5 border-b border-border/30 text-muted-foreground" style={{ paddingLeft: "24px", paddingRight: "8px" }}>
            <span>{item.name}</span>
            <span className="font-mono">{formatCurrency(item.debitBalance - item.creditBalance)}</span>
          </div>
        ))}

        {/* Operating Profit */}
        <div className="flex items-center justify-between gap-8 py-1.5 px-2 bg-primary/10 border-y-2 border-primary/30 font-bold text-foreground mt-1 rounded">
          <span>営業利益</span>
          <span className={cn("font-mono", operatingProfit >= 0 ? "text-success" : "text-destructive")}>
            {formatCurrency(operatingProfit)}
          </span>
        </div>

        {/* Profit ratio */}
        <div className="mt-2 px-2 flex items-center gap-6 text-xs text-muted-foreground">
          <span>
            営業利益率:{" "}
            <span className={cn("font-bold", operatingProfit >= 0 ? "text-success" : "text-destructive")}>
              {totalRevenue > 0 ? ((operatingProfit / totalRevenue) * 100).toFixed(1) : 0}%
            </span>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function MonthlyTrendTable({ data, monthLabels }: { data: MonthlyTrendRow[]; monthLabels: string[] }) {
  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-border p-12 text-center text-muted-foreground">
        データがありません
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-muted/20 border-b border-border">
            <th className="text-left px-3 py-2 text-xs font-bold text-muted-foreground sticky left-0 bg-muted/20 min-w-[120px]">
              科目
            </th>
            {monthLabels.map((m) => (
              <th key={m} className="text-right px-2 py-2 text-xs font-bold text-muted-foreground min-w-[85px]">
                {m}
              </th>
            ))}
            <th className="text-right px-3 py-2 text-xs font-bold text-muted-foreground min-w-[100px] bg-muted/10">
              累計
            </th>
          </tr>
        </thead>
        <tbody>
          {/* Revenue rows */}
          <tr className="bg-muted/10 border-t border-border">
            <td colSpan={monthLabels.length + 2} className="px-3 py-1.5 text-xs font-bold text-primary">収益</td>
          </tr>
          {data
            .filter((r) => r.category === "revenue")
            .map((row) => (
              <MonthlyTrendRowComponent key={row.name} row={row} />
            ))}

          {/* Expense rows */}
          <tr className="bg-muted/10 border-t border-border">
            <td colSpan={monthLabels.length + 2} className="px-3 py-1.5 text-xs font-bold text-primary">費用</td>
          </tr>
          {data
            .filter((r) => r.category === "expense")
            .map((row) => (
              <MonthlyTrendRowComponent key={row.name} row={row} />
            ))}

          {/* Monthly profit */}
          <tr className="bg-primary/5 border-t-2 border-primary/30 font-bold">
            <td className="px-3 py-2 text-foreground sticky left-0 bg-primary/5">差引損益</td>
            {monthLabels.map((_, idx) => {
              const rev = data
                .filter((r) => r.category === "revenue")
                .reduce((s, r) => s + r.months[idx], 0);
              const exp = data
                .filter((r) => r.category === "expense")
                .reduce((s, r) => s + r.months[idx], 0);
              const profit = rev - exp;
              return (
                <td key={idx} className={cn("px-2 py-2 text-right font-mono", profit >= 0 ? "text-success" : "text-destructive")}>
                  {profit !== 0 ? formatCurrency(profit) : "-"}
                </td>
              );
            })}
            <td className="px-3 py-2 text-right font-mono bg-muted/10">
              {(() => {
                const totalRev = data.filter((r) => r.category === "revenue").reduce((s, r) => s + r.total, 0);
                const totalExp = data.filter((r) => r.category === "expense").reduce((s, r) => s + r.total, 0);
                const totalProfit = totalRev - totalExp;
                return (
                  <span className={totalProfit >= 0 ? "text-success" : "text-destructive"}>
                    {formatCurrency(totalProfit)}
                  </span>
                );
              })()}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function MonthlyTrendRowComponent({ row }: { row: MonthlyTrendRow }) {
  return (
    <tr className="border-b border-border/50 bg-card hover:bg-muted/10 transition-colors">
      <td className="px-3 py-1.5 text-foreground font-medium sticky left-0 bg-card">{row.name}</td>
      {row.months.map((val, idx) => (
        <td key={idx} className="px-2 py-1.5 text-right font-mono text-muted-foreground">
          {val > 0 ? formatCurrency(val) : "-"}
        </td>
      ))}
      <td className="px-3 py-1.5 text-right font-mono font-bold text-foreground bg-muted/10">
        {formatCurrency(row.total)}
      </td>
    </tr>
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

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function StatementsPage() {
  const { id } = useParams<{ id: string }>();

  // デフォルト: 前月（当月にはまだデータがないことが多い）
  const now = new Date();
  now.setMonth(now.getMonth() - 1);
  const defaultYear = now.getFullYear();
  const defaultMonth = now.getMonth() + 1;

  const [activeTab, setActiveTab] = useState<StatementTab>("trial_balance");
  const [period, setPeriod] = useState(`${defaultYear}-${String(defaultMonth).padStart(2, "0")}`);

  const [trialData, setTrialData] = useState<TrialBalanceRow[]>([]);
  const [trendData, setTrendData] = useState<MonthlyTrendRow[]>([]);
  const [trendMonthLabels, setTrendMonthLabels] = useState<string[]>([]);
  const [inventoryData, setInventoryData] = useState<InventoryScheduleRow[]>([]);

  // 会計年度の開始月（4月始まり）を算出
  const fiscalYearStart = useMemo(() => {
    const [y, m] = period.split("-").map(Number);
    // 4月始まり: 4月〜3月。1〜3月は前年度
    const fyStartYear = m >= 4 ? y : y - 1;
    return `${fyStartYear}-04-01`;
  }, [period]);

  // 試算表/BS/PL: 会計年度開始〜選択月末の累計
  const startDate = useMemo(() => fiscalYearStart, [fiscalYearStart]);
  const endDate = useMemo(() => {
    const [y, m] = period.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    return `${period}-${String(lastDay).padStart(2, "0")}`;
  }, [period]);

  // 月次推移: 会計年度（4月〜翌3月）
  const fiscalYearEnd = useMemo(() => {
    const [y, m] = period.split("-").map(Number);
    const fyStartYear = m >= 4 ? y : y - 1;
    return `${fyStartYear + 1}-03-31`;
  }, [period]);

  const fetchTrialBalance = useCallback(async () => {
    try {
      const data = await getTrialBalance(id, startDate, endDate);
      setTrialData(data);
    } catch (e) {
      console.error("Trial balance fetch error:", e);
      setTrialData([]);
    }
  }, [id, startDate, endDate]);

  const fetchMonthlyTrend = useCallback(async () => {
    try {
      const { rows, monthLabels } = await getMonthlyTrend(id, fiscalYearStart, fiscalYearEnd);
      setTrendData(rows);
      setTrendMonthLabels(monthLabels);
    } catch (e) {
      console.error("Monthly trend fetch error:", e);
      setTrendData([]);
      setTrendMonthLabels([]);
    }
  }, [id, fiscalYearStart, fiscalYearEnd]);

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
    try {
      const data = await getInventorySchedule(id, fiscalYearStart, endDate);
      setInventoryData(data);
    } catch (e) {
      console.error("Inventory schedule fetch error:", e);
      setInventoryData([]);
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
      {activeTab === "trial_balance" && <TrialBalance data={trialData} />}
      {activeTab === "bs" && <BalanceSheet trialData={trialData} />}
      {activeTab === "pl" && <ProfitAndLoss trialData={trialData} />}
      {activeTab === "monthly_trend" && <MonthlyTrendTable data={trendData} monthLabels={trendMonthLabels} />}
      {activeTab === "inventory" && <InventorySchedule data={inventoryData} />}

      {/* Footer */}
      <div className="mt-4 flex justify-between items-center text-xs text-muted-foreground">
        <span>
          対象期間: {startDate} 〜 {endDate}（会計年度: {fiscalYearStart.slice(0, 4)}年4月〜{Number(fiscalYearStart.slice(0, 4)) + 1}年3月）
        </span>
      </div>
    </>
  );
}
