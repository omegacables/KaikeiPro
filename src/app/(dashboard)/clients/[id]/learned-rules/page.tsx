"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { Sparkles, Trash2, Loader2, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useData } from "@/lib/use-data";
import { listLearnedRules, deleteLearnedRule } from "@/actions/learned-rules";

const DIRECTION_LABELS: Record<string, string> = {
  received: "受領（経費・仕入）",
  issued: "発行（売上）",
  in: "入金",
  out: "出金",
};

export default function LearnedRulesPage() {
  const { id } = useParams<{ id: string }>();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data: rules, refetch } = useData(() => listLearnedRules(id), null);

  async function handleDelete(ruleId: string) {
    if (!confirm("この学習ルールを削除しますか？")) return;
    setDeletingId(ruleId);
    try {
      await deleteLearnedRule(ruleId);
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : "削除に失敗しました");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Sparkles className="size-6 text-primary" />
          仕訳学習
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          確定した仕訳から学習した「取引先・摘要 → 勘定科目」のルール。AI仕訳提案に自動で反映されます。
        </p>
      </div>

      <Card className="mb-6 p-4 border-primary/20 bg-primary/5">
        <div className="flex items-start gap-2 text-sm text-muted-foreground">
          <Info className="size-4 shrink-0 mt-0.5 text-primary" />
          <p>
            領収書のAI仕訳を承認したとき、銀行CSVを取り込んだとき、手入力で仕訳を登録したときに自動で学習します。
            誤って学習されたルールはここで削除できます。
          </p>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            学習済みルール
            {rules && <Badge variant="default">{rules.length}件</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {rules === null ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" />
            </div>
          ) : rules.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              まだ学習されたルールはありません。仕訳を確定すると自動的にここに蓄積されます。
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/20 border-b border-border">
                    <th className="text-left px-3 py-2 text-xs font-bold text-muted-foreground">取引先・摘要</th>
                    <th className="text-left px-3 py-2 text-xs font-bold text-muted-foreground">区分</th>
                    <th className="text-left px-3 py-2 text-xs font-bold text-muted-foreground">主科目</th>
                    <th className="text-left px-3 py-2 text-xs font-bold text-muted-foreground">相手科目</th>
                    <th className="text-left px-3 py-2 text-xs font-bold text-muted-foreground">税区分</th>
                    <th className="text-right px-3 py-2 text-xs font-bold text-muted-foreground">学習回数</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rules.map((r) => (
                    <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/10">
                      <td className="px-3 py-2.5 font-medium text-foreground">{r.signal || "—"}</td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">
                        {r.direction ? DIRECTION_LABELS[r.direction] ?? r.direction : "—"}
                      </td>
                      <td className="px-3 py-2.5">{r.accountName}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{r.counterAccountName ?? "—"}</td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">{r.taxCategory ?? "—"}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs">{r.usageCount}回</td>
                      <td className="px-3 py-2.5 text-right">
                        <button
                          onClick={() => handleDelete(r.id)}
                          disabled={deletingId === r.id}
                          className="text-destructive hover:text-destructive/80 disabled:opacity-50"
                          title="削除"
                        >
                          {deletingId === r.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Trash2 className="size-4" />
                          )}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
