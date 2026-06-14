"use server";

import { createServerSupabaseClient } from "@/lib/supabase";
import { assertClientAccess } from "@/lib/authz";
import type { Database } from "@/types/database";

type PaymentRow = Database["public"]["Tables"]["payments"]["Row"];
type PaymentInsert = Database["public"]["Tables"]["payments"]["Insert"];
type PaymentUpdate = Database["public"]["Tables"]["payments"]["Update"];

export async function getPayments(clientId: string) {
  await assertClientAccess(clientId);
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
  await assertClientAccess(input.client_id);
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

// ── 入金の一括登録＋自動消込（CSV/PDF取込・銀行CSV共通の中核） ──────────────────
//
// 解析済みの入金行（取引先を解決済み）を受け取り、payments を作成して、
// 「同一取引先 & 残額が金額と一致」する未払い請求書があれば自動で消込（allocation）する。
// 一致しない/曖昧なものは未消込のまま残し、画面で手動消込できるようにする。

export type DepositInput = {
  payment_date: string;
  amount: number;
  business_partner_id: string;
  memo?: string | null;
  payment_method?: string | null;
};

export type ReconcileResult = {
  created: number; // 入金登録した件数
  matched: number; // 自動消込（allocation）した件数
  errors: string[];
};

export async function reconcileDeposits(
  clientId: string,
  deposits: DepositInput[],
  opts: { onlyWhenMatched?: boolean } = {}
): Promise<ReconcileResult> {
  await assertClientAccess(clientId);
  const supabase = await createServerSupabaseClient();
  const result: ReconcileResult = { created: 0, matched: 0, errors: [] };
  if (deposits.length === 0) return result;

  // 残高ありの未払い請求書（自動消込の照合先）
  const { data: invoices, error: invError } = await supabase
    .from("invoices")
    .select(`id, total_amount, business_partner_id, payment_allocations ( allocated_amount )`)
    .eq("client_id", clientId)
    .not("status", "in", '("paid","void")');
  if (invError) throw new Error(invError.message);

  const unpaid = (invoices ?? [])
    .map((inv) => {
      const allocs = (inv.payment_allocations as unknown as { allocated_amount: number }[]) ?? [];
      const allocated = allocs.reduce((s, a) => s + (a.allocated_amount ?? 0), 0);
      return {
        id: inv.id,
        business_partner_id: inv.business_partner_id,
        remaining: inv.total_amount - allocated,
      };
    })
    .filter((inv) => inv.remaining > 0);

  const usedInvoiceIds = new Set<string>();

  for (const d of deposits) {
    try {
      if (!d.business_partner_id) {
        result.errors.push(`取引先が未指定の入金（金額 ${d.amount}）はスキップしました`);
        continue;
      }
      if (!Number.isFinite(d.amount) || d.amount <= 0) {
        result.errors.push(`金額が不正です: ${d.amount}`);
        continue;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.payment_date)) {
        result.errors.push(`日付フォーマットが不正です: ${d.payment_date}`);
        continue;
      }

      const amount = Math.round(d.amount);

      // 強マッチ: 同一取引先 & 残額が金額と一致する未払い請求書
      const match = unpaid.find(
        (inv) =>
          !usedInvoiceIds.has(inv.id) &&
          inv.business_partner_id === d.business_partner_id &&
          Math.abs(inv.remaining - amount) < 1
      );

      // 銀行CSV連携など onlyWhenMatched=true の場合、強マッチが無ければ何もしない
      // （現金売上等で既に仕訳済みの入金に、宛先不明の入金行を量産しないため）。
      if (!match && opts.onlyWhenMatched) continue;

      const { data: payment, error: payErr } = await supabase
        .from("payments")
        .insert({
          client_id: clientId,
          business_partner_id: d.business_partner_id,
          amount,
          payment_date: d.payment_date,
          payment_method: d.payment_method ?? "bank_transfer",
          memo: d.memo ?? null,
        })
        .select()
        .single();
      if (payErr || !payment) throw new Error(payErr?.message ?? "入金登録に失敗しました");
      result.created++;

      if (match) {
        const { error: allocErr } = await supabase
          .from("payment_allocations")
          .insert({ payment_id: payment.id, invoice_id: match.id, allocated_amount: amount });
        if (!allocErr) {
          usedInvoiceIds.add(match.id);
          result.matched++;
        }
      }
    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return result;
}
