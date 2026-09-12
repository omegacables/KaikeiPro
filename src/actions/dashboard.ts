"use server";

import { createServerSupabaseClient } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/fetch-all";

/**
 * ダッシュボードの「未処理の作業」。
 *
 * ここに出すのは**状態**（今こうなっている）であって、出来事ではない。
 * 処理すれば数が減って消えるものだけを載せる。
 * 「〇〇が終わりました」のような通知は、見ても何もすることが無く、
 * 溜まるだけで読まれなくなるため載せない。
 *
 * 取得は RLS 付きのクライアントで行うので、担当している顧問先だけが返る。
 */
export type PendingWork = {
  client_id: string;
  client_name: string;
  /** 要確認の仕訳。決算書の集計から外れているので放置すると決算書が不完全になる */
  needsReviewJournals: number;
  /** 未回答の質問（証憑・仕訳へのコメント） */
  openComments: number;
  /** 取り込んだが仕訳にしていない銀行・カード明細の行 */
  pendingStatementLines: number;
};

export async function getPendingWorkByClient(): Promise<PendingWork[]> {
  const supabase = await createServerSupabaseClient();

  const { data: clients, error } = await supabase
    .from("clients")
    .select("id, name")
    .eq("is_active", true)
    .order("name");
  if (error) throw new Error(error.message);
  if (!clients || clients.length === 0) return [];

  // 顧問先ごとに問い合わせると往復が件数分に増える。
  // 3回だけ引いて、顧問先ごとの集計は取得後に行う。
  type IdRow = { client_id: string };
  type CommentRow = { receipts: { client_id: string } | null };

  const [journals, statementLines, comments] = await Promise.all([
    fetchAllRows<IdRow>((from, to) =>
      supabase
        .from("journal_entries")
        .select("client_id")
        .eq("needs_review", true)
        .range(from, to) as unknown as PromiseLike<{
        data: IdRow[] | null;
        error: { message: string } | null;
      }>
    ),
    fetchAllRows<IdRow>((from, to) =>
      supabase
        .from("statement_lines")
        .select("client_id")
        .eq("status", "pending")
        .range(from, to) as unknown as PromiseLike<{
        data: IdRow[] | null;
        error: { message: string } | null;
      }>
    ),
    // comments は client_id を持たないので、紐付く証憑から辿る
    fetchAllRows<CommentRow>((from, to) =>
      supabase
        .from("comments")
        .select("receipts!inner ( client_id )")
        .eq("status", "open")
        .range(from, to) as unknown as PromiseLike<{
        data: CommentRow[] | null;
        error: { message: string } | null;
      }>
    ),
  ]);

  const tally = (rows: { client_id: string }[]) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.client_id, (m.get(r.client_id) ?? 0) + 1);
    return m;
  };

  const journalMap = tally(journals);
  const lineMap = tally(statementLines);
  const commentMap = tally(
    comments
      .map((c) => c.receipts?.client_id)
      .filter((v): v is string => Boolean(v))
      .map((client_id) => ({ client_id }))
  );

  return clients
    .map((c) => ({
      client_id: c.id as string,
      client_name: c.name as string,
      needsReviewJournals: journalMap.get(c.id as string) ?? 0,
      openComments: commentMap.get(c.id as string) ?? 0,
      pendingStatementLines: lineMap.get(c.id as string) ?? 0,
    }))
    // 何も無い顧問先は出さない（並べても読むところが無い）
    .filter((r) => r.needsReviewJournals + r.openComments + r.pendingStatementLines > 0);
}
