"use client";

/**
 * 消費税の集計表（10%分／8%（軽）分）。帳簿閲覧の「税区分別」から開く。
 * 区分の分け方は src/lib/tax-summary-table.ts（テストあり）。
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import { formatYen } from "@/lib/wareki";
import type { SummaryRow, SummaryTab } from "@/lib/tax-summary-table";

export function ConsumptionTaxTable({ tabs }: { tabs: SummaryTab[] }) {
  const [rate, setRate] = useState<"10" | "8">("10");
  const tab = tabs.find((t) => t.rate === rate) ?? tabs[0];
  return (
    <div className="space-y-3">
      <div className="flex border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.rate}
            onClick={() => setRate(t.rate)}
            className={cn(
              "px-4 py-1.5 text-sm font-bold border-b-2 -mb-px",
              t.rate === rate ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.title}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
        <Section title="売上" rows={tab.sales} />
        <Section title="仕入" rows={tab.purchase} />
      </div>
      <p className="text-xs text-muted-foreground">
        対価の返還は、売上の科目の借方（返品・値引き・取消）と仕入の科目の貸方の金額です。用途区分の無い仕入は「共通売上対応」に入れています。
        免税・非課税・対象外・地方消費税貨物割のような税率の無い取引は「10%分」に表示します。要確認の仕訳は含めていません。
      </p>
    </div>
  );
}

function Section({ title, rows }: { title: string; rows: SummaryRow[] }) {
  // 同じグループ（仕入・輸入仕入・仕入返還など）の行は、グループ名を1回だけ出す
  const span = new Map<number, number>();
  rows.forEach((r, i) => {
    if (!r.group) return;
    if (i > 0 && rows[i - 1].group === r.group) return;
    let n = 1;
    while (rows[i + n]?.group === r.group) n++;
    span.set(i, n);
  });
  const td = "px-2 py-1.5 text-right font-mono tabular-nums";
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full min-w-[560px] text-xs">
        <thead>
          <tr className="bg-muted/20 border-b border-border text-muted-foreground">
            <th className="px-2 py-2 text-left font-bold" colSpan={2}>
              {title}
            </th>
            <th className="px-2 py-2 text-right font-bold">件数</th>
            <th className="px-2 py-2 text-right font-bold">税込金額</th>
            <th className="px-2 py-2 text-right font-bold">税抜金額</th>
            <th className="px-2 py-2 text-right font-bold">消費税額</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.key} className={cn("border-b border-border last:border-0", r.cell.count === 0 && "text-muted-foreground")}>
              {r.group ? (
                span.has(i) && (
                  <td rowSpan={span.get(i)} className="px-2 py-1.5 font-bold align-middle border-r border-border w-20 whitespace-nowrap">
                    {r.group}
                  </td>
                )
              ) : null}
              <td className="px-2 py-1.5" colSpan={r.group ? 1 : 2}>
                {r.label}
              </td>
              <td className={td}>{r.cell.count || ""}</td>
              <td className={td}>{r.cell.count ? formatYen(r.cell.gross) : ""}</td>
              <td className={td}>{r.cell.count ? formatYen(r.cell.net) : ""}</td>
              <td className={td}>{r.cell.count ? formatYen(r.cell.tax) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
