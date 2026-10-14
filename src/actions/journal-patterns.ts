"use server";

/**
 * 仕訳入力の「連想」に使う、過去の仕訳の組み合わせ（摘要・科目・補助科目・税区分）。
 * 数え方と候補の選び方は src/lib/journal-association.ts（テストあり）。
 */

import { createServerSupabaseClient } from "@/lib/supabase";
import { assertClientAccess } from "@/lib/authz";
import { buildPatterns, type JournalPattern, type PastEntry } from "@/lib/journal-association";

type Row = {
  description: string | null;
  entry_date: string;
  journal_entry_lines: {
    account_id: string;
    sub_account_id: string | null;
    debit_amount: number;
    credit_amount: number;
    tax_category: string | null;
  }[];
};

/** 新しい仕訳から最大1000件を見て、よく使う組み合わせを返す */
export async function getJournalPatterns(clientId: string): Promise<JournalPattern[]> {
  await assertClientAccess(clientId);
  const supabase = await createServerSupabaseClient();
  const [{ data, error }, { data: subs }] = await Promise.all([
    supabase
      .from("journal_entries")
      .select("description, entry_date, journal_entry_lines(account_id, sub_account_id, debit_amount, credit_amount, tax_category)")
      .eq("client_id", clientId)
      .not("description", "is", null)
      .order("entry_date", { ascending: false })
      .limit(1000),
    supabase.from("sub_accounts").select("id, name").eq("client_id", clientId),
  ]);
  if (error) throw new Error(error.message);
  const subName = new Map((subs ?? []).map((s) => [s.id as string, s.name as string]));
  const entries: PastEntry[] = ((data ?? []) as unknown as Row[]).map((e) => ({
    description: e.description,
    entryDate: e.entry_date,
    lines: (e.journal_entry_lines ?? []).map((l) => ({
      accountId: l.account_id,
      subId: l.sub_account_id,
      subName: l.sub_account_id ? subName.get(l.sub_account_id) ?? null : null,
      debit: Number(l.debit_amount) || 0,
      credit: Number(l.credit_amount) || 0,
      tax: l.tax_category,
    })),
  }));
  return buildPatterns(entries);
}
