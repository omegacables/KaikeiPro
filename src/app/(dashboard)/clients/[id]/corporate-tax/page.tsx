"use client";

/**
 * 法人税申告書（別表一・四・五(一)(二)・七(一)・十五、防衛特別法人税）と地方税（法人住民税・法人事業税）。
 * 計算は src/lib/corporate-tax-return.ts（テストあり）、帳簿からの集計と入力の保存は src/actions/corporate-tax-return.ts。
 */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Landmark, ChevronLeft, ChevronRight, Loader2, Printer, AlertTriangle, Info, Plus, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AmountInput } from "@/components/ui/amount-input";
import { DateInput } from "@/components/ui/date-input";
import { cn } from "@/lib/utils";
import { SettlementCard } from "@/components/tax/settlement-card";
import { useClientRole } from "@/lib/use-client-role";
import { printPage } from "@/lib/export";
import type { TaxTable, Adjustment } from "@/lib/corporate-tax-return";
import {
  getCorporateTaxReturn,
  saveCorporateTaxReturnInputs,
  type CorporateReturnView,
  type CorporateReturnInputs,
} from "@/actions/corporate-tax-return";

const fieldCls = "w-full px-2 py-1.5 rounded-lg border border-border bg-card text-foreground text-sm";
const errMsg = (e: unknown) => (e instanceof Error ? e.message : "読み込みに失敗しました");
/** 別表の金額。マイナスは別表の書き方どおり △ */
const fmt = (n: number | null | undefined) => (n == null ? "" : n < 0 ? `△${Math.abs(n).toLocaleString()}` : Math.abs(n).toLocaleString());

/** 期首の利益積立金のうち、決まった名前で読み分ける行（未納の税額は △ で保存する） */
const OPENING_FIXED = [
  { name: "納税充当金", negative: false, hint: "前期末の未払法人税等" },
  { name: "未納法人税等", negative: true, hint: "前期分の法人税・地方法人税で期首に未納の額" },
  { name: "未納道府県民税", negative: true, hint: "前期分の道府県民税で期首に未納の額" },
  { name: "未納市町村民税", negative: true, hint: "前期分の市町村民税で期首に未納の額" },
];

