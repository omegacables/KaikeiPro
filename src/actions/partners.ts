"use server";

import { createServerSupabaseClient } from "@/lib/supabase";
import type { Database } from "@/types/database";

type PartnerRow = Database["public"]["Tables"]["business_partners"]["Row"];
type PartnerInsert = Database["public"]["Tables"]["business_partners"]["Insert"];
type PartnerUpdate = Database["public"]["Tables"]["business_partners"]["Update"];

export async function getPartners(clientId: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("business_partners")
    .select("*")
    .eq("client_id", clientId)
    .order("name");

  if (error) throw new Error(error.message);
  return data as PartnerRow[];
}

export async function getPartner(id: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("business_partners")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw new Error(error.message);
  return data as PartnerRow;
}

export async function createPartner(input: PartnerInsert) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("business_partners")
    .insert(input)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as PartnerRow;
}

export async function updatePartner(id: string, input: PartnerUpdate) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("business_partners")
    .update(input)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as PartnerRow;
}

export async function deletePartner(id: string) {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("business_partners")
    .delete()
    .eq("id", id);

  if (error) throw new Error(error.message);
}

export async function deleteAllPartners(clientId: string) {
  const supabase = await createServerSupabaseClient();

  // Delete invoices first due to FK RESTRICT on business_partners
  const { error: invError } = await supabase
    .from("invoices")
    .delete()
    .eq("client_id", clientId);

  if (invError) throw new Error(invError.message);

  const { error } = await supabase
    .from("business_partners")
    .delete()
    .eq("client_id", clientId);

  if (error) throw new Error(error.message);
}

/**
 * 取引先に「通帳での表記」（別名）を1件足す。
 *
 * 通帳には「振込 ｶ)ｵｵｻｶﾌﾞﾋﾝ」のように正式名称とは違う書かれ方で載るため、
 * 一度結び付けておくと次回から自動で当たるようになる。
 * 借入金台帳の addLoanAlias と同じ考え方で、学習に任せず明示的に登録する
 * （後から「なぜこの取引先に当たったのか」を説明できるようにするため）。
 */
export async function addPartnerAlias(partnerId: string, alias: string) {
  const trimmed = alias.trim();
  if (!trimmed) throw new Error("登録する表記が空です");

  const supabase = await createServerSupabaseClient();
  const { data: current, error: readErr } = await supabase
    .from("business_partners")
    .select("aliases")
    .eq("id", partnerId)
    .maybeSingle();
  if (readErr) throw new Error(readErr.message);
  if (!current) throw new Error("取引先が見つからないか、権限がありません");

  const existing = (current.aliases ?? []) as string[];
  if (existing.includes(trimmed)) return existing;

  const next = [...existing, trimmed];
  const { error } = await supabase
    .from("business_partners")
    .update({ aliases: next })
    .eq("id", partnerId);
  if (error) throw new Error(error.message);

  return next;
}
