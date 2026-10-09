"use client";

/**
 * 売上・仕入の税区分別。
 * 期間内の収益・費用の行を税区分ごとに合計し、税区分を選ぶとその取引を一覧にする。
 * 「すべて」で売上・仕入をまとめて見ることもできる。税区分が未設定の行もここで見つけて直せる。
 */

import { Fragment, useEffect, useMemo, useState } from "react";
import { Loader2, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn, formatDate } from "@/lib/utils";
import { formatYen } from "@/lib/wareki";
import { TaxBadge } from "@/components/journal/tax-badge";
import { getTaxCategoryBook, type TaxBookLineView } from "@/actions/ledger-books";
import { summarizeByAccountAndCategory, type TaxBookRow, type AccountTaxRow } from "@/lib/tax-book";
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
  /** 税区分ごとの一覧か、科目別税区分表か */
  const [view, setView] = useState<"category" | "account">("category");

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

  const accountRows = useMemo(() => (data ? summarizeByAccountAndCategory(data.lines) : []), [data]);

  useEffect(() => {
    if (!onCsv) return;
    if (!data) return onCsv(null);
    if (view === "account") {
      return onCsv({
        filename: `科目別税区分表_${dateFrom}_${dateTo}.csv`,
        headers: ["区分", "科目コード", "勘定科目", "税区分", "件数", "税抜金額", "消費税", "税込金額"],
        rows: accountRows.flatMap((r) =>
          r.categories.map((c) => [
            r.side === "sales" ? "売上" : "仕入",
            r.accountCode,
            r.accountName,
            c.codeName,
            c.count,
            c.net,
            c.tax,
            c.gross,
          ])
        ),
      });
    }
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
  }, [data, lines, onCsv, dateFrom, dateTo, view, accountRows]);

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

      <div className="inline-flex gap-1 bg-muted/20 p-1 rounded-lg">
        {(
          [
            ["category", "税区分ごと"],
            ["account", "科目別税区分表"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setView(k)}
            className={cn(
              "px-3 py-1.5 rounded-md text-xs font-bold transition-all",
              view === k ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {view === "account" && <AccountTaxTable rows={accountRows} />}

      {view === "category" && (
      <>
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
                      <td className={cn("px-3 py-2", r.code === "none" ? "text-warning" : "text-primary")}>
                        <TaxBadge code={r.code === "none" ? null : r.code} missing className="mr-1.5" />
                        {r.name}
                      </td>
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
                <td className="px-2 py-1.5">
                  <TaxBadge code={l.code === "none" ? null : l.code} missing className="mr-1" />
                  <span className={cn(l.code === "none" && "text-warning")}>{l.codeName}</span>
                </td>
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
      </>
      )}
      <p className="text-[11px] text-muted-foreground">
        消費税は仕訳ごとに、税込経理なら金額から取り出し、税抜経理（仮受消費税・仮払消費税を別に立てた仕訳）なら税抜金額×税率で出しています（消費税計算の画面と同じ方法）。要確認の仕訳は一覧には出しますが、合計には含めません。
      </p>
    </div>
  );
}

/**
 * 科目別税区分表。科目ごとに、どの税区分でいくら計上したかを並べる。
 * 「売上高に非課税が混ざっている」「給料に課税仕入が付いている」といった誤りを見つけやすくする。
 */
function AccountTaxTable({ rows }: { rows: AccountTaxRow[] }) {
  if (rows.length === 0) {
    return <p className="rounded-xl border border-border p-8 text-center text-sm text-muted-foreground">この期間の売上・仕入はありません</p>;
  }
  const sides = (["sales", "purchase"] as const).map((side) => ({
    side,
    label: side === "sales" ? "売上（収益）" : "仕入・経費（費用）",
    rows: rows.filter((r) => r.side === side),
  }));
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full min-w-[820px] text-xs">
        <thead>
          <tr className="bg-muted/20 border-b border-border text-muted-foreground">
            <th className="px-3 py-2 text-left font-bold">勘定科目</th>
            <th className="px-3 py-2 text-left font-bold">税区分</th>
            <th className="px-3 py-2 text-right font-bold">件数</th>
            <th className="px-3 py-2 text-right font-bold">税抜金額</th>
            <th className="px-3 py-2 text-right font-bold">消費税</th>
            <th className="px-3 py-2 text-right font-bold">税込金額</th>
          </tr>
        </thead>
        <tbody>
          {sides.map(
            (s) =>
              s.rows.length > 0 && (
                <Fragment key={s.side}>
                  <tr className="bg-muted/10 border-t border-border">
                    <td colSpan={6} className="px-3 py-1.5 font-bold text-primary">
                      {s.label}
                    </td>
                  </tr>
                  {s.rows.map((r) =>
                    r.categories.map((c, i) => (
                      <tr key={`${r.accountCode}-${r.accountName}-${c.code}`} className="border-b border-border/50">
                        {i === 0 && (
                          <td rowSpan={r.categories.length + (r.categories.length > 1 ? 1 : 0)} className="px-3 py-1.5 align-top font-medium whitespace-nowrap">
                            <span className="text-muted-foreground font-mono mr-1.5">{r.accountCode}</span>
                            {r.accountName}
                          </td>
                        )}
                        <td className="px-3 py-1.5 whitespace-nowrap">
                          <TaxBadge code={c.code === "none" ? null : c.code} missing className="mr-1.5" />
                          <span className={cn(c.code === "none" && "text-warning")}>{c.codeName}</span>
                        </td>
                        <td className="px-3 py-1.5 text-right text-muted-foreground">{c.count}</td>
                        <td className="px-3 py-1.5 text-right font-mono">{formatYen(c.net)}</td>
                        <td className="px-3 py-1.5 text-right font-mono">{c.tax ? formatYen(c.tax) : "-"}</td>
                        <td className="px-3 py-1.5 text-right font-mono">{formatYen(c.gross)}</td>
                      </tr>
                    )).concat(
                      r.categories.length > 1
                        ? [
                            <tr key={`${r.accountCode}-${r.accountName}-total`} className="border-b border-border bg-muted/10 font-bold">
                              <td className="px-3 py-1.5 text-right text-muted-foreground">科目計</td>
                              <td />
                              <td className="px-3 py-1.5 text-right font-mono">{formatYen(r.net)}</td>
                              <td className="px-3 py-1.5 text-right font-mono">{r.tax ? formatYen(r.tax) : "-"}</td>
                              <td className="px-3 py-1.5 text-right font-mono">{formatYen(r.gross)}</td>
                            </tr>,
                          ]
                        : []
                    )
                  )}
                  <tr className="border-t-2 border-border bg-muted/20 font-bold">
                    <td colSpan={3} className="px-3 py-2">
                      {s.label}の合計
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{formatYen(s.rows.reduce((a, r) => a + r.net, 0))}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatYen(s.rows.reduce((a, r) => a + r.tax, 0))}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatYen(s.rows.reduce((a, r) => a + r.gross, 0))}</td>
                  </tr>
                </Fragment>
              )
          )}
        </tbody>
      </table>
    </div>
  );
}
