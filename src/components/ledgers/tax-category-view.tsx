"use client";

/**
 * 売上・仕入の税区分別。
 * 期間内の収益・費用の行を税区分ごとに合計し、税区分を選ぶとその取引を一覧にする。
 * 「すべて」で売上・仕入をまとめて見ることもできる。税区分が未設定の行もここで見つけて直せる。
 */

import { useEffect, useMemo, useState } from "react";
import { Loader2, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn, formatDate } from "@/lib/utils";
import { formatYen } from "@/lib/wareki";
import { getTaxCategoryBook, type TaxBookLineView } from "@/actions/ledger-books";
import type { TaxBookRow } from "@/lib/tax-book";
import type { CsvSpec } from "@/components/ledgers/general-ledger-view";
import { beginLoad, endLoad } from "@/lib/loading-bus";

/** 一覧の絞り込み: すべて / 売上すべて / 仕入すべて / 税区分ひとつ */
type Filter = "all" | "sales" | "purchase" | `sales:${string}` | `purchase:${string}`;

export function TaxCategoryView({
  clientId,
  dateFrom,
  dateTo,
  descending,
  reloadKey,
  onOpenEntry,
  onCsv,
}: {
  clientId: string;
  dateFrom: string;
  dateTo: string;
  descending?: boolean;
  reloadKey?: number;
  onOpenEntry: (entryId: string) => void;
  onCsv?: (spec: CsvSpec | null) => void;
}) {
  const [data, setData] = useState<{ summary: TaxBookRow[]; lines: TaxBookLineView[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    beginLoad();
    getTaxCategoryBook(clientId, dateFrom, dateTo)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "読み込みに失敗しました"))
      .finally(endLoad);
    return () => {
      alive = false;
    };
  }, [clientId, dateFrom, dateTo, reloadKey]);

  const lines = useMemo(() => {
    if (!data) return [];
    let xs = data.lines;
    if (filter === "sales" || filter === "purchase") xs = xs.filter((l) => l.side === filter);
    else if (filter !== "all") {
      const [side, code] = filter.split(":");
      xs = xs.filter((l) => l.side === side && l.code === code);
    }
    return descending ? [...xs].reverse() : xs;
  }, [data, filter, descending]);

  useEffect(() => {
    if (!onCsv) return;
    if (!data) return onCsv(null);
    onCsv({
      filename: `税区分別_${dateFrom}_${dateTo}.csv`,
      headers: ["日付", "区分", "税区分", "勘定科目", "補助科目", "摘要", "税抜金額", "消費税", "税込金額", "経理方式", "状態"],
      rows: lines.map((l) => [
        l.entryDate,
        l.side === "sales" ? "売上" : "仕入",
        l.codeName,
        l.accountName,
        l.subAccountName ?? "",
        l.description,
        l.net,
        l.tax,
        l.gross,
        l.exclusive ? "税抜" : "税込",
        l.needsReview ? "要確認" : "",
      ]),
    });
  }, [data, lines, onCsv, dateFrom, dateTo]);

  if (error) return <p className="text-sm text-destructive p-4">{error}</p>;
  if (!data) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card p-12 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
        <span className="text-sm">読み込み中...</span>
      </div>
    );
  }

  const sides = (["sales", "purchase"] as const).map((side) => {
    const rows = data.summary.filter((r) => r.side === side);
    return {
      side,
      label: side === "sales" ? "売上" : "仕入",
      rows,
      net: rows.reduce((s, r) => s + r.net, 0),
      tax: rows.reduce((s, r) => s + r.tax, 0),
      gross: rows.reduce((s, r) => s + r.gross, 0),
      count: rows.reduce((s, r) => s + r.count, 0),
    };
  });
  const unset = data.summary.filter((r) => r.code === "none").reduce((s, r) => s + r.count, 0);

  return (
    <div className="space-y-4">
      {unset > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          <AlertTriangle className="size-3.5 mt-0.5 shrink-0" />
          税区分が未設定の取引が{unset}件あります。消費税の集計に入っていません。「税区分未設定」を選んで一覧から修正してください。
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {sides.map((s) => (
          <div key={s.side} className="overflow-hidden rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/20 border-b border-border text-xs text-muted-foreground">
                  <th className="px-3 py-2 text-left font-bold">{s.label}の税区分</th>
                  <th className="px-3 py-2 text-right font-bold">件数</th>
                  <th className="px-3 py-2 text-right font-bold">税抜金額</th>
                  <th className="px-3 py-2 text-right font-bold">消費税</th>
                  <th className="px-3 py-2 text-right font-bold">税込金額</th>
                </tr>
              </thead>
              <tbody>
                {s.rows.map((r) => {
                  const key = `${s.side}:${r.code}` as Filter;
                  return (
                    <tr
                      key={r.code}
                      onClick={() => setFilter(key)}
                      className={cn(
                        "border-b border-border last:border-0 cursor-pointer hover:bg-primary/5",
                        filter === key && "bg-primary/10"
                      )}
                    >
                      <td className={cn("px-3 py-2", r.code === "none" ? "text-warning" : "text-primary")}>{r.name}</td>
                      <td className="px-3 py-2 text-right text-muted-foreground">{r.count}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatYen(r.net)}</td>
                      <td className="px-3 py-2 text-right font-mono">{r.tax ? formatYen(r.tax) : "-"}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatYen(r.gross)}</td>
                    </tr>
                  );
                })}
                {s.rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground text-xs">
                      この期間の{s.label}はありません
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr
                  onClick={() => setFilter(s.side)}
                  className={cn("border-t-2 border-border bg-muted/20 font-bold cursor-pointer", filter === s.side && "bg-primary/10")}
                  title={`${s.label}をすべて表示`}
                >
                  <td className="px-3 py-2">{s.label}合計</td>
                  <td className="px-3 py-2 text-right">{s.count}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatYen(s.net)}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatYen(s.tax)}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatYen(s.gross)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-xs font-bold text-muted-foreground">表示:</span>
        {(
          [
            ["all", "すべて"],
            ["sales", "売上すべて"],
            ["purchase", "仕入すべて"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={cn(
              "px-2.5 py-1 rounded-full border text-xs",
              filter === k ? "bg-primary text-cream border-primary" : "border-border text-muted-foreground hover:bg-muted/30"
            )}
          >
            {label}
          </button>
        ))}
        {filter.includes(":") && (
          <Badge variant="accent">
            {data.summary.find((r) => `${r.side}:${r.code}` === filter)?.name ?? ""}
          </Badge>
        )}
        <span className="ml-auto text-xs text-muted-foreground">{lines.length}件</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[860px] text-xs">
          <thead>
            <tr className="bg-muted/20 border-b border-border text-muted-foreground">
              <th className="px-2 py-2 text-left font-bold w-24">日付</th>
              <th className="px-2 py-2 text-left font-bold">区分</th>
              <th className="px-2 py-2 text-left font-bold">税区分</th>
              <th className="px-2 py-2 text-left font-bold">勘定科目</th>
              <th className="px-2 py-2 text-left font-bold">補助科目</th>
              <th className="px-2 py-2 text-left font-bold">摘要</th>
              <th className="px-2 py-2 text-right font-bold">税抜金額</th>
              <th className="px-2 py-2 text-right font-bold">消費税</th>
              <th className="px-2 py-2 text-right font-bold">税込金額</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr
                key={l.lineId}
                onClick={() => onOpenEntry(l.entryId)}
                className={cn("border-b border-border last:border-0 cursor-pointer hover:bg-primary/5", l.needsReview && "bg-warning/5")}
                title="クリックで仕訳の詳細を表示・修正"
              >
                <td className="px-2 py-1.5 whitespace-nowrap">{formatDate(l.entryDate)}</td>
                <td className="px-2 py-1.5">{l.side === "sales" ? "売上" : "仕入"}</td>
                <td className={cn("px-2 py-1.5", l.code === "none" && "text-warning")}>{l.codeName}</td>
                <td className="px-2 py-1.5">{l.accountName}</td>
                <td className="px-2 py-1.5">{l.subAccountName ?? ""}</td>
                <td className="px-2 py-1.5 max-w-[280px] truncate" title={l.description}>
                  {l.description}
                  {l.needsReview && (
                    <Badge variant="warning" className="ml-1">
                      要確認
                    </Badge>
                  )}
                </td>
                <td className="px-2 py-1.5 text-right font-mono">{formatYen(l.net)}</td>
                <td className="px-2 py-1.5 text-right font-mono">{l.tax ? formatYen(l.tax) : "-"}</td>
                <td className="px-2 py-1.5 text-right font-mono">{formatYen(l.gross)}</td>
              </tr>
            ))}
            {lines.length === 0 && (
              <tr>
                <td colSpan={9} className="px-2 py-8 text-center text-muted-foreground">
                  該当する取引はありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        消費税は仕訳ごとに、税込経理なら金額から取り出し、税抜経理（仮受消費税・仮払消費税を別に立てた仕訳）なら税抜金額×税率で出しています（消費税計算の画面と同じ方法）。要確認の仕訳は一覧には出しますが、合計には含めません。
      </p>
    </div>
  );
}
