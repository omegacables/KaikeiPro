"use server";

import { createServerSupabaseClient } from "@/lib/supabase";
import { createRaqtoSupabaseClient } from "@/lib/supabase-raqto";

export type RaqtoIntegrationWithClient = {
  id: string;
  client_id: string;
  raqto_email: string | null;
  raqto_company_id: string | null;
  raqto_company_name: string | null;
  last_synced_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  client_name: string;
};

/**
 * 現在のユーザーがアクセス可能なクライアントIDを取得
 * RLSに依存せず、サーバー側で明示的にフィルタリング
 */
async function getAccessibleClientIds(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>
): Promise<string[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  // 1. firm_members 経由: ユーザーの事務所に属する全クライアント
  const { data: firmMembers } = await supabase
    .from("firm_members")
    .select("firm_id")
    .eq("user_id", user.id)
    .eq("is_active", true);

  const firmIds = firmMembers?.map((m) => m.firm_id) ?? [];
  let clientIds: string[] = [];

  if (firmIds.length > 0) {
    const { data: clients } = await supabase
      .from("clients")
      .select("id")
      .in("firm_id", firmIds);
    clientIds = clients?.map((c) => c.id) ?? [];
  }

  // 2. client_users 経由: クライアントユーザーの場合
  const { data: clientUsers } = await supabase
    .from("client_users")
    .select("client_id")
    .eq("user_id", user.id)
    .eq("is_active", true);

  const clientUserIds = clientUsers?.map((cu) => cu.client_id) ?? [];

  // 統合してユニーク化
  return [...new Set([...clientIds, ...clientUserIds])];
}

export async function getRaqtoIntegrations(): Promise<RaqtoIntegrationWithClient[]> {
  const supabase = await createServerSupabaseClient();

  // 明示的にアクセス可能なクライアントIDを取得（RLSに依存しない）
  const accessibleClientIds = await getAccessibleClientIds(supabase);
  if (accessibleClientIds.length === 0) return [];

  const { data, error } = await supabase
    .from("raqto_integrations")
    .select("id, client_id, raqto_email, raqto_company_id, raqto_company_name, last_synced_at, is_active, created_at, updated_at, clients(name)")
    .eq("is_active", true)
    .in("client_id", accessibleClientIds)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    id: row.id,
    client_id: row.client_id,
    raqto_email: row.raqto_email,
    raqto_company_id: row.raqto_company_id,
    raqto_company_name: row.raqto_company_name,
    last_synced_at: row.last_synced_at,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
    client_name: (row.clients as unknown as { name: string } | null)?.name ?? "",
  }));
}

export async function getRaqtoIntegration(clientId: string) {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("raqto_integrations")
    .select("*")
    .eq("client_id", clientId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

export async function linkRaqtoAccount(clientId: string, email: string) {
  // アクセス権チェック
  const supabase = await createServerSupabaseClient();
  const accessibleClientIds = await getAccessibleClientIds(supabase);
  if (!accessibleClientIds.includes(clientId)) {
    throw new Error("このクライアントにアクセスする権限がありません");
  }

  const raqto = createRaqtoSupabaseClient();

  // 1. Find user by email in Raqto auth
  const { data: userList, error: userError } = await raqto.auth.admin.listUsers();
  if (userError) throw new Error(`Raqto認証エラー: ${userError.message}`);

  const raqtoUser = userList.users.find(
    (u) => u.email?.toLowerCase() === email.toLowerCase()
  );
  if (!raqtoUser) {
    throw new Error("Raqto受発注にこのメールのアカウントが見つかりません");
  }

  // 2. Find company_member for this user
  const { data: member, error: memberError } = await raqto
    .from("company_members")
    .select("company_id")
    .eq("auth_user_id", raqtoUser.id)
    .limit(1)
    .maybeSingle();

  if (memberError) throw new Error(`会社メンバー検索エラー: ${memberError.message}`);
  if (!member) {
    throw new Error("Raqto受発注でこのユーザーの所属会社が見つかりません");
  }

  // 3. Get company name
  const { data: company, error: companyError } = await raqto
    .from("companies")
    .select("id, name")
    .eq("id", member.company_id)
    .single();

  if (companyError) throw new Error(`会社情報取得エラー: ${companyError.message}`);

  // 4. Save to KaikeiPro
  const { data, error } = await supabase
    .from("raqto_integrations")
    .upsert(
      {
        client_id: clientId,
        raqto_email: email,
        raqto_company_id: company.id,
        raqto_company_name: company.name,
        is_active: true,
      },
      { onConflict: "client_id" }
    )
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function unlinkRaqtoAccount(clientId: string) {
  const supabase = await createServerSupabaseClient();

  // アクセス権チェック
  const accessibleClientIds = await getAccessibleClientIds(supabase);
  if (!accessibleClientIds.includes(clientId)) {
    throw new Error("このクライアントの連携を解除する権限がありません");
  }

  const { error } = await supabase
    .from("raqto_integrations")
    .delete()
    .eq("client_id", clientId);

  if (error) throw new Error(error.message);
}
