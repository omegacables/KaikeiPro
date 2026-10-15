"use client";

/**
 * 所得税青色申告決算書（一般用）。個人事業主の1月〜12月の帳簿から作る。
 * 1ページ 損益計算書 ／ 2ページ 月別売上・仕入、青色申告特別控除額の計算 ／ 3ページ 減価償却費の計算 ／ 4ページ 貸借対照表
 * 計算は src/lib/blue-return.ts、データの取り出しは src/actions/blue-return.ts。
 */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { FileText, ChevronLeft, ChevronRight, Loader2, Printer, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatYen } from "@/lib/wareki";
import { printPage } from "@/lib/export";
import { useClientRole } from "@/lib/use-client-role";
import { getBlueReturn, saveBlueReturnDeduction, type BlueReturnView, type BlueDeduction } from "@/actions/blue-return";
import type { BsLine } from "@/lib/blue-return";

const CIRCLED = "⓪①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳㉑㉒㉓㉔㉕㉖㉗㉘㉙㉚㉛㉜㉝㉞㉟㊱㊲㊳㊴㊵㊶㊷㊸㊹㊺";
const circled = (no: string) => [...CIRCLED][Number(no)] ?? no;
const DEDUCTIONS: { value: BlueDeduction; label: string; note: string }[] = [
  { value: 650_000, label: "65万円", note: "複式簿記・貸借対照表を添付し、e-Tax で申告（または優良な電子帳簿）" },
  { value: 550_000, label: "55万円", note: "複式簿記・貸借対照表を添付し、期限内に申告" },
  { value: 100_000, label: "10万円", note: "上記以外" },
];

