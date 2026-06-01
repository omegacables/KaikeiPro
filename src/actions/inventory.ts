"use server";

import { createServerSupabaseClient } from "@/lib/supabase";

export interface InventoryCount {
  id: string;
  client_id: string;
  count_date: string;   // 棚卸日 (YYYY-MM-DD)
  product_name: string; // 商品名
  quantity: number;     // 数量
  unit_price: number;   // 単価
  amount: number;       // 金額 (= 数量 × 単価, DB側で自動計算)
  created_at: string;
}

export interface InventoryCountInput {
  count_date: string;
  product_name: string;
  quantity: number;
  unit_price: number;
}

export async function getInventoryCounts(clientId: string): Promise<InventoryCount[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("inventory_counts")
    .select("*")
    .eq("client_id", clientId)
    .order("count_date", { ascending: true })
    .order("product_name", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as InventoryCount[];
}

export async function createInventoryCount(
  clientId: string,
  input: InventoryCountInput
): Promise<InventoryCount> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("inventory_counts")
    .insert({
      client_id: clientId,
      count_date: input.count_date,
      product_name: input.product_name,
      quantity: input.quantity,
      unit_price: input.unit_price,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as InventoryCount;
}

export async function updateInventoryCount(
  id: string,
  input: InventoryCountInput
): Promise<InventoryCount> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("inventory_counts")
    .update({
      count_date: input.count_date,
      product_name: input.product_name,
      quantity: input.quantity,
      unit_price: input.unit_price,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as InventoryCount;
}

export async function deleteInventoryCount(id: string): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("inventory_counts").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
