"use server";

import { createServerSupabaseClient } from "@/lib/supabase";
import type { Database } from "@/types/database";

type AccountRow = Database["public"]["Tables"]["accounts"]["Row"];
type AccountInsert = Database["public"]["Tables"]["accounts"]["Insert"];
type AccountUpdate = Database["public"]["Tables"]["accounts"]["Update"];

export async function getAccounts(clientId: string, includeInactive = false) {
  const supabase = await createServerSupabaseClient();
  let query = supabase
    .from("accounts")
    .select(`
      *,
      account_categories ( id, type, name, sort_order )
    `)
    .or(`client_id.eq.${clientId},client_id.is.null`);
  // 勘定科目管理など、無効科目も含めて取得したい場合は includeInactive=true
  if (!includeInactive) query = query.eq("is_active", true);
  const { data, error } = await query.order("code");

  if (error) throw new Error(error.message);
  return data;
}

export async function getAccount(id: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("accounts")
    .select(`
      *,
      account_categories ( id, type, name, sort_order ),
      sub_accounts ( id, name, is_active )
    `)
    .eq("id", id)
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function createAccount(input: AccountInsert) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("accounts")
    .insert(input)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as AccountRow;
}

export async function updateAccount(id: string, input: AccountUpdate) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("accounts")
    .update(input)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as AccountRow;
}

export async function deleteAccount(id: string) {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("accounts")
    .update({ is_active: false })
    .eq("id", id);

  if (error) throw new Error(error.message);
}

export async function getAccountCategories() {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("account_categories")
    .select("*")
    .order("sort_order");

  if (error) throw new Error(error.message);
  return data;
}
