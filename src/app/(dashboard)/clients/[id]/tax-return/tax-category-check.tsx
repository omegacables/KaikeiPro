"use client";

/**
 * 税区分の点検（消費税申告書の画面の一部）。
 * はっきりした決まりと違う行・未設定の行・確認をすすめる行を出し、選んだ行の税区分をまとめて直す。
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { ListChecks, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getTaxCategoryIssues, fixTaxCategories, type TaxCategoryIssue } from "@/actions/tax-category-check";

const KIND = {
  conflict: { label: "直すべき", variant: "destructive" as const },
  missing: { label: "未設定", variant: "warning" as const },
  review: { label: "確認", variant: "info" as const },
};

export function TaxCategoryCheck({
  clientId,
  period,
  canWrite,
  onFixed,
}: {
  clientId: string;
  period: { startDate: string; endDate: string };
  canWrite: boolean;
  onFixed: () => void;
}) {
  const [issues, setIssues] = useState<TaxCategoryIssue[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    setIssues(null);
    getTaxCategoryIssues(clientId, period.startDate, period.endDate)
      .then((list) => {
        if (!alive) return;
        setIssues(list);
        // 直すべき・未設定は最初から選んでおく（確認は人が選ぶ）
        setSelected(new Set(list.filter((i) => i.kind !== "review").map((i) => i.lineId)));
      })
      .catch((e) => alive && setMessage(e instanceof Error ? e.message : "読み込みに失敗しました"));
    return () => {
      alive = false;
    };
  }, [clientId, period.startDate, period.endDate, reload]);

  const fix = async () => {
    if (!issues) return;
    setBusy(true);
    setMessage(null);
    try {
      const fixes = issues.filter((i) => selected.has(i.lineId)).map((i) => ({ lineId: i.lineId, code: i.suggested }));
      const { updated } = await fixTaxCategories(clientId, fixes);
      setMessage(`${updated}行の税区分を直しました。`);
      setReload((k) => k + 1);
      onFixed();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "直せませんでした");
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Card className="p-4 space-y-3 print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-sm flex items-center gap-2">
          <ListChecks className="size-4 text-primary" />
          税区分の確認
        </h3>
        {issues && issues.length > 0 && canWrite && (
          <Button size="sm" onClick={fix} disabled={busy || selected.size === 0}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            選んだ{selected.size}行の税区分を直す
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        給与・社会保険料・税金・利息・保険料など、消費税がかからないとはっきり決まっている取引と、税区分が付いていない行を探します。
        「確認」は取引の中身で変わるもので、理由を読んで必要なものだけ選んでください。
      </p>
      {message && <p className="text-sm text-primary">{message}</p>}
      {issues === null ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="size-4 animate-spin" />
          確認中...
        </div>
      ) : issues.length === 0 ? (
        <p className="text-sm text-success">この期の税区分に、気になる行はありません。</p>
      ) : (
        <div className="overflow-x-auto max-h-[480px] overflow-y-auto rounded-lg border border-border">
          <table className="w-full text-xs min-w-[900px]">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b border-border text-muted-foreground">
                <th className="w-8 px-2 py-1.5">
                  <input
                    type="checkbox"
                    aria-label="すべて選ぶ"
                    checked={selected.size === issues.length}
                    onChange={(e) => setSelected(e.target.checked ? new Set(issues.map((i) => i.lineId)) : new Set())}
                  />
                </th>
                <th className="text-left px-2 py-1.5">区分</th>
                <th className="text-left px-2 py-1.5">日付</th>
                <th className="text-left px-2 py-1.5">摘要</th>
                <th className="text-left px-2 py-1.5">科目</th>
                <th className="text-right px-2 py-1.5">金額</th>
                <th className="text-left px-2 py-1.5">今の税区分</th>
                <th className="text-left px-2 py-1.5">直した後</th>
                <th className="text-left px-2 py-1.5">理由</th>
              </tr>
            </thead>
            <tbody>
              {issues.map((i) => (
                <tr key={i.lineId} className="border-b border-border/40 last:border-0 align-top">
                  <td className="px-2 py-1">
                    <input type="checkbox" checked={selected.has(i.lineId)} onChange={() => toggle(i.lineId)} aria-label="選ぶ" />
                  </td>
                  <td className="px-2 py-1">
                    <Badge variant={KIND[i.kind].variant}>{KIND[i.kind].label}</Badge>
                  </td>
                  <td className="px-2 py-1 tabular-nums">{i.date}</td>
                  <td className="px-2 py-1">
                    <Link href={`/clients/${clientId}/ledgers?tab=journal&entry=${i.entryId}&date=${i.date}`} className="hover:underline">
                      {i.description || "（摘要なし）"}
                    </Link>
                  </td>
                  <td className="px-2 py-1">{i.accountName}</td>
                  <td className="px-2 py-1 text-right font-mono">{Math.abs(i.amount).toLocaleString()}</td>
                  <td className="px-2 py-1">{i.currentName}</td>
                  <td className="px-2 py-1 font-medium">{i.suggestedName}</td>
                  <td className="px-2 py-1 text-muted-foreground">{i.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
