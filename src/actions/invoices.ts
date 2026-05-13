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

// ── 請求書発行 + 自動仕訳 ────────────────────────────────────────────────────

export async function issueInvoiceWithJournal(invoiceId: string): Promise<void> {
  const supabase = await createServerSupabaseClient();

  const { data: invoice, error: invError } = await supabase
    .from("invoices")
    .select("*, business_partners:business_partner_id(id, name), invoice_items(*)")
    .eq("id", invoiceId)
    .single();
  if (invError || !invoice) throw new Error("請求書が見つかりません");
  if (invoice.status !== "draft") throw new Error("下書き状態の請求書のみ発行できます");

  const { data: accounts } = await supabase
    .from("accounts")
    .select("id, name")
    .or(`client_id.eq.${invoice.client_id},is_default.eq.true`)
    .in("name", ["売掛金", "売上高", "仮受消費税"])
    .eq("is_active", true);

  const acctMap = new Map((accounts ?? []).map((a) => [a.name, a.id]));
  const receivableId = acctMap.get("売掛金");
  const salesId = acctMap.get("売上高");
  if (!receivableId || !salesId) {
    throw new Error("売掛金または売上高の勘定科目が見つかりません。勘定科目を設定してください");
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("認証エラー");

  const partnerName = (invoice.business_partners as unknown as { name: string } | null)?.name ?? "";
  const subtotal = invoice.subtotal;
  const taxAmount = invoice.tax_amount;
  const totalAmount = invoice.total_amount;

  const { data: journalEntry, error: jeError } = await supabase
    .from("journal_entries")
    .insert({
      client_id: invoice.client_id,
      entry_date: invoice.issued_date,
      description: `売上計上: ${partnerName} ${invoice.invoice_number}`,
      status: "confirmed" as const,
      source: "manual" as const,
      created_by: user.id,
    })
    .select()
    .single();
  if (jeError) throw new Error(`仕訳作成エラー: ${jeError.message}`);

  type LineInsert = {
    journal_entry_id: string;
    account_id: string;
    debit_amount: number;
    credit_amount: number;
    sort_order: number;
  };

  const lines: LineInsert[] = [
    { journal_entry_id: journalEntry.id, account_id: receivableId, debit_amount: totalAmount, credit_amount: 0, sort_order: 0 },
    { journal_entry_id: journalEntry.id, account_id: salesId, debit_amount: 0, credit_amount: subtotal, sort_order: 1 },
  ];

  const taxId = acctMap.get("仮受消費税");
  if (taxId && taxAmount > 0) {
    lines.push({ journal_entry_id: journalEntry.id, account_id: taxId, debit_amount: 0, credit_amount: taxAmount, sort_order: 2 });
  } else if (!taxId && taxAmount > 0) {
    lines[1].credit_amount += taxAmount;
  }

  const { error: linesError } = await supabase.from("journal_entry_lines").insert(lines);
  if (linesError) {
    await supabase.from("journal_entries").delete().eq("id", journalEntry.id);
    throw new Error(`仕訳明細作成エラー: ${linesError.message}`);
  }

  const { error: updateError } = await supabase
    .from("invoices")
    .update({ status: "issued" as const, journal_entry_id: journalEntry.id })
    .eq("id", invoiceId);
  if (updateError) throw new Error(`請求書更新エラー: ${updateError.message}`);
}

// ── 得意先別売掛残高 ──────────────────────────────────────────────────────────

export interface PartnerReceivable {
  partnerId: string;
  partnerName: string;
  totalAmount: number;
  allocated: number;
  remaining: number;
  overdueAmount: number;
  maxDaysOverdue: number;
}

export async function getReceivablesByPartner(clientId: string): Promise<PartnerReceivable[]> {
  const supabase = await createServerSupabaseClient();
  const today = new Date().toISOString().split("T")[0];

  const { data, error } = await supabase
    .from("invoices")
    .select(`
      id, total_amount, due_date, business_partner_id,
      business_partners:business_partner_id ( id, name ),
      payment_allocations ( allocated_amount )
    `)
    .eq("client_id", clientId)
    .not("status", "in", '("paid","void")');

  if (error) throw new Error(error.message);

  const partnerMap = new Map<string, PartnerReceivable>();

  for (const inv of data ?? []) {
    const pid = inv.business_partner_id;
    const pname = (inv.business_partners as unknown as { name: string } | null)?.name ?? pid;
    const allocs = (inv.payment_allocations as unknown as { allocated_amount: number }[]) ?? [];
    const allocated = allocs.reduce((s, a) => s + (a.allocated_amount ?? 0), 0);
    const remaining = inv.total_amount - allocated;
    if (remaining <= 0) continue;

    let daysOverdue = 0;
    let isOverdue = false;
    if (inv.due_date && inv.due_date < today) {
      daysOverdue = Math.floor((new Date(today).getTime() - new Date(inv.due_date).getTime()) / 86400000);
      isOverdue = true;
    }

    const existing = partnerMap.get(pid);
    if (existing) {
      existing.totalAmount += inv.total_amount;
      existing.allocated += allocated;
      existing.remaining += remaining;
      if (isOverdue) {
        existing.overdueAmount += remaining;
        existing.maxDaysOverdue = Math.max(existing.maxDaysOverdue, daysOverdue);
      }
    } else {
      partnerMap.set(pid, {
        partnerId: pid,
        partnerName: pname,
        totalAmount: inv.total_amount,
        allocated,
        remaining,
        overdueAmount: isOverdue ? remaining : 0,
        maxDaysOverdue: isOverdue ? daysOverdue : 0,
      });
    }
  }

  return [...partnerMap.values()].sort((a, b) => b.remaining - a.remaining);
}

// ── エージングレポート ────────────────────────────────────────────────────────

export interface AgingBuckets {
  current: number;
  d0_30: number;
  d31_60: number;
  d61_90: number;
  over90: number;
}

export interface AgingReportRow {
  partnerId: string;
  partnerName: string;
  buckets: AgingBuckets;
  total: number;
}

export async function getAgingReport(clientId: string): Promise<AgingReportRow[]> {
  const supabase = await createServerSupabaseClient();
  const today = new Date().toISOString().split("T")[0];

  const { data, error } = await supabase
    .from("invoices")
    .select(`
      id, total_amount, due_date, business_partner_id,
      business_partners:business_partner_id ( id, name ),
      payment_allocations ( allocated_amount )
    `)
    .eq("client_id", clientId)
    .not("status", "in", '("paid","void")');

  if (error) throw new Error(error.message);

  const partnerMap = new Map<string, AgingReportRow>();

  for (const inv of data ?? []) {
    const pid = inv.business_partner_id;
    const pname = (inv.business_partners as unknown as { name: string } | null)?.name ?? pid;
    const allocs = (inv.payment_allocations as unknown as { allocated_amount: number }[]) ?? [];
    const allocated = allocs.reduce((s, a) => s + (a.allocated_amount ?? 0), 0);
    const remaining = inv.total_amount - allocated;
    if (remaining <= 0) continue;

    let bucket: keyof AgingBuckets = "current";
    if (inv.due_date && inv.due_date < today) {
      const days = Math.floor((new Date(today).getTime() - new Date(inv.due_date).getTime()) / 86400000);
      if (days <= 30) bucket = "d0_30";
      else if (days <= 60) bucket = "d31_60";
      else if (days <= 90) bucket = "d61_90";
      else bucket = "over90";
    }

    const existing = partnerMap.get(pid);
    if (existing) {
      existing.buckets[bucket] += remaining;
      existing.total += remaining;
    } else {
      const buckets: AgingBuckets = { current: 0, d0_30: 0, d31_60: 0, d61_90: 0, over90: 0 };
      buckets[bucket] = remaining;
      partnerMap.set(pid, { partnerId: pid, partnerName: pname, buckets, total: remaining });
    }
  }

  return [...partnerMap.values()].sort((a, b) => b.total - a.total);
}

// ── 未払い請求書を取得（消込用） ──────────────────────────────────────────────

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
