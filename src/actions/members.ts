"use server";

/**
 * 顧問先ごとのメンバーと権限。
 *
 *   事務所側: admin（税理士・管理者） / staff（スタッフ） / viewer（閲覧専用）
 *   顧問先側: owner（社長） / member（社員） / viewer（閲覧専用）
 *
 * 社長は、交代した税理士・スタッフの自社データへのアクセスを止められる（client_access_blocks）。
 * 書き込みの可否はデータベース側（RLS とトリガー）でも止めている。ここは画面と管理操作のための確認。
 */

import { createServerSupabaseClient, createAdminSupabaseClient } from "@/lib/supabase";
import { assertClientAccess } from "@/lib/authz";

export type MyClientRole = {
  kind: "super_admin" | "firm" | "client" | "none";
  /** admin / staff / viewer / owner / member */
  role: string;
  canWrite: boolean;
  /** 顧問先の社長（またはシステム管理者） */
  isOwner: boolean;
};

async function myRole(clientId: string): Promise<MyClientRole & { userId: string; firmId: string | null }> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("認証が必要です");
  const admin = createAdminSupabaseClient();
  const [{ data: sa }, { data: client }, { data: cu }] = await Promise.all([
    admin.from("super_admins").select("id").eq("user_id", user.id).eq("is_active", true).maybeSingle(),
    admin.from("clients").select("firm_id").eq("id", clientId).maybeSingle(),
    admin.from("client_users").select("role, is_active").eq("client_id", clientId).eq("user_id", user.id).maybeSingle(),
  ]);
  const firmId = (client?.firm_id as string | null) ?? null;
  const { data: canWrite } = await supabase.rpc("can_write_client", { p_client_id: clientId });
  if (sa) return { kind: "super_admin", role: "admin", canWrite: true, isOwner: true, userId: user.id, firmId };
  if (cu && cu.is_active) {
    return { kind: "client", role: cu.role as string, canWrite: Boolean(canWrite), isOwner: cu.role === "owner", userId: user.id, firmId };
  }
  if (firmId) {
    const { data: fm } = await admin
      .from("firm_members")
      .select("role")
      .eq("firm_id", firmId)
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();
    if (fm) return { kind: "firm", role: fm.role as string, canWrite: Boolean(canWrite), isOwner: false, userId: user.id, firmId };
  }
  return { kind: "none", role: "", canWrite: false, isOwner: false, userId: user.id, firmId };
}

/** 自分のこの顧問先での役割（画面の出し分けに使う） */
export async function getMyClientRole(clientId: string): Promise<MyClientRole> {
  await assertClientAccess(clientId);
  const { kind, role, canWrite, isOwner } = await myRole(clientId);
  return { kind, role, canWrite, isOwner };
}

export type ClientMembers = {
  me: MyClientRole;
  /** 顧問先を担当する事務所のメンバー（税理士・スタッフ） */
  firmMembers: {
    userId: string;
    name: string;
    email: string;
    role: string;
    blocked: boolean;
    blockedAt: string | null;
    reason: string | null;
  }[];
  /** 顧問先側のユーザー */
  clientUsers: { id: string; userId: string; name: string; email: string; role: string; isActive: boolean }[];
};

export async function getClientMembers(clientId: string): Promise<ClientMembers> {
  await assertClientAccess(clientId);
  const me = await myRole(clientId);
  const admin = createAdminSupabaseClient();
  const [{ data: fms }, { data: blocks }, { data: cus }] = await Promise.all([
    me.firmId
      ? admin.from("firm_members").select("user_id, name, email, role, is_active").eq("firm_id", me.firmId).eq("is_active", true)
      : Promise.resolve({ data: [] as { user_id: string; name: string; email: string; role: string }[] }),
    admin.from("client_access_blocks").select("user_id, blocked_at, reason").eq("client_id", clientId),
    admin.from("client_users").select("id, user_id, name, email, role, is_active").eq("client_id", clientId).order("name"),
  ]);
  const blockOf = new Map(
    ((blocks ?? []) as { user_id: string; blocked_at: string; reason: string | null }[]).map((b) => [b.user_id, b])
  );
  return {
    me: { kind: me.kind, role: me.role, canWrite: me.canWrite, isOwner: me.isOwner },
    firmMembers: (fms ?? []).map((m) => {
      const b = blockOf.get(m.user_id as string);
      return {
        userId: m.user_id as string,
        name: (m.name as string) ?? "",
        email: (m.email as string) ?? "",
        role: m.role as string,
        blocked: Boolean(b),
        blockedAt: b?.blocked_at ?? null,
        reason: b?.reason ?? null,
      };
    }),
    clientUsers: (cus ?? []).map((u) => ({
      id: u.id as string,
      userId: u.user_id as string,
      name: (u.name as string) ?? "",
      email: (u.email as string) ?? "",
      role: (u.role as string) ?? "owner",
      isActive: Boolean(u.is_active),
    })),
  };
}

