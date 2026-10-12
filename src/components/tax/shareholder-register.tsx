"use client";

/**
 * 株主名簿と同族会社の判定（法人税申告書の別表二）。
 * 株主グループ: 判定基準となる株主（本人）とその同族関係者（親族・支配する会社など）に同じ番号を付ける。
 */

import { useEffect, useState } from "react";
import { Loader2, Plus, Trash2, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getShareholderRegister, saveShareholderRegister, type ShareholderRegister, type ShareholderRow } from "@/actions/shareholders";

const KIND_LABEL: Record<1 | 3 | 4, string> = { 1: "同族会社", 3: "非同族会社", 4: "特定同族会社" };
const field = "w-full px-2 py-1 rounded-md border border-border bg-card text-foreground text-sm";

type Draft = { issued: string; treasury: string; rows: (Omit<ShareholderRow, "shares" | "groupNo"> & { shares: string; groupNo: string })[] };

const toDraft = (r: ShareholderRegister): Draft => ({
  issued: r.issuedShares === null ? "" : String(r.issuedShares),
  treasury: r.treasuryShares === null ? "" : String(r.treasuryShares),
  rows: r.shareholders.map((s) => ({ ...s, shares: String(s.shares), groupNo: String(s.groupNo) })),
});
const int = (v: string) => Number(v.normalize("NFKC").replace(/[,\s]/g, ""));

export function ShareholderRegisterCard({ clientId, canWrite, onSaved }: { clientId: string; canWrite: boolean; onSaved: () => void }) {
  const [reg, setReg] = useState<ShareholderRegister | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    getShareholderRegister(clientId)
      .then((r) => {
        setReg(r);
        setDraft(toDraft(r));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "読み込みに失敗しました"));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  if (!reg || !draft) return null;
  const j = reg.judgement;
  const setRow = (i: number, patch: Partial<Draft["rows"][number]>) =>
    setDraft({ ...draft, rows: draft.rows.map((r, k) => (k === i ? { ...r, ...patch } : r)) });

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveShareholderRegister(clientId, {
        issuedShares: draft.issued.trim() === "" ? null : int(draft.issued),
        treasuryShares: draft.treasury.trim() === "" ? null : int(draft.treasury),
        shareholders: draft.rows.map((r) => ({ ...r, shares: int(r.shares || "0"), groupNo: int(r.groupNo || "1") })),
      });
      await load();
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存できませんでした");
    } finally {
      setSaving(false);
    }
  };
  const disabled = !canWrite || saving;

  return (
    <Card className="p-4 space-y-3 print:hidden">
      <button className="flex w-full items-center gap-2 text-left" onClick={() => setOpen((v) => !v)}>
        <Users className="size-4 text-primary" />
        <span className="font-bold text-sm">株主名簿・同族会社の判定（別表二）</span>
        <span className="text-xs text-muted-foreground">
          {j
            ? `${KIND_LABEL[j.kind]}（上位3グループ ${j.top3Ratio}%）`
            : "株主名簿が入っていません。入れると別表二を e-Tax 用ファイルに入れます"}
        </span>
        <span className="ml-auto text-xs text-primary">{open ? "閉じる" : "開く"}</span>
      </button>

      {open && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <label className="text-xs font-bold text-muted-foreground">
              期末現在の発行済株式の総数
              <input className={cn(field, "mt-1 text-right")} inputMode="numeric" value={draft.issued} disabled={disabled} onChange={(e) => setDraft({ ...draft, issued: e.target.value })} />
            </label>
            <label className="text-xs font-bold text-muted-foreground">
              うち自己株式
              <input className={cn(field, "mt-1 text-right")} inputMode="numeric" value={draft.treasury} disabled={disabled} onChange={(e) => setDraft({ ...draft, treasury: e.target.value })} />
            </label>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border">
                  <th className="px-1 py-1.5 text-left w-20">グループ</th>
                  <th className="px-1 py-1.5 text-left">氏名又は法人名</th>
                  <th className="px-1 py-1.5 text-left w-28">続柄</th>
                  <th className="px-1 py-1.5 text-left">住所又は所在地</th>
                  <th className="px-1 py-1.5 text-center w-14">法人</th>
                  <th className="px-1 py-1.5 text-right w-28">株式数</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {draft.rows.map((r, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="px-1 py-1"><input className={cn(field, "text-right")} inputMode="numeric" value={r.groupNo} disabled={disabled} onChange={(e) => setRow(i, { groupNo: e.target.value })} aria-label="株主グループ" /></td>
                    <td className="px-1 py-1"><input className={field} value={r.name} disabled={disabled} onChange={(e) => setRow(i, { name: e.target.value })} aria-label="氏名又は法人名" /></td>
                    <td className="px-1 py-1"><input className={field} list="relationship-options" placeholder="本人" value={r.relationship ?? ""} disabled={disabled} onChange={(e) => setRow(i, { relationship: e.target.value })} aria-label="判定基準となる株主との続柄" /></td>
                    <td className="px-1 py-1"><input className={field} value={r.address ?? ""} disabled={disabled} onChange={(e) => setRow(i, { address: e.target.value })} aria-label="住所又は所在地" /></td>
                    <td className="px-1 py-1 text-center"><input type="checkbox" checked={r.isCorporation} disabled={disabled} onChange={(e) => setRow(i, { isCorporation: e.target.checked })} aria-label="法人株主" /></td>
                    <td className="px-1 py-1"><input className={cn(field, "text-right")} inputMode="numeric" value={r.shares} disabled={disabled} onChange={(e) => setRow(i, { shares: e.target.value })} aria-label="株式数" /></td>
                    <td className="px-1 py-1">
                      {canWrite && (
                        <button className="text-muted-foreground hover:text-destructive" onClick={() => setDraft({ ...draft, rows: draft.rows.filter((_, k) => k !== i) })} aria-label="行を削除">
                          <Trash2 className="size-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <datalist id="relationship-options">
              {["本人", "妻", "夫", "長男", "長女", "次男", "次女", "父", "母", "兄", "弟", "姉", "妹"].map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </div>
          {canWrite && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setDraft({
                    ...draft,
                    rows: [...draft.rows, { groupNo: String(Math.max(0, ...draft.rows.map((r) => int(r.groupNo) || 0)) + 1), name: "", address: "", relationship: "本人", isCorporation: false, shares: "" }],
                  })
                }
              >
                <Plus className="size-4" />
                株主を追加
              </Button>
              <Button size="sm" onClick={save} disabled={saving}>
                {saving && <Loader2 className="size-4 animate-spin" />}
                保存
              </Button>
            </div>
          )}
          {j && (
            <div className="text-xs text-muted-foreground space-y-1">
              <p>
                判定: <b className="text-foreground">{KIND_LABEL[j.kind]}</b>。上位3グループの株式数 {j.top3Shares.toLocaleString()}株 ÷ 発行済株式（自己株式を除く）
                {j.outstanding.toLocaleString()}株 ＝ {j.top3Ratio}%（50%を超えると同族会社）
              </p>
              <p>
                順位:{" "}
                {j.groups.map((g) => `${g.rank}位 ${g.members[0]?.name ?? ""}グループ ${g.shares.toLocaleString()}株`).join("、")}
              </p>
              {j.warnings.map((w) => (
                <p key={w} className="text-warning">{w}</p>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            同じ「グループ」には、判定基準となる株主（本人）と、その親族や支配している会社など同族関係者を入れます。「続柄」は本人から見た関係です。
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </>
      )}
    </Card>
  );
}
