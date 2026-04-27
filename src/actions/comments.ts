"use server";

import { createServerSupabaseClient } from "@/lib/supabase";
import type { Database } from "@/types/database";

type CommentRow = Database["public"]["Tables"]["comments"]["Row"];
type CommentInsert = Database["public"]["Tables"]["comments"]["Insert"];
type CommentUpdate = Database["public"]["Tables"]["comments"]["Update"];

export async function getCommentsByReceipt(receiptId: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("comments")
    .select("*")
    .eq("receipt_id", receiptId)
    .order("created_at");

  if (error) throw new Error(error.message);
  return data as CommentRow[];
}

export async function getCommentsByJournalEntry(journalEntryId: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("comments")
    .select("*")
    .eq("journal_entry_id", journalEntryId)
    .order("created_at");

  if (error) throw new Error(error.message);
  return data as CommentRow[];
}

export async function getOpenComments(clientId: string) {
  const supabase = await createServerSupabaseClient();

  // Get receipt IDs for this client
  const { data: receipts } = await supabase
    .from("receipts")
    .select("id")
    .eq("client_id", clientId);

  const receiptIds = receipts?.map((r) => r.id) ?? [];

  if (receiptIds.length === 0) return [];

  const { data, error } = await supabase
    .from("comments")
    .select("*")
    .eq("status", "open")
    .in("receipt_id", receiptIds)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data as CommentRow[];
}

export async function createComment(input: CommentInsert) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("comments")
    .insert(input)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as CommentRow;
}

export async function updateComment(id: string, input: CommentUpdate) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("comments")
    .update(input)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as CommentRow;
}

export async function resolveComment(id: string) {
  return updateComment(id, { status: "resolved" });
}

/**
 * スレッド型Q&A: クライアントの質問 + 返信 + レシート情報 + 著者名
 */
export async function getCommentsWithReplies(clientId: string) {
  const supabase = await createServerSupabaseClient();

  // クライアントのレシートID取得
  const { data: receipts } = await supabase
    .from("receipts")
    .select("id")
    .eq("client_id", clientId);

  const receiptIds = receipts?.map((r) => r.id) ?? [];

  // コメント取得（レシートjoinは型定義に関係がないため別クエリ）
  const { data, error } = await supabase
    .from("comments")
    .select("*")
    .neq("status", "resolved")
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  // クライアントに関連するコメントだけフィルタ
  const filtered = (data ?? []).filter((c) => {
    if (c.receipt_id && receiptIds.includes(c.receipt_id)) return true;
    if (!c.receipt_id) return true; // 一般質問は全て表示
    return false;
  });

  // レシートのOCR情報を別途取得（vendor_name用）
  const commentReceiptIds = [
    ...new Set(filtered.map((c) => c.receipt_id).filter(Boolean) as string[]),
  ];
  const receiptOcrMap: Record<string, string | null> = {};
  if (commentReceiptIds.length > 0) {
    const { data: receiptData } = await supabase
      .from("receipts")
      .select("id, ocr_result")
      .in("id", commentReceiptIds);
    receiptData?.forEach((r) => {
      const ocr = r.ocr_result as { vendor_name?: string } | null;
      receiptOcrMap[r.id] = ocr?.vendor_name ?? null;
    });
  }

  // トップレベル(質問)と返信に分離
  const topLevel = filtered.filter((c) => !c.parent_id);
  const replies = filtered.filter((c) => c.parent_id);

  // 著者名を解決
  const authorIds = filtered.map((c) => ({
    id: c.author_id,
    role: c.author_role as "staff" | "client",
  }));
  const authorNames = await resolveAuthorNames(supabase, authorIds);

  return topLevel.map((q) => ({
    ...q,
    vendor_name: q.receipt_id ? (receiptOcrMap[q.receipt_id] ?? null) : null,
    author_name: authorNames[q.author_id] ?? (q.author_role === "staff" ? "担当者" : "クライアント"),
    replies: replies
      .filter((r) => r.parent_id === q.id)
      .map((r) => ({
        ...r,
        author_name: authorNames[r.author_id] ?? (r.author_role === "staff" ? "担当者" : "クライアント"),
      })),
  }));
}

/**
 * 著者名を firm_members / client_users から解決
 */
async function resolveAuthorNames(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  authorIds: { id: string; role: "staff" | "client" }[]
) {
  const names: Record<string, string> = {};
  const uniqueStaff = [...new Set(authorIds.filter((a) => a.role === "staff").map((a) => a.id))];
  const uniqueClient = [...new Set(authorIds.filter((a) => a.role === "client").map((a) => a.id))];

  if (uniqueStaff.length > 0) {
    const { data } = await supabase
      .from("firm_members")
      .select("user_id, name")
      .in("user_id", uniqueStaff);
    data?.forEach((m) => { names[m.user_id] = m.name; });
  }

  if (uniqueClient.length > 0) {
    const { data } = await supabase
      .from("client_users")
      .select("user_id, name")
      .in("user_id", uniqueClient);
    data?.forEach((c) => { names[c.user_id] = c.name; });
  }

  return names;
}