/**
 * 税理士・スタッフの、この顧問先へのアクセスを止める（または再開する）。社長だけが行える。
 * 止めると、その人はこの顧問先のデータを見ることも変えることもできなくなる。
 */
export async function setFirmMemberBlocked(
  clientId: string,
  userId: string,
  blocked: boolean,
  reason?: string
): Promise<void> {
  await assertClientAccess(clientId);
  const me = await myRole(clientId);
  if (!me.isOwner) throw new Error("担当者のアクセスを止められるのは、顧問先の社長だけです");
  const admin = createAdminSupabaseClient();
  if (!me.firmId) throw new Error("この顧問先には担当の事務所がありません");
  const { data: fm } = await admin.from("firm_members").select("id").eq("firm_id", me.firmId).eq("user_id", userId).maybeSingle();
  if (!fm) throw new Error("この顧問先を担当する事務所のメンバーではありません");
  if (blocked) {
    const { error } = await admin
      .from("client_access_blocks")
      .upsert({ client_id: clientId, user_id: userId, blocked_by: me.userId, reason: reason?.trim() || null }, {
        onConflict: "client_id,user_id",
      });
    if (error) throw new Error(error.message);
  } else {
    const { error } = await admin
      .from("client_access_blocks")
      .delete()
      .eq("client_id", clientId)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
  }
}

const CLIENT_ROLES = ["owner", "member", "viewer"] as const;
type ClientRole = (typeof CLIENT_ROLES)[number];

/** 顧問先ユーザーを管理できるか（社長、または書き込める事務所のメンバー） */
function canManageClientUsers(me: MyClientRole) {
  return me.isOwner || (me.kind === "firm" && me.canWrite);
}

/**
 * 顧問先ユーザーの役割の変更・停止。
 * 社長の役割・停止を変えられるのは社長だけ。最後の社長は外せない。
 */
export async function updateClientUserAccess(
  clientId: string,
  clientUserId: string,
  patch: { role?: ClientRole; isActive?: boolean }
): Promise<void> {
  await assertClientAccess(clientId);
  const me = await myRole(clientId);
  if (!canManageClientUsers(me)) throw new Error("ユーザーを管理する権限がありません");
  if (patch.role && !CLIENT_ROLES.includes(patch.role)) throw new Error("役割が正しくありません");
  const admin = createAdminSupabaseClient();
  const { data: target } = await admin
    .from("client_users")
    .select("id, user_id, role, is_active")
    .eq("id", clientUserId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (!target) throw new Error("ユーザーが見つかりません");
  const touchesOwner = target.role === "owner" || patch.role === "owner";
  if (touchesOwner && !me.isOwner) throw new Error("社長の役割を変えられるのは社長だけです");

  // 最後の社長を外さない（社長がいなくなると、担当者の停止などができなくなる）
  const losesOwner = target.role === "owner" && target.is_active && (patch.isActive === false || (patch.role && patch.role !== "owner"));
  if (losesOwner) {
    const { count } = await admin
      .from("client_users")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .eq("role", "owner")
      .eq("is_active", true);
    if ((count ?? 0) <= 1) throw new Error("最後の社長は外せません。先に別のユーザーを社長にしてください");
  }

  const update: { role?: string; is_active?: boolean } = {};
  if (patch.role) update.role = patch.role;
  if (patch.isActive !== undefined) update.is_active = patch.isActive;
  const { error } = await admin.from("client_users").update(update as { role?: ClientRole; is_active?: boolean }).eq("id", clientUserId);
  if (error) throw new Error(error.message);
}

/** 顧問先ユーザーを作る（社長・社員・閲覧専用）。社長または事務所のメンバーが行う */
export async function createClientUser(
  clientId: string,
  input: { name: string; email: string; password: string; role: ClientRole }
): Promise<void> {
  await assertClientAccess(clientId);
  const me = await myRole(clientId);
  if (!canManageClientUsers(me)) throw new Error("ユーザーを追加する権限がありません");
  if (!CLIENT_ROLES.includes(input.role)) throw new Error("役割が正しくありません");
  if (input.role === "owner" && !me.isOwner && me.kind !== "firm") throw new Error("社長を追加する権限がありません");
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("メールアドレスが正しくありません");
  if (input.password.length < 8) throw new Error("パスワードは8文字以上にしてください");

  const admin = createAdminSupabaseClient();
  const { data: dup } = await admin.from("client_users").select("id").eq("client_id", clientId).eq("email", email).limit(1);
  if (dup && dup.length) throw new Error("このメールアドレスは既に登録されています");

  const { data: auth, error: authError } = await admin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
    user_metadata: { name: input.name, role: "client" },
  });
  if (authError) throw new Error(authError.message);
  const { error } = await admin.from("client_users").insert({
    client_id: clientId,
    user_id: auth.user.id,
    name: input.name.trim(),
    email,
    is_active: true,
    role: input.role,
  });
  if (error) throw new Error(error.message);
}
