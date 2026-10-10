"use client";

/**
 * 消費税及び地方消費税の確定申告書（第一表・第二表・付表）。
 * 計算は src/lib/consumption-tax-return.ts（テストあり）、読み込みと設定の保存は src/actions/consumption-tax-return.ts。
 */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Calculator, ChevronLeft, ChevronRight, Loader2, Printer, AlertTriangle, Info } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AmountInput } from "@/components/ui/amount-input";
import { cn } from "@/lib/utils";
import { useClientRole } from "@/lib/use-client-role";
import { printPage } from "@/lib/export";
import { BUSINESS_TYPES, CALC_METHOD_LABELS, type CalcMethod, type FormTable } from "@/lib/consumption-tax-return";
import {
  getConsumptionTaxReturn,
  saveConsumptionTaxReturnSettings,
  type ConsumptionTaxReturnView,
} from "@/actions/consumption-tax-return";
import { TaxCategoryCheck } from "./tax-category-check";

const fieldCls = "w-full px-2 py-1.5 rounded-lg border border-border bg-card text-foreground text-sm";
const errMsg = (e: unknown) => (e instanceof Error ? e.message : "読み込みに失敗しました");

/** 申告書の金額。様式で「－」を付ける欄（還付）だけマイナスが来る */
const yen = (n: number | null | undefined) => (n == null ? "" : n < 0 ? `－${Math.abs(n).toLocaleString()}` : n.toLocaleString());

export default function TaxReturnPage() {
  const { id } = useParams<{ id: string }>();
  const role = useClientRole(id);
  const canWrite = role?.canWrite ?? false;
  const [periodKey, setPeriodKey] = useState<string | undefined>(undefined);
  const [view, setView] = useState<ConsumptionTaxReturnView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    getConsumptionTaxReturn(id, periodKey)
      .then((v) => {
        if (!alive) return;
        setView(v);
        setError(null);
      })
      .catch((e) => alive && setError(errMsg(e)));
    return () => {
      alive = false;
    };
  }, [id, periodKey, reloadKey]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Calculator className="size-6 text-primary" />
            消費税申告書
          </h1>
          <p className="text-muted-foreground text-sm mt-1 print:hidden">
            仕訳から、消費税及び地方消費税の確定申告書（第一表・第二表・付表）の各欄を計算します。e-Tax や申告書の用紙に、欄の番号どおりに写せます。
          </p>
        </div>
        {view && (
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <Button variant="outline" size="sm" onClick={() => setPeriodKey(view.period.prevKey)}>
              <ChevronLeft className="size-4" />
              前期
            </Button>
            <span className="text-sm font-medium tabular-nums">
              {view.period.startDate} 〜 {view.period.endDate}
            </span>
            <Button variant="outline" size="sm" onClick={() => setPeriodKey(view.period.nextKey)}>
              翌期
              <ChevronRight className="size-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => printPage()}>
              <Printer className="size-4" />
              印刷・PDF
            </Button>
          </div>
        )}
      </div>

      {error && <Note tone="warning">{error}</Note>}
      {!view && !error && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="size-4 animate-spin" />
          読み込み中...
        </div>
      )}

      {view && view.taxExempt && (
        <Note tone="info">
          この顧問先は<b>免税事業者</b>に設定されています。消費税の申告・納付はありません（設定は「設定」→消費税計算で変えられます）。
        </Note>
      )}

      {view && !view.taxExempt && (
        <>
          <p className="hidden print:block text-sm">
            課税期間 {view.period.startDate} 〜 {view.period.endDate}（{CALC_METHOD_LABELS[view.settings.method]}）
          </p>
          <SettingsCard view={view} clientId={id} canWrite={canWrite} onSaved={() => setReloadKey((k) => k + 1)} />

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Amount label="消費税（国）" value={view.result.national} />
            <Amount label="地方消費税" value={view.result.local} />
            <Amount label="合計" value={view.result.total} strong />
          </div>

          {[...view.eligibility, ...view.result.warnings].map((w) => (
            <Note key={w} tone="warning">
              {w}
            </Note>
          ))}

          <Card className="p-4 text-sm flex flex-wrap gap-x-8 gap-y-1">
            <span>
              基準期間（{view.basePeriod.startDate}〜{view.basePeriod.endDate}）の課税売上高:{" "}
              <b className="font-mono">{view.basePeriodSales === null ? "記録なし" : `${yen(view.basePeriodSales)}円`}</b>
            </span>
            {view.result.taxableSalesRatio !== null && (
              <span>
                課税売上割合: <b className="font-mono">{(Math.floor(view.result.taxableSalesRatio * 10000) / 100).toFixed(2)}%</b>（
                {view.result.deductionMethod === "full" ? "全額控除" : "一括比例配分方式"}）
              </span>
            )}
          </Card>

          <TaxCategoryCheck clientId={id} period={view.period} canWrite={canWrite} onFixed={() => setReloadKey((k) => k + 1)} />

          {view.result.tables.map((t) => (
            <FormTableView key={t.key} table={t} />
          ))}

          <Note tone="info">
            <b>この画面の前提</b>：売上・仕入の返品や値引きは、帳簿で売上・仕入から直接差し引いているものとして計算しています。
            売上の消費税は割戻し計算（税込 × 100/110 から課税標準額を出す方法）です。
            個別対応方式、2つ以上の事業区分の簡易課税、旧税率（8%の標準税率など）の取引、特定課税仕入れには対応していません。
            申告の前に、税理士が内容を確認してください。
          </Note>
        </>
      )}
    </div>
  );
}

