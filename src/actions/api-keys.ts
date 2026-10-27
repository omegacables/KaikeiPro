"use server";

/**
 * 外部連携のAPIキー（顧問先ごと）の発行・一覧・無効化。
 * キーは発行したときに一度だけ返し、データベースには SHA-256 の指紋だけを残す。
 * 発行・無効化はその会社の管理者（社長）と事務所の管理者だけ。一覧はこの会社を見られる人なら見られる。
 */

import { createServerSupabaseClient, createAdminSupabaseClient } from "@/lib/supabase";
import { assertClientAccess } from "@/lib/authz";
import { getMyClientRole } from "./members";
import {
  API_SCOPES,
  apiKeyDisplayPrefix,
  canManageApiKeys,
  generateApiKey,
  hashApiKey,
} from "@/lib/external-api/keys";

export type ApiKeyListItem = {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export type ApiKeyList = { canManage: boolean; keys: ApiKeyListItem[] };

async function assertCanManage(clientId: string): Promise<string> {
  await assertClientAccess(clientId);
  const me = await getMyClientRole(clientId);
  if (!canManageApiKeys(me)) {
    throw new Error("APIキーを発行・無効化できるのは、会社の管理者（社長）と事務所の管理者だけです");
  }
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("認証が必要です");
  return user.id;
}

export async function listApiKeys(clientId: string): Promise<ApiKeyList> {
  await assertClientAccess(clientId);
  const me = await getMyClientRole(clientId);
  const admin = createAdminSupabaseClient();
  // 指紋（key_hash）は読まない
  const { data, error } = await admin
    .from("api_keys")
    .select("id, name, key_prefix, scopes, last_used_at, revoked_at, created_at")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return {
    canManage: canManageApiKeys(me),
    keys: (data ?? []).map((k) => ({
      id: k.id,
      name: k.name,
      keyPrefix: k.key_prefix,
      scopes: k.scopes,
      lastUsedAt: k.last_used_at,
      revokedAt: k.revoked_at,
      createdAt: k.created_at,
    })),
  };
}

/** 発行。返す key はこのときだけ。書き込みはキーを発行した人として行われる */
export async function createApiKey(clientId: string, name: string): Promise<{ key: string; item: ApiKeyListItem }> {
  const userId = await assertCanManage(clientId);
  const label = name.trim();
  if (!label) throw new Error("キーの名前を入れてください（例: 自動仕訳のMac）");
  if (label.length > 100) throw new Error("キーの名前は100文字までです");

  const key = generateApiKey();
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("api_keys")
    .insert({
      client_id: clientId,
      user_id: userId,
      name: label,
      key_prefix: apiKeyDisplayPrefix(key),
      key_hash: hashApiKey(key),
      scopes: API_SCOPES,
      created_by: userId,
    })
    .select("id, name, key_prefix, scopes, last_used_at, revoked_at, created_at")
    .single();
  if (error || !data) throw new Error(`発行に失敗しました: ${error?.message ?? "unknown"}`);
  return {
    key,
    item: {
      id: data.id,
      name: data.name,
      keyPrefix: data.key_prefix,
      scopes: data.scopes,
      lastUsedAt: data.last_used_at,
      revokedAt: data.revoked_at,
      createdAt: data.created_at,
    },
  };
}

/** 無効化（元に戻せない。使い続けるなら発行し直す） */
export async function revokeApiKey(clientId: string, keyId: string): Promise<void> {
  await assertCanManage(clientId);
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", keyId)
    .eq("client_id", clientId)
    .is("revoked_at", null)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error("そのキーは見つからないか、すでに無効です");
}
