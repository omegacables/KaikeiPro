"use client";

import { useState, useCallback } from "react";
import { useParams } from "next/navigation";
import {
  Archive,
  CheckCircle,
  Circle,
  Lock,
  Unlock,
  AlertTriangle,
  Calculator,
  FileText,
  Calendar,
  ArrowRight,
  TrendingDown,
  Loader2,
  X,
} from "lucide-react";
import { createJournalEntry } from "@/actions/journals";
import {
  getActiveFiscalYear,
  getClosingEntries,
  getDepreciationSummary,
  updateFiscalYearStatus,
  type ClosingEntry,
  type DepreciationSummary,
} from "@/actions/closing";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency } from "@/lib/utils";
import { useData } from "@/lib/use-data";

type StepStatus = "completed" | "current" | "pending";

const emptyDepreciation: DepreciationSummary = {
  totalAssets: 0,
  totalDepreciation: 0,
  items: [],
};

export default function ClosingPage() {
  const { id } = useParams();
  const clientId = id as string;
  const [showLockWarning, setShowLockWarning] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [savingEntry, setSavingEntry] = useState(false);
  const [locking, setLocking] = useState(false);
  const [newAdjustment, setNewAdjustment] = useState({
    description: "",
    debit_account: "",
    credit_account: "",
    amount: 0,
    type: "未払費用",
  });

  // Fetch active fiscal year
  const { data: fiscalYear, refetch: refetchFY } = useData(
    useCallback(() => getActiveFiscalYear(clientId), [clientId]),
    null
  );

  const isLocked = fiscalYear?.status === "locked";

  // Fetch closing entries
  const { data: adjustmentEntries, refetch: refetchEntries } = useData(
    useCallback(() => {
      if (!fiscalYear) return Promise.resolve([] as ClosingEntry[]);
      return getClosingEntries(clientId, fiscalYear.end_date);
    }, [clientId, fiscalYear]),
    [] as ClosingEntry[]
  );

  // Fetch depreciation summary
  const { data: depreciation } = useData(
    useCallback(() => {
      if (!fiscalYear) return Promise.resolve(emptyDepreciation);
      return getDepreciationSummary(clientId, fiscalYear.end_date);
    }, [clientId, fiscalYear]),
    emptyDepreciation
  );

  // Compute step statuses dynamically
  const steps: { label: string; status: StepStatus; description: string }[] = (() => {
    const hasEntries = adjustmentEntries.length > 0;
    const hasAssets = depreciation.totalAssets > 0;
    const allConfirmed = adjustmentEntries.length > 0 && adjustmentEntries.every((e) => e.status === "confirmed");

    const closingDone = hasEntries;
    const depreciationDone = hasAssets;
    const trialBalanceDone = closingDone && allConfirmed;

    return [
      {
        label: "決算整理仕訳",
        status: closingDone ? "completed" : "current",
        description: "前払費用・未払費用等の計上",
      },
      {
        label: "減価償却計算",
        status: depreciationDone ? "completed" : closingDone ? "current" : "pending",
        description: "固定資産の減価償却費計上",
      },
      {
        label: "試算表確認",
        status: trialBalanceDone ? "completed" : (closingDone && depreciationDone) ? "current" : "pending",
        description: "残高確認・差異チェック",
      },
      {
        label: "年度締め",
        status: isLocked ? "completed" : trialBalanceDone ? "current" : "pending",
        description: "年度のロック・翌期繰越",
      },
    ];
  })();

  const handleAddAdjustment = async () => {
    if (!newAdjustment.description || !newAdjustment.amount || !fiscalYear) return;
    setSavingEntry(true);
    try {
      await createJournalEntry(
        {
          client_id: clientId,
          entry_date: fiscalYear.end_date,
          description: newAdjustment.description,
          status: "draft",
          source: "closing",
          created_by: clientId,
        },
        [
          { account_id: newAdjustment.debit_account || ("" as unknown as string), debit_amount: newAdjustment.amount, credit_amount: 0 },
          { account_id: newAdjustment.credit_account || ("" as unknown as string), debit_amount: 0, credit_amount: newAdjustment.amount },
        ]
      );
      setShowAddForm(false);
      setNewAdjustment({ description: "", debit_account: "", credit_account: "", amount: 0, type: "未払費用" });
      refetchEntries();
    } catch (e) {
      alert(e instanceof Error ? e.message : "仕訳の追加に失敗しました");
    } finally {
      setSavingEntry(false);
    }
  };

  const handleLock = async () => {
    if (!fiscalYear) return;
    setLocking(true);
    try {
      await updateFiscalYearStatus(fiscalYear.id, "locked");
      refetchFY();
    } catch (e) {
      alert(e instanceof Error ? e.message : "年度締めに失敗しました");
    } finally {
      setLocking(false);
      setShowLockWarning(false);
    }
  };

  const handleUnlock = async () => {
    if (!fiscalYear) return;
    setLocking(true);
    try {
      await updateFiscalYearStatus(fiscalYear.id, "open");
      refetchFY();
    } catch (e) {
      alert(e instanceof Error ? e.message : "ロック解除に失敗しました");
    } finally {
      setLocking(false);
    }
  };

  const confirmedEntries = adjustmentEntries.filter(
    (e) => e.status === "confirmed"
  ).length;
  const draftEntries = adjustmentEntries.filter(
    (e) => e.status === "draft"
  ).length;
  const totalAdjustment = adjustmentEntries.reduce(
    (sum, e) => sum + e.amount,
    0
  );

  // Format fiscal year display
  const fiscalYearDisplay = fiscalYear
    ? (() => {
        const start = new Date(fiscalYear.start_date);
        const end = new Date(fiscalYear.end_date);
        const fy = start.getFullYear();
        return {
          name: `${fy}年度`,
          startDate: fiscalYear.start_date.replace(/-/g, "/"),
          endDate: fiscalYear.end_date.replace(/-/g, "/"),
          status: fiscalYear.status,
        };
      })()
    : null;

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">決算処理</h1>
          <p className="text-muted-foreground text-sm mt-1">
            決算整理仕訳・減価償却計算・年度締め処理
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            {isLocked ? (
              <Lock className="size-4 text-destructive" />
            ) : (
              <Unlock className="size-4 text-success" />
            )}
            <span
              className={cn(
                "text-sm font-bold",
                isLocked ? "text-destructive" : "text-success"
              )}
            >
              {isLocked ? "ロック中" : "編集可能"}
            </span>
          </div>
        </div>
      </div>

      {/* Steps display */}
      <Card className="mb-6 p-6">
        <div className="flex items-center justify-between">
          {steps.map((step, idx) => (
            <div key={step.label} className="flex items-center">
              <div className="flex flex-col items-center text-center">
                <div
                  className={cn(
                    "size-10 rounded-full flex items-center justify-center mb-2",
                    step.status === "completed"
                      ? "bg-success/20 text-success"
                      : step.status === "current"
                        ? "bg-primary/20 text-primary"
                        : "bg-muted/30 text-muted-foreground"
                  )}
                >
                  {step.status === "completed" ? (
                    <CheckCircle className="size-5" />
                  ) : step.status === "current" ? (
                    <span className="text-sm font-bold">{idx + 1}</span>
                  ) : (
                    <Circle className="size-5" />
                  )}
                </div>
                <p
                  className={cn(
                    "text-sm font-bold",
                    step.status === "current"
                      ? "text-primary"
                      : step.status === "completed"
                        ? "text-success"
                        : "text-muted-foreground"
                  )}
                >
                  {step.label}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5 max-w-[120px]">
                  {step.description}
                </p>
              </div>
              {idx < steps.length - 1 && (
                <ArrowRight className="size-5 text-muted-foreground mx-4 mt-[-24px]" />
              )}
            </div>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Fiscal year info */}
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <Calendar className="size-4 text-primary" />
            <span className="text-sm font-bold text-foreground">会計年度情報</span>
          </div>
          {fiscalYearDisplay ? (
            <div className="space-y-3">
              <div>
                <p className="text-xs text-muted-foreground">年度</p>
                <p className="text-sm font-bold text-foreground">{fiscalYearDisplay.name}</p>
              </div>
              <div className="flex gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">開始日</p>
                  <p className="text-sm font-medium text-foreground">
                    {fiscalYearDisplay.startDate}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">終了日</p>
                  <p className="text-sm font-medium text-foreground">
                    {fiscalYearDisplay.endDate}
                  </p>
                </div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">ステータス</p>
                <Badge variant={fiscalYearDisplay.status === "open" ? "success" : "muted"}>
                  {fiscalYearDisplay.status === "open" ? "進行中" : fiscalYearDisplay.status === "locked" ? "ロック済" : "締め済"}
                </Badge>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">会計年度が未設定です</p>
          )}
        </Card>

        {/* Depreciation summary */}
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingDown className="size-4 text-warning" />
            <span className="text-sm font-bold text-foreground">減価償却計算</span>
          </div>
          <p className="text-2xl font-bold text-foreground mb-4">
            {formatCurrency(depreciation.totalDepreciation)}
          </p>
          <div className="space-y-2">
            {depreciation.items.map((item) => (
              <div key={item.category} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{item.category}</span>
                <span className="font-mono font-medium text-foreground">
                  {formatCurrency(item.amount)}
                </span>
              </div>
            ))}
            {depreciation.items.length === 0 && (
              <p className="text-sm text-muted-foreground">固定資産データなし</p>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            対象資産: {depreciation.totalAssets}件
          </p>
        </Card>

        {/* Adjustment summary */}
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <FileText className="size-4 text-primary-light" />
            <span className="text-sm font-bold text-foreground">決算整理仕訳</span>
          </div>
          <p className="text-2xl font-bold text-foreground mb-4">
            {adjustmentEntries.length}件
          </p>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">確認済</span>
              <Badge variant="success">{confirmedEntries}件</Badge>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">下書き</span>
              <Badge variant="warning">{draftEntries}件</Badge>
            </div>
            <div className="flex items-center justify-between text-sm border-t border-border pt-2 mt-2">
              <span className="text-muted-foreground">合計金額</span>
              <span className="font-mono font-bold text-foreground">
                {formatCurrency(totalAdjustment)}
              </span>
            </div>
          </div>
        </Card>
      </div>

      {/* Adjustment entries table */}
      <Card className="mb-6 overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>決算整理仕訳一覧</CardTitle>
          <Button size="sm" onClick={() => setShowAddForm((v) => !v)} disabled={isLocked}>
            <Calculator className="size-4" />
            仕訳追加
          </Button>
        </CardHeader>
        <CardContent>
          {showAddForm && (
            <div className="mb-4 p-4 rounded-lg border border-primary/30 bg-primary/5">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-bold text-foreground">決算整理仕訳追加</h4>
                <button onClick={() => setShowAddForm(false)} className="text-muted-foreground hover:text-foreground">
                  <X className="size-4" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-4 mb-3">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">摘要</label>
                  <input
                    type="text"
                    value={newAdjustment.description}
                    onChange={(e) => setNewAdjustment({ ...newAdjustment, description: e.target.value })}
                    placeholder="例: 未払電気代の計上"
                    className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">種別</label>
                  <select
                    value={newAdjustment.type}
                    onChange={(e) => setNewAdjustment({ ...newAdjustment, type: e.target.value })}
                    className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="前払費用">前払費用</option>
                    <option value="未払費用">未払費用</option>
                    <option value="引当金">引当金</option>
                    <option value="前受収益">前受収益</option>
                    <option value="棚卸">棚卸</option>
                    <option value="その他">その他</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">借方科目</label>
                  <input
                    type="text"
                    value={newAdjustment.debit_account}
                    onChange={(e) => setNewAdjustment({ ...newAdjustment, debit_account: e.target.value })}
                    placeholder="例: 水道光熱費"
                    className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">貸方科目</label>
                  <input
                    type="text"
                    value={newAdjustment.credit_account}
                    onChange={(e) => setNewAdjustment({ ...newAdjustment, credit_account: e.target.value })}
                    placeholder="例: 未払費用"
                    className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div className="mb-3">
                <label className="block text-sm font-medium text-foreground mb-1">金額</label>
                <input
                  type="number"
                  value={newAdjustment.amount || ""}
                  onChange={(e) => setNewAdjustment({ ...newAdjustment, amount: Number(e.target.value) || 0 })}
                  placeholder="0"
                  className="w-48 bg-card border border-border rounded-lg px-3 py-2 text-sm font-mono"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={() => setShowAddForm(false)}>キャンセル</Button>
                <Button size="sm" onClick={handleAddAdjustment} disabled={savingEntry || !newAdjustment.description || !newAdjustment.amount}>
                  {savingEntry && <Loader2 className="size-4 animate-spin" />}
                  追加
                </Button>
              </div>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/20 border-b border-border">
                  <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground">
                    日付
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground">
                    摘要
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground">
                    種別
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground">
                    借方
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground">
                    貸方
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-bold text-muted-foreground">
                    金額
                  </th>
                  <th className="text-center px-4 py-3 text-xs font-bold text-muted-foreground">
                    ステータス
                  </th>
                </tr>
              </thead>
              <tbody>
                {adjustmentEntries.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                      決算整理仕訳がありません
                    </td>
                  </tr>
                )}
                {adjustmentEntries.map((entry) => (
                  <tr
                    key={entry.id}
                    className="border-b border-border last:border-0 hover:bg-muted/10"
                  >
                    <td className="px-4 py-3 text-muted-foreground">{entry.date}</td>
                    <td className="px-4 py-3 font-medium text-foreground">
                      {entry.description}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="muted">{entry.type}</Badge>
                    </td>
                    <td className="px-4 py-3 text-foreground">{entry.debit}</td>
                    <td className="px-4 py-3 text-foreground">{entry.credit}</td>
                    <td className="px-4 py-3 text-right font-mono font-bold">
                      {formatCurrency(entry.amount)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge
                        variant={
                          entry.status === "confirmed" ? "success" : "warning"
                        }
                      >
                        {entry.status === "confirmed" ? "確認済" : "下書き"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Year-end lock section */}
      <Card className="p-6 border-warning/30">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
              <Archive className="size-5 text-warning" />
              年度締め処理
            </h3>
            <p className="text-sm text-muted-foreground mt-2">
              年度を締めるとデータがロックされ、仕訳の追加・編集ができなくなります。
              締め処理を行う前に、すべての決算整理仕訳が確認済みであることを確認してください。
            </p>
            {draftEntries > 0 && (
              <div className="flex items-center gap-2 mt-3 p-3 rounded-lg bg-warning/10">
                <AlertTriangle className="size-4 text-warning" />
                <span className="text-sm text-warning font-medium">
                  未確認の決算整理仕訳が{draftEntries}件あります。締め処理前に確認してください。
                </span>
              </div>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            {!showLockWarning ? (
              <Button
                variant={isLocked ? "outline" : "destructive"}
                disabled={locking}
                onClick={() => {
                  if (isLocked) {
                    handleUnlock();
                  } else {
                    setShowLockWarning(true);
                  }
                }}
              >
                {locking && <Loader2 className="size-4 animate-spin" />}
                {isLocked ? (
                  <>
                    <Unlock className="size-4" />
                    ロック解除
                  </>
                ) : (
                  <>
                    <Lock className="size-4" />
                    年度締め実行
                  </>
                )}
              </Button>
            ) : (
              <div className="flex flex-col items-end gap-2">
                <p className="text-xs text-destructive font-bold">
                  本当に年度を締めますか？
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowLockWarning(false)}
                  >
                    キャンセル
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={locking}
                    onClick={handleLock}
                  >
                    {locking && <Loader2 className="size-4 animate-spin" />}
                    確定する
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </Card>
    </>
  );
}
