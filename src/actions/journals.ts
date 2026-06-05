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
  // 紐づく証憑も連動削除＋会計年度ロックチェックのため、まとめ削除に委譲
  await deleteJournalEntries([id]);
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

  // 紐づく証憑（領収書）も削除（仕訳→証憑の連動）。
  // 仕訳は上で削除済みのため、deleteReceipts 内の仕訳削除は実質no-opで再帰しない。
  if (receiptIds.length > 0) {
    const { deleteReceipts } = await import("./receipts");
    await deleteReceipts(receiptIds);
  }
}

export type JournalImportRow = {
  date: string;
  debitAccountCode: string;
  debitAmount: number;
  creditAccountCode: string;
  creditAmount: number;
  description?: string | null;
};

export type JournalImportResult = {
  created: number;
  errors: { row: number; message: string }[];
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeDate(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  if (DATE_RE.test(s)) return s;
  const slash = s.match(/^(\d{4})[\/.](\d{1,2})[\/.](\d{1,2})$/);
  if (slash) {
    const [, y, m, d] = slash;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return null;
}

/**
 * CSV/Excel から仕訳を一括インポート。
 * 各行 = 1仕訳（借方1行・貸方1行のシンプルな複式）。
 * 借方金額と貸方金額が一致する必要がある。
 */
export async function importJournalEntries(
  clientId: string,
  rows: JournalImportRow[]
): Promise<JournalImportResult> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("認証が必要です");

  // 勘定科目マスタ取得（コード→IDの解決用）
  const { data: accounts, error: accErr } = await supabase
    .from("accounts")
    .select("id, code")
    .eq("client_id", clientId);
  if (accErr) throw new Error(accErr.message);

  const codeToId = new Map<string, string>();
  for (const a of accounts ?? []) {
    if (a.code) codeToId.set(String(a.code).trim(), a.id);
  }

  const errors: { row: number; message: string }[] = [];
  let created = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const lineNo = i + 2; // 1-based + ヘッダ行

    const date = normalizeDate(row.date);
    if (!date) {
      errors.push({ row: lineNo, message: `日付が不正です: "${row.date}"` });
      continue;
    }

    const debitId = codeToId.get(String(row.debitAccountCode).trim());
    if (!debitId) {
      errors.push({ row: lineNo, message: `借方勘定科目コードが見つかりません: "${row.debitAccountCode}"` });
      continue;
    }

    const creditId = codeToId.get(String(row.creditAccountCode).trim());
    if (!creditId) {
      errors.push({ row: lineNo, message: `貸方勘定科目コードが見つかりません: "${row.creditAccountCode}"` });
      continue;
    }

    const debitAmt = Number(row.debitAmount);
    const creditAmt = Number(row.creditAmount);
    if (!Number.isFinite(debitAmt) || debitAmt <= 0) {
      errors.push({ row: lineNo, message: `借方金額が不正です: "${row.debitAmount}"` });
      continue;
    }
    if (!Number.isFinite(creditAmt) || creditAmt <= 0) {
      errors.push({ row: lineNo, message: `貸方金額が不正です: "${row.creditAmount}"` });
      continue;
    }
    if (Math.round(debitAmt) !== Math.round(creditAmt)) {
      errors.push({ row: lineNo, message: `借方金額と貸方金額が一致しません (借: ${debitAmt} / 貸: ${creditAmt})` });
      continue;
    }

    const { data: entry, error: entryErr } = await supabase
      .from("journal_entries")
      .insert({
        client_id: clientId,
        entry_date: date,
        description: row.description?.trim() || null,
        status: "draft",
        source: "import",
        created_by: user.id,
      })
      .select("id")
      .single();

    if (entryErr || !entry) {
      errors.push({ row: lineNo, message: `仕訳作成エラー: ${entryErr?.message ?? "unknown"}` });
      continue;
    }

    const { error: linesErr } = await supabase
      .from("journal_entry_lines")
      .insert([
        {
          journal_entry_id: entry.id,
          account_id: debitId,
          debit_amount: Math.round(debitAmt),
          credit_amount: 0,
          sort_order: 0,
        },
        {
          journal_entry_id: entry.id,
          account_id: creditId,
          debit_amount: 0,
          credit_amount: Math.round(creditAmt),
          sort_order: 1,
        },
      ]);

    if (linesErr) {
      // ロールバック: 作成済みエントリを削除
      await supabase.from("journal_entries").delete().eq("id", entry.id);
      errors.push({ row: lineNo, message: `仕訳明細作成エラー: ${linesErr.message}` });
      continue;
    }

    created++;
  }

  return { created, errors };
}

// 摘要の予測候補: 直近の仕訳から重複を除いた摘要リストを返す（新しい順）
export async function getDescriptionSuggestions(clientId: string, scanLimit = 400): Promise<string[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("journal_entries")
    .select("description, entry_date")
    .eq("client_id", clientId)
    .not("description", "is", null)
    .order("entry_date", { ascending: false })
    .limit(scanLimit);

  if (error) throw new Error(error.message);

  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of data ?? []) {
    const d = ((r as { description?: string | null }).description ?? "").trim();
    if (!d || seen.has(d)) continue;
    seen.add(d);
    out.push(d);
  }
  return out;
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
