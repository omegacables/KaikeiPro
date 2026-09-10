"use client";

import { useState, useEffect, useCallback, use, useMemo } from "react";
import {
  ListChecks,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Circle,
  Info,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  getClosingChecklist,
  type ClosingChecklist,
  type ChecklistStatus,
} from "@/actions/closing-checklist";
import { getClient } from "@/actions/clients";
import { fiscalRangeFromStartYear, currentFiscalStartYear } from "@/lib/fiscal";

const statusMeta: Record<
  ChecklistStatus,
  { label: string; icon: typeof CheckCircle2; cls: string }
> = {
  ok: { label: "OK", icon: CheckCircle2, cls: "text-success" },
  warning: { label: "注意", icon: AlertTriangle, cls: "text-warning" },
  todo: { label: "要対応", icon: Circle, cls: "text-destructive" },
  info: { label: "確認", icon: Info, cls: "text-muted-foreground" },
};

export default function ClosingChecklistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [startMonth, setStartMonth] = useState(4);
  const [startYear, setStartYear] = useState<number>(() => new Date().getFullYear());
  const [result, setResult] = useState<ClosingChecklist | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await getClosingChecklist(id, startDate, endDate);
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "チェックに失敗しました");
    } finally {
      setLoading(false);
    }
  }, [id, startDate, endDate]);

  useEffect(() => {
    run();
  }, [run]);

  const yearOptions: number[] = [];
  const baseYear = currentFiscalStartYear(startMonth);
  for (let y = baseYear + 1; y >= baseYear - 5; y--) yearOptions.push(y);

  const counts = useMemo(() => {
    const c = { ok: 0, warning: 0, todo: 0, info: 0 };
    for (const it of result?.items ?? []) c[it.status] += 1;
    return c;
  }, [result]);

  return (
    <div className="space-y-6">
      {/* ヘッダー */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ListChecks className="size-6 text-primary" />
          <h1 className="text-xl font-bold">決算前チェックリスト</h1>
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
          <Button onClick={run} disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : <ListChecks className="size-4" />}
            再チェック
          </Button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        決算前に確認すべき項目（未払費用・減価償却・棚卸・役員借入金・期首残高）を自動判定します。
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
            <p className="text-xs text-destructive">要対応</p>
            <p className="text-xl font-bold tabular-nums">{counts.todo}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <p className="text-xs text-warning">注意</p>
            <p className="text-xl font-bold tabular-nums">{counts.warning}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <p className="text-xs text-muted-foreground">確認</p>
            <p className="text-xl font-bold tabular-nums">{counts.info}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3">
            <p className="text-xs text-success">OK</p>
            <p className="text-xl font-bold tabular-nums">{counts.ok}</p>
          </CardContent>
        </Card>
      </div>

      {/* チェック項目 */}
      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="size-5 animate-spin mr-2" />
              チェック中...
            </div>
          ) : (
            <div className="space-y-2">
              {(result?.items ?? []).map((it) => {
                const meta = statusMeta[it.status];
                const Icon = meta.icon;
                return (
                  <div
                    key={it.key}
                    className="flex items-start gap-3 rounded-lg border border-border px-4 py-3"
                  >
                    <Icon className={"size-5 shrink-0 mt-0.5 " + meta.cls} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{it.label}</span>
                        <span className={"text-xs font-bold " + meta.cls}>{meta.label}</span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-0.5">{it.detail}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        ※ 自動判定は仕訳・固定資産・借入金台帳のデータに基づく目安です。最終確認は担当税理士が行ってください。
      </p>
    </div>
  );
}
