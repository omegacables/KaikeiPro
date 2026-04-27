"use server";

import { createServerSupabaseClient, createAdminSupabaseClient } from "@/lib/supabase";
import type { Database } from "@/types/database";

type JournalEntryRow = Database["public"]["Tables"]["journal_entries"]["Row"];
type JournalEntryInsert = Database["public"]["Tables"]["journal_entries"]["Insert"];
type JournalEntryUpdate = Database["public"]["Tables"]["journal_entries"]["Update"];
type JournalLineInsert = Database["public"]["Tables"]["journal_entry_lines"]["Insert"];

/**
 * 指定した仕訳IDがロック済み会計年度に属していないかチェック。
 * admin client（RLSバイパス）を使う操作で呼び出す。
 */
async function assertNotInLockedFiscalYear(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  entryIds: string[]
): Promise<void> {
  if (entryIds.length === 0) return;

  const { data: entries } = await admin
    .from("journal_entries")
    .select("id, client_id, entry_date")
    .in("id", entryIds);

  if (!entries || entries.length === 0) return;

  for (const entry of entries) {
    const { data: locked } = await admin
      .from("fiscal_years")
      .select("id")
      .eq("client_id", entry.client_id)
      .eq("status", "locked")
      .lte("start_date", entry.entry_date)
      .gte("end_date", entry.entry_date)
      .limit(1);

    if (locked && locked.length > 0) {
      throw new Error("ロック済み会計年度の仕訳は変更・削除できません");
    }
  }
}

export async function getJournalEntries(clientId: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("journal_entries")
    .select(`
      *,
      journal_entry_lines (
        *,
        accounts:account_id ( id, code, name )
      )
    `)
    .eq("client_id", clientId)
    .order("entry_date", { ascending: false })
    .limit(100);

  if (error) throw new Error(error.message);
  return data;
}

export async function getJournalEntry(id: string) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("journal_entries")
    .select(`
      *,
      journal_entry_lines (
        *,
        accounts:account_id ( id, code, name, category_id )
      )
    `)
    .eq("id", id)
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function createJournalEntry(
  entry: JournalEntryInsert,
  lines: Omit<JournalLineInsert, "journal_entry_id">[]
) {
  const supabase = await createServerSupabaseClient();

  const { data: journalEntry, error: entryError } = await supabase
    .from("journal_entries")
    .insert(entry)
    .select()
    .single();

  if (entryError) throw new Error(entryError.message);

  if (lines.length > 0) {
    const { error: linesError } = await supabase
      .from("journal_entry_lines")
      .insert(
        lines.map((line, i) => ({
          ...line,
          journal_entry_id: journalEntry.id,
          sort_order: i,
        }))
      );

    if (linesError) throw new Error(linesError.message);
  }

  return journalEntry as JournalEntryRow;
}

export async function updateJournalEntry(
  id: string,
  entry: JournalEntryUpdate
) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("journal_entries")
    .update(entry)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as JournalEntryRow;
}

export async function deleteJournalEntry(id: string) {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("journal_entries")
    .delete()
    .eq("id", id);

  if (error) throw new Error(error.message);
}

/**
 * 複数の仕訳を一括削除（明細→仕訳の順、レシートステータスもリセット）
 */
export async function deleteJournalEntries(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const admin = createAdminSupabaseClient();

  // 会計年度ロックチェック（admin clientはRLSバイパスするため）
  await assertNotInLockedFiscalYear(admin, ids);

  // 紐づくレシートIDを取得
  const { data: entries } = await admin
    .from("journal_entries")
    .select("id, receipt_id")
    .in("id", ids);

  const receiptIds = (entries ?? [])
    .map((e) => e.receipt_id)
    .filter((rid): rid is string => !!rid);

  // 明細を先に削除（FK制約）
  await admin
    .from("journal_entry_lines")
    .delete()
    .in("journal_entry_id", ids);

  // 仕訳を削除
  await admin
    .from("journal_entries")
    .delete()
    .in("id", ids);

  // 紐づくレシートのステータスをリセット
  if (receiptIds.length > 0) {
    await admin
      .from("receipts")
      .update({ status: "ocr_done" as const })
      .in("id", receiptIds);
  }
}

export async function getRecentJournals(clientId: string, limit = 10) {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("journal_entries")
    .select(`
      *,
      journal_entry_lines (
        *,
        accounts:account_id ( id, code, name )
      )
    `)
    .eq("client_id", clientId)
    .order("entry_date", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return data;
}
