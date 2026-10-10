"use server";

/**
 * 消費税の区分の付け分け。
 *   purchase … 課税仕入れの行の用途区分（個別対応方式）: 課税売上げにのみ要する / 非課税売上げにのみ要する / 共通
 *   sales    … 課税売上げの行の事業区分（簡易課税）: 第1種〜第6種
 */

import { createServerSupabaseClient } from "@/lib/supabase";
import { assertClientAccess } from "@/lib/authz";
import { fetchAllRows } from "@/lib/fetch-all";
import { taxCategoryInfo } from "@/lib/tax-category";

export type ClassificationKind = "purchase" | "sales";
export type ClassificationLine = {
  lineId: string;
  entryId: string;
  date: string;
  description: string;
  accountName: string;
  amount: number;
  /** purchase: taxable / non_taxable / common、sales: "1"〜"6"。未設定は "" */
  value: string;
};

type Line = {
  id: string;
  journal_entry_id: string;
  debit_amount: number;
  credit_amount: number;
  tax_category: string | null;
  purchase_use: string | null;
  business_type: number | null;
  accounts: { name: string; account_categories: { type: string } | null } | null;
  journal_entries: { client_id: string; entry_date: string; description: string | null; needs_review: boolean | null };
};

export async function getClassificationLines(
  clientId: string,
  startDate: string,
  endDate: string,
  kind: ClassificationKind
): Promise<ClassificationLine[]> {
  await assertClientAccess(clientId);
  const db = await createServerSupabaseClient();
  const type = kind === "purchase" ? "expenses" : "revenue";
  const lines = await fetchAllRows<Line>((from, to) =>
    db
      .from("journal_entry_lines")
      .select(
        "id, journal_entry_id, debit_amount, credit_amount, tax_category, purchase_use, business_type, accounts!inner ( name, account_categories!inner ( type ) ), journal_entries!inner ( client_id, entry_date, description, needs_review )"
      )
      .eq("journal_entries.client_id", clientId)
      .gte("journal_entries.entry_date", startDate)
      .lte("journal_entries.entry_date", endDate)
      .eq("accounts.account_categories.type", type)
      .range(from, to) as unknown as PromiseLike<{ data: Line[] | null; error: { message: string } | null }>
  );
  return lines
    .filter((l) => !l.journal_entries.needs_review)
    .filter((l) => {
      // 課税の取引（10%・8%・経過措置）だけ。貸倒れは除く
      const info = taxCategoryInfo(l.tax_category);
      return Boolean(info && info.rate > 0 && !info.badDebt);
    })
    .map((l) => {
      const d = Number(l.debit_amount) || 0;
      const c = Number(l.credit_amount) || 0;
      return {
        lineId: l.id,
        entryId: l.journal_entry_id,
        date: l.journal_entries.entry_date,
        description: l.journal_entries.description ?? "",
        accountName: l.accounts?.name ?? "",
        amount: kind === "purchase" ? d - c : c - d,
        value: kind === "purchase" ? l.purchase_use ?? "" : l.business_type ? String(l.business_type) : "",
      };
    })
    .sort((a, b) => a.accountName.localeCompare(b.accountName) || a.date.localeCompare(b.date));
}

export async function setLineClassification(
  clientId: string,
  kind: ClassificationKind,
  updates: { lineId: string; value: string }[]
): Promise<{ updated: number }> {
  await assertClientAccess(clientId);
  if (updates.length === 0) return { updated: 0 };
  const valid = kind === "purchase" ? ["taxable", "non_taxable", "common", ""] : ["1", "2", "3", "4", "5", "6", ""];
  for (const u of updates) if (!valid.includes(u.value)) throw new Error("区分が正しくありません");

  const db = await createServerSupabaseClient();
  const ids = updates.map((u) => u.lineId);
  const { data: rows, error } = await db
    .from("journal_entry_lines")
    .select("id, accounts!inner ( account_categories!inner ( type ) ), journal_entries!inner ( client_id, entry_date )")
    .in("id", ids);
  if (error) throw new Error(error.message);
  type R = { id: string; accounts: { account_categories: { type: string } }; journal_entries: { client_id: string; entry_date: string } };
  const byId = new Map(((rows ?? []) as unknown as R[]).map((r) => [r.id, r]));
  const { data: locked } = await db.from("fiscal_years").select("start_date, end_date").eq("client_id", clientId).eq("status", "locked");
  const isLocked = (d: string) => (locked ?? []).some((f) => f.start_date <= d && d <= f.end_date);
  const type = kind === "purchase" ? "expenses" : "revenue";

  const byValue = new Map<string, string[]>();
  for (const u of updates) {
    const r = byId.get(u.lineId);
    if (!r || r.journal_entries.client_id !== clientId) throw new Error("この顧問先の仕訳ではない行があります");
    if (r.accounts.account_categories.type !== type) throw new Error("区分を付けられない行があります");
    if (isLocked(r.journal_entries.entry_date)) throw new Error("ロック済みの会計年度の仕訳は変えられません");
    byValue.set(u.value, [...(byValue.get(u.value) ?? []), u.lineId]);
  }
  let updated = 0;
  for (const [value, lineIds] of byValue) {
    const patch =
      kind === "purchase"
        ? { purchase_use: (value || null) as "taxable" | "non_taxable" | "common" | null }
        : { business_type: value ? Number(value) : null };
    const { error: uErr } = await db.from("journal_entry_lines").update(patch).in("id", lineIds);
    if (uErr) throw new Error(uErr.message);
    updated += lineIds.length;
  }
  return { updated };
}