function Note({ tone, children }: { tone: "info" | "warning"; children: React.ReactNode }) {
  const cls = tone === "warning" ? "border-warning/30 bg-warning/10 text-warning" : "border-info/30 bg-info/10 text-info";
  const Icon = tone === "warning" ? AlertTriangle : Info;
  return (
    <div className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 text-sm print:hidden", cls)}>
      <Icon className="size-4 mt-0.5 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

function Amount({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  const refund = value < 0;
  return (
    <Card className={cn("p-4", strong && "border-primary/40")}>
      <p className="text-xs text-muted-foreground">
        {label}（{refund ? "還付" : "納付"}）
      </p>
      <p className={cn("text-2xl font-bold font-mono mt-1", refund ? "text-info" : "text-foreground")}>
        {Math.abs(value).toLocaleString()}円
      </p>
    </Card>
  );
}

function SettingsCard({
  view,
  clientId,
  canWrite,
  onSaved,
}: {
  view: ConsumptionTaxReturnView;
  clientId: string;
  canWrite: boolean;
  onSaved: () => void;
}) {
  const s = view.settings;
  const [f, setF] = useState({
    method: s.method,
    purchaseTaxCalc: s.purchaseTaxCalc,
    businessType: s.businessType,
    interimNational: String(s.interimNational || ""),
    interimLocal: String(s.interimLocal || ""),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setF({
      method: s.method,
      purchaseTaxCalc: s.purchaseTaxCalc,
      businessType: s.businessType,
      interimNational: String(s.interimNational || ""),
      interimLocal: String(s.interimLocal || ""),
    });
  }, [s.method, s.purchaseTaxCalc, s.businessType, s.interimNational, s.interimLocal, view.period.key]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveConsumptionTaxReturnSettings(clientId, view.period, {
        method: f.method,
        purchaseTaxCalc: f.purchaseTaxCalc,
        businessType: f.businessType,
        interimNational: Number(f.interimNational) || 0,
        interimLocal: Number(f.interimLocal) || 0,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const label = (t: string) => <span className="block text-xs font-bold text-muted-foreground mb-1">{t}</span>;
  const disabled = !canWrite || saving;
  return (
    <Card className="p-4 space-y-3 print:hidden">
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        <label>
          {label("計算方法")}
          <select value={f.method} disabled={disabled} onChange={(e) => setF({ ...f, method: e.target.value as CalcMethod })} className={fieldCls}>
            {(Object.keys(CALC_METHOD_LABELS) as CalcMethod[]).map((m) => (
              <option key={m} value={m}>
                {CALC_METHOD_LABELS[m]}
              </option>
            ))}
          </select>
        </label>
        {f.method === "standard" && (
          <label>
            {label("仕入税額の計算")}
            <select
              value={f.purchaseTaxCalc}
              disabled={disabled}
              onChange={(e) => setF({ ...f, purchaseTaxCalc: e.target.value as "stacked" | "proportional" })}
              className={fieldCls}
            >
              <option value="stacked">積上げ計算（請求書などの税額を足す）</option>
              <option value="proportional">割戻し計算（税込の合計から計算）</option>
            </select>
          </label>
        )}
        {f.method === "simplified" && (
          <label>
            {label("事業区分")}
            <select
              value={f.businessType ?? ""}
              disabled={disabled}
              onChange={(e) => setF({ ...f, businessType: e.target.value ? Number(e.target.value) : null })}
              className={fieldCls}
            >
              <option value="">選んでください</option>
              {BUSINESS_TYPES.map((b) => (
                <option key={b.type} value={b.type}>
                  {b.label} みなし仕入率{b.rate}%
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          {label("中間納付税額（国）")}
          <AmountInput value={f.interimNational} onChange={(v) => setF({ ...f, interimNational: v })} className={cn(fieldCls, "text-right")} disabled={disabled} />
        </label>
        <label>
          {label("中間納付譲渡割額（地方）")}
          <AmountInput value={f.interimLocal} onChange={(v) => setF({ ...f, interimLocal: v })} className={cn(fieldCls, "text-right")} disabled={disabled} />
        </label>
        {canWrite && (
          <div className="flex items-end">
            <Button size="sm" onClick={save} disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              この期の設定を保存
            </Button>
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        中間納付額は、中間申告書の「納付すべき税額」（実際に納めた額ではなく申告した額）の合計を入れます。
        {!s.saved && " この期の設定はまだ保存されていないため、顧問先の設定から表示しています。"}
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </Card>
  );
}

function FormTableView({ table }: { table: FormTable }) {
  const abc = table.columns === "ABC";
  return (
    <Card className="overflow-hidden break-inside-avoid">
      <h3 className="px-4 py-2 text-sm font-bold bg-muted/20 border-b border-border">{table.title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[640px]">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="text-center px-2 py-1.5 w-12">欄</th>
              <th className="text-left px-2 py-1.5">項目</th>
              {abc && <th className="text-right px-2 py-1.5 w-32">税率6.24%（A）</th>}
              {abc && <th className="text-right px-2 py-1.5 w-32">税率7.8%（B）</th>}
              <th className="text-right px-2 py-1.5 w-36">{abc ? "合計（C）" : "金額"}</th>
              <th className="text-left px-2 py-1.5 w-48 print:hidden">備考</th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r) => (
              <tr key={r.no + r.label} className="border-b border-border/40 last:border-0">
                <td className="text-center px-2 py-1 font-bold">{r.no}</td>
                <td className="px-2 py-1">{r.label}</td>
                {abc && <td className="text-right px-2 py-1 font-mono">{r.a === undefined ? "" : yen(r.a)}</td>}
                {abc && <td className="text-right px-2 py-1 font-mono">{r.b === undefined ? "" : yen(r.b)}</td>}
                <td className="text-right px-2 py-1 font-mono font-bold">{yen(r.c)}</td>
                <td className="px-2 py-1 text-muted-foreground print:hidden">{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
