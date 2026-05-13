"use server";

import { createAdminSupabaseClient, createServerSupabaseClient } from "@/lib/supabase";
import {
  fetchAccounts,
  fetchTransactions,
  refreshAccessToken,
  revokeToken,
  expiresAt,
  type MoneytreeAccount,
} from "@/lib/moneytree";

// ── Token management ──────────────────────────────────────────────────────────

async function getValidToken(clientId: string): Promise<string> {
  const admin = createAdminSupabaseClient();

  const { data: conn, error } = await admin
    .from("moneytree_connections")
    .select("access_token, refresh_token, expires_at")
    .eq("client_id", clientId)
    .eq("is_active", true)
    .single();

  if (error || !conn) throw new Error("Moneytree連携が見つかりません");

  const bufferMs = 60 * 1000;
  if (new Date(conn.expires_at).getTime() > Date.now() + bufferMs) {
    return conn.access_token;
  }

  if (!conn.refresh_token) throw new Error("リフレッシュトークンが存在しません");

  const refreshed = await refreshAccessToken(conn.refresh_token);
  await admin
    .from("moneytree_connections")
    .update({
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token ?? conn.refresh_token,
      expires_at: expiresAt(refreshed.expires_in).toISOString(),
    })
    .eq("client_id", clientId);

  return refreshed.access_token;
}

// ── Connection status ─────────────────────────────────────────────────────────

export async function getMoneytreeConnection(clientId: string) {
  const admin = createAdminSupabaseClient();
  const { data } = await admin
    .from("moneytree_connections")
    .select("id, is_active, connected_at, updated_at, scope")
    .eq("client_id", clientId)
    .eq("is_active", true)
    .maybeSingle();
  return data;
}

export async function disconnectMoneytree(clientId: string) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const admin = createAdminSupabaseClient();
  const { data: conn } = await admin
    .from("moneytree_connections")
    .select("access_token, refresh_token")
    .eq("client_id", clientId)
    .single();

  if (conn) {
    await revokeToken(conn.access_token);
    if (conn.refresh_token) await revokeToken(conn.refresh_token);
  }

  await admin
    .from("moneytree_connections")
    .delete()
    .eq("client_id", clientId);
}

// ── Sync ──────────────────────────────────────────────────────────────────────

function toAccountType(mt: MoneytreeAccount): "ordinary" | "checking" | "savings" {
  const t = mt.account_type?.toLowerCase() ?? "";
  if (t.includes("check") || t.includes("current")) return "checking";
  if (t.includes("sav")) return "savings";
  return "ordinary";
}

export async function syncMoneytreeAccounts(clientId: string): Promise<{
  synced: number;
  accounts: { id: string; bank_name: string }[];
}> {
  const accessToken = await getValidToken(clientId);
  const mtAccounts = await fetchAccounts(accessToken);

  const admin = createAdminSupabaseClient();
  const results: { id: string; bank_name: string }[] = [];

  for (const mt of mtAccounts) {
    const providerId = String(mt.id);

    // Check if already exists
    const { data: existing } = await admin
      .from("bank_accounts")
      .select("id, bank_name")
      .eq("client_id", clientId)
      .eq("provider_account_id", providerId)
      .eq("provider", "moneytree")
      .maybeSingle();

    if (existing) {
      results.push({ id: existing.id, bank_name: existing.bank_name });
      continue;
    }

    const { data, error } = await admin
      .from("bank_accounts")
      .insert({
        client_id: clientId,
        bank_name: mt.institution.name,
        branch_name: mt.branch_name ?? null,
        account_type: toAccountType(mt),
        account_number: mt.account_number ?? providerId,
        account_holder: null,
        provider: "moneytree" as const,
        provider_account_id: providerId,
        is_active: mt.status === "active" || mt.status === "aggregating",
        sync_status: "idle" as const,
      })
      .select("id, bank_name")
      .single();

    if (!error && data) results.push({ id: data.id, bank_name: data.bank_name });
  }

  return { synced: results.length, accounts: results };
}

export async function syncMoneytreeTransactions(
  clientId: string,
  bankAccountId: string,
  options?: { from?: string; to?: string }
): Promise<{ inserted: number }> {
  const admin = createAdminSupabaseClient();

  const { data: bankAccount } = await admin
    .from("bank_accounts")
    .select("provider_account_id")
    .eq("id", bankAccountId)
    .eq("provider", "moneytree")
    .single();

  if (!bankAccount?.provider_account_id) {
    throw new Error("Moneytree口座IDが見つかりません");
  }

  await admin
    .from("bank_accounts")
    .update({ sync_status: "syncing" as const })
    .eq("id", bankAccountId);

  try {
    const accessToken = await getValidToken(clientId);
    const mtTransactions = await fetchTransactions(
      accessToken,
      Number(bankAccount.provider_account_id),
      options
    );

    const rows = mtTransactions.map((tx) => ({
      bank_account_id: bankAccountId,
      transaction_date: tx.date,
      description: tx.description,
      amount: Math.round(tx.base_amount ?? tx.amount),
      transaction_type: (tx.amount >= 0 ? "deposit" : "withdrawal") as "deposit" | "withdrawal",
      match_status: "unmatched" as const,
      raw_data: tx as unknown as import("@/types/database").Json,
    }));

    let inserted = 0;
    if (rows.length > 0) {
      const { data } = await admin
        .from("bank_transactions")
        .insert(rows)
        .select("id");
      inserted = data?.length ?? 0;
    }

    await admin
      .from("bank_accounts")
      .update({
        sync_status: "success" as const,
        last_synced_at: new Date().toISOString(),
      })
      .eq("id", bankAccountId);

    return { inserted };
  } catch (err) {
    await admin
      .from("bank_accounts")
      .update({ sync_status: "error" as const })
      .eq("id", bankAccountId);
    throw err;
  }
}

export async function syncAllMoneytreeTransactions(
  clientId: string,
  options?: { from?: string; to?: string }
): Promise<{ totalInserted: number; accounts: number }> {
  const admin = createAdminSupabaseClient();

  const { data: bankAccounts } = await admin
    .from("bank_accounts")
    .select("id")
    .eq("client_id", clientId)
    .eq("provider", "moneytree")
    .eq("is_active", true);

  if (!bankAccounts?.length) return { totalInserted: 0, accounts: 0 };

  let totalInserted = 0;
  for (const account of bankAccounts) {
    try {
      const result = await syncMoneytreeTransactions(clientId, account.id, options);
      totalInserted += result.inserted;
    } catch {
      // Continue syncing other accounts even if one fails
    }
  }

  return { totalInserted, accounts: bankAccounts.length };
}
