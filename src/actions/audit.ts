"use server";

import { createServerSupabaseClient, createAdminSupabaseClient } from "@/lib/supabase";
import { assertClientAccess } from "@/lib/authz";
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

/** 監査ログの1行に、操作した人の名前を添えたもの */
export type AuditLogWithActor = AuditLogRow & { performer_name: string | null };

/** 利用者IDから表示名（事務所のメンバー・顧問先ユーザー・システム管理者） */
async function actorNames(userIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  const names = new Map<string, string>();
  if (!ids.length) return names;
  const admin = createAdminSupabaseClient();
  const [fm, cu, sa] = await Promise.all([
    admin.from("firm_members").select("user_id, name, email, role").in("user_id", ids),
    admin.from("client_users").select("user_id, name, email").in("user_id", ids),
    admin.from("super_admins").select("user_id, name, email").in("user_id", ids),
  ]);
  const label: Record<string, string> = { admin: "税理士", staff: "スタッフ", viewer: "閲覧専用" };
  for (const r of sa.data ?? []) names.set(r.user_id, `${r.name || r.email}（システム管理者）`);
  for (const r of cu.data ?? []) if (!names.has(r.user_id)) names.set(r.user_id, `${r.name || r.email}（顧問先）`);
  for (const r of fm.data ?? []) if (!names.has(r.user_id)) names.set(r.user_id, `${r.name || r.email}（${label[r.role] ?? r.role}）`);
  return names;
}

export async function getAuditLogs(
  clientId: string,
  filters?: AuditLogFilters,
  limit = 100
): Promise<AuditLogWithActor[]> {
  await assertClientAccess(clientId);
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
  const rows = (data ?? []) as AuditLogRow[];
  const names = await actorNames(rows.map((r) => r.performed_by ?? ""));
  return rows.map((r) => ({
    ...r,
    // 操作者が分からないもの（システムの自動処理や、この機能より前の記録）は null
    performer_name: r.performed_by ? names.get(r.performed_by) ?? "（不明なユーザー）" : null,
  }));
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
