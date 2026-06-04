"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { Home, Loader2, Save } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/providers/auth-provider";
import {
  getAllocatableAccounts,
  getAllocationRates,
  upsertAllocationRate,
  type AllocatableAccount,
  type AllocationRate,
} from "@/actions/allocations";

interface Draft {
  ratio: string;
  note: string;
}

export default function AllocationsPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const isStaff =
    user?.role === "super_admin" || user?.role === "admin" || user?.role === "staff";

  // 会計年度（4月始まり）
  const now = new Date();
  const currentFy = now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
  const [fiscalYear, setFiscalYear] = useState(currentFy);

  const [accounts, setAccounts] = useState<AllocatableAccount[]>([]);
  const [rates, setRates] = useState<Record<string, AllocationRate>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [accs, rateMap] = await Promise.all([
        getAllocatableAccounts(id),
        getAllocationRates(id, fiscalYear),
      ]);
      setAccounts(accs);
      setRates(rateMap);
      setDrafts({});
    } catch (e) {
      console.error("家事按分設定の取得に失敗:", e);
      setAccounts([]);
      setRates({});
    } finally {
      setLoading(false);
    }
  }, [id, fiscalYear]);

  useEffect(() => {
    load();
  }, [load]);

  const ratioValue = (accountId: string) =>
    drafts[accountId]?.ratio !== undefined
      ? drafts[accountId].ratio
      : rates[accountId]
        ? String(rates[accountId].business_ratio)
        : "";
  const noteValue = (accountId: string) =>
    drafts[accountId]?.note !== undefined
      ? drafts[accountId].note
      : rates[accountId]?.basis_note ?? "";

  const setDraft = (accountId: string, patch: Partial<Draft>) =>
    setDrafts((p) => ({
      ...p,
      [accountId]: {
        ratio: p[accountId]?.ratio ?? (rates[accountId] ? String(rates[accountId].business_ratio) : ""),
        note: p[accountId]?.note ?? (rates[accountId]?.basis_note ?? ""),
        ...patch,
      },
    }));

  async function saveRow(accountId: string) {
    const ratioStr = ratioValue(accountId).trim();
    const note = noteValue(accountId).trim();
    const ratio = ratioStr === "" ? 0 : Number(ratioStr);
    if (Number.isNaN(ratio) || ratio < 0 || ratio > 100) {
      alert("按分率は0〜100の数値で入力してください");
      return;
    }
    setSavingId(accountId);
    try {
      await upsertAllocationRate(id, fiscalYear, accountId, ratio, note || null);
      setRates((p) => ({
        ...p,
        [accountId]: { account_id: accountId, business_ratio: ratio, basis_note: note || null },
      }));
      setDrafts((p) => {
        const n = { ...p };
        delete n[accountId];
        return n;
      });
    } catch (e) {
      alert(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSavingId(null);
    }
  }

  const years = Array.from({ length: 5 }, (_, i) => currentFy - i);

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Home className="size-6 text-primary" />
            家事按分設定
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            自宅兼事務所の経費を事業使用割合で按分するための、科目ごとの按分率を設定します。
          </p>
        </div>
      </div>

      {/* 年度選択 */}
      <Card className="mb-4 w-fit">
        <CardContent className="py-2.5 px-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground font-bold">対象年度:</label>
            <select
              value={fiscalYear}
              onChange={(e) => setFiscalYear(Number(e.target.value))}
              className="px-2 py-1 rounded-lg border border-border bg-card text-foreground text-sm"
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}年度（{y}/4〜{y + 1}/3）
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      {!isStaff && (
        <p className="mb-3 text-xs text-muted-foreground">
          ※ 按分率の設定は税理士が行います（閲覧のみ）。
        </p>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-border p-12 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          <span className="text-sm">読み込み中...</span>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/20 border-b border-border">
                <th className="text-left px-3 py-2 text-xs font-bold text-muted-foreground">勘定科目</th>
                <th className="text-right px-3 py-2 text-xs font-bold text-muted-foreground w-32">按分率（%）</th>
                <th className="text-left px-3 py-2 text-xs font-bold text-muted-foreground">按分根拠メモ</th>
                {isStaff && <th className="text-center px-3 py-2 text-xs font-bold text-muted-foreground w-20">操作</th>}
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id} className="border-b border-border/50 hover:bg-muted/10">
                  <td className="px-3 py-1.5 text-foreground">
                    <span className="font-mono text-xs text-muted-foreground mr-2">{a.code}</span>
                    {a.name}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {isStaff ? (
                      <input
                        type="number"
                        min={0}
                        max={100}
                        value={ratioValue(a.id)}
                        onChange={(e) => setDraft(a.id, { ratio: e.target.value })}
                        placeholder="0"
                        className="w-24 px-2 py-1 rounded border border-border bg-card text-foreground text-sm text-right"
                      />
                    ) : (
                      <span className="font-mono">{rates[a.id] ? `${rates[a.id].business_ratio}%` : "-"}</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    {isStaff ? (
                      <input
                        type="text"
                        value={noteValue(a.id)}
                        onChange={(e) => setDraft(a.id, { note: e.target.value })}
                        placeholder="例: 床面積20㎡中8㎡を事業利用"
                        className="w-full px-2 py-1 rounded border border-border bg-card text-foreground text-sm"
                      />
                    ) : (
                      <span className="text-muted-foreground">{rates[a.id]?.basis_note ?? "-"}</span>
                    )}
                  </td>
                  {isStaff && (
                    <td className="px-3 py-1.5 text-center">
                      <Button size="sm" variant="outline" onClick={() => saveRow(a.id)} disabled={savingId === a.id}>
                        {savingId === a.id ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
              {accounts.length === 0 && (
                <tr>
                  <td colSpan={isStaff ? 4 : 3} className="px-3 py-12 text-center text-muted-foreground">
                    費用科目がありません
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        ※ 按分率は事業使用割合です（例: 40% → 経費40%・私用60%）。私用分は「事業主貸」に振り替わります（自動仕訳は次フェーズで対応）。
      </p>
    </>
  );
}
