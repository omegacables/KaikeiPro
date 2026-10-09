"use client";

/**
 * 総勘定元帳（補助科目を指定すれば補助元帳）。
 * 前期繰越から始めて残高を出し、各行に補助科目・相手先・税区分を添える。
 * 行をクリックすると仕訳の詳細が開き、その場で修正できる。
 */

import { useEffect, useState } from "react";
import { Loader2, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn, formatDate } from "@/lib/utils";
import { formatYen } from "@/lib/wareki";
import { getLedgerBook, type LedgerBook } from "@/actions/ledger-books";
import { beginLoad, endLoad } from "@/lib/loading-bus";

export type CsvSpec = { filename: string; headers: string[]; rows: (string | number)[][] };

export function GeneralLedgerView({
  clientId,
  accountId,
  dateFrom,
  dateTo,
  subAccount,
  descending,
  reloadKey,
  onOpenEntry,
  onCsv,
}: {
  clientId: string;
  accountId: string;
  dateFrom: string;
  dateTo: string;
  /** 補助科目で絞る（"none" は補助科目なし） */
  subAccount?: string | "none" | null;
  descending?: boolean;
  /** 値が変わると読み直す（仕訳を修正した後など） */
  reloadKey?: number;
  onOpenEntry: (entryId: string) => void;
  onCsv?: (spec: CsvSpec | null) => void;
}) {
  const [book, setBook] = useState<LedgerBook | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accountId) return;
    let alive = true;
    setLoading(true);
    setError(null);
    beginLoad();
    getLedgerBook(clientId, accountId, dateFrom, dateTo, subAccount ?? null)
      .then((b) => alive && setBook(b))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "読み込みに失敗しました"))
      .finally(() => {
        endLoad();
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [clientId, accountId, dateFrom, dateTo, subAccount, reloadKey]);

  useEffect(() => {
    if (!onCsv) return;
    if (!book) return onCsv(null);
    onCsv({
      filename: `総勘定元帳_${book.account.name}_${dateFrom}_${dateTo}.csv`,
      headers: ["日付", "相手科目", "補助科目", "摘要", "相手先", "税区分", "借方", "貸方", "残高"],
      rows: [
        [dateFrom, "前期繰越", "", "", "", "", "", "", book.opening],
        ...book.rows.map((r) => [
          r.entryDate,
          r.counterAccount,
          r.subAccountName ?? "",
          r.description,
          r.partnerName ?? "",
          r.taxCategoryName ?? "",
          r.debit,
          r.credit,
          r.needsReview ? "要確認" : r.balance,
        ]),
      ],
    });
  }, [book, onCsv, dateFrom, dateTo]);

  if (!accountId) {
    return <p className="text-sm text-muted-foreground p-6">勘定科目を選んでください。</p>;
  }
  if (error) return <p className="text-sm text-destructive p-4">{error}</p>;
  if (loading || !book) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card p-12 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
        <span className="text-sm">読み込み中...</span>
      </div>
    );
  }

  const rows = descending ? [...book.rows].reverse() : book.rows;
  const reviewCount = book.rows.filter((r) => r.needsReview).length;
  const isPl = book.account.category === "revenue" || book.account.category === "expense";

  return (
    <div className="space-y-2">
      {reviewCount > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          <AlertTriangle className="size-3.5 mt-0.5 shrink-0" />
          要確認の仕訳が{reviewCount}件あります。試算表と同じく残高には含めていません（行をクリックして確認・修正できます）。
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[980px] text-xs">
          <thead>
            <tr className="bg-muted/20 border-b border-border text-muted-foreground">
              <th className="px-2 py-2 text-left font-bold w-24">日付</th>
              <th className="px-2 py-2 text-left font-bold">相手科目</th>
              <th className="px-2 py-2 text-left font-bold">補助科目</th>
              <th className="px-2 py-2 text-left font-bold">摘要</th>
              <th className="px-2 py-2 text-left font-bold">相手先</th>
              <th className="px-2 py-2 text-left font-bold">税区分</th>
              <th className="px-2 py-2 text-right font-bold">借方</th>
              <th className="px-2 py-2 text-right font-bold">貸方</th>
              <th className="px-2 py-2 text-right font-bold">残高</th>
            </tr>
          </thead>
          <tbody>
            {!descending && <OpeningRow amount={book.opening} isPl={isPl} />}
            {rows.map((r) => (
              <tr
                key={r.lineId}
                onClick={() => onOpenEntry(r.entryId)}
                className={cn(
                  "border-b border-border last:border-0 cursor-pointer hover:bg-primary/5",
                  r.needsReview && "bg-warning/5"
                )}
                title="クリックで仕訳の詳細（相手先・税率など）を表示・修正"
              >
                <td className="px-2 py-1.5 whitespace-nowrap">{formatDate(r.entryDate)}</td>
                <td className="px-2 py-1.5">
                  <span className="text-primary underline-offset-2 hover:underline">{r.counterAccount}</span>
                  {r.counterLines.length > 1 && (
                    <div className="text-[10px] text-muted-foreground">
                      {r.counterLines.map((c) => c.accountName).join("・")}
                    </div>
                  )}
                </td>
                <td className="px-2 py-1.5">{r.subAccountName ?? ""}</td>
                <td className="px-2 py-1.5 max-w-[260px] truncate" title={r.description}>
                  {r.description}
                  {r.needsReview && (
                    <Badge variant="warning" className="ml-1">
                      要確認
                    </Badge>
                  )}
                </td>
                <td className="px-2 py-1.5 max-w-[160px] truncate">{r.partnerName ?? ""}</td>
                <td className="px-2 py-1.5 whitespace-nowrap text-muted-foreground">{r.taxCategoryName ?? ""}</td>
                <td className="px-2 py-1.5 text-right font-mono">{r.debit ? formatYen(r.debit) : ""}</td>
                <td className="px-2 py-1.5 text-right font-mono">{r.credit ? formatYen(r.credit) : ""}</td>
                <td className="px-2 py-1.5 text-right font-mono font-bold">
                  {r.needsReview ? <span className="text-muted-foreground font-normal">-</span> : formatYen(r.balance)}
                </td>
              </tr>
            ))}
            {descending && <OpeningRow amount={book.opening} isPl={isPl} />}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-2 py-8 text-center text-muted-foreground">
                  この期間の取引はありません
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border bg-muted/20 font-bold">
              <td colSpan={6} className="px-2 py-2 text-right">
                合計 ／ 期末残高
              </td>
              <td className="px-2 py-2 text-right font-mono">{formatYen(book.debitTotal)}</td>
              <td className="px-2 py-2 text-right font-mono">{formatYen(book.creditTotal)}</td>
              <td className="px-2 py-2 text-right font-mono">{formatYen(book.closing)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function OpeningRow({ amount, isPl }: { amount: number; isPl: boolean }) {
  return (
    <tr className="border-b border-border bg-muted/10 text-muted-foreground">
      <td className="px-2 py-1.5" />
      <td className="px-2 py-1.5 font-bold" colSpan={7}>
        {isPl ? "前月までの累計（期首から）" : "前期繰越"}
      </td>
      <td className="px-2 py-1.5 text-right font-mono font-bold text-foreground">{formatYen(amount)}</td>
    </tr>
  );
}
