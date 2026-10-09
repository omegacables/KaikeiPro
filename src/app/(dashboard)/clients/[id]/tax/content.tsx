"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useParams } from "next/navigation";
import {
  Percent,
  TrendingUp,
  TrendingDown,
  Calculator,
  Info,
  ChevronDown,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency } from "@/lib/utils";
import { printPage } from "@/lib/export";
import { useData } from "@/lib/use-data";
import { getTaxSummary, type TaxSummary } from "@/actions/tax";
import { getClient, updateClient } from "@/actions/clients";
import { currentFiscalStartYear, fiscalRangeFromStartYear } from "@/lib/fiscal";

type TaxMethod = "standard" | "simplified";

// Legal constants — not mock data
const simplifiedRates = [
  { type: "第1種", label: "卸売業", rate: 90 },
  { type: "第2種", label: "小売業等", rate: 80 },
  { type: "第3種", label: "製造業等", rate: 70 },
  { type: "第4種", label: "その他", rate: 60 },
  { type: "第5種", label: "サービス業等", rate: 50 },
  { type: "第6種", label: "不動産業", rate: 40 },
];

// 免税事業者等からの仕入れに係る経過措置。
// 令和8年度改正で期限が2年延長され4段階になった（改正前は 80%→50% の2段階）。
// 割合そのものは src/lib/constants.ts の getInvoiceTransitionRate が唯一の正で、
// ここは表示用。期間の区切りは同じものを使う。
const invoiceTransition = [
  { period: "2023/10 〜 2026/9", start: "2023-10-01", end: "2026-09-30", rate: 80 },
  { period: "2026/10 〜 2028/9", start: "2026-10-01", end: "2028-09-30", rate: 70 },
  { period: "2028/10 〜 2030/9", start: "2028-10-01", end: "2030-09-30", rate: 50 },
  { period: "2030/10 〜 2031/9", start: "2030-10-01", end: "2031-09-30", rate: 30 },
  { period: "2031/10 〜", start: "2031-10-01", end: null, rate: 0 },
];

const emptyTaxSummary: TaxSummary = {
  sales10: 0, sales10Tax: 0,
  sales8: 0, sales8Tax: 0,
  purchase10: 0, purchase10Tax: 0,
  purchase8: 0, purchase8Tax: 0,
  salesExempt: 0, salesTaxFree: 0, salesOutOfScope: 0,
  transitionNotDeductible: 0, badDebtTax: 0, uncategorizedLines: 0,
};

