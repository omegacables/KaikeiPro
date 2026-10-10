"use server";

/**
 * 税区分の点検と一括修正。判別の決まりは src/lib/tax-classify.ts（テストあり）。
 *   conflict … はっきりした決まり（給与は不課税、利息は非課税など）と違う
 *   missing  … 税区分が付いていない（消費税の計算に入っていない）
 *   review   … 取引の中身で変わるもの（会費・住宅家賃・切手など）。確認をすすめる
 */

import { createServerSupabaseClient } from "@/lib/supabase";
import { assertClientAccess } from "@/lib/authz";
import { fetchAllRows } from "@/lib/fetch-all";
import { checkTaxCategory } from "@/lib/tax-classify";
import { sanitizeTaxCategory, taxCategoryInfo, taxCategoriesFor } from "@/lib/tax-category";

export type TaxCategoryIssue = {
  lineId: string;
  entryId: string;
  date: string;
  description: string;
  accountName: string;
  amount: number;
  current: string | null;
  currentName: string;
  suggested: string;
  suggestedName: string;
  kind: "conflict" | "missing" | "review";
  reason: string;
};

type Line = {
  id: string;
  journal_entry_id: string;
  debit_amount: number;
  credit_amount: number;
  tax_category: string | null;
  accounts: { name: string; account_categories: { type: string } | null } | null;
  journal_entries: { client_id: string; entry_date: string; description: string | null };
};

export async function getTaxCategoryIssues(clientId: string, startDate: string, endDate: string): Promise<TaxCategoryIssue[]> {
  await assertClientAccess(clientId);
  const db = await createServerSupabaseClient();
  const lines = await fetchAllRows<Line>((from, to) =>
    db
      .from("journal_entry_lines")
      .select(
        "id, journal_entry_id, debit_amount, credit_amount, tax_category, accounts!inner ( name, account_categories!inner ( type ) ), journal_entries!inner ( client_id, entry_date, description )"
      )
      .eq("journal_entries.client_id", clientId)
      .gte("journal_entries.entry_date", startDate)
      .lte("journal_entries.entry_date", endDate)
      .in("accounts.account_categories.type", ["revenue", "expenses"])
      .range(from, to) as unknown as PromiseLike<{ data: Line[] | null; error: { message: string } | null }>
  );
  const issues: TaxCategoryIssue[] = [];
  for (const l of lines) {
    const type = l.accounts?.account_categories?.type ?? "";
    const accountName = l.accounts?.name ?? "";
    const check = checkTaxCategory(type, accountName, l.journal_entries.description, l.tax_category);
    if (check.kind === "ok") continue;
    const debit = Number(l.debit_amount) || 0;
    const credit = Number(l.credit_amount) || 0;
    issues.push({
      lineId: l.id,
      entryId: l.journal_entry_id,
      date: l.journal_entries.entry_date,
      description: l.journal_entries.description ?? "",
      accountName,
      amount: type === "revenue" ? credit - debit : debit - credit,
      current: l.tax_category,
      currentName: taxCategoryInfo(l.tax_category)?.name ?? "未設定",
      suggested: check.suggestion.code,
      suggestedName: taxCategoryInfo(check.suggestion.code)?.name ?? check.suggestion.code,
      kind: check.kind,
      reason: check.suggestion.reason,
    });
  }
  const order = { conflict: 0, missing: 1, review: 2 };
  return issues.sort((a, b) => order[a.kind] - order[b.kind] || a.date.localeCompare(b.date));
}

/** 選んだ行の税区分を直す（ロック済みの会計年度の仕訳は直さない） */
export async function fixTaxCategories(clientId: string, fixes: { lineId: string; code: string }[]): Promise<{ updated: number }> {
  await assertClientAccess(clientId);
  if (fixes.length === 0) return { updated: 0 };
  const db = await createServerSupabaseClient();
  const ids = fixes.map((f) => f.lineId);
  const { data: rows, error } = await db
    .from("journal_entry_lines")
    .select("id, accounts!inner ( account_categories!inner ( type ) ), journal_entries!inner ( client_id, entry_date )")
    .in("id", ids);
  if (error) throw new Error(error.message);
  type R = { id: string; accounts: { account_categories: { type: string } }; journal_entries: { client_id: string; entry_date: string } };
  const byId = new Map(((rows ?? []) as unknown as R[]).map((r) => [r.id, r]));

  const { data: locked } = await db.from("fiscal_years").select("start_date, end_date").eq("client_id", clientId).eq("status", "locked");
  const isLocked = (d: string) => (locked ?? []).some((f) => f.start_date <= d && d <= f.end_date);

  const byCode = new Map<string, string[]>();
  for (const f of fixes) {
    const r = byId.get(f.lineId);
    if (!r || r.journal_entries.client_id !== clientId) throw new Error("この顧問先の仕訳ではない行があります");
    if (isLocked(r.journal_entries.entry_date)) throw new Error("ロック済みの会計年度の仕訳は直せません");
    const code = sanitizeTaxCategory(f.code);
    const type = r.accounts.account_categories.type;
    if (!code || !taxCategoriesFor(type).some((c) => c.code === code)) throw new Error("税区分が正しくありません");
    byCode.set(code, [...(byCode.get(code) ?? []), f.lineId]);
  }
  let updated = 0;
  for (const [code, lineIds] of byCode) {
    const { error: uErr } = await db.from("journal_entry_lines").update({ tax_category: code }).in("id", lineIds);
    if (uErr) throw new Error(uErr.message);
    updated += lineIds.length;
  }
  return { updated };
}
