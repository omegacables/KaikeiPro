"use server";

import { createServerSupabaseClient, createAdminSupabaseClient } from "@/lib/supabase";
import { resolveClientIdForRecord } from "@/lib/authz";
import type { Database } from "@/types/database";

type CardAccountRow = Database["public"]["Tables"]["card_accounts"]["Row"];
type CardAccountInsert = Database["public"]["Tables"]["card_accounts"]["Insert"];
type CardAccountUpdate = Database["public"]["Tables"]["card_accounts"]["Update"];
type CardTransactionRow = Database["public"]["Tables"]["card_transactions"]["Row"];
type CardTransactionInsert = Database["public"]["Tables"]["card_transactions"]["Insert"];
type CardTransactionUpdate = Database["public"]["Tables"]["card_transactions"]["Update"];
type CardPaymentRow = Database["public"]["Tables"]["card_payments"]["Row"];

/**
 * 取引日と締日から引き落とし対象月（YYYY-MM-01）を計算
 * 例: 締日=15日の場合、2026-02-10利用 → statement_month=2026-02-01
 *     締日=15日の場合、2026-02-20利用 → statement_month=2026-03-01
 */
function computeStatementMonth(txDate: string, closingDay: number): string {
  const d = new Date(txDate);
  const day = d.getDate();
  if (day > closingDay) {
    // 翌月締め
    const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-01`;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

// ---------------------------------------------------------------------------
// Card Accounts CRUD
// ---------------------------------------------------------------------------

export async function getCardAccounts(clientId: string): Promise<CardAccountRow[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("card_accounts")
    .select("*")
    .eq("client_id", clientId)
    .order("card_name");
  if (error) throw new Error(error.message);
  return data as CardAccountRow[];
}

export async function getAllCardAccounts() {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("card_accounts")
    .select("*, clients!inner(id, name)")
    .order("card_name");
  if (error) throw new Error(error.message);
  return data;
}

export async function getCardAccount(id: string): Promise<CardAccountRow> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("card_accounts")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);
  return data as CardAccountRow;
}

export async function createCardAccount(input: CardAccountInsert): Promise<CardAccountRow> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("card_accounts")
    .insert(input)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as CardAccountRow;
}

export async function updateCardAccount(id: string, input: CardAccountUpdate): Promise<CardAccountRow> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("card_accounts")
    .update(input)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as CardAccountRow;
}

export async function deleteCardAccount(id: string): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("card_accounts").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// Card Transactions
// ---------------------------------------------------------------------------

export async function getCardTransactions(cardAccountId: string): Promise<CardTransactionRow[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("card_transactions")
    .select("*")
    .eq("card_account_id", cardAccountId)
    .order("transaction_date", { ascending: false });
  if (error) throw new Error(error.message);
  return data as CardTransactionRow[];
}

export async function getCardTransactionsByClient(clientId: string) {
  const supabase = await createServerSupabaseClient();
  const { data: cards } = await supabase
    .from("card_accounts")
    .select("id")
    .eq("client_id", clientId);
  if (!cards || cards.length === 0) return [];

  const cardIds = cards.map((c) => c.id);

  const { data, error } = await supabase
    .from("card_transactions")
    .select(`
      *,
      card_accounts!inner(id, card_company, card_name, card_number_masked, client_id),
      accounts:suggested_account_id(id, name)
    `)
    .in("card_account_id", cardIds)
    .order("transaction_date", { ascending: false });

  if (error) throw new Error(error.message);
  return data;
}

export async function updateCardTransaction(id: string, input: CardTransactionUpdate) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("card_transactions")
    .update(input)
    .eq("id", id)
    .select("*, card_accounts!inner(id, card_company, card_name, card_number_masked), accounts:suggested_account_id(id, name)")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * カード取引を一括作成（CSVインポート用）
 * 締日に応じて statement_month を自動計算
 */
export async function createCardTransactions(
  cardAccountId: string,
  transactions: {
    transaction_date: string;
    description: string;
    amount: number;
    installment_type?: "lump" | "installment" | "revolving" | "bonus";
    installment_count?: number;
    counterparty?: string;
  }[]
): Promise<CardTransactionRow[]> {
  if (transactions.length === 0) return [];
  await resolveClientIdForRecord("card_accounts", cardAccountId);
  const admin = createAdminSupabaseClient();

  // カード情報を取得（締日）
  const { data: card } = await admin
    .from("card_accounts")
    .select("closing_day")
    .eq("id", cardAccountId)
    .single();

  if (!card) throw new Error("カードが見つかりません");

  const rows: CardTransactionInsert[] = transactions.map((t) => ({
    card_account_id: cardAccountId,
    transaction_date: t.transaction_date,
    description: t.description,
    amount: t.amount,
    transaction_type: (t.amount >= 0 ? "charge" : "refund") as "charge" | "refund",
    installment_type: t.installment_type ?? "lump",
    installment_count: t.installment_count ?? null,
    counterparty: t.counterparty ?? null,
    statement_month: computeStatementMonth(t.transaction_date, card.closing_day),
    match_status: "unmatched" as const,
  }));

  const { data, error } = await admin
    .from("card_transactions")
    .insert(rows)
    .select();

  if (error) throw new Error(`カード取引の一括作成に失敗: ${error.message}`);
  return data as CardTransactionRow[];
}

// ---------------------------------------------------------------------------
// Card Payments (月次引き落とし)
// ---------------------------------------------------------------------------

export async function getCardPayments(cardAccountId: string): Promise<CardPaymentRow[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("card_payments")
    .select("*")
    .eq("card_account_id", cardAccountId)
    .order("statement_month", { ascending: false });
  if (error) throw new Error(error.message);
  return data as CardPaymentRow[];
}

/**
 * 指定カード・指定締め月のカード利用合計を計算
 */
export async function getStatementTotal(
  cardAccountId: string,
  statementMonth: string
): Promise<number> {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase
    .from("card_transactions")
    .select("amount")
    .eq("card_account_id", cardAccountId)
    .eq("statement_month", statementMonth);
  return (data ?? []).reduce((sum, t) => sum + t.amount, 0);
}

/**
 * 月次引き落とし仕訳を作成 (Dr 未払金 / Cr 普通預金)
 */
export async function recordCardPayment(
  cardAccountId: string,
  statementMonth: string,
  paymentDate: string
): Promise<string> {
  await resolveClientIdForRecord("card_accounts", cardAccountId);
  const admin = createAdminSupabaseClient();

  // カード情報取得
  const { data: card } = await admin
    .from("card_accounts")
    .select("*, bank_accounts:linked_bank_account_id(id, account_id, bank_name)")
    .eq("id", cardAccountId)
    .single();

  if (!card) throw new Error("カードが見つかりません");
  if (!card.payable_account_id) {
    throw new Error("カードに未払金科目が設定されていません。設定画面から登録してください。");
  }

  const bankAccount = card.bank_accounts as unknown as {
    id: string;
    account_id: string | null;
    bank_name: string;
  } | null;

  if (!bankAccount || !bankAccount.account_id) {
    throw new Error("引き落とし先の銀行口座・勘定科目が設定されていません。");
  }

  // 該当月の利用合計を計算
  const { data: txns } = await admin
    .from("card_transactions")
    .select("amount")
    .eq("card_account_id", cardAccountId)
    .eq("statement_month", statementMonth);

  const total = (txns ?? []).reduce((s, t) => s + t.amount, 0);
  if (total <= 0) {
    throw new Error(`${statementMonth.slice(0, 7)} 分の引き落とし対象がありません`);
  }

  // 仕訳作成 (Dr 未払金 / Cr 普通預金)
  const { data: entry, error: entryError } = await admin
    .from("journal_entries")
    .insert({
      client_id: card.client_id,
      entry_date: paymentDate,
      description: `${card.card_name} ${statementMonth.slice(0, 7)}分 引き落とし`,
      status: "draft",
      source: "card",
      created_by: card.client_id,
      needs_review: false,
    })
    .select()
    .single();

  if (entryError) throw new Error(`仕訳作成エラー: ${entryError.message}`);

  const { error: linesError } = await admin.from("journal_entry_lines").insert([
    {
      journal_entry_id: entry.id,
      account_id: card.payable_account_id,
      debit_amount: total,
      credit_amount: 0,
      sort_order: 0,
    },
    {
      journal_entry_id: entry.id,
      account_id: bankAccount.account_id,
      debit_amount: 0,
      credit_amount: total,
      sort_order: 1,
    },
  ]);

  if (linesError) throw new Error(`仕訳明細作成エラー: ${linesError.message}`);

  // card_payments にレコード作成
  await admin.from("card_payments").upsert(
    {
      card_account_id: cardAccountId,
      statement_month: statementMonth,
      payment_date: paymentDate,
      total_amount: total,
      journal_entry_id: entry.id,
      status: "paid" as const,
    },
    { onConflict: "card_account_id,statement_month" }
  );

  return entry.id;
}
