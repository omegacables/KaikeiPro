"use client";

import { useState, useEffect, useCallback, use } from "react";
import {
  ClipboardCheck,
  Loader2,
  CheckCircle,
  AlertCircle,
  MessageCircleQuestion,
  RotateCcw,
  X,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  getReviewEntries,
  getReviewSummary,
  setReviewStatus,
  type ReviewEntry,
  type ReviewStatus,
  type ReviewSummary,
} from "@/actions/review";
import { formatCurrency } from "@/lib/utils";

const statusMeta: Record<
  ReviewStatus,
  { label: string; variant: "muted" | "success" | "warning" | "default" }
> = {
  unreviewed: { label: "未確認", variant: "muted" },
  confirmed: { label: "確認済み", variant: "success" },
  needs_fix: { label: "要修正", variant: "warning" },
  question: { label: "質問中", variant: "default" },
};

const sourceLabel: Record<string, string> = {
  manual: "手動",
  ai: "AI",
  import: "取込",
  raqto: "Raqto",
  bank: "銀行",
  closing: "決算",
  card: "カード",
};

type FilterKey = "all" | ReviewStatus;

export default function ReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [entries, setEntries] = useState<ReviewEntry[]>([]);
  const [summary, setSummary] = useState<ReviewSummary | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // メモ入力モーダル
  const [noteModal, setNoteModal] = useState<{
    entry: ReviewEntry;
    status: ReviewStatus;
  } | null>(null);
  const [noteText, setNoteText] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [list, sum] = await Promise.all([
        getReviewEntries(id, filter === "all" ? undefined : filter),
        getReviewSummary(id),
      ]);
      setEntries(list);
      setSummary(sum);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }, [id, filter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function applyStatus(
    entry: ReviewEntry,
    status: ReviewStatus,
    note?: string | null
  ) {
    setBusy(entry.id);
    setError(null);
    try {
      await setReviewStatus(entry.id, status, note);
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新に失敗しました");
    } finally {
      setBusy(null);
    }
  }

  function openNote(entry: ReviewEntry, status: ReviewStatus) {
    setNoteModal({ entry, status });
    setNoteText(entry.reviewNote ?? "");
    setError(null);
  }

  async function submitNote() {
    if (!noteModal) return;
    const { entry, status } = noteModal;
    setNoteModal(null);
    await applyStatus(entry, status, noteText);
  }

  const summaryCards: { key: FilterKey; label: string; count: number }[] = [
    { key: "all", label: "全仕訳", count: summary?.total ?? 0 },
    { key: "unreviewed", label: "未確認", count: summary?.unreviewed ?? 0 },
    { key: "confirmed", label: "確認済み", count: summary?.confirmed ?? 0 },
    { key: "needs_fix", label: "要修正", count: summary?.needs_fix ?? 0 },
    { key: "question", label: "質問中", count: summary?.question ?? 0 },
  ];

  return (
    <div className="space-y-6">
      {/* ヘッダー */}
      <div className="flex items-center gap-2">
        <ClipboardCheck className="size-6 text-primary" />
        <h1 className="text-xl font-bold">仕訳レビュー</h1>
      </div>

      <p className="text-sm text-muted-foreground">
        仕訳を1件ずつ査閲し「確認済み」「要修正」「質問中」を付けられます。「要修正」「質問中」でメモを残すと、顧問先への質問（質問管理）にも連携されます。
      </p>

      {error && (
        <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* サマリー（クリックでフィルタ） */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {summaryCards.map((c) => (
          <button key={c.key} onClick={() => setFilter(c.key)} className="text-left">
            <Card
              className={
                filter === c.key
                  ? "ring-2 ring-primary/50 transition-shadow"
                  : "hover:bg-muted/20 transition-colors"
              }
            >
              <CardContent className="py-3">
                <p className="text-xs text-muted-foreground">{c.label}</p>
                <p className="text-xl font-bold tabular-nums">{c.count}</p>
              </CardContent>
            </Card>
          </button>
        ))}
      </div>

      {/* 一覧 */}
      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="size-5 animate-spin mr-2" />
              読み込み中...
            </div>
          ) : entries.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              該当する仕訳がありません。
            </div>
          ) : (
            <div className="overflow-x-auto -mx-2 px-2">
              <table className="w-full text-sm min-w-[820px]">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="text-left py-2 px-2">日付</th>
                    <th className="text-left py-2 px-2">摘要</th>
                    <th className="text-left py-2 px-2">借方</th>
                    <th className="text-left py-2 px-2">貸方</th>
                    <th className="text-right py-2 px-2">金額</th>
                    <th className="text-center py-2 px-2">区分</th>
                    <th className="text-center py-2 px-2">状態</th>
                    <th className="text-right py-2 px-2">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => {
                    const isBusy = busy === e.id;
                    const meta = statusMeta[e.reviewStatus];
                    return (
                      <tr key={e.id} className="border-b border-border/50 align-top">
                        <td className="py-2 px-2 whitespace-nowrap">{e.date}</td>
                        <td className="py-2 px-2">
                          <div className="max-w-[200px] truncate" title={e.description}>
                            {e.description || "（摘要なし）"}
                          </div>
                          {e.reviewNote && (
                            <div className="text-xs text-muted-foreground mt-0.5 max-w-[200px] truncate" title={e.reviewNote}>
                              📝 {e.reviewNote}
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-2 max-w-[120px] truncate" title={e.debitAccount}>
                          {e.debitAccount}
                        </td>
                        <td className="py-2 px-2 max-w-[120px] truncate" title={e.creditAccount}>
                          {e.creditAccount}
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums">{formatCurrency(e.amount)}</td>
                        <td className="py-2 px-2 text-center">
                          <span className="text-xs text-muted-foreground">
                            {sourceLabel[e.source] ?? e.source}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-center">
                          <Badge variant={meta.variant}>{meta.label}</Badge>
                        </td>
                        <td className="py-2 px-2">
                          <div className="flex items-center justify-end gap-1">
                            {isBusy ? (
                              <Loader2 className="size-4 animate-spin text-muted-foreground" />
                            ) : (
                              <>
                                <button
                                  onClick={() => applyStatus(e, "confirmed")}
                                  title="確認済みにする"
                                  className="p-1.5 rounded hover:bg-muted text-green-600 dark:text-green-400 disabled:opacity-40"
                                  disabled={e.reviewStatus === "confirmed"}
                                >
                                  <CheckCircle className="size-4" />
                                </button>
                                <button
                                  onClick={() => openNote(e, "needs_fix")}
                                  title="要修正（メモ）"
                                  className="p-1.5 rounded hover:bg-muted text-amber-600 dark:text-amber-400"
                                >
                                  <AlertCircle className="size-4" />
                                </button>
                                <button
                                  onClick={() => openNote(e, "question")}
                                  title="質問中（メモ）"
                                  className="p-1.5 rounded hover:bg-muted text-primary"
                                >
                                  <MessageCircleQuestion className="size-4" />
                                </button>
                                {e.reviewStatus !== "unreviewed" && (
                                  <button
                                    onClick={() => applyStatus(e, "unreviewed", null)}
                                    title="未確認に戻す"
                                    className="p-1.5 rounded hover:bg-muted text-muted-foreground"
                                  >
                                    <RotateCcw className="size-4" />
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* メモ入力モーダル */}
      {noteModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={() => setNoteModal(null)}
        >
          <div
            className="bg-card border border-border rounded-xl shadow-xl w-full max-w-md"
            onClick={(ev) => ev.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="font-bold">
                {noteModal.status === "needs_fix" ? "要修正にする" : "質問中にする"}
              </h2>
              <button onClick={() => setNoteModal(null)} className="p-1 rounded hover:bg-muted">
                <X className="size-5" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-xs text-muted-foreground">
                {noteModal.entry.date}・{noteModal.entry.description || "（摘要なし）"}
              </p>
              <textarea
                value={noteText}
                onChange={(ev) => setNoteText(ev.target.value)}
                rows={4}
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                placeholder={
                  noteModal.status === "needs_fix"
                    ? "修正が必要な点を記入（顧問先への質問にも連携されます）"
                    : "顧問先への質問内容を記入"
                }
              />
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
              <Button variant="outline" onClick={() => setNoteModal(null)}>
                キャンセル
              </Button>
              <Button onClick={submitNote}>登録</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
