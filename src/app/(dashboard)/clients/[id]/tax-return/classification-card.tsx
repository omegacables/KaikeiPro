"use client";

/**
 * 消費税の区分の付け分け（消費税申告書の画面の一部）。
 *   個別対応方式 … 課税仕入れの行ごとに用途区分
 *   簡易課税     … 課税売上げの行ごとに事業区分
 * 科目ごとにまとめて付けてから、例外の行だけ1行ずつ直せる。
 */

import { useEffect, useMemo, useState } from "react";
import { Tags, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BUSINESS_TYPES, PURCHASE_USE_LABELS } from "@/lib/consumption-tax-return";
import {
  getClassificationLines,
  setLineClassification,
  type ClassificationKind,
  type ClassificationLine,
} from "@/actions/line-classification";

const fieldCls = "px-2 py-1 rounded border border-border bg-card text-foreground text-xs";

export function ClassificationCard({
  clientId,
  period,
  kind,
  canWrite,
  onChanged,
}: {
  clientId: string;
  period: { startDate: string; endDate: string };
  kind: ClassificationKind;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const [lines, setLines] = useState<ClassificationLine[] | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [account, setAccount] = useState("");

  useEffect(() => {
    let alive = true;
    setLines(null);
    getClassificationLines(clientId, period.startDate, period.endDate, kind)
      .then((l) => {
        if (!alive) return;
        setLines(l);
        setEdits({});
      })
      .catch((e) => alive && setMessage(e instanceof Error ? e.message : "読み込みに失敗しました"));
    return () => {
      alive = false;
    };
  }, [clientId, period.startDate, period.endDate, kind, reload]);

  const options =
    kind === "purchase"
      ? (Object.keys(PURCHASE_USE_LABELS) as (keyof typeof PURCHASE_USE_LABELS)[]).map((k) => ({ value: k, label: PURCHASE_USE_LABELS[k] }))
      : BUSINESS_TYPES.map((b) => ({ value: String(b.type), label: `${b.label}（${b.rate}%）` }));
  const empty = kind === "purchase" ? "未設定（共通として扱う）" : "未設定（設定の事業区分）";

  const accounts = useMemo(() => {
    const m = new Map<string, { count: number; amount: number; unset: number }>();
    for (const l of lines ?? []) {
      const v = edits[l.lineId] ?? l.value;
      const e = m.get(l.accountName) ?? { count: 0, amount: 0, unset: 0 };
      e.count++;
      e.amount += l.amount;
      if (!v) e.unset++;
      m.set(l.accountName, e);
    }
    return [...m];
  }, [lines, edits]);

  const setAccountAll = (name: string, value: string) =>
    setEdits((prev) => {
      const next = { ...prev };
      for (const l of lines ?? []) if (l.accountName === name) next[l.lineId] = value;
      return next;
    });

  const changed = (lines ?? []).filter((l) => edits[l.lineId] !== undefined && edits[l.lineId] !== l.value);
  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const { updated } = await setLineClassification(
        clientId,
        kind,
        changed.map((l) => ({ lineId: l.lineId, value: edits[l.lineId] }))
      );
      setMessage(`${updated}行の区分を保存しました。`);
      setReload((k) => k + 1);
      onChanged();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "保存できませんでした");
    } finally {
      setBusy(false);
    }
  };

  const shown = (lines ?? []).filter((l) => !account || l.accountName === account).slice(0, 300);
  return (
    <Card className="p-4 space-y-3 print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold text-sm flex items-center gap-2">
          <Tags className="size-4 text-primary" />
          {kind === "purchase" ? "課税仕入れの用途区分（個別対応方式）" : "課税売上げの事業区分（簡易課税）"}
        </h3>
        {canWrite && changed.length > 0 && (
          <Button size="sm" onClick={save} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {changed.length}行の区分を保存
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {kind === "purchase"
          ? "仕入れを、課税売上げのためだけのもの・非課税売上げ（家賃収入の住宅貸付けなど）のためだけのもの・両方に共通するもの に分けます。科目ごとにまとめて付けてから、違う行だけ直してください。"
          : "売上げを事業区分ごとに分けます。2つ以上の事業区分があると、みなし仕入率の加重平均や75%特例でいちばん有利な計算を選びます。"}
      </p>
      {message && <p className="text-sm text-primary">{message}</p>}
      {!lines ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="size-4 animate-spin" />
          読み込み中...
        </div>
      ) : lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">この期の{kind === "purchase" ? "課税仕入れ" : "課税売上げ"}はありません。</p>
      ) : (
        <>
          <table className="text-xs w-full">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left px-2 py-1">科目</th>
                <th className="text-right px-2 py-1">行数</th>
                <th className="text-right px-2 py-1">金額</th>
                <th className="text-right px-2 py-1">未設定</th>
                <th className="text-left px-2 py-1">まとめて付ける</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map(([name, e]) => (
                <tr key={name} className="border-b border-border/40 last:border-0">
                  <td className="px-2 py-1">
                    <button className="hover:underline" onClick={() => setAccount(account === name ? "" : name)}>
                      {name}
                    </button>
                  </td>
                  <td className="px-2 py-1 text-right">{e.count}</td>
                  <td className="px-2 py-1 text-right font-mono">{e.amount.toLocaleString()}</td>
                  <td className="px-2 py-1 text-right">{e.unset || ""}</td>
                  <td className="px-2 py-1">
                    <select className={fieldCls} disabled={!canWrite} value="" onChange={(ev) => ev.target.value && setAccountAll(name, ev.target.value)}>
                      <option value="">選ぶ…</option>
                      {options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="overflow-x-auto max-h-[420px] overflow-y-auto rounded-lg border border-border">
            <table className="w-full text-xs min-w-[720px]">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left px-2 py-1.5">日付</th>
                  <th className="text-left px-2 py-1.5">摘要</th>
                  <th className="text-left px-2 py-1.5">科目</th>
                  <th className="text-right px-2 py-1.5">金額</th>
                  <th className="text-left px-2 py-1.5">区分</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((l) => (
                  <tr key={l.lineId} className="border-b border-border/40 last:border-0">
                    <td className="px-2 py-1 tabular-nums">{l.date}</td>
                    <td className="px-2 py-1">{l.description}</td>
                    <td className="px-2 py-1">{l.accountName}</td>
                    <td className="px-2 py-1 text-right font-mono">{l.amount.toLocaleString()}</td>
                    <td className="px-2 py-1">
                      <select
                        className={fieldCls}
                        disabled={!canWrite}
                        value={edits[l.lineId] ?? l.value}
                        onChange={(ev) => setEdits((p) => ({ ...p, [l.lineId]: ev.target.value }))}
                      >
                        <option value="">{empty}</option>
                        {options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(lines ?? []).filter((l) => !account || l.accountName === account).length > 300 && (
            <p className="text-xs text-muted-foreground">300行まで表示しています。科目名を押すと、その科目の行だけに絞れます。</p>
          )}
        </>
      )}
    </Card>
  );
}
