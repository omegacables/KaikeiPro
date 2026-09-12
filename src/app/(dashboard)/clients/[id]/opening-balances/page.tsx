"use client";

import { useState, useEffect, useCallback, use, useMemo } from "react";
import { Scale, Loader2, Save, AlertTriangle, RefreshCw } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { AmountInput } from "@/components/ui/amount-input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  getOpeningBalances,
  saveOpeningBalances,
  carryForwardOpeningBalances,
  type OpeningBalanceRow,
  type BsCategory,
} from "@/actions/opening-balances";
import { getClient } from "@/actions/clients";
import { fiscalRangeFromStartYear, currentFiscalStartYear } from "@/lib/fiscal";
import { formatCurrency } from "@/lib/utils";

const num = (s: string) => Math.round(Number(s) || 0);

const inputCls =
  "w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/40";

const categoryLabel: Record<BsCategory, string> = {
  asset: "資産",
  liability: "負債",
  equity: "純資産",
};
const categoryOrder: BsCategory[] = ["asset", "liability", "equity"];

export default function OpeningBalancesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [startMonth, setStartMonth] = useState(4);
  const [startYear, setStartYear] = useState<number>(
    () => new Date().getFullYear()
  );
  const [rows, setRows] = useState<OpeningBalanceRow[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [carrying, setCarrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // クライアントの期首月を取得して開始年の初期値を決める
  useEffect(() => {
    getClient(id)
      .then((c) => {
        const sm = c.fiscal_year_start_month ?? 4;
        setStartMonth(sm);
        setStartYear(currentFiscalStartYear(sm));
      })
      .catch(() => {});
  }, [id]);

  const fiscalYearStart = useMemo(
    () => fiscalRangeFromStartYear(startMonth, startYear).startDate,
    [startMonth, startYear]
  );

  const fetchData = useCallback(async () => {
    setLoading(true);
    setSuccess(null);
    try {
      const data = await getOpeningBalances(id, fiscalYearStart);
      setRows(data);
      const v: Record<string, string> = {};
      for (const r of data) {
        v[r.account_id] = r.balance !== 0 ? String(r.balance) : "";
      }
      setValues(v);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }, [id, fiscalYearStart]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 借方・貸方合計
  const { debitTotal, creditTotal } = useMemo(() => {
    let d = 0;
    let c = 0;
    for (const r of rows) {
      const v = num(values[r.account_id] ?? "");
      if (v === 0) continue;
      if (r.category === "asset") {
        if (v >= 0) d += v;
        else c += -v;
      } else {
        if (v >= 0) c += v;
        else d += -v;
      }
    }
    return { debitTotal: d, creditTotal: c };
  }, [rows, values]);

  const diff = debitTotal - creditTotal;
  const balanced = diff === 0;

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const items = rows.map((r) => ({
        account_id: r.account_id,
        category: r.category,
        balance: num(values[r.account_id] ?? ""),
      }));
      await saveOpeningBalances(id, fiscalYearStart, items);
      setSuccess(`${fiscalYearStart} 時点の期首残高を保存しました。`);
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  async function handleCarryForward() {
    if (
      !confirm(
        "前年度の決算残高から期首残高を自動作成します。\n前期のP/L純損益は繰越利益剰余金に振り替えられ、既存の期首残高は上書きされます。よろしいですか？"
      )
    )
      return;
    setCarrying(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await carryForwardOpeningBalances(id, fiscalYearStart);
      const profitLabel =
        res.netIncome === 0
          ? "純損益なし"
          : `前期${res.netIncome > 0 ? "利益" : "損失"} ${formatCurrency(
              Math.abs(res.netIncome)
            )}`;
      const reLabel = res.retainedAccountName
        ? `（${res.retainedAccountName}へ振替）`
        : "";
      setSuccess(
        `前年度（${res.priorStart}〜${res.priorEnd}）から ${res.carriedCount} 科目を自動繰越しました。${profitLabel}${reLabel}`
      );
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "自動繰越に失敗しました");
    } finally {
      setCarrying(false);
    }
  }

  // 年の選択肢（前後5年）
  const yearOptions: number[] = [];
  const baseYear = currentFiscalStartYear(startMonth);
  for (let y = baseYear + 1; y >= baseYear - 5; y--) yearOptions.push(y);

  const grouped = categoryOrder.map((cat) => ({
    cat,
    rows: rows.filter((r) => r.category === cat),
  }));

  return (
    <div className="space-y-6">
      {/* ヘッダー */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Scale className="size-6 text-primary" />
          <h1 className="text-xl font-bold">期首残高設定</h1>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={startYear}
            onChange={(e) => setStartYear(Number(e.target.value))}
            className="px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            {yearOptions.map((y) => {
              const { startDate, endDate } = fiscalRangeFromStartYear(startMonth, y);
              return (
                <option key={y} value={y}>
                  {startDate} 〜 {endDate} 期
                </option>
              );
            })}
          </select>
          <Button
            variant="outline"
            onClick={handleCarryForward}
            disabled={carrying || saving || loading}
            title="前年度の決算残高から期首残高を自動生成します"
          >
            {carrying ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            前期から自動繰越
          </Button>
          <Button onClick={handleSave} disabled={saving || carrying || loading || !balanced}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            保存
          </Button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        前年度のデータがある場合は「前期から自動繰越」で前期末残高を自動取込できます（前期純損益は繰越利益剰余金へ振替）。
        初年度など手動の場合は前期決算書（貸借対照表）の各科目残高を入力してください。保存すると
        <span className="font-medium text-foreground"> {fiscalYearStart} </span>
        付の「期首残高（前期繰越）」仕訳を作成し、試算表・帳簿の前期繰越に反映されます。
      </p>

      {error && (
        <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
          {error}
        </div>
      )}
      {success && (
        <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-sm text-success">
          {success}
        </div>
      )}

      {/* 借方・貸方バランス */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground">借方合計（資産）</p>
            <p className="text-lg font-bold tabular-nums">{formatCurrency(debitTotal)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground">貸方合計（負債・純資産）</p>
            <p className="text-lg font-bold tabular-nums">{formatCurrency(creditTotal)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground">貸借差額</p>
            <p
              className={
                "text-lg font-bold tabular-nums " +
                (balanced ? "text-success" : "text-destructive")
              }
            >
              {balanced ? "一致" : formatCurrency(Math.abs(diff))}
            </p>
          </CardContent>
        </Card>
      </div>

      {!balanced && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm text-warning">
          <AlertTriangle className="size-4 shrink-0" />
          貸借が一致していません。差額 {formatCurrency(Math.abs(diff))} を利益剰余金等で調整すると保存できます。
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="size-5 animate-spin mr-2" />
          読み込み中...
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          {grouped.map(({ cat, rows: catRows }) => (
            <Card key={cat}>
              <CardHeader className="flex-row items-center justify-between gap-2">
                <CardTitle className="text-base">{categoryLabel[cat]}</CardTitle>
                <Badge variant={cat === "asset" ? "muted" : "default"}>
                  {cat === "asset" ? "借方" : "貸方"}
                </Badge>
              </CardHeader>
              <CardContent>
                {catRows.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">該当科目がありません。</p>
                ) : (
                  <div className="space-y-2">
                    {catRows.map((r) => (
                      <div key={r.account_id} className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground w-12 shrink-0 tabular-nums">
                          {r.code}
                        </span>
                        <span className="text-sm flex-1 truncate" title={r.name}>
                          {r.name}
                        </span>
                        <AmountInput
                          value={values[r.account_id] ?? ""}
                          onChange={(v) =>
                            setValues((prev) => ({
                              ...prev,
                              [r.account_id]: v,
                            }))
                          }
                          className={inputCls + " w-32"}
                          placeholder="0"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
