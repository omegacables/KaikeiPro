"use client";

/**
 * 売掛帳・買掛帳の上に出す「相手先が付いていない行」。
 * 摘要に書かれた取引先名を候補にして、確かめてからまとめて補助科目を付ける。
 * 行が無ければ何も出さない。
 */

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatYen } from "@/lib/wareki";
import {
  getUnassignedPartnerLines,
  assignPartnerToLines,
  type UnassignedPartnerLines,
} from "@/actions/partner-lines";

export function UnassignedPartnerLinesCard({
  clientId,
  accountName,
  reloadKey,
  onAssigned,
  onOpenEntry,
}: {
  clientId: string;
  accountName: "売掛金" | "買掛金";
  reloadKey?: number;
  onAssigned: () => void;
  onOpenEntry: (entryId: string) => void;
}) {
  const [data, setData] = useState<UnassignedPartnerLines | null>(null);
  const [open, setOpen] = useState(false);
  /** 行ID → 選んだ取引先ID（"" は付けない） */
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await getUnassignedPartnerLines(clientId, accountName);
      setData(d);
      setChoice(Object.fromEntries(d.lines.filter((l) => !l.locked).map((l) => [l.id, l.suggestedPartnerId ?? ""])));
    } catch {
      setData(null);
    }
  }, [clientId, accountName]);

  useEffect(() => {
    load();
  }, [load, reloadKey]);

  if (!data || data.lines.length === 0) return null;

  const chosen = Object.entries(choice).filter(([, p]) => p);
  const label = accountName === "売掛金" ? "得意先" : "仕入先";

  const submit = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await assignPartnerToLines(
        clientId,
        accountName,
        chosen.map(([lineId, partnerId]) => ({ lineId, partnerId }))
      );
      setMessage(`${r.assigned}行に${label}を付けました${r.skipped ? `（${r.skipped}行は付けられませんでした）` : ""}`);
      await load();
      onAssigned();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "付けられませんでした");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-4 rounded-xl border border-warning/30 bg-warning/5">
      <button
        className="w-full flex items-center gap-2 px-4 py-3 text-left text-sm"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        <AlertTriangle className="size-4 text-warning" />
        <span className="font-medium text-foreground">
          {label}（補助科目）が付いていない{accountName}の行が {data.lines.length}行 あります
        </span>
        <span className="text-xs text-muted-foreground">
          {label}ごとの残高に入りません。開いて{label}を選び、まとめて付けられます
        </span>
      </button>
      {open && (
        <div className="px-4 pb-4">
          <p className="text-xs text-muted-foreground mb-2">
            摘要に{label}の名前があれば候補を選んであります。確かめてから「選んだ{label}を付ける」を押してください。
            期首残高のように複数の{label}をまとめた行は、{label}ごとの仕訳に分けてから付けます。
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="bg-muted/20 border-b border-border text-xs text-muted-foreground">
                  <th className="px-2 py-1.5 text-left font-medium">日付</th>
                  <th className="px-2 py-1.5 text-left font-medium">摘要</th>
                  <th className="px-2 py-1.5 text-right font-medium">借方</th>
                  <th className="px-2 py-1.5 text-right font-medium">貸方</th>
                  <th className="px-2 py-1.5 text-left font-medium">{label}</th>
                </tr>
              </thead>
              <tbody>
                {data.lines.map((l) => (
                  <tr key={l.id} className="border-b border-border last:border-0">
                    <td className="px-2 py-1.5 whitespace-nowrap tabular-nums">{l.date.replaceAll("-", "/")}</td>
                    <td className="px-2 py-1.5">
                      <button className="text-left hover:underline" onClick={() => onOpenEntry(l.entryId)}>
                        {l.description || "（摘要なし）"}
                      </button>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{l.debit ? formatYen(l.debit) : ""}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{l.credit ? formatYen(l.credit) : ""}</td>
                    <td className="px-2 py-1.5">
                      {l.locked ? (
                        <span className="text-xs text-muted-foreground">締めた年度のため変更できません</span>
                      ) : (
                        <select
                          aria-label={`${l.date} ${l.description} の${label}`}
                          className="w-full max-w-[240px] rounded-md border border-border bg-background px-2 py-1 text-sm"
                          value={choice[l.id] ?? ""}
                          onChange={(e) => setChoice((c) => ({ ...c, [l.id]: e.target.value }))}
                        >
                          <option value="">（付けない）</option>
                          {data.partners.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                              {p.id === l.suggestedPartnerId ? "（摘要から）" : ""}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <Button size="sm" onClick={submit} disabled={busy || chosen.length === 0}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              選んだ{label}を付ける（{chosen.length}行）
            </Button>
            {data.partners.length === 0 && (
              <span className="text-xs text-muted-foreground">取引先マスタに{label}を登録すると選べるようになります</span>
            )}
            {message && <span className="text-xs text-foreground">{message}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
