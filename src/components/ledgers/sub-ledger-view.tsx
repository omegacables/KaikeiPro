"use client";

/**
 * 補助元帳（相手先別）。売掛帳・買掛帳もこれを使う。
 *
 * まず補助科目（相手先）ごとの 前期繰越・発生・回収（支払）・残高 を一覧にし、
 * 相手先を名前で検索（予測変換）するか一覧の行をクリックすると、その相手先の取引を元帳で出す。
 */

import { useEffect, useMemo, useState } from "react";
import { Loader2, ArrowLeft, Search, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PartnerInput } from "@/components/ui/partner-input";
import { formatYen } from "@/lib/wareki";
import { getSubAccountSummary, type SubAccountSummaryView, type LedgerAccount } from "@/actions/ledger-books";
import { GeneralLedgerView, type CsvSpec } from "@/components/ledgers/general-ledger-view";
import { beginLoad, endLoad } from "@/lib/loading-bus";

/** 増減の呼び方（売掛金なら 発生／回収、買掛金なら 発生／支払） */
function movementLabels(a: LedgerAccount | null): [string, string] {
  if (!a) return ["増加", "減少"];
  if (/売掛|未収/.test(a.name)) return ["発生", "回収"];
  if (/買掛|未払/.test(a.name)) return ["発生", "支払"];
  if (a.category === "asset" && /預金|現金/.test(a.name)) return ["入金", "出金"];
  if (a.category === "expense") return ["発生", "取消"];
  return ["増加", "減少"];
}