export default function BlueReturnPage() {
  const { id } = useParams<{ id: string }>();
  const role = useClientRole(id);
  const canWrite = role?.canWrite ?? false;
  const [year, setYear] = useState<number | undefined>(undefined);
  const [view, setView] = useState<BlueReturnView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = (y?: number) => {
    setError(null);
    getBlueReturn(id, y)
      .then(setView)
      .catch((e) => setError(e instanceof Error ? e.message : "読み込みに失敗しました"));
  };
  useEffect(() => load(year), [id, year]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = async (d: BlueDeduction) => {
    if (!view || d === view.deductionSetting) return;
    setSaving(true);
    try {
      await saveBlueReturnDeduction(id, d);
      load(view.year);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存できませんでした");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <FileText className="size-6 text-primary" />
            青色申告決算書
          </h1>
          <p className="text-muted-foreground text-sm mt-1">個人事業主の1月〜12月の帳簿から、所得税青色申告決算書（一般用）を作ります。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <Button variant="outline" size="sm" onClick={() => view && setYear(view.year - 1)} disabled={!view}>
            <ChevronLeft className="size-4" />
            前年
          </Button>
          <span className="text-sm font-bold tabular-nums">{view ? `${view.year}年分` : "…"}</span>
          <Button variant="outline" size="sm" onClick={() => view && setYear(view.year + 1)} disabled={!view}>
            翌年
            <ChevronRight className="size-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => printPage()}>
            <Printer className="size-4" />
            印刷・PDF
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {!view ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="size-4 animate-spin" />
          読み込み中...
        </div>
      ) : (
        <>
          {view.warnings.length > 0 && (
            <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning space-y-1 print:hidden">
              {view.warnings.map((w) => (
                <p key={w} className="flex items-start gap-2">
                  <AlertTriangle className="size-4 mt-0.5 shrink-0" />
                  {w}
                </p>
              ))}
            </div>
          )}

          <Card className="p-4 space-y-2 print:hidden">
            <p className="text-sm font-bold">青色申告特別控除</p>
            {/* 3つを並べて選ばれている方を塗る（今の状態が分かるように） */}
            <div role="radiogroup" aria-label="青色申告特別控除" className="inline-flex rounded-lg border border-border bg-muted/30 p-0.5">
              {DEDUCTIONS.map((d) => (
                <button
                  key={d.value}
                  role="radio"
                  aria-checked={view.deductionSetting === d.value}
                  disabled={!canWrite || saving}
                  onClick={() => choose(d.value)}
                  className={cn(
                    "rounded-md px-4 py-1.5 text-sm font-bold transition-colors",
                    view.deductionSetting === d.value ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {d.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              現在の設定: {DEDUCTIONS.find((d) => d.value === view.deductionSetting)?.label}（{DEDUCTIONS.find((d) => d.value === view.deductionSetting)?.note}）。
              控除できるのは控除前の所得金額までです。
            </p>
          </Card>

          <Summary view={view} />
          <Page1 view={view} />
          <Page2 view={view} />
          <Page3 view={view} />
          <Page4 view={view} />
        </>
      )}
    </div>
  );
}

function Summary({ view }: { view: BlueReturnView }) {
  const r = view.result;
  const items: [string, number][] = [
    ["売上（収入）金額 ①", r.pl.find((l) => l.no === "1")!.amount],
    ["控除前の所得金額 ㊸", r.incomeBeforeDeduction],
    ["青色申告特別控除額 ㊹", r.deduction],
    ["所得金額 ㊺", r.income],
  ];
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {items.map(([label, v]) => (
        <Card key={label} className="p-4">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-xl font-bold font-mono mt-1">{formatYen(v)}</p>
        </Card>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-4 space-y-2 break-inside-avoid">
      <h2 className="text-base font-bold">{title}</h2>
      {children}
    </Card>
  );
}

const th = "px-2 py-1.5 font-bold text-muted-foreground";
const td = "px-2 py-1.5";
const num = "px-2 py-1.5 text-right font-mono tabular-nums";

function Page1({ view }: { view: BlueReturnView }) {
  const strong = new Set(["7", "32", "33", "43", "44", "45"]);
  return (
    <Section title={`1ページ 損益計算書（自 ${view.year}年1月1日 至 ${view.year}年12月31日）`}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="border-b border-border">
              <th className={cn(th, "text-left w-10")}>欄</th>
              <th className={cn(th, "text-left")}>科目</th>
              <th className={cn(th, "text-right w-36")}>金額（円）</th>
              <th className={cn(th, "text-left")}>帳簿の科目</th>
            </tr>
          </thead>
          <tbody>
            {view.result.pl.map((l) => (
              <tr key={l.no + l.label} className={cn("border-b border-border/50 last:border-0", strong.has(l.no) && "font-bold bg-muted/10")}>
                <td className={td}>{circled(l.no)}</td>
                <td className={td}>{l.label}</td>
                <td className={num}>{formatYen(l.amount)}</td>
                <td className={cn(td, "text-xs text-muted-foreground")}>{l.accounts.length > 1 || (l.accounts[0] && l.accounts[0] !== l.label) ? l.accounts.join("・") : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function Page2({ view }: { view: BlueReturnView }) {
  const m = view.monthly;
  const d = view.result.deductionCalc;
  return (
    <Section title="2ページ 月別売上（収入）金額及び仕入金額・青色申告特別控除額の計算">
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[420px]">
          <thead>
            <tr className="border-b border-border">
              <th className={cn(th, "text-left")}>月</th>
              <th className={cn(th, "text-right")}>売上（収入）金額</th>
              <th className={cn(th, "text-right")}>仕入金額</th>
            </tr>
          </thead>
          <tbody>
            {m.sales.map((s, k) => (
              <tr key={k} className="border-b border-border/50">
                <td className={td}>{k + 1}月</td>
                <td className={num}>{formatYen(s)}</td>
                <td className={num}>{formatYen(m.purchases[k])}</td>
              </tr>
            ))}
            <tr className="border-b border-border/50">
              <td className={td}>雑収入</td>
              <td className={num}>{formatYen(m.misc)}</td>
              <td />
            </tr>
            <tr className="font-bold bg-muted/10">
              <td className={td}>計</td>
              <td className={num}>{formatYen(m.salesTotal)}</td>
              <td className={num}>{formatYen(m.purchaseTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        仕入金額の12月には、棚卸資産の増減（売上原価に織り込んだ分）を戻しています（計は1ページ③とそろいます）。
      </p>
      <table className="w-full text-sm max-w-xl">
        <tbody>
          <tr className="border-b border-border/50"><td className={td}>⑥ 本年分の不動産所得の金額</td><td className={num}>{formatYen(d.realEstate)}</td></tr>
          <tr className="border-b border-border/50"><td className={td}>⑦ 青色申告特別控除前の所得金額</td><td className={num}>{formatYen(d.business)}</td></tr>
          <tr className="border-b border-border/50"><td className={td}>控除の上限</td><td className={num}>{formatYen(d.limit)}</td></tr>
          <tr className="font-bold"><td className={td}>⑨ 青色申告特別控除額（1ページ㊹へ）</td><td className={num}>{formatYen(d.deducted)}</td></tr>
        </tbody>
      </table>
    </Section>
  );
}

function Page3({ view }: { view: BlueReturnView }) {
  const rows = view.depreciation;
  return (
    <Section title="3ページ 減価償却費の計算">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">この年に償却する固定資産はありません（固定資産・減価償却の画面で登録します）。</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[900px]">
            <thead>
              <tr className="border-b border-border">
                {["減価償却資産の名称", "取得年月", "取得価額", "償却方法", "耐用年数", "償却率", "本年中の償却期間", "本年分の普通償却費", "特別償却費", "本年分の償却費合計", "事業専用割合", "本年分の必要経費算入額", "未償却残高"].map((h) => (
                  <th key={h} className={cn(th, "text-left")}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name + r.acquired} className="border-b border-border/50">
                  <td className={td}>{r.name}</td>
                  <td className={td}>{r.acquired}</td>
                  <td className={num}>{formatYen(r.cost)}</td>
                  <td className={td}>{r.method}</td>
                  <td className={num}>{r.life}年</td>
                  <td className={num}>{r.rate ?? "—"}</td>
                  <td className={num}>{r.months}/12</td>
                  <td className={num}>{formatYen(r.ordinary)}</td>
                  <td className={num}>{r.special ? formatYen(r.special) : ""}</td>
                  <td className={num}>{formatYen(r.total)}</td>
                  <td className={num}>{r.businessRatio}%</td>
                  <td className={num}>{formatYen(r.expense)}</td>
                  <td className={num}>{formatYen(r.closingBook)}</td>
                </tr>
              ))}
              <tr className="font-bold bg-muted/10">
                <td className={td} colSpan={11}>計（1ページ⑱へ）</td>
                <td className={num}>{formatYen(rows.reduce((s, r) => s + r.expense, 0))}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

function BsTable({ title, lines, total }: { title: string; lines: BsLine[]; total?: { opening: number; closing: number } }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border">
          <th className={cn(th, "text-left")}>{title}</th>
          <th className={cn(th, "text-right")}>1月1日（期首）</th>
          <th className={cn(th, "text-right")}>12月31日（期末）</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l, k) => (
          <tr key={l.label + k} className="border-b border-border/50" title={l.accounts.join("・")}>
            <td className={td}>{l.label}</td>
            <td className={num}>{l.opening === null ? "" : formatYen(l.opening)}</td>
            <td className={num}>{formatYen(l.closing)}</td>
          </tr>
        ))}
        {total && (
          <tr className="font-bold bg-muted/10">
            <td className={td}>合計</td>
            <td className={num}>{formatYen(total.opening)}</td>
            <td className={num}>{formatYen(total.closing)}</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function Page4({ view }: { view: BlueReturnView }) {
  const bs = view.result.bs;
  return (
    <Section title={`4ページ 貸借対照表（資産負債調）（${view.year}年12月31日現在）`}>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <BsTable title="資産の部" lines={bs.assets} total={bs.assetTotal} />
        <div>
          <BsTable title="負債・資本の部" lines={[...bs.liabilities, ...bs.capital]} total={bs.liabilityTotal} />
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        元入金は「期首の資産の総額 − 期首の負債の総額」です（事業主貸・事業主借は毎年0から始めます）。行にマウスを重ねると、まとめた帳簿の科目が出ます。
      </p>
    </Section>
  );
}
