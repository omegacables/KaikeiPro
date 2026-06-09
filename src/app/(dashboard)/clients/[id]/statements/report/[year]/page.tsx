"use client";

import { useState, useEffect, use } from "react";
import { Loader2, Printer, ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  getSettlementReport,
  type SettlementReport,
  type ReportLine,
} from "@/actions/settlement-report";
import { formatCurrency } from "@/lib/utils";

const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  #report-root, #report-root * { visibility: visible !important; }
  #report-root { position: absolute; left: 0; top: 0; width: 100%; }
  .no-print { display: none !important; }
  .sheet { page-break-after: always; box-shadow: none !important; border: none !important; margin: 0 auto !important; }
  .sheet:last-child { page-break-after: auto; }
  @page { size: A4; margin: 14mm; }
}
`;

function jpDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[1]}年${Number(m[2])}月${Number(m[3])}日`;
}

function Sheet({ children }: { children: React.ReactNode }) {
  return (
    <div className="sheet mx-auto max-w-[820px] bg-white text-black border border-border rounded-lg shadow-sm p-12 mb-6">
      {children}
    </div>
  );
}

// 金額行（当期・前期2列）
function AmtRow({
  label,
  amount,
  prior,
  bold,
  indent,
}: {
  label: string;
  amount: number;
  prior?: number;
  bold?: boolean;
  indent?: boolean;
}) {
  return (
    <div
      className={
        "flex justify-between gap-4 py-1 border-b border-gray-200 " +
        (bold ? "font-bold " : "") +
        (indent ? "pl-4" : "")
      }
    >
      <span>{label}</span>
      <span className="flex gap-6 tabular-nums">
        <span className="w-32 text-right">{formatCurrency(amount)}</span>
        {prior !== undefined && (
          <span className="w-32 text-right text-gray-500">{formatCurrency(prior)}</span>
        )}
      </span>
    </div>
  );
}

function ColHeader({ twoCol }: { twoCol?: boolean }) {
  return (
    <div className="flex justify-between gap-4 py-1 border-b-2 border-black text-xs font-bold text-gray-600">
      <span>科目</span>
      <span className="flex gap-6">
        <span className="w-32 text-right">当期</span>
        {twoCol && <span className="w-32 text-right">前期</span>}
      </span>
    </div>
  );
}

