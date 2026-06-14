"use server";

import {
  createServerSupabaseClient,
  createAdminSupabaseClient,
} from "@/lib/supabase";
import { assertClientAccess, resolveClientIdForRecord } from "@/lib/authz";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PendingReviewEntry {
  id: string;
  journalEntryId: string;
  date: string;
  description: string;
  debitAccount: string;
  creditAccount: string;
  debitAmount: number;
  creditAmount: number;
  receiptId: string | null;
  memo: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// 確認待ち仕訳一覧
// ---------------------------------------------------------------------------

export async function getPendingReviews(
  clientId: string
): Promise<PendingReviewEntry[]> {
  await assertClientAccess(clientId);
  const admin = createAdminSupabaseClient();

  // needs_review = true の仕訳を取得
  const { data: entries, error } = await admin
    .from("journal_entries")
    .select(`
      id, entry_date, description, receipt_id, created_at,
      journal_entry_lines (
        debit_amount, credit_amount, sort_order,
        accounts:account_id ( code, name )
      )
    `)
    .eq("client_id", clientId)
    .eq("needs_review", true)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  // 対応するコメント（メモ）を取得
  const entryIds = (entries ?? []).map((e) => e.id);
  let commentMap = new Map<string, string>();

  if (entryIds.length > 0) {
    const { data: comments } = await admin
      .from("comments")
      .select("journal_entry_id, body")
      .in("journal_entry_id", entryIds)
      .eq("author_role", "client")
      .eq("status", "open");

    for (const c of comments ?? []) {
      if (c.journal_entry_id) {
        commentMap.set(c.journal_entry_id, c.body);
      }
    }
  }

  return (entries ?? []).map((entry) => {
    const lines = (entry.journal_entry_lines ?? []) as {
      debit_amount: number;
      credit_amount: number;
      sort_order: number;
      accounts: { code: string; name: string } | null;
    }[];

    const debitLines = lines.filter((l) => l.debit_amount > 0);
    const creditLines = lines.filter((l) => l.credit_amount > 0);

    return {
      id: entry.id.slice(0, 8),
      journalEntryId: entry.id,
      date: entry.entry_date,
      description: entry.description ?? "",
      debitAccount: debitLines.map((l) => l.accounts?.name ?? "").join("・"),
      creditAccount: creditLines.map((l) => l.accounts?.name ?? "").join("・"),
      debitAmount: debitLines.reduce((s, l) => s + l.debit_amount, 0),
      creditAmount: creditLines.reduce((s, l) => s + l.credit_amount, 0),
      receiptId: entry.receipt_id,
      memo: commentMap.get(entry.id) ?? null,
      createdAt: entry.created_at,
    };
  });
}

// ---------------------------------------------------------------------------
// 承認（確認待ち → 仕訳帳に反映）
// ---------------------------------------------------------------------------

export async function approveReviewEntry(
  journalEntryId: string
): Promise<void> {
  await resolveClientIdForRecord("journal_entries", journalEntryId);
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("認証エラー");

  const admin = createAdminSupabaseClient();

  const { error } = await admin
    .from("journal_entries")
    .update({
      needs_review: false,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", journalEntryId)
    .eq("needs_review", true);

  if (error) throw new Error(`承認エラー: ${error.message}`);

  // 関連コメントを resolved に更新
  await admin
    .from("comments")
    .update({ status: "resolved" })
    .eq("journal_entry_id", journalEntryId)
    .eq("status", "open");
}

// ---------------------------------------------------------------------------
// 却下（仕訳を削除）
// ---------------------------------------------------------------------------

export async function rejectReviewEntry(
  journalEntryId: string
): Promise<void> {
  await resolveClientIdForRecord("journal_entries", journalEntryId);
  const admin = createAdminSupabaseClient();

  // needs_review = true のみ操作可能
  const { data: entry } = await admin
    .from("journal_entries")
    .select("id, needs_review, receipt_id")
    .eq("id", journalEntryId)
    .single();

  if (!entry || !entry.needs_review) {
    throw new Error("確認待ちの仕訳ではありません");
  }

  // 明細を先に削除（FK制約）
  await admin
    .from("journal_entry_lines")
    .delete()
    .eq("journal_entry_id", journalEntryId);

  // 仕訳を削除
  await admin
    .from("journal_entries")
    .delete()
    .eq("id", journalEntryId);

  // レシートのステータスを ocr_done に戻す
  if (entry.receipt_id) {
    await admin
      .from("receipts")
      .update({ status: "ocr_done" })
      .eq("id", entry.receipt_id);
  }

  // 関連コメントを resolved に更新
  await admin
    .from("comments")
    .update({ status: "resolved" })
    .eq("journal_entry_id", journalEntryId);
}
