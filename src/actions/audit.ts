"use server";

import { createServerSupabaseClient } from "@/lib/supabase";
import type { Database } from "@/types/database";

type AuditLogRow = Database["public"]["Tables"]["audit_logs"]["Row"];
type HistoryRow = Database["public"]["Tables"]["journal_entries_history"]["Row"];

export interface AuditLogFilters {
  tableName?: string;
  action?: "INSERT" | "UPDATE" | "DELETE";
  dateFrom?: string;
  dateTo?: string;
  recordId?: string;
}

export async function getAuditLogs(
  clientId: string,
  filters?: AuditLogFilters,
  limit = 100
): Promise<AuditLogRow[]> {
  const supabase = await createServerSupabaseClient();

  let query = supabase
    .from("audit_logs")
    .select("*")
    .eq("client_id", clientId)
    .order("performed_at", { ascending: false })
    .limit(limit);

  if (filters?.tableName) {
    query = query.eq("table_name", filters.tableName);
  }
  if (filters?.action) {
    query = query.eq("action", filters.action);
  }
  if (filters?.dateFrom) {
    query = query.gte("performed_at", filters.dateFrom);
  }
  if (filters?.dateTo) {
    query = query.lte("performed_at", `${filters.dateTo}T23:59:59`);
  }
  if (filters?.recordId) {
    query = query.eq("record_id", filters.recordId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data as AuditLogRow[];
}

export async function getJournalEntryHistory(
  journalEntryId: string
): Promise<HistoryRow[]> {
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("journal_entries_history")
    .select("*")
    .eq("journal_entry_id", journalEntryId)
    .order("version", { ascending: false });

  if (error) throw new Error(error.message);
  return data as HistoryRow[];
}