export default function SettlementReportPage({
  params,
}: {
  params: Promise<{ id: string; year: string }>;
}) {
  const { id, year } = use(params);
  const router = useRouter();
  const [data, setData] = useState<SettlementReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSettlementReport(id, Number(year))
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "読み込みに失敗しました"))
      .finally(() => setLoading(false));
  }, [id, year]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="size-5 animate-spin mr-2" />
        読み込み中...
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
        {error ?? "データが見つかりません"}
      </div>
    );
  }

  const periodLabel = `自 ${jpDate(data.period.start)}　至 ${jpDate(data.period.end)}`;
  const pl = data.pl;

  const section = (title: string, lines: ReportLine[], total: number, twoCol = true) => (
    <div className="mb-4">
      <p className="font-bold border-b border-black pb-0.5 mb-1">{title}</p>
      {lines.map((l, i) => (
        <AmtRow key={i} label={l.name} amount={l.amount} prior={twoCol ? l.prior : undefined} indent />
      ))}
      <AmtRow label={`${title}合計`} amount={total} bold />
    </div>
  );

  return (
    <div className="space-y-4">
      {/* eslint-disable-next-line react/no-danger */}
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

      {/* 操作バー */}
      <div className="no-print flex items-center justify-between gap-2">
        <button
          onClick={() => router.push(`/clients/${id}/statements`)}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          試算表・財務諸表に戻る
        </button>
        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
        >
          <Printer className="size-4" />
          印刷 / PDF保存
        </button>
      </div>

      {!data.bs.balanced && (
        <div className="no-print p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm text-amber-700 dark:text-amber-400">
          貸借対照表の貸借が一致していません。期首残高・仕訳をご確認ください。
        </div>
      )}

      <div id="report-root">
        {/* ===== 1. 表紙 ===== */}
        <Sheet>
          <div className="flex flex-col items-center justify-center text-center" style={{ minHeight: "900px" }}>
            <p className="text-sm tracking-widest mb-24">{data.company.name}</p>
            <h1 className="text-4xl font-bold tracking-[0.4em] mb-4">決 算 報 告 書</h1>
            <p className="text-base tracking-widest mb-24">{periodLabel}</p>
            <div className="mt-auto text-sm space-y-1">
              <p className="font-bold text-lg">{data.company.name}</p>
              {data.company.address && <p className="text-xs">{data.company.address}</p>}
              {data.preparer && (
                <p className="text-xs mt-6 text-gray-600">作成： {data.preparer.name}</p>
              )}
            </div>
          </div>
        </Sheet>

        {/* ===== 2. 貸借対照表 ===== */}
        <Sheet>
          <h2 className="text-center text-xl font-bold tracking-widest mb-1">貸借対照表</h2>
          <p className="text-center text-xs text-gray-500 mb-4">{jpDate(data.period.end)} 現在</p>
          <ColHeader twoCol />
          {section("資産の部", data.bs.assets, data.bs.totalAssets)}
          {section("負債の部", data.bs.liabilities, data.bs.totalLiabilities)}
          <div className="mb-4">
            <p className="font-bold border-b border-black pb-0.5 mb-1">純資産の部</p>
            {data.bs.equity.map((l, i) => (
              <AmtRow key={i} label={l.name} amount={l.amount} prior={l.prior} indent />
            ))}
            <AmtRow label="当期純利益" amount={data.bs.netIncome} indent />
            <AmtRow label="純資産合計" amount={data.bs.totalEquity} bold />
          </div>
          <AmtRow
            label="負債及び純資産合計"
            amount={data.bs.totalLiabilities + data.bs.totalEquity}
            bold
          />
        </Sheet>

        {/* ===== 3. 損益計算書 ===== */}
        <Sheet>
          <h2 className="text-center text-xl font-bold tracking-widest mb-1">損益計算書</h2>
          <p className="text-center text-xs text-gray-500 mb-4">{periodLabel}</p>
          <ColHeader twoCol />
          {pl.sales.length > 0 && section("売上高", pl.sales, pl.salesT)}
          {pl.cogs.length > 0 && section("売上原価", pl.cogs, pl.cogsT)}
          <AmtRow label="売上総利益" amount={pl.grossProfit} bold />
          {pl.sga.length > 0 && section("販売費及び一般管理費", pl.sga, pl.sgaT)}
          <AmtRow label="営業利益" amount={pl.operatingProfit} bold />
          {pl.nonOpRev.length > 0 && section("営業外収益", pl.nonOpRev, pl.nonOpRevT)}
          {pl.nonOpExp.length > 0 && section("営業外費用", pl.nonOpExp, pl.nonOpExpT)}
          <AmtRow label="経常利益" amount={pl.ordinaryProfit} bold />
          {pl.extraGain.length > 0 && section("特別利益", pl.extraGain, pl.extraGainT)}
          {pl.extraLoss.length > 0 && section("特別損失", pl.extraLoss, pl.extraLossT)}
          <AmtRow label="税引前当期純利益" amount={pl.pretaxProfit} bold />
          {pl.tax.length > 0 && <AmtRow label="法人税等" amount={pl.taxT} indent />}
          <AmtRow label="当期純利益" amount={pl.netIncome} bold />
        </Sheet>

        {/* ===== 4. 株主資本等変動計算書 ===== */}
        <Sheet>
          <h2 className="text-center text-xl font-bold tracking-widest mb-1">株主資本等変動計算書</h2>
          <p className="text-center text-xs text-gray-500 mb-4">{periodLabel}</p>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-100">
                <th className="border border-gray-400 px-2 py-1.5 text-left">区分</th>
                <th className="border border-gray-400 px-2 py-1.5 text-right">当期首残高</th>
                <th className="border border-gray-400 px-2 py-1.5 text-right">当期変動額</th>
                <th className="border border-gray-400 px-2 py-1.5 text-right">当期末残高</th>
              </tr>
            </thead>
            <tbody>
              {data.changesInEquity.rows.map((r, i) => (
                <tr key={i}>
                  <td className="border border-gray-400 px-2 py-1.5">{r.label}</td>
                  <td className="border border-gray-400 px-2 py-1.5 text-right tabular-nums">{formatCurrency(r.opening)}</td>
                  <td className="border border-gray-400 px-2 py-1.5 text-right tabular-nums">{formatCurrency(r.change)}</td>
                  <td className="border border-gray-400 px-2 py-1.5 text-right tabular-nums">{formatCurrency(r.closing)}</td>
                </tr>
              ))}
              <tr className="font-bold bg-gray-50">
                <td className="border border-gray-400 px-2 py-1.5">純資産合計</td>
                <td className="border border-gray-400 px-2 py-1.5 text-right tabular-nums">{formatCurrency(data.changesInEquity.total.opening)}</td>
                <td className="border border-gray-400 px-2 py-1.5 text-right tabular-nums">{formatCurrency(data.changesInEquity.total.change)}</td>
                <td className="border border-gray-400 px-2 py-1.5 text-right tabular-nums">{formatCurrency(data.changesInEquity.total.closing)}</td>
              </tr>
            </tbody>
          </table>
        </Sheet>

        {/* ===== 5. 個別注記表 ===== */}
        <Sheet>
          <h2 className="text-center text-xl font-bold tracking-widest mb-6">個別注記表</h2>
          <div className="space-y-5 text-sm">
            {data.notes.map((n, i) => (
              <div key={i}>
                <p className="font-bold border-b border-gray-300 pb-0.5 mb-1">{i + 1}. {n.heading}</p>
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{n.body}</p>
              </div>
            ))}
          </div>
        </Sheet>

        {/* ===== 6. 販売費及び一般管理費の明細 ===== */}
        <Sheet>
          <h2 className="text-center text-xl font-bold tracking-widest mb-1">販売費及び一般管理費の明細</h2>
          <p className="text-center text-xs text-gray-500 mb-4">{periodLabel}</p>
          <ColHeader twoCol />
          {pl.sga.length === 0 ? (
            <p className="py-4 text-center text-sm text-gray-500">該当する費用はありません。</p>
          ) : (
            <>
              {pl.sga.map((l, i) => (
                <AmtRow key={i} label={l.name} amount={l.amount} prior={l.prior} indent />
              ))}
              <AmtRow label="販売費及び一般管理費 合計" amount={pl.sgaT} bold />
            </>
          )}
        </Sheet>
      </div>
    </div>
  );
}
