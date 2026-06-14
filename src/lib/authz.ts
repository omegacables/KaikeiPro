// 共通認可ヘルパー（マルチテナント横断のIDOR対策）。
//
// 背景: 多くのサーバーアクションが createAdminSupabaseClient()（サービスロール）で
// 動作し RLS を迂回しているため、呼び出し側が渡す clientId / recordId の所有権を
// アプリ側で検証する必要がある。ここでは RLS（clients_select 等）をそのまま認可の
// 真実として再利用する：RLS バウンドのクライアントで対象行が取得できる＝アクセス可。
//
// 使い方: 各アクションの先頭で assertClientAccess(clientId) を呼ぶ。recordId しか
// 持たないアクションは resolveClientIdForRecord(table, id) で client_id を解決してから
// 後続のサービスロール処理を行う。

import { createServerSupabaseClient } from "@/lib/supabase";

/** client_id 列を直接持つテナントスコープのテーブル */
export type ClientScopedTable =
  | "receipts"
  | "journal_entries"
  | "payments"
  | "invoices"
  | "payroll_records"
  | "statement_lines"
  | "loans"
  | "fixed_assets"
  | "business_partners"
  | "accounts"
  | "bank_accounts"
  | "card_accounts"
  | "company_documents"
  | "client_users";

/**
 * 現在の認証ユーザーが指定クライアントにアクセスできることを保証する。
 * できない場合は例外を投げる。
 * RLS: clients_select = is_super_admin() OR id IN (SELECT get_user_client_ids())
 */
export async function assertClientAccess(clientId: string | null | undefined): Promise<string> {
  if (!clientId) throw new Error("クライアントIDが指定されていません");
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("認証が必要です");

  const { data, error } = await supabase
    .from("clients")
    .select("id")
    .eq("id", clientId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("このクライアントにアクセスする権限がありません");
  return clientId;
}

/**
 * 指定テーブルのレコードが属する client_id を、RLS バウンドのクライアントで解決する。
 * RLS により取得できなければアクセス不可として例外を投げる（＝所有権チェック）。
 * 解決した client_id を返すので、後続のサービスロール処理に利用できる。
 */
export async function resolveClientIdForRecord(
  table: ClientScopedTable,
  recordId: string | null | undefined
): Promise<string> {
  if (!recordId) throw new Error("レコードIDが指定されていません");
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("認証が必要です");

  const { data, error } = await supabase
    .from(table)
    .select("client_id")
    .eq("id", recordId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  const clientId = (data as { client_id: string | null } | null)?.client_id ?? null;
  if (!clientId) throw new Error("対象レコードが見つからないか、アクセスする権限がありません");
  return clientId;
}

/**
 * 複数レコードがすべて、アクセス可能なクライアントに属することを保証する。
 * 削除系の一括操作（deleteReceipts / deleteJournalEntries 等）で使用。
 */
export async function assertRecordsAccess(
  table: ClientScopedTable,
  recordIds: string[]
): Promise<void> {
  if (recordIds.length === 0) return;
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("認証が必要です");

  // RLS バウンドのクライアントで取得できた件数が、要求した件数と一致するか確認。
  const uniqueIds = Array.from(new Set(recordIds));
  const { data, error } = await supabase.from(table).select("id").in("id", uniqueIds);
  if (error) throw new Error(error.message);
  if (!data || data.length !== uniqueIds.length) {
    throw new Error("一部のレコードにアクセスする権限がありません");
  }
}

/** 現在ユーザーが super_admin かどうかを返す。 */
export async function isSuperAdmin(): Promise<boolean> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase
    .from("super_admins")
    .select("id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();
  return !!data;
}

/** 現在ユーザーが super_admin であることを保証する。 */
export async function assertSuperAdmin(): Promise<void> {
  if (!(await isSuperAdmin())) {
    throw new Error("この操作にはシステム管理者権限が必要です");
  }
}

/** firm_members から現在ユーザーのロールを取得（is_active のみ）。未所属なら null。 */
async function getFirmMembership(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  firmId: string,
  userId: string
): Promise<{ role: string } | null> {
  const { data } = await supabase
    .from("firm_members")
    .select("role")
    .eq("firm_id", firmId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  return (data as { role: string } | null) ?? null;
}

/**
 * 現在ユーザーが指定事務所のメンバー（必要なら admin）であることを保証する。
 * super_admin は常に許可。
 */
export async function assertFirmAccess(
  firmId: string | null | undefined,
  opts: { requireAdmin?: boolean } = {}
): Promise<void> {
  if (!firmId) throw new Error("事務所IDが指定されていません");
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("認証が必要です");

  // super_admin は全許可
  const { data: superAdmin } = await supabase
    .from("super_admins")
    .select("id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();
  if (superAdmin) return;

  const membership = await getFirmMembership(supabase, firmId, user.id);
  if (!membership) throw new Error("この事務所にアクセスする権限がありません");
  if (opts.requireAdmin && membership.role !== "admin") {
    throw new Error("この操作には事務所管理者権限が必要です");
  }
}

/**
 * 現在ユーザーが super_admin か、指定クライアントを管理する事務所の
 * メンバー（必要なら admin）であることを保証する。
 * createClientPortalAccount のように「クライアントを管理できる事務所側ユーザーか」を
 * 判定したい場合に使用（client_users 自身による昇格を防ぐ）。
 */
export async function assertClientManagedByFirm(
  clientId: string | null | undefined,
  opts: { requireAdmin?: boolean } = {}
): Promise<void> {
  if (!clientId) throw new Error("クライアントIDが指定されていません");
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("認証が必要です");

  const { data: superAdmin } = await supabase
    .from("super_admins")
    .select("id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();
  if (superAdmin) return;

  // クライアントの所属事務所を取得（RLS で可視なクライアントのみ）
  const { data: client, error } = await supabase
    .from("clients")
    .select("firm_id")
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const firmId = (client as { firm_id: string | null } | null)?.firm_id ?? null;
  if (!firmId) throw new Error("このクライアントを管理する権限がありません");

  await assertFirmAccess(firmId, opts);
}
