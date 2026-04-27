"use server";

import { createServerSupabaseClient } from "@/lib/supabase";
import type { Database } from "@/types/database";

type AssetRow = Database["public"]["Tables"]["fixed_assets"]["Row"];
type AssetInsert = Database["public"]["Tables"]["fixed_assets"]["Insert"];
type AssetUpdate = Database["public"]["Tables"]["fixed_assets"]["Update"];

export async function getAssets(clientId: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("fixed_assets")
    .select("*")
    .eq("client_id", clientId)
    .is("disposed_at", null)
    .order("acquisition_date", { ascending: false });

  if (error) throw new Error(error.message);
  return data as AssetRow[];
}

export async function getAsset(id: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("fixed_assets")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw new Error(error.message);
  return data as AssetRow;
}

export async function createAsset(input: AssetInsert) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("fixed_assets")
    .insert(input)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as AssetRow;
}

export async function updateAsset(id: string, input: AssetUpdate) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("fixed_assets")
    .update(input)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as AssetRow;
}

export async function disposeAsset(id: string, disposedAt: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("fixed_assets")
    .update({ disposed_at: disposedAt })
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as AssetRow;
}
