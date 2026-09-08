"use client";

import { useEffect, useState, use } from "react";
import { Printer, Loader2, ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { getLoanBreakdownReport } from "@/actions/loans";
import type { LoanBreakdownReport } from "@/types/index";
import { printPage } from "@/lib/export";

// 印刷時はこの帳票だけを出す（既存の決算書と同じ方式）
const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  #breakdown-root, #breakdown-root * { visibility: visible !important; }
  #breakdown-root { position: absolute; left: 0; top: 0; width: 100%; }
  .no-print { display: none !important; }
  .sheet { page-break-after: always; box-shadow: none !important; border: none !important; margin: 0 auto !important; }
  .sheet:last-child { page-break-after: auto; }
  @page { size: A4 portrait; margin: 14mm; }
}
`;

const SERIF = `"Hiragino Mincho ProN", "Yu Mincho", "MS PMincho", serif`;

/** 金額表記。マイナスは △ で表す（帳簿の慣行） */
function fmt(n: number): string {
  const v = Math.round(n);
  return v < 0 ? `△${Math.abs(v).toLocaleString()}` : v.toLocaleString();
}

/** 西暦を和暦に直す（令和のみ。それ以前は西暦のまま） */
function jpYear(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (y >= 2019) {
    const r = y - 2018;
    return `令和${r === 1 ? "元" : r}年${m}月${d}日`;
  }
  return `${y}年${m}月${d}日`;
}

export default function LoanBreakdownPage({
  params,
}: {
  params: Promise<{ id: string; year: string }>;
}) {
  const { id, year } = use(params);
  const router = useRouter();
  const [report, setReport] = useState<LoanBreakdownReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getLoanBreakdownReport(id, Number(year))
      .then(setReport)
      .catch((e) => setError(e instanceof Error ? e.message : "読み込みに失敗しました"))
      .finally(() => setLoading(false));
  }, [id, year]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-[17px] text-foreground">
        <Loader2 className="size-5 animate-spin mr-2" />
        読み込み中...
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-[17px] text-destructive">
        {error ?? "データがありません"}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <Button variant="outline" onClick={() => router.push(`/clients/${id}/loans`)}>
          <ArrowLeft className="size-4" />
          借入金台帳に戻る
        </Button>

        {/* 内訳書が要るのは決算後で、そのとき作るのは「終わったばかりの前期」分。
            事業年度を選べないと前期の書類が作れないため、前後に移動できるようにする。 */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => router.push(`/clients/${id}/loans/breakdown/${Number(year) - 1}`)}
            title="前の事業年度"
          >
            <ChevronLeft className="size-4" />
            前期
          </Button>
          <span className="text-[17px] font-medium tabular-nums">
            {report.periodStart} 〜 {report.periodEnd}
          </span>
          <Button
            variant="outline"
            onClick={() => router.push(`/clients/${id}/loans/breakdown/${Number(year) + 1}`)}
            title="次の事業年度"
          >
            翌期
            <ChevronRight className="size-4" />
          </Button>
        </div>

        <Button onClick={printPage}>
          <Printer className="size-4" />
          印刷 / PDF保存
        </Button>
      </div>

      {report.rows.length === 0 && (
        <p className="no-print text-[17px] text-foreground">
          この事業年度（{report.periodStart} 〜 {report.periodEnd}）に記載対象となる借入金がありません。
          別の年度は「前期」「翌期」で切り替えられます。
        </p>
      )}

      <div id="breakdown-root">
        <div
          className="sheet mx-auto w-full max-w-[820px] bg-white text-black p-10 shadow"
          style={{ fontFamily: SERIF }}
        >
          <h1 className="text-center text-xl font-bold tracking-widest">
            借入金及び支払利子の内訳書
          </h1>

          <div className="mt-6 flex justify-between text-[15px]">
            <span>法人名: {report.clientName}</span>
            <span>
              事業年度: {jpYear(report.periodStart)} 〜 {jpYear(report.periodEnd)}
            </span>
          </div>

          <table className="mt-4 w-full border-collapse text-[14px]">
            <thead>
              <tr>
                {[
                  "借入先",
                  "所在地",
                  "期末現在高",
                  "期中の支払利子額",
                  "利率",
                  "借入理由",
                ].map((h) => (
                  <th
                    key={h}
                    className="border border-black px-2 py-1.5 text-center font-bold bg-gray-100"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r, i) => (
                <tr key={i}>
                  <td className="border border-black px-2 py-1.5">
                    {r.lender_name}
                    {/* 役員借入金は必ず記載対象になるため、明示しておく */}
                    {r.is_officer && <span className="ml-1 text-[12px]">（役員）</span>}
                  </td>
                  <td className="border border-black px-2 py-1.5">{r.address ?? ""}</td>
                  <td className="border border-black px-2 py-1.5 text-right tabular-nums">
                    {fmt(r.closing_balance)}
                  </td>
                  <td className="border border-black px-2 py-1.5 text-right tabular-nums">
                    {fmt(r.interest_paid)}
                  </td>
                  <td className="border border-black px-2 py-1.5 text-right tabular-nums">
                    {r.interest_rate != null ? `${r.interest_rate}%` : ""}
                  </td>
                  <td className="border border-black px-2 py-1.5">{r.purpose ?? ""}</td>
                </tr>
              ))}

              {/* 用紙らしく見せるため、行が少ないときは空行で埋める */}
              {Array.from({ length: Math.max(0, 8 - report.rows.length) }).map((_, i) => (
                <tr key={`blank-${i}`}>
                  {Array.from({ length: 6 }).map((__, c) => (
                    <td key={c} className="border border-black px-2 py-1.5">
                      &nbsp;
                    </td>
                  ))}
                </tr>
              ))}

              <tr>
                <td
                  colSpan={2}
                  className="border border-black px-2 py-1.5 text-center font-bold bg-gray-100"
                >
                  計
                </td>
                <td className="border border-black px-2 py-1.5 text-right font-bold tabular-nums">
                  {fmt(report.totalClosingBalance)}
                </td>
                <td className="border border-black px-2 py-1.5 text-right font-bold tabular-nums">
                  {fmt(report.totalInterestPaid)}
                </td>
                <td className="border border-black px-2 py-1.5"></td>
                <td className="border border-black px-2 py-1.5"></td>
              </tr>
            </tbody>
          </table>

          <p className="mt-4 text-[12px] leading-relaxed">
            ※ 期末現在高は決算日（{report.periodEnd}）時点の増減明細の積み上げ、
            支払利子額は当該事業年度（{report.periodStart} 〜 {report.periodEnd}）に
            支払った利息と元本に加算した利息の合計です。
            役員からの借入金は残高が無い場合も記載対象として表示しています。
          </p>
        </div>
      </div>
    </div>
  );
}
