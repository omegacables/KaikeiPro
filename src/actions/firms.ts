"use server";

import { createServerSupabaseClient, createAdminSupabaseClient } from "@/lib/supabase";
import { assertSuperAdmin, assertFirmAccess } from "@/lib/authz";
import type { Database } from "@/types/database";

type FirmRow = Database["public"]["Tables"]["firms"]["Row"];
type FirmInsert = Database["public"]["Tables"]["firms"]["Insert"];
type FirmUpdate = Database["public"]["Tables"]["firms"]["Update"];

export async function getFirms() {
  // super_admin は全事務所、それ以外は RLS（firms_select = id IN get_user_firm_ids()）で
  // 自分の所属事務所のみ。これにより全事務所名の横断漏えいを防ぐ。
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

  const client = superAdmin ? createAdminSupabaseClient() : supabase;
  const { data, error } = await client
    .from("firms")
    .select("*")
    .order("name");

  if (error) throw new Error(error.message);
  return data as FirmRow[];
}

export async function getFirm(id: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("firms")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw new Error(error.message);
  return data as FirmRow;
}

export async function createFirm(input: Omit<FirmInsert, "id">) {
  // 事務所の新規作成は super_admin のみ（自由なテナント乱立を防止）
  await assertSuperAdmin();
  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from("firms")
    .insert(input)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as FirmRow;
}

export async function updateFirm(id: string, input: FirmUpdate) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("認証が必要です");

  // super_admin uses admin client to bypass RLS
  const { data: superAdmin } = await supabase
    .from("super_admins")
    .select("id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .single();

  const client = superAdmin ? createAdminSupabaseClient() : supabase;
  const { data, error } = await client
    .from("firms")
    .update(input)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as FirmRow;
}

export async function getCurrentFirm(): Promise<FirmRow | null> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("認証が必要です");

  // super_adminの場合はfirm_memberがないのでnull返却
  const { data: superAdmin } = await supabase
    .from("super_admins")
    .select("id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .single();

  if (superAdmin) return null;

  const { data: member } = await supabase
    .from("firm_members")
    .select("firm_id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .single();

  if (!member) return null;

  return getFirm(member.firm_id);
}

export async function getFirmMembers(firmId: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("firm_members")
    .select("*")
    .eq("firm_id", firmId)
    .order("name");

  if (error) throw new Error(error.message);
  return data;
}

export async function updateFirmMember(
  id: string,
  input: { name?: string; role?: "admin" | "staff"; is_active?: boolean }
) {
  // Use admin client to bypass RLS recursive policy on firm_members
  const supabase = await createServerSupabaseClient();
  const admin = createAdminSupabaseClient();

  // Verify the current user is an admin of the same firm as the target member
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("認証されていません");

  const { data: target } = await admin
    .from("firm_members")
    .select("firm_id")
    .eq("id", id)
    .single();
  if (!target) throw new Error("メンバーが見つかりません");

  const { data: caller } = await admin
    .from("firm_members")
    .select("role, is_active")
    .eq("firm_id", target.firm_id)
    .eq("user_id", user.id)
    .single();
  if (!caller || caller.role !== "admin" || !caller.is_active) {
    throw new Error("管理者権限が必要です");
  }

  const { data, error } = await admin
    .from("firm_members")
    .update(input)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

/**
 * 税理士アカウント（firm_members）を削除する。
 * super_admin または同一事務所の有効な管理者のみ実行可能。
 * 削除後、他に所属（別事務所・顧問先ユーザー・super_admin）が無ければ
 * 認証ユーザー本体も削除し、メールアドレスを再利用可能にする。
 */
export async function deleteFirmMember(id: string) {
  const supabase = await createServerSupabaseClient();
  const admin = createAdminSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("認証されていません");

  const { data: target } = await admin
    .from("firm_members")
    .select("firm_id, user_id")
    .eq("id", id)
    .single();
  if (!target) throw new Error("メンバーが見つかりません");

  if (target.user_id === user.id) {
    throw new Error("自分自身のアカウントは削除できません");
  }

  // super_admin か、同一事務所の有効な管理者のみ削除可能
  const { data: superAdmin } = await admin
    .from("super_admins")
    .select("user_id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (!superAdmin) {
    const { data: caller } = await admin
      .from("firm_members")
      .select("role, is_active")
      .eq("firm_id", target.firm_id)
      .eq("user_id", user.id)
      .single();
    if (!caller || caller.role !== "admin" || !caller.is_active) {
      throw new Error("削除には管理者権限が必要です");
    }
  }

  // メンバーシップを削除
  const { error } = await admin.from("firm_members").delete().eq("id", id);
  if (error) throw new Error(error.message);

  // 他に所属が無ければ認証ユーザーも削除（メール再利用のため）
  const uid = target.user_id;
  const [fm, cu, sa] = await Promise.all([
    admin.from("firm_members").select("user_id").eq("user_id", uid).limit(1),
    admin.from("client_users").select("user_id").eq("user_id", uid).limit(1),
    admin.from("super_admins").select("user_id").eq("user_id", uid).limit(1),
  ]);
  const stillUsed =
    (fm.data?.length ?? 0) > 0 ||
    (cu.data?.length ?? 0) > 0 ||
    (sa.data?.length ?? 0) > 0;
  if (!stillUsed) {
    await admin.auth.admin.deleteUser(uid).catch(() => {
      // 認証ユーザーが既に存在しない場合等は無視（メンバーシップ削除は完了済み）
    });
  }
}

export async function isSelfServiceFirm(): Promise<boolean> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  // client_usersベースのユーザー（firm_id=NULLの顧問先）はセルフサービスとみなす
  const { data: clientUser } = await supabase
    .from("client_users")
    .select("client_id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .single();

  if (clientUser) {
    // client の firm_id が NULL ならセルフサービス
    const { data: client } = await supabase
      .from("clients")
      .select("firm_id")
      .eq("id", clientUser.client_id)
      .single();

    return client?.firm_id === null;
  }

  // firm_memberの場合は従来通り
  const { data: member } = await supabase
    .from("firm_members")
    .select("firm_id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .single();

  if (!member) return false;

  const { data: firm } = await supabase
    .from("firms")
    .select("is_self_service")
    .eq("id", member.firm_id)
    .single();

  return firm?.is_self_service ?? false;
}

export async function inviteFirmMember(input: {
  firm_id: string;
  email: string;
  name: string;
  role: "admin" | "staff";
}) {
  // 呼び出し者が当該事務所の管理者（または super_admin）であることを検証
  await assertFirmAccess(input.firm_id, { requireAdmin: true });
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("firm_members")
    .insert({ ...input, is_active: true, user_id: crypto.randomUUID() })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}
