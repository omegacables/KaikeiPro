"use server";

import { createServerSupabaseClient } from "@/lib/supabase";
import { assertClientAccess, resolveClientIdForRecord } from "@/lib/authz";
import type { Database } from "@/types/database";

type PaymentRow = Database["public"]["Tables"]["payments"]["Row"];
type PaymentInsert = Database["public"]["Tables"]["payments"]["Insert"];
type PaymentUpdate = Database["public"]["Tables"]["payments"]["Update"];

type SupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

// 入金方法 → 借方の勘定科目名。現金以外は預金口座で受け取る想定。
const DEBIT_ACCOUNT_BY_METHOD: Record<string, string> = {
  cash: "現金",
  bank_transfer: "普通預金",
  card: "普通預金",
  e_money: "普通預金",
};

/**
 * 消込後の後処理（請求書ステータス更新 ＋ 入金仕訳の自動計上）。
 *
 * - 消込累計が請求額に達した請求書を「入金済(paid)」にする
 * - 入金1件につき「（普通預金/現金） / 売掛金」の仕訳を1本作成する
 *
 * 二重計上の防止:
 *   銀行明細CSVの取込でも同じ入金の仕訳（source='bank'）が作られ得るため、
 *   同一日・同額・同方向の仕訳が既にある場合は作成をスキップする。
 *   作成した仕訳は source='payment' で識別できる。
 */
