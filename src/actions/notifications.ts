"use server";

import { createServerSupabaseClient } from "@/lib/supabase";
import type { Database } from "@/types/database";

export type Notification =
  Database["public"]["Tables"]["notifications"]["Row"];

async function getAuthenticatedClient() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("認証が必要です");
  return { supabase, userId: user.id };
}

export async function getNotifications(limit = 20): Promise<Notification[]> {
  const { supabase } = await getAuthenticatedClient();
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`通知の取得に失敗しました: ${error.message}`);
  return data ?? [];
}

export async function getUnreadCount(): Promise<number> {
  const { supabase } = await getAuthenticatedClient();
  const { count, error } = await supabase
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("is_read", false);

  if (error) throw new Error(`未読件数の取得に失敗しました: ${error.message}`);
  return count ?? 0;
}

export async function markAsRead(id: string): Promise<void> {
  const { supabase } = await getAuthenticatedClient();
  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("id", id);

  if (error) throw new Error(`既読処理に失敗しました: ${error.message}`);
}

export async function markAllAsRead(): Promise<void> {
  const { supabase } = await getAuthenticatedClient();
  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("is_read", false);

  if (error) throw new Error(`一括既読処理に失敗しました: ${error.message}`);
}
