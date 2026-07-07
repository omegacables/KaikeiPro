"use server";

import { createServerSupabaseClient, createAdminSupabaseClient } from "@/lib/supabase";
import { assertRecordsAccess } from "@/lib/authz";
import type { Database } from "@/types/database";
import { getReviewReasons } from "@/lib/receipt-review";

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

// ダッシュボード用：顧問先ごとに「要確認」の証憑件数を集計する。
// 判定基準は一覧/詳細と同じ共通ロジック（src/lib/receipt-review.ts）を使用。
export async function getReviewCountsByClient(): Promise<
  { client_id: string; client_name: string; count: number }[]
> {
  const supabase = await createServerSupabaseClient();

  const { data: clients, error } = await supabase
    .from("clients")
    .select("id, name")
    .eq("is_active", true)
    .order("name");
  if (error) throw new Error(error.message);
  if (!clients) return [];

  const results = await Promise.all(
    clients.map(async (c) => {
      const [receiptsRes, reviewRes] = await Promise.all([
        supabase
          .from("receipts")
          .select("*")
          .eq("client_id", c.id)
          .not("status", "in", "(uploaded,processing)"),
        supabase
          .from("journal_entries")
          .select("receipt_id")
          .eq("client_id", c.id)
          .eq("needs_review", true)
          .not("receipt_id", "is", null),
      ]);

      const reviewIds = new Set(
        (reviewRes.data ?? []).map((e) => e.receipt_id).filter(Boolean)
      );

      let count = 0;
      for (const row of receiptsRes.data ?? []) {
        const r = row as ReceiptRow & {
          direction?: "issued" | "received";
          document_type?: string;
        };
        const ocr = (r.ocr_result ?? null) as {
          invoice_number?: string;
          confidence?: number;
          amount_total?: number;
          total_amount?: number;
          date?: string;
          issued_date?: string;
          vendor_name?: string;
          possible_duplicate?: boolean;
        } | null;
        const direction = r.direction ?? "received";
        const reasons = getReviewReasons(
          {
            invoiceNumber: ocr?.invoice_number,
            ocrConfidence:
              typeof ocr?.confidence === "number" ? ocr.confidence : undefined,
            amount: ocr?.amount_total ?? ocr?.total_amount ?? 0,
            date: ocr?.date ?? ocr?.issued_date ?? r.uploaded_at?.split("T")[0] ?? "",
            vendor: ocr?.vendor_name ?? "不明",
            needsReview: reviewIds.has(r.id),
            documentType: r.document_type,
            possibleDuplicate: ocr?.possible_duplicate === true,
          },
          // 受領側のみインボイス形式チェックを要確認に含める（証憑管理の挙動に一致）
          direction === "received"
        );
        if (reasons.length > 0) count++;
      }

      return { client_id: c.id, client_name: c.name, count };
    })
  );

  return results;
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
  // 紐づく仕訳・コメント・画像もまとめて削除（証憑→仕訳の連動）
  await deleteReceipts([id]);
}

/**
 * 複数の領収書を一括削除（紐づく仕訳も削除）
 */
export async function deleteReceipts(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await assertRecordsAccess("receipts", ids);
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