export function SubLedgerView({
  clientId,
  accountId,
  dateFrom,
  dateTo,
  descending,
  reloadKey,
  onOpenEntry,
  onCsv,
}: {
  clientId: string;
  accountId: string;
  dateFrom: string;
  dateTo: string;
  descending?: boolean;
  reloadKey?: number;
  onOpenEntry: (entryId: string) => void;
  onCsv?: (spec: CsvSpec | null) => void;
}) {
  const [account, setAccount] = useState<LedgerAccount | null>(null);
  const [rows, setRows] = useState<SubAccountSummaryView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  /** 開いている相手先（補助科目ID、"none" は補助科目なし）と、その名前 */
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState("");
  const open = (id: string, name: string) => {
    setSelected(id);
    setSelectedName(name);
  };

  useEffect(() => {
    setSelected(null);
    setQuery("");
  }, [accountId]);

  useEffect(() => {
    if (!accountId) return;
    let alive = true;
    setRows(null);
    setError(null);
    beginLoad();
    getSubAccountSummary(clientId, accountId, dateFrom, dateTo)
      .then((r) => {
        if (!alive) return;
        setAccount(r.account);
        setRows(r.rows);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "読み込みに失敗しました"))
      .finally(endLoad);
    return () => {
      alive = false;
    };
  }, [clientId, accountId, dateFrom, dateTo, reloadKey]);

  const [incLabel, decLabel] = movementLabels(account);

  useEffect(() => {
    if (!onCsv || selected) return;
    if (!rows || !account) return onCsv(null);
    onCsv({
      filename: `補助元帳_${account.name}_相手先別_${dateFrom}_${dateTo}.csv`,
      headers: ["相手先（補助科目）", "前期繰越", incLabel, decLabel, "残高", "件数"],
      rows: rows.map((r) => [r.name, r.opening, r.increase, r.decrease, r.closing, r.count]),
    });
  }, [rows, account, selected, onCsv, dateFrom, dateTo, incLabel, decLabel]);

  const suggestions = useMemo(
    () => (rows ?? []).filter((r) => r.subAccountId).map((r) => ({ id: r.subAccountId!, name: r.name, sub: `残高 ${formatYen(r.closing)}円` })),
    [rows]
  );
  const filtered = useMemo(() => {
    if (!rows) return [];
    const q = query.trim().normalize("NFKC").toLowerCase();
    return q ? rows.filter((r) => r.name.normalize("NFKC").toLowerCase().includes(q)) : rows;
  }, [rows, query]);

  if (!accountId) return <p className="text-sm text-muted-foreground p-6">勘定科目を選んでください。</p>;
  if (error) return <p className="text-sm text-destructive p-4">{error}</p>;

  // 相手先を開いているときは、その相手先の元帳
  if (selected) {
    // 修正で補助科目を付け替えると一覧から消えることがあるため、開いたときの名前を出す
    const name = selectedName;
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => setSelected(null)}>
            <ArrowLeft className="size-4" />
            相手先の一覧に戻る
          </Button>
          <span className="text-sm font-bold">
            {account?.name}　／　{name}
          </span>
        </div>
        <GeneralLedgerView
          clientId={clientId}
          accountId={accountId}
          dateFrom={dateFrom}
          dateTo={dateTo}
          subAccount={selected}
          descending={descending}
          reloadKey={reloadKey}
          onOpenEntry={onOpenEntry}
          onCsv={onCsv}
        />
      </div>
    );
  }

  if (!rows) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card p-12 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" />
        <span className="text-sm">読み込み中...</span>
      </div>
    );
  }

  const total = rows.reduce(
    (s, r) => ({ opening: s.opening + r.opening, inc: s.inc + r.increase, dec: s.dec + r.decrease, closing: s.closing + r.closing }),
    { opening: 0, inc: 0, dec: 0, closing: 0 }
  );
  const noSubOnly = rows.length > 0 && rows.every((r) => !r.subAccountId);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-80">
          <label className="block text-xs font-bold text-muted-foreground mb-1">
            <Search className="inline size-3 mr-1" />
            相手先を検索（名前の一部でも探せます）
          </label>
          <PartnerInput
            value={query}
            partners={suggestions}
            placeholder="例: MRコネクト"
            onChange={setQuery}
            onSelect={(p) => {
              setQuery(p.name);
              open(p.id, p.name);
            }}
          />
        </div>
      </div>

      {noSubOnly && (
        <div className="flex items-start gap-2 rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-xs text-info">
          <Info className="size-3.5 mt-0.5 shrink-0" />
          この科目の仕訳には、まだ補助科目（相手先）が付いていません。勘定科目管理で補助科目を作り、
          仕訳入力や元帳の「修正する」で付けると、相手先ごとに分かれて表示されます。
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="bg-muted/20 border-b border-border text-xs text-muted-foreground">
              <th className="px-3 py-2 text-left font-bold">相手先（補助科目）</th>
              <th className="px-3 py-2 text-right font-bold">前期繰越</th>
              <th className="px-3 py-2 text-right font-bold">{incLabel}</th>
              <th className="px-3 py-2 text-right font-bold">{decLabel}</th>
              <th className="px-3 py-2 text-right font-bold">残高</th>
              <th className="px-3 py-2 text-right font-bold">件数</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr
                key={r.subAccountId ?? "none"}
                onClick={() => open(r.subAccountId ?? "none", r.name)}
                className="border-b border-border last:border-0 cursor-pointer hover:bg-primary/5"
                title="クリックでこの相手先の取引を表示"
              >
                <td className={r.subAccountId ? "px-3 py-2 font-medium text-primary" : "px-3 py-2 text-muted-foreground"}>
                  {r.name}
                </td>
                <td className="px-3 py-2 text-right font-mono">{formatYen(r.opening)}</td>
                <td className="px-3 py-2 text-right font-mono">{formatYen(r.increase)}</td>
                <td className="px-3 py-2 text-right font-mono">{formatYen(r.decrease)}</td>
                <td className="px-3 py-2 text-right font-mono font-bold">{formatYen(r.closing)}</td>
                <td className="px-3 py-2 text-right text-muted-foreground">{r.count}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                  {rows.length === 0 ? "この期間の取引はありません" : "該当する相手先がありません"}
                </td>
              </tr>
            )}
          </tbody>
          {!query && rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-border bg-muted/20 font-bold">
                <td className="px-3 py-2">合計</td>
                <td className="px-3 py-2 text-right font-mono">{formatYen(total.opening)}</td>
                <td className="px-3 py-2 text-right font-mono">{formatYen(total.inc)}</td>
                <td className="px-3 py-2 text-right font-mono">{formatYen(total.dec)}</td>
                <td className="px-3 py-2 text-right font-mono">{formatYen(total.closing)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