async function finalizeReconciliation(
  supabase: SupabaseClient,
  clientId: string,
  paymentIds: string[]
): Promise<{ journalsCreated: number; invoicesPaid: number; errors: string[] }> {
  const result = { journalsCreated: 0, invoicesPaid: 0, errors: [] as string[] };
  if (paymentIds.length === 0) return result;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    result.errors.push("認証情報が取得できないため入金仕訳を作成できませんでした。");
    return result;
  }
  const userId = user.id;

  // --- 1. 消込対象の請求書を「入金済」に更新 ---
  const { data: allocs } = await supabase
    .from("payment_allocations")
    .select("invoice_id")
    .in("payment_id", paymentIds);

  const invoiceIds = [...new Set((allocs ?? []).map((a) => a.invoice_id).filter(Boolean))] as string[];

  if (invoiceIds.length > 0) {
    const { data: invoices } = await supabase
      .from("invoices")
      .select("id, total_amount, status, payment_allocations ( allocated_amount )")
      .in("id", invoiceIds);

    for (const inv of invoices ?? []) {
      if (inv.status === "paid" || inv.status === "void") continue;
      const lines = (inv.payment_allocations as unknown as { allocated_amount: number }[]) ?? [];
      const allocated = lines.reduce((s, a) => s + (a.allocated_amount ?? 0), 0);
      // 全額消し込まれたものだけ「入金済」にする（一部入金は据え置き）
      if (inv.total_amount > 0 && allocated >= inv.total_amount) {
        const { error } = await supabase.from("invoices").update({ status: "paid" }).eq("id", inv.id);
        if (error) result.errors.push(`請求書ステータス更新エラー: ${error.message}`);
        else result.invoicesPaid++;
      }
    }
  }

  // --- 2. 入金仕訳の自動計上 ---
  const { data: payments } = await supabase
    .from("payments")
    .select("id, payment_date, amount, payment_method, business_partner_id, business_partners:business_partner_id ( name )")
    .in("id", paymentIds);

  if (!payments || payments.length === 0) return result;

  const neededNames = [
    "売掛金",
    ...new Set(Object.values(DEBIT_ACCOUNT_BY_METHOD)),
  ];
  const { data: accounts } = await supabase
    .from("accounts")
    .select("id, name")
    .or(`client_id.eq.${clientId},is_default.eq.true`)
    .in("name", neededNames);

  const accountByName = new Map((accounts ?? []).map((a) => [a.name, a.id]));
  const receivableId = accountByName.get("売掛金");
  if (!receivableId) {
    result.errors.push("勘定科目「売掛金」が見つからないため入金仕訳を作成できませんでした。");
    return result;
  }

  for (const p of payments) {
    const debitName = DEBIT_ACCOUNT_BY_METHOD[p.payment_method ?? "bank_transfer"] ?? "普通預金";
    const debitId = accountByName.get(debitName);
    if (!debitId) {
      result.errors.push(`勘定科目「${debitName}」が見つからないため入金仕訳を作成できませんでした。`);
      continue;
    }

    // 二重計上ガード: 同日・同額の入金仕訳（銀行CSV由来含む）が既にあればスキップ
    const { data: sameDay } = await supabase
      .from("journal_entries")
      .select("id, journal_entry_lines ( debit_amount, account_id )")
      .eq("client_id", clientId)
      .eq("entry_date", p.payment_date);

    const duplicated = (sameDay ?? []).some((e) => {
      const lines = (e.journal_entry_lines as unknown as { debit_amount: number; account_id: string }[]) ?? [];
      return lines.some((l) => l.account_id === debitId && Math.abs((l.debit_amount ?? 0) - p.amount) < 1);
    });
    if (duplicated) continue;

    const partnerName = (p.business_partners as unknown as { name?: string } | null)?.name ?? "";
    const { data: entry, error: entryError } = await supabase
      .from("journal_entries")
      .insert({
        client_id: clientId,
        entry_date: p.payment_date,
        description: `入金消込: ${partnerName}`.trim(),
        status: "draft",
        source: "payment",
        created_by: userId,
      })
      .select("id")
      .single();

    if (entryError || !entry) {
      result.errors.push(`入金仕訳の作成エラー: ${entryError?.message ?? "不明なエラー"}`);
      continue;
    }

    const { error: lineError } = await supabase.from("journal_entry_lines").insert([
      { journal_entry_id: entry.id, account_id: debitId, debit_amount: p.amount, credit_amount: 0, sort_order: 0 },
      { journal_entry_id: entry.id, account_id: receivableId, debit_amount: 0, credit_amount: p.amount, sort_order: 1 },
    ]);

    if (lineError) {
      await supabase.from("journal_entries").delete().eq("id", entry.id);
      result.errors.push(`入金仕訳明細の作成エラー: ${lineError.message}`);
    } else {
      result.journalsCreated++;
    }
  }

  return result;
}

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
  // 画面からの手動消込。所有権を確認してから消込＋後処理を行う。
  const clientId = await resolveClientIdForRecord("payments", paymentId);
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

  // 請求書ステータス更新＋入金仕訳の自動計上（一括消込と同じ後処理）
  await finalizeReconciliation(supabase, clientId, [paymentId]);

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
  journalsCreated: number; // 自動計上した入金仕訳の件数
  invoicesPaid: number; // 「入金済」に更新した請求書の件数
  errors: string[];
};

export async function reconcileDeposits(
  clientId: string,
  deposits: DepositInput[],
  opts: { onlyWhenMatched?: boolean; bankAccount?: string | null } = {}
): Promise<ReconcileResult> {
  await assertClientAccess(clientId);
  const supabase = await createServerSupabaseClient();
  const result: ReconcileResult = { created: 0, matched: 0, journalsCreated: 0, invoicesPaid: 0, errors: [] };
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
  const createdPaymentIds: string[] = [];

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
          bank_account: opts.bankAccount ?? null,
          memo: d.memo ?? null,
        })
        .select()
        .single();
      if (payErr || !payment) throw new Error(payErr?.message ?? "入金登録に失敗しました");
      result.created++;
      createdPaymentIds.push(payment.id);

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

  // 請求書ステータス更新＋入金仕訳の自動計上。
  // 銀行CSV経由（onlyWhenMatched=true）は取込時に source='bank' の仕訳が別途
  // 作られるため、ここでの仕訳計上は行わない（二重計上の防止）。
  if (createdPaymentIds.length > 0 && !opts.onlyWhenMatched) {
    const post = await finalizeReconciliation(supabase, clientId, createdPaymentIds);
    result.journalsCreated = post.journalsCreated;
    result.invoicesPaid = post.invoicesPaid;
    result.errors.push(...post.errors);
  }

  return result;
}
