"use server";

import { createServerSupabaseClient, createAdminSupabaseClient } from "@/lib/supabase";
import { assertFirmAccess, assertClientManagedByFirm } from "@/lib/authz";

export async function setupSelfServiceAccount(name: string, companyName: string) {
  const supabase = await createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("認証が必要です");

  // 重複防止: 既にclient_usersまたはfirm_membersに登録されていないか確認
  const { data: existingClient } = await supabase
    .from("client_users")
    .select("id")
    .eq("user_id", user.id)
    .limit(1);

  if (existingClient && existingClient.length > 0) {
    throw new Error("既にアカウントが設定済みです");
  }

  const { data: existingMember } = await supabase
    .from("firm_members")
    .select("id")
    .eq("user_id", user.id)
    .limit(1);

  if (existingMember && existingMember.length > 0) {
    throw new Error("既にアカウントが設定済みです");
  }

  const { data: clientId, error } = await supabase.rpc(
    "setup_self_service_account",
    {
      p_user_id: user.id,
      p_name: name,
      p_email: user.email ?? "",
      p_company_name: companyName,
    }
  );

  if (error) throw new Error(error.message);

  return { clientId };
}

export async function createClientPortalAccount(input: {
  clientId: string;
  name: string;
  email: string;
  password: string;
}) {
  // 認証確認（税理士がログイン済みであること）
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("認証が必要です");

  // 呼び出し者が当該クライアントを管理する事務所メンバー（または super_admin）か検証。
  // これがないと、任意の認証ユーザーが他テナントのクライアントにログインを作成できてしまう。
  await assertClientManagedByFirm(input.clientId);

  // 重複チェック
  const { data: existingUser } = await supabase
    .from("client_users")
    .select("id")
    .eq("client_id", input.clientId)
    .eq("email", input.email)
    .limit(1);

  if (existingUser && existingUser.length > 0) {
    throw new Error("このメールアドレスは既に登録されています");
  }

  // Admin クライアントでユーザーを作成
  const admin = createAdminSupabaseClient();

  const { data: authData, error: authError } =
    await admin.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: { name: input.name, role: "client" },
    });

  if (authError) throw new Error(authError.message);

  // client_users にリンク
  const { error: linkError } = await admin
    .from("client_users")
    .insert({
      client_id: input.clientId,
      user_id: authData.user.id,
      name: input.name,
      email: input.email,
      is_active: true,
    });

  if (linkError) throw new Error(linkError.message);

  return { userId: authData.user.id };
}

export async function createFirmMemberAccount(input: {
  firmId: string;
  name: string;
  email: string;
  password: string;
  role: "admin" | "staff";
}) {
  // 呼び出し者が当該事務所の管理者（または super_admin）であることを検証。
  // これがないと、誰でも任意の事務所に自分を staff/admin として追加できてしまう。
  await assertFirmAccess(input.firmId, { requireAdmin: true });

  const admin = createAdminSupabaseClient();

  // 重複チェック
  const { data: existing } = await admin
    .from("firm_members")
    .select("id")
    .eq("firm_id", input.firmId)
    .eq("email", input.email)
    .limit(1);

  if (existing && existing.length > 0) {
    throw new Error("このメールアドレスは既にこの事務所に登録されています");
  }

  // Auth ユーザー作成
  const { data: authData, error: authError } =
    await admin.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      user_metadata: { name: input.name, role: input.role },
    });

  if (authError) throw new Error(authError.message);

  // firm_members にリンク
  const { error: linkError } = await admin
    .from("firm_members")
    .insert({
      firm_id: input.firmId,
      user_id: authData.user.id,
      name: input.name,
      email: input.email,
      role: input.role,
      is_active: true,
    });

  if (linkError) throw new Error(linkError.message);

  return { userId: authData.user.id };
}
