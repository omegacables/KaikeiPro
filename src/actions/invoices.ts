"use server";

import { createServerSupabaseClient } from "@/lib/supabase";
import type { Database } from "@/types/database";

type InvoiceRow = Database["public"]["Tables"]["invoices"]["Row"];
type InvoiceInsert = Database["public"]["Tables"]["invoices"]["Insert"];
type InvoiceUpdate = Database["public"]["Tables"]["invoices"]["Update"];
type InvoiceItemInsert = Database["public"]["Tables"]["invoice_items"]["Insert"];

export async function getInvoices(clientId: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("invoices")
    .select(`
      *,
      business_partners:business_partner_id ( id, name, type )
    `)
    .eq("client_id", clientId)
    .order("issued_date", { ascending: false });

  if (error) throw new Error(error.message);
  return data;
}

export async function getInvoice(id: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("invoices")
    .select(`
      *,
      business_partners:business_partner_id ( * ),
      invoice_items ( * )
    `)
    .eq("id", id)
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function createInvoice(
  invoice: InvoiceInsert,
  items: Omit<InvoiceItemInsert, "invoice_id">[]
) {
  const supabase = await createServerSupabaseClient();

  const { data: inv, error: invError } = await supabase
    .from("invoices")
    .insert(invoice)
    .select()
    .single();

  if (invError) throw new Error(invError.message);

  if (items.length > 0) {
    const { error: itemsError } = await supabase
      .from("invoice_items")
      .insert(
        items.map((item, i) => ({
          ...item,
          invoice_id: inv.id,
          sort_order: i,
        }))
      );

    if (itemsError) throw new Error(itemsError.message);
  }

  return inv as InvoiceRow;
}

export async function updateInvoice(id: string, input: InvoiceUpdate) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("invoices")
    .update(input)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as InvoiceRow;
}

export async function deleteInvoice(id: string) {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("invoices").delete().eq("id", id);

  if (error) throw new Error(error.message);
}

export async function deleteAllInvoices(clientId: string) {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("invoices")
    .delete()
    .eq("client_id", clientId);

  if (error) throw new Error(error.message);
}

/**
 * 未払い請求書を取得（消込用）
 * status が paid/void 以外 + payment_allocations で消込残額を算出可能
 */
export async function getUnpaidInvoices(clientId: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("invoices")
    .select(`
      *,
      business_partners:business_partner_id ( id, name, type ),
      payment_allocations ( id, allocated_amount )
    `)
    .eq("client_id", clientId)
    .not("status", "in", '("paid","void")')
    .order("due_date", { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
}
