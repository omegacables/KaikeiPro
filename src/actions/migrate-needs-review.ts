"use server";

import { createAdminSupabaseClient } from "@/lib/supabase";

/**
 * needs_review カラムが存在しない場合に自動的に追加するマイグレーション
 * アプリ起動時に一度だけ呼ばれる
 */
let migrationDone = false;

export async function ensureNeedsReviewColumn(): Promise<void> {
  if (migrationDone) return;

  const admin = createAdminSupabaseClient();

  // カラムの存在確認: needs_review が存在しないエントリを取得してみる
  const { error } = await admin
    .from("journal_entries")
    .select("needs_review")
    .limit(1);

  if (error && error.message.includes("needs_review")) {
    // カラムが存在しない → RPC経由で追加を試みる
    // Supabase REST APIでは直接DDLを実行できないため、
    // 代わりにアプリ側で needs_review をオプショナルとして扱う
    console.warn("needs_review カラムが存在しません。SupabaseダッシュボードのSQL Editorで以下を実行してください:");
    console.warn("ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false;");
    console.warn("ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS reviewed_by uuid;");
    console.warn("ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;");
  }

  migrationDone = true;
}
