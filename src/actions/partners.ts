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
