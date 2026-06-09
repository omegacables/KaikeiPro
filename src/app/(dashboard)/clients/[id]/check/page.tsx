"use client";

import { useState, useEffect, useCallback, use, useMemo } from "react";
import {
  ShieldAlert,
  Loader2,
  AlertTriangle,
  AlertCircle,
  Info,
  ScanSearch,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  getJournalChecks,
  type CheckResult,
  type CheckSeverity,
  type CheckRuleKey,
} from "@/actions/journal-check";
import { getClient } from "@/actions/clients";
import { fiscalRangeFromStartYear, currentFiscalStartYear } from "@/lib/fiscal";
import { formatCurrency } from "@/lib/utils";

const sevMeta: Record<
  CheckSeverity,
  { label: string; variant: "destructive" | "warning" | "muted"; icon: typeof AlertTriangle }
> = {
  high: { label: "重要", variant: "destructive", icon: AlertTriangle },
  warning: { label: "注意", variant: "warning", icon: AlertCircle },
  info: { label: "情報", variant: "muted", icon: Info },
};

const ruleKeys: { key: CheckRuleKey; label: string }[] = [
  { key: "tax_category", label: "税区分" },
  { key: "officer_loan", label: "役員貸付金" },
  { key: "entertainment", label: "交際費" },
  { key: "supplies", label: "消耗品費" },
];

export default function CheckPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [startMonth, setStartMonth] = useState(4);
  const [startYear, setStartYear] = useState<number>(() => new Date().getFullYear());
  const [result, setResult] = useState<CheckResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ruleFilter, setRuleFilter] = useState<CheckRuleKey | "all">("all");

  useEffect(() => {
    getClient(id)
      .then((c) => {
        const sm = c.fiscal_year_start_month ?? 4;
        setStartMonth(sm);
        setStartYear(currentFiscalStartYear(sm));
      })
      .catch(() => {});
  }, [id]);

  const { startDate, endDate } = useMemo(
    () => fiscalRangeFromStartYear(startMonth, startYear),
    [startMonth, startYear]
  );

  const runCheck = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await getJournalChecks(id, startDate, endDate);
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "チェックに失敗しました");
    } finally {
      setLoading(false);
    }
  }, [id, startDate, endDate]);

  useEffect(() => {
    runCheck();
  }, [runCheck]);

  const yearOptions: number[] = [];
  const baseYear = currentFiscalStartYear(startMonth);
  for (let y = baseYear + 1; y >= baseYear - 5; y--) yearOptions.push(y);

  const filtered = (result?.findings ?? []).filter(
    (f) => ruleFilter === "all" || f.ruleKey === ruleFilter
  );

  return (
    <div className="space-y-6">
      {/* ヘッダー */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldAlert className="size-6 text-primary" />
          <h1 className="text-xl font-bold">AI仕訳チェック</h1>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={startYear}
            onChange={(e) => setStartYear(Number(e.target.value))}
            className="px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            {yearOptions.map((y) => {
              const r = fiscalRangeFromStartYear(startMonth, y);
              return (
                <option key={y} value={y}>
                  {r.startDate} 〜 {r.endDate} 期
                </option>
              );
            })}
          </select>
          <Button onClick={runCheck} disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : <ScanSearch className="size-4" />}
            再チェック
          </Button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        作成済みの仕訳を走査し、税区分ミス・役員貸付金・交際費・消耗品費の異常値や注意点を検出します。
      </p>

      {error && (
        <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* サマリー */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="py-3">
            <p className="text-xs text-muted-foreground">検出件数</p>
            <p className="text-xl font-bold tabular-nums">{result?.counts.total ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <p className="text-xs text-destructive">重要</p>
            <p className="text-xl font-bold tabular-nums">{result?.counts.high ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <p className="text-xs text-amber-600 dark:text-amber-400">注意</p>
            <p className="text-xl font-bold tabular-nums">{result?.counts.warning ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <p className="text-xs text-muted-foreground">走査した仕訳</p>
            <p className="text-xl font-bold tabular-nums">{result?.scanned ?? 0}</p>
          </CardContent>
        </Card>
      </div>

      {/* ルールフィルタ */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setRuleFilter("all")}
          className={
            "px-3 py-1.5 rounded-lg text-sm border transition-colors " +
            (ruleFilter === "all"
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:bg-muted/30")
          }
        >
          すべて
        </button>
        {ruleKeys.map((r) => {
          const cnt = (result?.findings ?? []).filter((f) => f.ruleKey === r.key).length;
          return (
            <button
              key={r.key}
              onClick={() => setRuleFilter(r.key)}
              className={
                "px-3 py-1.5 rounded-lg text-sm border transition-colors " +
                (ruleFilter === r.key
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-muted/30")
              }
            >
              {r.label}（{cnt}）
            </button>
          );
        })}
      </div>

      {/* 検出結果 */}
      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="size-5 animate-spin mr-2" />
              チェック中...
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              該当する指摘はありません。{result && result.scanned === 0 && "（対象期間に仕訳がありません）"}
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((f) => {
                const meta = sevMeta[f.severity];
                const Icon = meta.icon;
                return (
                  <div
                    key={f.key}
                    className="flex items-start gap-3 rounded-lg border border-border px-3 py-2.5"
                  >
                    <Icon
                      className={
                        "size-5 shrink-0 mt-0.5 " +
                        (f.severity === "high"
                          ? "text-destructive"
                          : f.severity === "warning"
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-muted-foreground")
                      }
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={meta.variant}>{meta.label}</Badge>
                        <span className="text-xs font-medium text-primary">{f.ruleLabel}</span>
                        {f.date && (
                          <span className="text-xs text-muted-foreground">{f.date}</span>
                        )}
                        <span className="text-xs text-muted-foreground truncate">
                          {f.accountName}
                          {f.amount > 0 && ` ・ ${formatCurrency(f.amount)}`}
                        </span>
                      </div>
                      <p className="text-sm mt-1">{f.message}</p>
                      {f.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          摘要: {f.description}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        ※ 本チェックはルールベースの自動検出です。最終的な税務判断は担当税理士が行ってください。
      </p>
    </div>
  );
}
