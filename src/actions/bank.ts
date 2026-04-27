"use server";

import { createServerSupabaseClient, createAdminSupabaseClient } from "@/lib/supabase";
import type { Database } from "@/types/database";

type BankAccountRow = Database["public"]["Tables"]["bank_accounts"]["Row"];
type BankAccountInsert = Database["public"]["Tables"]["bank_accounts"]["Insert"];
type BankAccountUpdate = Database["public"]["Tables"]["bank_accounts"]["Update"];
type BankTransactionRow = Database["public"]["Tables"]["bank_transactions"]["Row"];
type BankTransactionUpdate = Database["public"]["Tables"]["bank_transactions"]["Update"];
type BankTransactionInsert = Database["public"]["Tables"]["bank_transactions"]["Insert"];

// ── Bank Accounts ──

export async function getBankAccounts(clientId: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("bank_accounts")
    .select("*")
    .eq("client_id", clientId)
    .order("bank_name");

  if (error) throw new Error(error.message);
  return data as BankAccountRow[];
}

export async function getAllBankAccounts() {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("bank_accounts")
    .select("*, clients(id, name)")
    .order("bank_name");

  if (error) throw new Error(error.message);
  return data;
}

export async function getBankAccount(id: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("bank_accounts")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw new Error(error.message);
  return data as BankAccountRow;
}

export async function createBankAccount(input: BankAccountInsert) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("bank_accounts")
    .insert(input)
    .select("*, clients(id, name)")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function updateBankAccount(id: string, input: BankAccountUpdate) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("bank_accounts")
    .update(input)
    .eq("id", id)
    .select("*, clients(id, name)")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function deleteBankAccount(id: string) {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("bank_accounts")
    .delete()
    .eq("id", id);

  if (error) throw new Error(error.message);
}

export async function syncBankAccount(id: string) {
  const supabase = await createServerSupabaseClient();

  // Set syncing
  await supabase
    .from("bank_accounts")
    .update({ sync_status: "syncing" as const })
    .eq("id", id);

  // Simulate sync delay (in real impl, call Moneytree API here)
  // For now, just mark as success
  const { data, error } = await supabase
    .from("bank_accounts")
    .update({
      sync_status: "success" as const,
      last_synced_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("*, clients(id, name)")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

// ── Bank Transactions ──

export async function getBankTransactions(bankAccountId: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("bank_transactions")
    .select("*")
    .eq("bank_account_id", bankAccountId)
    .order("transaction_date", { ascending: false });

  if (error) throw new Error(error.message);
  return data as BankTransactionRow[];
}

export async function getBankTransactionsByClient(clientId: string) {
  const supabase = await createServerSupabaseClient();

  const { data: accounts, error: accError } = await supabase
    .from("bank_accounts")
    .select("id")
    .eq("client_id", clientId);

  if (accError) throw new Error(accError.message);
  if (!accounts || accounts.length === 0) return [];

  const accountIds = accounts.map((a) => a.id);

  const { data, error } = await supabase
    .from("bank_transactions")
    .select("*, bank_accounts!inner(id, bank_name, branch_name, account_number), accounts:suggested_account_id(id, name)")
    .in("bank_account_id", accountIds)
    .order("transaction_date", { ascending: false });

  if (error) throw new Error(error.message);
  return data;
}

export async function updateBankTransaction(id: string, input: BankTransactionUpdate) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("bank_transactions")
    .update(input)
    .eq("id", id)
    .select("*, bank_accounts!inner(id, bank_name, branch_name, account_number), accounts:suggested_account_id(id, name)")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

/**
 * 銀行取引を一括作成（CSVインポート用）
 */
export async function createBankTransactions(
  bankAccountId: string,
  transactions: {
    transaction_date: string;
    description: string;
    amount: number;
    balance_after?: number;
    counterparty?: string;
    reference_number?: string;
  }[]
): Promise<BankTransactionRow[]> {
  if (transactions.length === 0) return [];
  const admin = createAdminSupabaseClient();

  const rows: BankTransactionInsert[] = transactions.map((t) => ({
    bank_account_id: bankAccountId,
    transaction_date: t.transaction_date,
    description: t.description,
    amount: t.amount,
    balance_after: t.balance_after ?? null,
    counterparty: t.counterparty ?? null,
    reference_number: t.reference_number ?? null,
    transaction_type: (t.amount >= 0 ? "deposit" : "withdrawal") as "deposit" | "withdrawal",
    match_status: "unmatched" as const,
  }));

  const { data, error } = await admin
    .from("bank_transactions")
    .insert(rows)
    .select();

  if (error) throw new Error(`取引の一括作成に失敗: ${error.message}`);
  return data as BankTransactionRow[];
}

export async function matchBankTransaction(transactionId: string, journalEntryId: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("bank_transactions")
    .update({
      journal_entry_id: journalEntryId,
      match_status: "matched" as const,
    })
    .eq("id", transactionId)
    .select("*, bank_accounts!inner(id, bank_name, branch_name, account_number), accounts:suggested_account_id(id, name)")
    .single();

  if (error) throw new Error(error.message);
  return data;
}
