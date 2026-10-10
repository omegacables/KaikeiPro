/**
 * 作った仕訳の税区分を、科目と摘要から補う・直す（src/lib/tax-classify.ts の決まりで）。
 * AI・銀行明細など自動で作った仕訳の保存直後に呼ぶ。サーバー処理からだけ呼ぶこと
 * （呼び出し側で顧問先へのアクセス権を確かめておく）。
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveTaxCategory } from "@/lib/tax-classify";

type LineRow = {
  id: string;
  tax_category: string | null;
  accounts: { name: string; account_categories: { type: string } | null } | null;
  journal_entries: { description: string | null } | null;
};

/** 直した行の数を返す。失敗しても仕訳の作成は止めない（呼び出し側で握りつぶしてよい） */
export async function classifyEntryLines(db: SupabaseClient, entryIds: string[]): Promise<number> {
  if (entryIds.length === 0) return 0;
  const { data, error } = await db
    .from("journal_entry_lines")
    .select("id, tax_category, accounts!inner ( name, account_categories ( type ) ), journal_entries!inner ( description )")
    .in("journal_entry_id", entryIds);
  if (error) throw new Error(error.message);
  const byCode = new Map<string | null, string[]>();
  for (const l of (data ?? []) as unknown as LineRow[]) {
    const type = l.accounts?.account_categories?.type ?? "";
    if (type !== "revenue" && type !== "expenses") continue;
    const next = resolveTaxCategory(type, l.accounts?.name ?? "", l.journal_entries?.description, l.tax_category);
    if (next === l.tax_category) continue;
    byCode.set(next, [...(byCode.get(next) ?? []), l.id]);
  }
  let changed = 0;
  for (const [code, ids] of byCode) {
    const { error: uErr } = await db.from("journal_entry_lines").update({ tax_category: code }).in("id", ids);
    if (uErr) throw new Error(uErr.message);
    changed += ids.length;
  }
  return changed;
}
