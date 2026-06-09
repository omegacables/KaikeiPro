"use server";

import {
  createServerSupabaseClient,
  createAdminSupabaseClient,
} from "@/lib/supabase";

export type ReviewStatus =
  | "unreviewed"
  | "confirmed"
  | "needs_fix"
  | "question";

export interface ReviewEntry {
  id: string;
  date: string;
  description: string;
  debitAccount: string;
  creditAccount: string;
  amount: number;
  source: string;
  status: "draft" | "confirmed" | "locked";
  reviewStatus: ReviewStatus;
  reviewNote: string | null;
  receiptId: string | null;
  reviewedAt: string | null;
}

export interface ReviewSummary {
  unreviewed: number;
  confirmed: number;
  needs_fix: number;
  question: number;
  total: number;
}

type DbRow = Record<string, unknown>;

/** 仕訳レビュー一覧（レビューステータスでの絞り込み可） */
export async function getReviewEntries(
  clientId: string,
  filter?: ReviewStatus
): Promise<ReviewEntry[]> {
  const admin = createAdminSupabaseClient();
  let query = admin
    .from("journal_entries")
    .select(
      `id, entry_date, description, source, status, review_status, review_note, receipt_id, reviewed_at,
       journal_entry_lines ( debit_amount, credit_amount, accounts:account_id ( name ) )`
    )
    .eq("client_id", clientId);
  if (filter) query = query.eq("review_status", filter);
  const { data, error } = await query
    .order("entry_date", { ascending: false })
    .limit(300);
  if (error) throw new Error(error.message);

  return (data ?? []).map((e) => {
    const entry = e as DbRow;
    const lines = (entry.journal_entry_lines ?? []) as {
      debit_amount: number;
      credit_amount: number;
      accounts: { name: string } | null;
    }[];
    const debitLines = lines.filter((l) => l.debit_amount > 0);
    const creditLines = lines.filter((l) => l.credit_amount > 0);
    return {
      id: entry.id as string,
      date: entry.entry_date as string,
      description: (entry.description as string) ?? "",
      debitAccount: debitLines.map((l) => l.accounts?.name ?? "").join("・"),
      creditAccount: creditLines.map((l) => l.accounts?.name ?? "").join("・"),
      amount: debitLines.reduce((s, l) => s + l.debit_amount, 0),
      source: (entry.source as string) ?? "manual",
      status: (entry.status as ReviewEntry["status"]) ?? "draft",
      reviewStatus: (entry.review_status as ReviewStatus) ?? "unreviewed",
      reviewNote: (entry.review_note as string) ?? null,
      receiptId: (entry.receipt_id as string) ?? null,
      reviewedAt: (entry.reviewed_at as string) ?? null,
    };
  });
}

/** レビューステータスの集計（バッジ・サマリー用） */
export async function getReviewSummary(
  clientId: string
): Promise<ReviewSummary> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("journal_entries")
    .select("review_status")
    .eq("client_id", clientId);
  if (error) throw new Error(error.message);
  const summary: ReviewSummary = {
    unreviewed: 0,
    confirmed: 0,
    needs_fix: 0,
    question: 0,
    total: 0,
  };
  for (const r of data ?? []) {
    const s = ((r as DbRow).review_status as ReviewStatus) ?? "unreviewed";
    if (s in summary) summary[s] += 1;
    summary.total += 1;
  }
  return summary;
}

/**
 * 仕訳のレビューステータスを設定する。
 * 「要修正」「質問中」でメモがある場合は、顧問先向けの質問（comments）も作成して
 * 質問管理と連携する。
 */
export async function setReviewStatus(
  journalEntryId: string,
  reviewStatus: ReviewStatus,
  note?: string | null
): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const admin = createAdminSupabaseClient();
  const trimmedNote = note?.trim() || null;

  const { error } = await admin
    .from("journal_entries")
    .update({
      review_status: reviewStatus,
      review_note: trimmedNote,
      reviewed_by: user?.id ?? null,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", journalEntryId);
  if (error) throw new Error(`レビュー更新エラー: ${error.message}`);

  // 「要修正」「質問中」でメモがあれば質問（comments）として顧問先に連携
  if ((reviewStatus === "question" || reviewStatus === "needs_fix") && trimmedNote && user?.id) {
    const prefix = reviewStatus === "question" ? "【質問】" : "【要修正】";
    await admin.from("comments").insert({
      journal_entry_id: journalEntryId,
      author_id: user.id,
      author_role: "staff",
      body: `${prefix} ${trimmedNote}`,
      status: "open",
    });
  }

  // 「確認済み」にしたら、その仕訳の未解決の質問を解決済みに
  if (reviewStatus === "confirmed") {
    await admin
      .from("comments")
      .update({ status: "resolved" })
      .eq("journal_entry_id", journalEntryId)
      .eq("status", "open");
  }
}
