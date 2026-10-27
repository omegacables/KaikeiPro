/**
 * 外部連携の受け口が使う Supabase の読み書き。
 *
 * キーを引くまでは操作者なしの管理用クライアント、キーが決まったら操作者（x-actor-id）＝キーの利用者を
 * 付けた管理用クライアントで書く。書き込みはすべて client_id＝キーの会社に絞る。
 * キーの利用者が閲覧専用になった・アクセスを止められたときは、データベースのトリガーが書き込みを止める。
 */

import { createAdminSupabaseClient } from "@/lib/supabase";
import { supabaseReceiptIO } from "@/lib/receipt-upload";
import { ApiError, type ApiContext, type ExternalApiStore, type JournalSummary } from "./core";

type Admin = ReturnType<typeof createAdminSupabaseClient>;

const SUMMARY_COLUMNS = "id, external_id, entry_date, description, status, needs_review, receipt_id, created_at";

/** 書き込みの失敗を、送り手に分かる言葉にする */
function dbError(error: { code?: string; message: string }, what: string): never {
  if (error.code === "42501") {
    throw new ApiError(403, "user_cannot_write", "このAPIキーの利用者は、この会社に書き込めません（閲覧専用・停止など）。キーを発行し直してください");
  }
  console.error(`[api/v1] ${what}:`, error.message);
  throw new ApiError(500, "internal_error", `${what}に失敗しました`);
}

/** キーを引く・回数を数えるための入れ物（操作者なし） */
export function createKeyLookupStore(): Pick<ExternalApiStore, "findKeyByHash" | "hitRateLimit"> {
  const admin = createAdminSupabaseClient();
  return {
    async findKeyByHash(hash) {
      const { data, error } = await admin
        .from("api_keys")
        .select("id, client_id, user_id, scopes, revoked_at")
        .eq("key_hash", hash)
        .maybeSingle();
      if (error) dbError(error, "APIキーの確認");
      return data ?? null;
    },
    async hitRateLimit(keyId, limit) {
      const { data, error } = await admin.rpc("api_key_hit", { p_key_id: keyId, p_limit: limit });
      if (error) dbError(error, "呼び出し回数の確認");
      return Boolean(data);
    },
  };
}

/** キーが決まったあとの読み書き（操作者＝キーの利用者） */
export function createSupabaseStore(ctx: ApiContext): ExternalApiStore {
  const db: Admin = createAdminSupabaseClient({ actorId: ctx.userId });
  const lookup = createKeyLookupStore();
  return {
    ...lookup,
    async getClientName(clientId) {
      const { data } = await db.from("clients").select("name").eq("id", clientId).maybeSingle();
      return (data?.name as string | undefined) ?? null;
    },
    // 画面の getAccounts と同じく、会社の科目＋標準科目（client_id IS NULL）。
    // clientId はキーから決めた UUID なので、or() の文字列に入れてよい
    async listAccounts(clientId) {
      const { data, error } = await db
        .from("accounts")
        .select("id, client_id, code, name, is_active, account_categories:category_id ( type )")
        .or(`client_id.eq.${clientId},client_id.is.null`);
      if (error) dbError(error, "勘定科目の読み込み");
      type Row = {
        id: string;
        client_id: string | null;
        code: string;
        name: string;
        is_active: boolean;
        account_categories: { type: string } | null;
      };
      return ((data ?? []) as unknown as Row[]).map((a) => ({
        id: a.id,
        code: String(a.code ?? ""),
        name: a.name,
        type: a.account_categories?.type ?? "",
        is_active: a.is_active,
        standard: a.client_id === null,
      }));
    },
    async isDateLocked(clientId, date) {
      const { data, error } = await db
        .from("fiscal_years")
        .select("id")
        .eq("client_id", clientId)
        .eq("status", "locked")
        .lte("start_date", date)
        .gte("end_date", date)
        .limit(1);
      if (error) dbError(error, "会計年度の確認");
      return (data ?? []).length > 0;
    },
    async findJournalByExternalId(clientId, externalId) {
      const { data, error } = await db
        .from("journal_entries")
        .select(SUMMARY_COLUMNS)
        .eq("client_id", clientId)
        .eq("external_id", externalId)
        .maybeSingle();
      if (error) dbError(error, "仕訳の確認");
      return (data as JournalSummary | null) ?? null;
    },
    async receiptExists(clientId, receiptId) {
      const { data } = await db.from("receipts").select("id").eq("client_id", clientId).eq("id", receiptId).maybeSingle();
      return Boolean(data);
    },
    async insertJournal(entry, lines) {
      const { data: created, error } = await db.from("journal_entries").insert(entry).select("id").single();
      if (error) {
        if (error.code === "23505") return "conflict";
        dbError(error, "仕訳の登録");
      }
      const { error: linesErr } = await db
        .from("journal_entry_lines")
        .insert(lines.map((l) => ({ ...l, journal_entry_id: created!.id })));
      if (linesErr) {
        // ロールバック: 作成済みの仕訳を消す（明細の無い仕訳を残さない）
        await db.from("journal_entries").delete().eq("id", created!.id).eq("client_id", entry.client_id);
        dbError(linesErr, "仕訳明細の登録");
      }
      return { id: created!.id };
    },
    async markReceiptJournalized(clientId, receiptId, userId) {
      await db
        .from("receipts")
        .update({ status: "journalized", reviewed_at: new Date().toISOString(), reviewed_by: userId })
        .eq("id", receiptId)
        .eq("client_id", clientId);
    },
    // 照合・行の作成・ストレージともに管理用（操作者＝キーの利用者）
    receiptIO: supabaseReceiptIO(db, db),
  };
}