export function TaxPageContent({ hideHeader = false }: { hideHeader?: boolean }) {
  const { id } = useParams();
  const clientId = id as string;
  const [selectedPeriodIdx, setSelectedPeriodIdx] = useState(0);
  const [taxMethod, setTaxMethod] = useState<TaxMethod>("standard");
  // 消費税の納税義務（課税事業者・免税事業者）
  const [taxStatus, setTaxStatus] = useState<"taxable" | "exempt">("taxable");
  const [savingSetting, setSavingSetting] = useState(false);

  // クライアントの決算月（期首月）と消費税の設定を取得。
  // 会計年度は他画面（試算表・決算書等）と同じく clients.fiscal_year_start_month を基準にする。
  const { data: client } = useData<{
    fiscal_year_start_month?: number;
    tax_method?: TaxMethod;
    consumption_tax_status?: "taxable" | "exempt";
  } | null>(
    useCallback(() => getClient(clientId) as Promise<{ fiscal_year_start_month?: number }>, [clientId]),
    null
  );
  const fiscalStartMonth = client ? client.fiscal_year_start_month ?? 4 : null;
  useEffect(() => {
    if (!client) return;
    setTaxMethod(client.tax_method ?? "standard");
    setTaxStatus(client.consumption_tax_status ?? "taxable");
  }, [client]);

  // 設定は顧問先ごとに保存する（画面を開き直しても同じ計算方法で出す）
  const saveSetting = async (patch: { tax_method?: TaxMethod; consumption_tax_status?: "taxable" | "exempt" }) => {
    setSavingSetting(true);
    try {
      await updateClient(clientId, patch);
    } catch (e) {
      alert(e instanceof Error ? e.message : "設定の保存に失敗しました");
    } finally {
      setSavingSetting(false);
    }
  };
  const isExempt = taxStatus === "exempt";

  // Build period options（当期から過去5年度分）
  const periods = useMemo(() => {
    if (fiscalStartMonth === null) return [];
    const currentYear = currentFiscalStartYear(fiscalStartMonth);
    return Array.from({ length: 5 }, (_, i) => {
      const y = currentYear - i;
      const { startDate, endDate } = fiscalRangeFromStartYear(fiscalStartMonth, y);
      const sm = Number(startDate.slice(5, 7));
      const em = Number(endDate.slice(5, 7));
      return {
        value: String(y),
        label: `${y}年度 通期 (${sm}月〜${em}月)`,
        startDate,
        endDate,
      };
    });
  }, [fiscalStartMonth]);

  const selectedPeriod = periods[selectedPeriodIdx] ?? null;

  // Fetch tax summary for selected period
  const { data: taxSummary } = useData(
    useCallback(() => {
      if (!selectedPeriod) return Promise.resolve(emptyTaxSummary);
      return getTaxSummary(clientId, selectedPeriod.startDate, selectedPeriod.endDate);
    }, [clientId, selectedPeriod]),
    emptyTaxSummary,
    [selectedPeriod]
  );

  const totalSalesTax = taxSummary.sales10Tax + taxSummary.sales8Tax;
  const totalPurchaseTax = taxSummary.purchase10Tax + taxSummary.purchase8Tax;
  // 貸倒れに係る税額は売上の消費税から控除する（消費税法39条）
  const taxPayable = totalSalesTax - totalPurchaseTax - taxSummary.badDebtTax;

  // Simplified tax: no per-category sales data from DB yet, so amounts default to 0
  const simplifiedCategories = simplifiedRates.map((r) => ({ ...r, amount: 0 }));
  const simplifiedTotal = simplifiedCategories.reduce((sum, c) => sum + c.amount, 0);
  const simplifiedDeemPurchase = simplifiedCategories.reduce(
    (sum, c) => sum + Math.floor((c.amount * c.rate) / 100),
    0
  );
  const simplifiedTax = simplifiedTotal > 0
    ? Math.floor(totalSalesTax - (totalSalesTax * simplifiedDeemPurchase) / simplifiedTotal)
    : 0;

  // 仕入税額の方が多いときは還付。マイナス表記は使わず「還付」と書く
  const shownPayable = taxMethod === "standard" ? taxPayable : simplifiedTax;

  const salesCategories = [
    { label: "課税売上", total: taxSummary.sales10 + taxSummary.sales8 },
    { label: "非課税売上", total: taxSummary.salesExempt },
    { label: "免税売上", total: taxSummary.salesTaxFree },
    { label: "不課税", total: taxSummary.salesOutOfScope },
  ];

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        {!hideHeader ? (
          <div>
            <h1 className="text-2xl font-bold text-foreground">消費税計算</h1>
            <p className="text-muted-foreground text-sm mt-1">
              消費税の税率別集計と納付税額の計算
            </p>
          </div>
        ) : <div />}
        <Button variant="outline" onClick={() => printPage()}>
          <Calculator className="size-4" />
          申告書出力
        </Button>
      </div>

      {/* Period selector */}
      <Card className="mb-6 p-4">
        <div className="flex items-center gap-4">
          <label className="text-sm font-bold text-foreground">対象期間:</label>
          <div className="relative">
            <select
              value={selectedPeriodIdx}
              onChange={(e) => setSelectedPeriodIdx(Number(e.target.value))}
              className="appearance-none pl-3 pr-8 py-2 rounded-lg border border-border bg-card text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              {periods.length === 0 && (
                <option value={0}>読み込み中...</option>
              )}
              {periods.map((p, i) => (
                <option key={p.value} value={i}>
                  {p.label}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
          </div>
        </div>
      </Card>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="size-4 text-success" />
            <span className="text-sm text-muted-foreground">課税売上合計（税抜）</span>
          </div>
          <p className="text-2xl font-bold text-foreground">
            {formatCurrency(taxSummary.sales10 + taxSummary.sales8)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            消費税額: {formatCurrency(totalSalesTax)}
          </p>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-2">
            <TrendingDown className="size-4 text-primary-light" />
            <span className="text-sm text-muted-foreground">課税仕入合計（税抜）</span>
          </div>
          <p className="text-2xl font-bold text-foreground">
            {formatCurrency(taxSummary.purchase10 + taxSummary.purchase8)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            消費税額: {formatCurrency(totalPurchaseTax)}
          </p>
        </Card>
        <Card className="p-5 border-primary/30">
          <div className="flex items-center gap-2 mb-2">
            <Percent className="size-4 text-primary" />
            <span className="text-sm text-muted-foreground">
              {isExempt
                ? "納付税額"
                : `${shownPayable < 0 ? "還付税額" : "納付税額"}（${taxMethod === "standard" ? "本則" : "簡易"}）`}
            </span>
          </div>
          <p className="text-2xl font-bold text-primary">
            {isExempt ? "なし（免税事業者）" : formatCurrency(Math.abs(shownPayable))}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {isExempt ? "申告・納付は不要です" : "売上税額 − 仕入税額控除 − 貸倒れに係る税額"}
          </p>
        </Card>
      </div>

      {/* 消費税の設定（顧問先ごとに保存） */}
      <Card className="mb-6 p-4">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-3">
            <span className="text-sm font-bold text-foreground">納税義務</span>
            <div className="flex gap-1 bg-muted/20 p-1 rounded-lg">
              {([
                ["taxable", "課税事業者"],
                ["exempt", "免税事業者"],
              ] as const).map(([k, label]) => (
                <button
                  key={k}
                  disabled={savingSetting}
                  onClick={() => {
                    setTaxStatus(k);
                    saveSetting({ consumption_tax_status: k });
                  }}
                  className={cn(
                    "px-4 py-2 rounded-md text-sm font-bold transition-all",
                    taxStatus === k ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {!isExempt && (
            <div className="flex items-center gap-3">
              <span className="text-sm font-bold text-foreground">計算方法</span>
              <div className="flex gap-1 bg-muted/20 p-1 rounded-lg">
                {([
                  ["standard", "本則課税"],
                  ["simplified", "簡易課税"],
                ] as const).map(([k, label]) => (
                  <button
                    key={k}
                    disabled={savingSetting}
                    onClick={() => {
                      setTaxMethod(k);
                      saveSetting({ tax_method: k });
                    }}
                    className={cn(
                      "px-4 py-2 rounded-md text-sm font-bold transition-all",
                      taxMethod === k ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          免税事業者は、基準期間（前々事業年度）の課税売上高が1,000万円以下などで、インボイス発行事業者の登録をしていない事業者です。
          免税事業者は消費税の申告・納付がありません。設定は顧問先ごとに保存されます。
        </p>
      </Card>

      {isExempt && (
        <div className="mb-6 rounded-lg border border-info/30 bg-info/10 px-4 py-3 text-sm text-info">
          この顧問先は<strong>免税事業者</strong>に設定されています。消費税の申告・納付はありません。
          下の集計は、課税事業者になるかどうか（基準期間の課税売上高）を確かめるための参考です。
        </div>
      )}

      {taxMethod === "standard" ? (
        <>
          {/* Tax rate breakdown */}
          <Card className="mb-6 overflow-hidden">
            <CardHeader>
              <CardTitle>税率別内訳</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/20 border-b border-border">
                      <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground">
                        区分
                      </th>
                      <th className="text-right px-4 py-3 text-xs font-bold text-muted-foreground">
                        税率10% 税抜金額
                      </th>
                      <th className="text-right px-4 py-3 text-xs font-bold text-muted-foreground">
                        税率10% 消費税額
                      </th>
                      <th className="text-right px-4 py-3 text-xs font-bold text-muted-foreground">
                        税率8% 税抜金額
                      </th>
                      <th className="text-right px-4 py-3 text-xs font-bold text-muted-foreground">
                        税率8% 消費税額
                      </th>
                      <th className="text-right px-4 py-3 text-xs font-bold text-muted-foreground">
                        合計消費税額
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-border hover:bg-muted/10">
                      <td className="px-4 py-3 font-medium text-foreground">
                        課税売上
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {formatCurrency(taxSummary.sales10)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-success">
                        {formatCurrency(taxSummary.sales10Tax)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {formatCurrency(taxSummary.sales8)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-success">
                        {formatCurrency(taxSummary.sales8Tax)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold">
                        {formatCurrency(totalSalesTax)}
                      </td>
                    </tr>
                    <tr className="border-b border-border hover:bg-muted/10">
                      <td className="px-4 py-3 font-medium text-foreground">
                        課税仕入
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {formatCurrency(taxSummary.purchase10)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-destructive">
                        {formatCurrency(taxSummary.purchase10Tax)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">
                        {formatCurrency(taxSummary.purchase8)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-destructive">
                        {formatCurrency(taxSummary.purchase8Tax)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold">
                        {formatCurrency(totalPurchaseTax)}
                      </td>
                    </tr>
                    {taxSummary.badDebtTax !== 0 && (
                      <tr className="border-b border-border hover:bg-muted/10">
                        <td className="px-4 py-3 font-medium text-foreground">貸倒れに係る税額（控除）</td>
                        <td className="px-4 py-3" colSpan={4}></td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-destructive">
                          {formatCurrency(taxSummary.badDebtTax)}
                        </td>
                      </tr>
                    )}
                    <tr className="bg-muted/10">
                      <td className="px-4 py-3 font-bold text-foreground">
                        {taxPayable < 0 ? "差引還付税額" : "差引納付税額"}
                      </td>
                      <td className="px-4 py-3" colSpan={4}></td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-primary text-lg">
                        {formatCurrency(Math.abs(taxPayable))}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Sales categories */}
          <Card className="mb-6 overflow-hidden">
            <CardHeader>
              <CardTitle>売上区分別集計</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/20 border-b border-border">
                      <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground">
                        区分
                      </th>
                      <th className="text-right px-4 py-3 text-xs font-bold text-muted-foreground">
                        合計金額（税抜）
                      </th>
                      <th className="text-right px-4 py-3 text-xs font-bold text-muted-foreground">
                        構成比
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {salesCategories.map((cat) => {
                      const totalAll = salesCategories.reduce(
                        (s, c) => s + c.total,
                        0
                      );
                      const ratio = totalAll > 0 ? ((cat.total / totalAll) * 100).toFixed(1) : "0.0";
                      return (
                        <tr
                          key={cat.label}
                          className="border-b border-border hover:bg-muted/10"
                        >
                          <td className="px-4 py-3 font-medium text-foreground">
                            {cat.label}
                          </td>
                          <td className="px-4 py-3 text-right font-mono">
                            {formatCurrency(cat.total)}
                          </td>
                          <td className="px-4 py-3 text-right text-muted-foreground">
                            {ratio}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <>
          {/* Simplified tax calculation */}
          <Card className="mb-6 overflow-hidden">
            <CardHeader>
              <CardTitle>簡易課税 - 事業区分別計算</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/20 border-b border-border">
                      <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground">
                        事業区分
                      </th>
                      <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground">
                        業種
                      </th>
                      <th className="text-right px-4 py-3 text-xs font-bold text-muted-foreground">
                        みなし仕入率
                      </th>
                      <th className="text-right px-4 py-3 text-xs font-bold text-muted-foreground">
                        課税売上高（税抜）
                      </th>
                      <th className="text-right px-4 py-3 text-xs font-bold text-muted-foreground">
                        みなし仕入額
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {simplifiedCategories.map((cat) => (
                      <tr
                        key={cat.type}
                        className={cn(
                          "border-b border-border hover:bg-muted/10",
                          cat.amount === 0 && "opacity-40"
                        )}
                      >
                        <td className="px-4 py-3 font-medium text-foreground">
                          {cat.type}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {cat.label}
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          {cat.rate}%
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          {formatCurrency(cat.amount)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          {formatCurrency(Math.floor((cat.amount * cat.rate) / 100))}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-muted/10 border-b border-border">
                      <td
                        className="px-4 py-3 font-bold text-foreground"
                        colSpan={3}
                      >
                        合計
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold">
                        {formatCurrency(simplifiedTotal)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold">
                        {formatCurrency(simplifiedDeemPurchase)}
                      </td>
                    </tr>
                    <tr className="bg-muted/10">
                      <td
                        className="px-4 py-3 font-bold text-primary"
                        colSpan={4}
                      >
                        簡易課税による納付税額
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-primary text-lg">
                        {formatCurrency(simplifiedTax)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card className="mb-6 p-5">
            <div className="flex items-start gap-3">
              <Info className="size-5 text-primary-light mt-0.5" />
              <div>
                <p className="text-sm font-bold text-foreground mb-1">
                  簡易課税制度について
                </p>
                <p className="text-xs text-muted-foreground">
                  基準期間の課税売上高が5,000万円以下の事業者が選択できます。
                  実際の仕入税額ではなく、売上に対するみなし仕入率を適用して仕入税額控除を計算します。
                  複数の事業区分がある場合は、それぞれのみなし仕入率を加重平均して計算します。
                </p>
              </div>
            </div>
          </Card>
        </>
      )}

      {/* Invoice transition measures */}
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="size-4 text-warning" />
            インボイス経過措置
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-4">
            免税事業者等からの課税仕入れについて、仕入税額控除の経過措置が適用されます。
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {invoiceTransition.map((item) => {
              // 「現在適用中」は 80% に固定されていた。日付で判定する
              const today = new Date().toISOString().slice(0, 10);
              const current = today >= item.start && (item.end === null || today <= item.end);
              return (
              <div
                key={item.period}
                className={cn(
                  "p-4 rounded-lg border border-border",
                  current ? "bg-primary/5 border-primary/30" : "bg-muted/20"
                )}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-muted-foreground">{item.period}</span>
                  {current && <Badge variant="default">現在適用中</Badge>}
                </div>
                <p className="text-2xl font-bold text-foreground mb-1">
                  {item.rate}%
                </p>
                <p className="text-xs text-muted-foreground">
                  {item.rate > 0
                    ? `仕入税額の${item.rate}%を控除できます`
                    : "控除できません（全額が自己負担）"}
                </p>
              </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </>
  );
}
