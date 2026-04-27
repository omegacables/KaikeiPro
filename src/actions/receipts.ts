"use server";

import { createServerSupabaseClient, createAdminSupabaseClient } from "@/lib/supabase";
import type { Database } from "@/types/database";

type ReceiptRow = Database["public"]["Tables"]["receipts"]["Row"];
type ReceiptInsert = Database["public"]["Tables"]["receipts"]["Insert"];
type ReceiptUpdate = Database["public"]["Tables"]["receipts"]["Update"];

export type ReceiptWithReview = ReceiptRow & { needs_review: boolean };

export async function getReceipts(clientId: string): Promise<ReceiptWithReview[]> {
  const supabase = await createServerSupabaseClient();

  // レシート一覧を取得
  const { data: receipts, error } = await supabase
    .from("receipts")
    .select("*")
    .eq("client_id", clientId)
    .order("uploaded_at", { ascending: false });

  if (error) throw new Error(error.message);

  // needs_review=true の仕訳に紐づく receipt_id を取得
  const { data: reviewEntries } = await supabase
    .from("journal_entries")
    .select("receipt_id")
    .eq("client_id", clientId)
    .eq("needs_review", true)
    .not("receipt_id", "is", null);

  const reviewReceiptIds = new Set(
    (reviewEntries ?? []).map((e) => e.receipt_id).filter(Boolean)
  );

  return (receipts ?? []).map((r) => ({
    ...r,
    needs_review: reviewReceiptIds.has(r.id),
  })) as ReceiptWithReview[];
}

export async function getReceipt(id: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("receipts")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw new Error(error.message);
  return data as ReceiptRow;
}

export async function createReceipt(input: ReceiptInsert) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("receipts")
    .insert(input)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as ReceiptRow;
}

export async function updateReceipt(id: string, input: ReceiptUpdate) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("receipts")
    .update(input)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as ReceiptRow;
}

export async function deleteReceipt(id: string) {
  const supabase = await createServerSupabaseClient();

  // 削除前にimage_pathを取得
  const { data: receipt } = await supabase
    .from("receipts")
    .select("image_path")
    .eq("id", id)
    .single();

  const { error } = await supabase.from("receipts").delete().eq("id", id);
  if (error) throw new Error(error.message);

  // ストレージからも削除（非クリティカル）
  if (receipt?.image_path) {
    try {
      const { deleteReceiptImage } = await import("./receipt-storage");
      await deleteReceiptImage(receipt.image_path);
    } catch {
      // ストレージ削除失敗は無視
    }
  }
}

/**
 * 複数の領収書を一括削除（紐づく仕訳も削除）
 */
export async function deleteReceipts(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const admin = createAdminSupabaseClient();

  // 紐づく仕訳を取得
  const { data: journals } = await admin
    .from("journal_entries")
    .select("id")
    .in("receipt_id", ids);

  const journalIds = (journals ?? []).map((j) => j.id);

  // 仕訳明細 → 仕訳を削除
  if (journalIds.length > 0) {
    await admin.from("journal_entry_lines").delete().in("journal_entry_id", journalIds);
    await admin.from("journal_entries").delete().in("id", journalIds);
  }

  // 関連コメントを削除
  await admin.from("comments").delete().in("receipt_id", ids);

  // 画像パスを取得
  const { data: receipts } = await admin
    .from("receipts")
    .select("image_path")
    .in("id", ids);

  // 領収書を削除
  await admin.from("receipts").delete().in("id", ids);

  // ストレージから画像を削除（非クリティカル）
  const { deleteReceiptImage } = await import("./receipt-storage");
  for (const r of receipts ?? []) {
    if (r.image_path) {
      try { await deleteReceiptImage(r.image_path); } catch { /* ignore */ }
    }
  }
}

export async function getReceiptsByStatus(
  clientId: string,
  status: ReceiptRow["status"]
) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("receipts")
    .select("*")
    .eq("client_id", clientId)
    .eq("status", status)
    .order("uploaded_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data as ReceiptRow[];
}

// For portal: get receipts uploaded by a specific user
export async function getReceiptsByUser(userId: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("receipts")
    .select("*")
    .eq("uploaded_by", userId)
    .order("uploaded_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data as ReceiptRow[];
}
