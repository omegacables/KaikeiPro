"use server";

import { createServerSupabaseClient } from "@/lib/supabase";
import type { Database } from "@/types/database";

type PaymentRow = Database["public"]["Tables"]["payments"]["Row"];
type PaymentInsert = Database["public"]["Tables"]["payments"]["Insert"];
type PaymentUpdate = Database["public"]["Tables"]["payments"]["Update"];

export async function getPayments(clientId: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("payments")
    .select(`
      *,
      business_partners:business_partner_id ( id, name, type ),
      payment_allocations (
        id,
        allocated_amount,
        invoices:invoice_id ( id, invoice_number, total_amount )
      )
    `)
    .eq("client_id", clientId)
    .order("payment_date", { ascending: false });

  if (error) throw new Error(error.message);
  return data;
}

export async function getPayment(id: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("payments")
    .select(`
      *,
      business_partners:business_partner_id ( * ),
      payment_allocations (
        *,
        invoices:invoice_id ( * )
      )
    `)
    .eq("id", id)
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function createPayment(input: PaymentInsert) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("payments")
    .insert(input)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as PaymentRow;
}

export async function updatePayment(id: string, input: PaymentUpdate) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("payments")
    .update(input)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as PaymentRow;
}

export async function deletePayment(id: string) {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("payments").delete().eq("id", id);

  if (error) throw new Error(error.message);
}

export async function allocatePayment(
  paymentId: string,
  invoiceId: string,
  amount: number
) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("payment_allocations")
    .insert({
      payment_id: paymentId,
      invoice_id: invoiceId,
      allocated_amount: amount,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}