export default function CorporateTaxPage() {
  const { id } = useParams<{ id: string }>();
  const role = useClientRole(id);
  const canWrite = role?.canWrite ?? false;
  const [periodKey, setPeriodKey] = useState<string | undefined>(undefined);
  const [view, setView] = useState<CorporateReturnView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    getCorporateTaxReturn(id, periodKey)
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

  const r = view?.result;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Landmark className="size-6 text-primary" />
            法人税申告書
          </h1>
          <p className="text-muted-foreground text-sm mt-1 print:hidden">
            帳簿と固定資産台帳から、法人税・地方法人税・防衛特別法人税（別表一・四・五・七・十五）と、法人住民税・法人事業税を計算します。
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
      {view && view.entityType === "individual" && (
        <Note tone="warning">この顧問先は個人事業主に設定されています。法人税申告書は法人のためのものです。</Note>
      )}

      {view && r && (
        <>
          <p className="hidden print:block text-sm">
            事業年度 {view.period.startDate} 〜 {view.period.endDate}
          </p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Amount label="所得金額" value={r.income} plain />
            <Amount label="法人税・地方法人税等" value={r.taxes.corporate + r.taxes.localCorporate + (r.taxes.defense ?? 0)} />
            <Amount label="住民税（道府県・市町村）" value={r.taxes.prefectural + r.taxes.municipal} />
            <Amount label="事業税・特別法人事業税" value={r.taxes.enterprise} />
          </div>
          <Card className="p-4 flex flex-wrap items-center gap-x-8 gap-y-2 text-sm">
            <span>
              この申告で{r.totalPayable < 0 ? "還付される" : "納める"}合計: <b className="font-mono text-lg">{Math.abs(r.totalPayable).toLocaleString()}円</b>
            </span>
            <span className="text-muted-foreground">
              当期の税額の合計（中間分を含む。決算で「法人税、住民税及び事業税」に計上する額の目安）: <b className="font-mono">{r.totalTaxForPeriod.toLocaleString()}円</b>
            </span>
          </Card>

          {r.warnings.map((w) => (
            <Note key={w} tone="warning">
              {w}
            </Note>
          ))}
          {view.carriedFromPrior && (
            <Note tone="info">この期の入力はまだ保存されていません。前期の申告から、期首の利益積立金・繰越欠損金・前期分の事業税を引き継いで表示しています。</Note>
          )}

          <Card className="p-4 text-sm print:hidden">
            <p className="font-bold mb-1">帳簿から集めた数字</p>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-muted-foreground">
              <span>当期利益 <b className="text-foreground font-mono">{fmt(view.books.netIncome)}</b></span>
              <span>「法人税」を含む費用科目 <b className="text-foreground font-mono">{fmt(view.books.taxExpenseBooked)}</b></span>
              <span>交際費 <b className="text-foreground font-mono">{fmt(view.books.entertainment)}</b></span>
              <span>償却超過額 <b className="text-foreground font-mono">{fmt(view.books.depreciationExcess)}</b>・認容額 <b className="text-foreground font-mono">{fmt(view.books.depreciationAllowed)}</b>（固定資産台帳）</span>
            </div>
          </Card>

          <InputsCard view={view} clientId={id} canWrite={canWrite} onSaved={() => setReloadKey((k) => k + 1)} />

          <SettlementCard
            clientId={id}
            kind="corporate"
            periodKey={view.period.key}
            endDate={view.period.endDate}
            canWrite={canWrite}
            refreshKey={reloadKey}
            onChanged={() => setReloadKey((k) => k + 1)}
          />

          {r.tables.map((t) => (
            <TableView key={t.key} table={t} />
          ))}

          <Note tone="info">
            <b>この画面の前提</b>：中小法人（資本金1億円以下の普通法人・青色申告・単体）を対象にしています。
            名前に「法人税」を含む費用科目（法人税、住民税及び事業税など）は、中間納付と期末の納税充当金の繰入とみなします。期首の納税充当金は、前期分の税金の納付に全額使ったものとします。
            地方税は標準税率で計算します（自治体によって税率が違うときは、税率を変えてください）。事務所が1か所の法人を想定し、分割基準による按分はしません。
            受取配当等の益金不算入・寄附金・役員給与・貸倒引当金の限度超過などは、「手入力の加算・減算」で入れてください。申告の前に、税理士が内容を確認してください。
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

function Amount({ label, value, plain }: { label: string; value: number; plain?: boolean }) {
  const refund = value < 0;
  return (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground">
        {label}
        {!plain && `（${refund ? "還付" : "納付"}）`}
        {plain && refund && "（欠損）"}
      </p>
      <p className={cn("text-xl font-bold font-mono mt-1", refund && !plain ? "text-info" : "text-foreground")}>
        {plain ? fmt(value) : Math.abs(value).toLocaleString()}円
      </p>
    </Card>
  );
}

function TableView({ table }: { table: TaxTable }) {
  return (
    <Card className="overflow-hidden break-inside-avoid">
      <h3 className="px-4 py-2 text-sm font-bold bg-muted/20 border-b border-border">{table.title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[640px]">
          <thead>
            <tr className="border-b border-border text-muted-foreground">
              <th className="text-center px-2 py-1.5 w-14">欄</th>
              <th className="text-left px-2 py-1.5">項目</th>
              {table.columns.map((c) => (
                <th key={c} className="text-right px-2 py-1.5 w-32">
                  {c}
                </th>
              ))}
              <th className="text-left px-2 py-1.5 w-44 print:hidden">備考</th>
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, idx) => (
              <tr key={`${row.no}-${row.label}-${idx}`} className="border-b border-border/40 last:border-0">
                <td className="text-center px-2 py-1 font-bold">{row.no}</td>
                <td className="px-2 py-1">{row.label}</td>
                {row.values.map((v, j) => (
                  <td key={j} className="text-right px-2 py-1 font-mono">
                    {fmt(v)}
                  </td>
                ))}
                <td className="px-2 py-1 text-muted-foreground print:hidden">{row.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 入力
// ---------------------------------------------------------------------------

const toStr = (n: number | null | undefined) => (n == null || n === 0 ? "" : String(n));
const toNum = (s: string) => (s === "" ? 0 : Number(s) || 0);
const pctStr = (v: number) => String(Math.round(v * 100000) / 1000);

function InputsCard({ view, clientId, canWrite, onSaved }: { view: CorporateReturnView; clientId: string; canWrite: boolean; onSaved: () => void }) {
  const [f, setF] = useState<CorporateReturnInputs>(view.inputs);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(!view.saved);
  useEffect(() => setF(view.inputs), [view]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveCorporateTaxReturnInputs(clientId, view.period, f);
      onSaved();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  const disabled = !canWrite || saving;
  const label = (t: string, hint?: string) => (
    <span className="block text-xs font-bold text-muted-foreground mb-1">
      {t}
      {hint && <span className="font-normal ml-1">{hint}</span>}
    </span>
  );
  const money = (value: number | null, onChange: (n: number) => void) => (
    <AmountInput value={toStr(value)} onChange={(v) => onChange(toNum(v))} className={cn(fieldCls, "text-right")} disabled={disabled} />
  );
  const fixedOpening = (name: string) => Math.abs(f.openingRetained.find((r) => r.name === name)?.amount ?? 0);
  const setOpening = (name: string, amount: number, negative: boolean) =>
    setF({
      ...f,
      openingRetained: [...f.openingRetained.filter((r) => r.name !== name), ...(amount ? [{ name, amount: negative ? -amount : amount }] : [])],
    });
  const otherOpening = f.openingRetained.filter((r) => !OPENING_FIXED.some((x) => x.name === r.name));
  const setOther = (list: { name: string; amount: number }[]) =>
    setF({ ...f, openingRetained: [...f.openingRetained.filter((r) => OPENING_FIXED.some((x) => x.name === r.name)), ...list] });
  const setAdj = (idx: number, patch: Partial<Adjustment>) => setF({ ...f, adjustments: f.adjustments.map((a, i) => (i === idx ? { ...a, ...patch } : a)) });

  return (
    <Card className="p-4 space-y-4 print:hidden">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-sm">申告の入力（この期）</h3>
        <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
          {open ? "閉じる" : "開く"}
        </Button>
      </div>
      {open && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <label>
              {label("資本金等の額（期末）")}
              {money(f.capital, (n) => setF({ ...f, capital: n }))}
            </label>
            <label>
              {label("従業者数（期末）", "均等割")}
              <input
                type="number"
                min={0}
                value={f.employees ?? ""}
                disabled={disabled}
                onChange={(e) => setF({ ...f, employees: e.target.value === "" ? null : Number(e.target.value) })}
                className={fieldCls}
              />
            </label>
            <label>
              {label("控除する所得税額", "利息・配当の源泉所得税")}
              {money(f.withholdingTax, (n) => setF({ ...f, withholdingTax: n }))}
            </label>
            <label>
              {label("接待飲食費", "（50%基準と比べるとき）")}
              <AmountInput
                value={f.entertainmentDining == null ? "" : String(f.entertainmentDining)}
                onChange={(v) => setF({ ...f, entertainmentDining: v === "" ? null : toNum(v) })}
                className={cn(fieldCls, "text-right")}
                disabled={disabled}
              />
            </label>
          </div>

          <div>
            <p className="text-xs font-bold text-muted-foreground mb-1">中間申告で納付の確定した税額（申告額）</p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {(
                [
                  ["corporate", "法人税"],
                  ["localCorporate", "地方法人税"],
                  ["prefectural", "道府県民税"],
                  ["municipal", "市町村民税"],
                  ["enterprise", "事業税・特別法人事業税"],
                ] as const
              ).map(([k, t]) => (
                <label key={k}>
                  {label(t)}
                  {money(f.interim[k], (n) => setF({ ...f, interim: { ...f.interim, [k]: n } }))}
                </label>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-bold text-muted-foreground mb-1">期首の状況（前期の別表五(一)・(二)から）</p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {OPENING_FIXED.map((x) => (
                <label key={x.name}>
                  {label(x.name)}
                  {money(fixedOpening(x.name), (n) => setOpening(x.name, n, x.negative))}
                  <span className="block text-[10px] text-muted-foreground mt-0.5">{x.hint}</span>
                </label>
              ))}
              <label>
                {label("前期分の事業税等")}
                {money(f.priorEnterpriseTaxPaid, (n) => setF({ ...f, priorEnterpriseTaxPaid: n }))}
                <span className="block text-[10px] text-muted-foreground mt-0.5">当期に納税充当金から納めた額（別表四で減算）</span>
              </label>
            </div>
            <ListEditor
              title="その他の期首の利益積立金（利益準備金・貸倒引当金超過額など）"
              disabled={disabled}
              rows={otherOpening}
              onChange={setOther}
              empty={{ name: "", amount: 0 }}
              render={(row, set) => (
                <>
                  <input value={row.name} onChange={(e) => set({ ...row, name: e.target.value })} placeholder="項目名" className={cn(fieldCls, "flex-1")} disabled={disabled} />
                  <div className="w-40">
                    <AmountInput value={toStr(Math.abs(row.amount))} onChange={(v) => set({ ...row, amount: (row.amount < 0 ? -1 : 1) * toNum(v) })} className={cn(fieldCls, "text-right")} disabled={disabled} />
                  </div>
                  <label className="text-xs flex items-center gap-1">
                    <input type="checkbox" checked={row.amount < 0} onChange={(e) => set({ ...row, amount: (e.target.checked ? -1 : 1) * Math.abs(row.amount) })} disabled={disabled} />△
                  </label>
                </>
              )}
            />
          </div>

          <ListEditor
            title="繰越欠損金（前期までの青色欠損金。事業年度の末日と、控除しきれていない額）"
            disabled={disabled}
            rows={f.losses}
            onChange={(losses) => setF({ ...f, losses })}
            empty={{ periodEnd: "", amount: 0 }}
            render={(row, set) => (
              <>
                <div className="w-40">
                  <DateInput allowEmpty value={row.periodEnd} onChange={(v) => set({ ...row, periodEnd: v })} className={fieldCls} />
                </div>
                <div className="w-48">
                  <AmountInput value={toStr(row.amount)} onChange={(v) => set({ ...row, amount: toNum(v) })} className={cn(fieldCls, "text-right")} disabled={disabled} />
                </div>
              </>
            )}
          />

          <ListEditor
            title="手入力の加算・減算（役員給与の損金不算入、受取配当等の益金不算入、寄附金、貸倒引当金の限度超過など）"
            disabled={disabled}
            rows={f.adjustments}
            onChange={(adjustments) => setF({ ...f, adjustments })}
            empty={{ kind: "add", name: "", amount: 0, treatment: "retained" } as Adjustment}
            render={(row, set, idx) => (
              <>
                <select value={row.kind} onChange={(e) => setAdj(idx, { kind: e.target.value as Adjustment["kind"] })} className={cn(fieldCls, "w-24")} disabled={disabled}>
                  <option value="add">加算</option>
                  <option value="deduct">減算</option>
                </select>
                <input value={row.name} onChange={(e) => set({ ...row, name: e.target.value })} placeholder="項目名" className={cn(fieldCls, "flex-1")} disabled={disabled} />
                <div className="w-40">
                  <AmountInput value={toStr(row.amount)} onChange={(v) => set({ ...row, amount: toNum(v) })} className={cn(fieldCls, "text-right")} disabled={disabled} />
                </div>
                <select value={row.treatment} onChange={(e) => setAdj(idx, { treatment: e.target.value as Adjustment["treatment"] })} className={cn(fieldCls, "w-28")} disabled={disabled}>
                  <option value="retained">留保</option>
                  <option value="outflow">社外流出</option>
                </select>
              </>
            )}
          />

          <div>
            <p className="text-xs font-bold text-muted-foreground mb-1">地方税の税率（標準税率と違う自治体のとき変えてください）</p>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
              {(
                [
                  ["prefectural", "道府県民税 法人税割 %"],
                  ["municipal", "市町村民税 法人税割 %"],
                ] as const
              ).map(([k, t]) => (
                <label key={k}>
                  {label(t)}
                  <input
                    type="number"
                    step="0.1"
                    value={pctStr(f.localRates[k])}
                    disabled={disabled}
                    onChange={(e) => setF({ ...f, localRates: { ...f.localRates, [k]: Number(e.target.value) / 100 } })}
                    className={fieldCls}
                  />
                </label>
              ))}
              {(["年400万円以下 %", "400万〜800万円 %", "800万円超 %"] as const).map((t, i) => (
                <label key={t}>
                  {label(`事業税 ${t}`)}
                  <input
                    type="number"
                    step="0.01"
                    value={pctStr(f.localRates.enterprise[i])}
                    disabled={disabled}
                    onChange={(e) => {
                      const next = [...f.localRates.enterprise] as [number, number, number];
                      next[i] = Number(e.target.value) / 100;
                      setF({ ...f, localRates: { ...f.localRates, enterprise: next } });
                    }}
                    className={fieldCls}
                  />
                </label>
              ))}
              <label className="flex items-end gap-2 text-xs pb-2">
                <input
                  type="checkbox"
                  checked={f.localRates.reducedRateExcluded}
                  disabled={disabled}
                  onChange={(e) => setF({ ...f, localRates: { ...f.localRates, reducedRateExcluded: e.target.checked } })}
                />
                軽減税率不適用法人（3以上の都道府県に事務所・資本金1,000万円以上）
              </label>
            </div>
          </div>

          {canWrite && (
            <div className="flex items-center gap-3">
              <Button size="sm" onClick={save} disabled={saving}>
                {saving && <Loader2 className="size-4 animate-spin" />}
                この期の入力を保存して計算
              </Button>
              <span className="text-xs text-muted-foreground">保存すると、翌期の申告の期首の数字として引き継がれます。</span>
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </>
      )}
    </Card>
  );
}

function ListEditor<T>({
  title,
  rows,
  onChange,
  empty,
  render,
  disabled,
}: {
  title: string;
  rows: T[];
  onChange: (rows: T[]) => void;
  empty: T;
  render: (row: T, set: (row: T) => void, idx: number) => React.ReactNode;
  disabled: boolean;
}) {
  return (
    <div className="mt-3">
      <p className="text-xs font-bold text-muted-foreground mb-1">{title}</p>
      <div className="space-y-2">
        {rows.map((row, idx) => (
          <div key={idx} className="flex flex-wrap items-center gap-2">
            {render(row, (next) => onChange(rows.map((r, i) => (i === idx ? next : r))), idx)}
            {!disabled && (
              <Button size="sm" variant="ghost" onClick={() => onChange(rows.filter((_, i) => i !== idx))} aria-label="削除">
                <Trash2 className="size-3.5" />
              </Button>
            )}
          </div>
        ))}
        {!disabled && (
          <Button size="sm" variant="outline" onClick={() => onChange([...rows, empty])}>
            <Plus className="size-3.5" />
            行を追加
          </Button>
        )}
      </div>
    </div>
  );
}
