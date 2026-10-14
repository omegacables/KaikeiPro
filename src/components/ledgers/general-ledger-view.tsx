"use client";

/**
 * 総勘定元帳（補助科目を指定すれば補助元帳）。
 * 前期繰越から始めて残高を出し、各行に補助科目・相手先・税区分を添える。月ごとに「月計」をはさむ（切り替えられる）。
 * 行をクリックすると仕訳の詳細が開き、その場で修正できる。
 * 科目名をクリックすると「内訳」（相手先別・税区分別の合計）が開き、選ぶとその行だけに絞り込める。
 */

import { useEffect, useState } from "react";
import { Loader2, AlertTriangle, ChevronDown, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn, formatDate } from "@/lib/utils";
import { formatYen } from "@/lib/wareki";
import { TaxBadge } from "@/components/journal/tax-badge";
import { getLedgerBook, type LedgerBook } from "@/actions/ledger-books";
import { breakdownLedger, withMonthlyTotals, type LedgerBreakdownRow } from "@/lib/ledger";
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
  /** 月計の行を出すか */
  const [monthly, setMonthly] = useState(true);
  /** 内訳（相手先別・税区分別）を開いているか */
  const [showBreakdown, setShowBreakdown] = useState(false);
  /** 内訳で選んだ相手先・税区分で行を絞る */
  const [focus, setFocus] = useState<{ kind: "partner" | "tax"; key: string; label: string } | null>(null);
  useEffect(() => setFocus(null), [accountId, dateFrom, dateTo, subAccount]);

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
        ...withMonthlyTotals(book.rows, book.opening)
          .filter((x) => monthly || x.kind === "row")
          .map((x) =>
            x.kind === "month"
              ? ["", "", "", `${monthLabel(x.month)} 月計`, "", "", x.debit, x.credit, x.balance]
              : [
                  x.row.entryDate,
                  x.row.counterAccount,
                  x.row.subAccountName ?? "",
                  x.row.description,
                  x.row.partnerName ?? "",
                  x.row.taxCategoryName ?? "",
                  x.row.debit,
                  x.row.credit,
                  x.row.needsReview ? "要確認" : x.row.balance,
                ]
          ),
      ],
    });
  }, [book, onCsv, dateFrom, dateTo, monthly]);

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

  // 全角・半角や空白の違いだけの相手先（「２丁目」と「2丁目」など）は同じ相手先にまとめる
  const partnerKey = (r: LedgerBook["rows"][number]) => r.partnerName?.normalize("NFKC").replace(/\s+/g, " ").trim() || null;
  const taxKey = (r: LedgerBook["rows"][number]) => r.taxCategory;
  const taxName = new Map(book.rows.map((r) => [r.taxCategory ?? "", r.taxCategoryName ?? ""]));
  const matches = (r: LedgerBook["rows"][number]) =>
    !focus || ((focus.kind === "partner" ? partnerKey(r) : taxKey(r)) ?? "") === focus.key;
  // 絞り込み中は月計を出さない（一部の行だけの月計は残高と合わず紛らわしいため）
  const items = withMonthlyTotals(book.rows, book.opening, descending).filter((x) =>
    x.kind === "row" ? matches(x.row) : monthly && !focus
  );
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
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <button
          onClick={() => setShowBreakdown((v) => !v)}
          className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-bold text-foreground hover:border-primary/50"
          title="相手先別・税区分別の合計を見る"
        >
          {book.account.code} {book.account.name}
          <span className="text-xs font-normal text-muted-foreground">の内訳</span>
          <ChevronDown className={cn("size-4 transition-transform", showBreakdown && "rotate-180")} />
        </button>
        {focus && (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary">
            {focus.kind === "partner" ? "相手先" : "税区分"}: {focus.label} の行だけ表示中
            <button onClick={() => setFocus(null)} aria-label="絞り込みを解除" className="hover:text-foreground">
              <X className="size-3.5" />
            </button>
          </span>
        )}
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground w-fit">
          <input type="checkbox" checked={monthly} onChange={(e) => setMonthly(e.target.checked)} />
          月計を表示する
        </label>
      </div>
      {showBreakdown && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 print:hidden">
          <BreakdownTable
            title="相手先別"
            rows={breakdownLedger(book.account.category, book.rows, partnerKey)}
            label={(k) => k || "（相手先なし）"}
            active={focus?.kind === "partner" ? focus.key : null}
            onPick={(key, label) => setFocus(focus?.kind === "partner" && focus.key === key ? null : { kind: "partner", key, label })}
          />
          <BreakdownTable
            title="税区分別"
            rows={breakdownLedger(book.account.category, book.rows, taxKey)}
            label={(k) => taxName.get(k) || "（税区分なし）"}
            active={focus?.kind === "tax" ? focus.key : null}
            onPick={(key, label) => setFocus(focus?.kind === "tax" && focus.key === key ? null : { kind: "tax", key, label })}
          />
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
            {items.map((x) =>
              x.kind === "month" ? (
                <tr key={`m-${x.month}`} className="border-b border-border bg-muted/10 font-bold">
                  <td className="px-2 py-1.5" colSpan={6}>
                    <span className="block text-center">※※ {monthLabel(x.month)} 月計 ※※</span>
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono">{formatYen(x.debit)}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{formatYen(x.credit)}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{formatYen(x.balance)}</td>
                </tr>
              ) : (
                <tr
                  key={x.row.lineId}
                  onClick={() => onOpenEntry(x.row.entryId)}
                  className={cn(
                    "border-b border-border last:border-0 cursor-pointer hover:bg-primary/5",
                    x.row.needsReview && "bg-warning/5"
                  )}
                  title="クリックで仕訳の詳細（相手先・税率など）を表示・修正"
                >
                  <td className="px-2 py-1.5 whitespace-nowrap">{formatDate(x.row.entryDate)}</td>
                  <td className="px-2 py-1.5">
                    <span className="text-primary underline-offset-2 hover:underline">{x.row.counterAccount}</span>
                    {x.row.counterLines.length > 1 && (
                      <div className="text-[10px] text-muted-foreground">
                        {x.row.counterLines.map((c) => c.accountName).join("・")}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1.5">{x.row.subAccountName ?? ""}</td>
                  <td className="px-2 py-1.5 max-w-[260px] truncate" title={x.row.description}>
                    {x.row.description}
                    {x.row.needsReview && (
                      <Badge variant="warning" className="ml-1">
                        要確認
                      </Badge>
                    )}
                  </td>
                  <td className="px-2 py-1.5 max-w-[160px] truncate">{x.row.partnerName ?? ""}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <TaxBadge code={x.row.taxCategory} missing={isPl} />
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono">{x.row.debit ? formatYen(x.row.debit) : ""}</td>
                  <td className="px-2 py-1.5 text-right font-mono">{x.row.credit ? formatYen(x.row.credit) : ""}</td>
                  <td className="px-2 py-1.5 text-right font-mono font-bold">
                    {x.row.needsReview ? <span className="text-muted-foreground font-normal">-</span> : formatYen(x.row.balance)}
                  </td>
                </tr>
              )
            )}
            {descending && <OpeningRow amount={book.opening} isPl={isPl} />}
            {book.rows.length === 0 && (
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

/** 内訳の表（相手先別・税区分別）。行を選ぶと元帳をその行だけに絞る */
function BreakdownTable({
  title,
  rows,
  label,
  active,
  onPick,
}: {
  title: string;
  rows: LedgerBreakdownRow[];
  label: (key: string) => string;
  active: string | null;
  onPick: (key: string, label: string) => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-muted/20 border-b border-border text-muted-foreground">
            <th className="px-2 py-1.5 text-left font-bold">{title}</th>
            <th className="px-2 py-1.5 text-right font-bold w-12">件数</th>
            <th className="px-2 py-1.5 text-right font-bold w-24">借方</th>
            <th className="px-2 py-1.5 text-right font-bold w-24">貸方</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.key}
              onClick={() => onPick(r.key, label(r.key))}
              className={cn(
                "border-b border-border last:border-0 cursor-pointer hover:bg-primary/5",
                active === r.key && "bg-primary/10 font-bold"
              )}
              title="クリックでこの行だけを元帳に表示（もう一度で解除）"
            >
              <td className="px-2 py-1.5 truncate max-w-[220px]">{label(r.key)}</td>
              <td className="px-2 py-1.5 text-right font-mono">{r.count}</td>
              <td className="px-2 py-1.5 text-right font-mono">{r.debit ? formatYen(r.debit) : ""}</td>
              <td className="px-2 py-1.5 text-right font-mono">{r.credit ? formatYen(r.credit) : ""}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="px-2 py-4 text-center text-muted-foreground">
                この期間の取引はありません
              </td>
            </tr>
          )}
        </tbody>
      </table>
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

/** "2025-09" → "2025年9月" */
function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${y}年${m}月`;
}
