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

// ── 銀行入金からの自動消込 ────────────────────────────────────────────────────

export interface AutoMatchResult {
  matched: number;
  skipped: number;
  errors: string[];
}

export async function autoMatchBankDeposits(clientId: string): Promise<AutoMatchResult> {
  const supabase = await createServerSupabaseClient();
  const result: AutoMatchResult = { matched: 0, skipped: 0, errors: [] };

  // クライアントの銀行口座ID一覧
  const { data: bankAccounts } = await supabase
    .from("bank_accounts")
    .select("id")
    .eq("client_id", clientId);
  if (!bankAccounts?.length) return result;
  const bankAccountIds = bankAccounts.map((b) => b.id);

  // 未照合の入金取引
  const { data: deposits, error: depError } = await supabase
    .from("bank_transactions")
    .select("id, transaction_date, amount, description, counterparty")
    .in("bank_account_id", bankAccountIds)
    .eq("match_status", "unmatched")
    .eq("transaction_type", "deposit")
    .gt("amount", 0);
  if (depError) throw new Error(depError.message);
  if (!deposits?.length) return result;

  // 残高ありの未払い請求書
  const { data: invoices, error: invError } = await supabase
    .from("invoices")
    .select(`
      id, total_amount, business_partner_id, issued_date,
      business_partners:business_partner_id ( id, name ),
      payment_allocations ( allocated_amount )
    `)
    .eq("client_id", clientId)
    .not("status", "in", '("paid","void")');
  if (invError) throw new Error(invError.message);

  const unpaid = (invoices ?? []).map((inv) => {
    const allocs = (inv.payment_allocations as unknown as { allocated_amount: number }[]) ?? [];
    const allocated = allocs.reduce((s, a) => s + (a.allocated_amount ?? 0), 0);
    const remaining = inv.total_amount - allocated;
    const partnerName = (inv.business_partners as unknown as { name: string } | null)?.name ?? "";
    return { ...inv, remaining, partnerName };
  }).filter((inv) => inv.remaining > 0);

  const usedInvoiceIds = new Set<string>();

  for (const deposit of deposits) {
    try {
      const candidates = unpaid.filter((inv) => {
        if (usedInvoiceIds.has(inv.id)) return false;
        if (Math.abs(inv.remaining - deposit.amount) < 1) return true;
        const haystack = `${deposit.counterparty ?? ""} ${deposit.description}`.toLowerCase();
        const needle = inv.partnerName.toLowerCase();
        return needle.length >= 2 && haystack.includes(needle);
      });

      if (!candidates.length) { result.skipped++; continue; }

      // 金額一致を優先
      const best = candidates.sort((a, b) => {
        const aEx = Math.abs(a.remaining - deposit.amount) < 1 ? 0 : 1;
        const bEx = Math.abs(b.remaining - deposit.amount) < 1 ? 0 : 1;
        return aEx - bEx;
      })[0];

      const allocAmount = Math.min(deposit.amount, best.remaining);

      const { data: payment, error: payErr } = await supabase
        .from("payments")
        .insert({
          client_id: clientId,
          business_partner_id: best.business_partner_id,
          amount: deposit.amount,
          payment_date: deposit.transaction_date,
          payment_method: "bank_transfer",
          memo: `自動消込: ${deposit.description}`,
        })
        .select()
        .single();
      if (payErr) throw new Error(payErr.message);

      const { error: allocErr } = await supabase
        .from("payment_allocations")
        .insert({ payment_id: payment.id, invoice_id: best.id, allocated_amount: allocAmount });
      if (allocErr) {
        await supabase.from("payments").delete().eq("id", payment.id);
        throw new Error(allocErr.message);
      }

      await supabase
        .from("bank_transactions")
        .update({ match_status: "matched" as const })
        .eq("id", deposit.id);

      usedInvoiceIds.add(best.id);
      result.matched++;
    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return result;
}
