/**
 * 期間内の仕訳のうち、税抜経理で付けられたもの（仮受消費税・仮払消費税の行があるもの）を調べ、
 * 消費税の集計に渡す行（TaxBookLine）を作る。消費税の出し方は src/lib/tax-book.ts。
 * サーバー処理からだけ呼ぶ（呼び出し側で顧問先へのアクセス権を確かめておくこと）。
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/fetch-all";
import { OUTPUT_TAX_ACCOUNT, INPUT_TAX_ACCOUNT, taxCodeOfLine, type TaxBookLine } from "@/lib/tax-book";
import { taxCategoryInfo } from "@/lib/tax-category";

/** 税抜経理の仕訳と、その仕訳に記録された消費税額（売上側＝仮受、仕入側＝仮払） */
export type ExclusiveEntries = { sales: Map<string, number>; purchase: Map<string, number> };

export async function loadExclusiveEntries(
  db: SupabaseClient,
  clientId: string,
  dateFrom: string,
  dateTo: string
): Promise<ExclusiveEntries> {
  type Row = { journal_entry_id: string; debit_amount: number; credit_amount: number; accounts: { name: string } | null };
  const rows = await fetchAllRows<Row>((from, to) =>
    db
      .from("journal_entry_lines")
      .select("journal_entry_id, debit_amount, credit_amount, accounts!inner ( name ), journal_entries!inner ( client_id, entry_date )")
      .eq("journal_entries.client_id", clientId)
      .gte("journal_entries.entry_date", dateFrom)
      .lte("journal_entries.entry_date", dateTo)
      .ilike("accounts.name", "%消費税%")
      .range(from, to) as unknown as PromiseLike<{ data: Row[] | null; error: { message: string } | null }>
  );
  const result: ExclusiveEntries = { sales: new Map(), purchase: new Map() };
  const add = (m: Map<string, number>, id: string, v: number) => m.set(id, (m.get(id) ?? 0) + v);
  for (const r of rows) {
    const name = r.accounts?.name ?? "";
    const d = Number(r.debit_amount) || 0;
    const c = Number(r.credit_amount) || 0;
    if (OUTPUT_TAX_ACCOUNT.test(name)) add(result.sales, r.journal_entry_id, c - d);
    if (INPUT_TAX_ACCOUNT.test(name)) add(result.purchase, r.journal_entry_id, d - c);
  }
  return result;
}

export type RawTaxLine = Omit<TaxBookLine, "exclusive" | "recordedTax"> & { entryId: string };

/**
 * 集計に渡す行を作る。税抜経理の仕訳で、課税の売上（仕入）の行が1行だけなら、
 * 記録された消費税額をその行の消費税とする（レシート・請求書の額と一致させるため）。
 */
export function toTaxBookLines(raw: RawTaxLine[], ex: ExclusiveEntries): TaxBookLine[] {
  // 貸倒れの行（費用）は、税抜経理なら仮受消費税を減らしているので売上側の消費税の行で判断する
  const isBadDebt = (l: Pick<RawTaxLine, "taxCategory">) => Boolean(taxCategoryInfo(l.taxCategory)?.badDebt);
  const sideOfLine = (l: Pick<RawTaxLine, "accountType" | "taxCategory">) =>
    l.accountType === "revenue" || isBadDebt(l) ? "sales" : "purchase";
  const isTaxable = (l: RawTaxLine) => {
    const code = taxCodeOfLine(l);
    return code !== undefined && code !== "none" && (taxCategoryInfo(code)?.rate ?? 0) > 0;
  };
  // 仕訳×売上/仕入ごとの、課税の行の数
  const taxableCount = new Map<string, number>();
  for (const l of raw) {
    if (!isTaxable(l)) continue;
    const k = `${l.entryId}:${sideOfLine(l)}`;
    taxableCount.set(k, (taxableCount.get(k) ?? 0) + 1);
  }
  return raw.map(({ entryId, ...l }) => {
    const side = sideOfLine(l);
    const rec = ex[side].get(entryId);
    // 貸倒れは仮受消費税を借方に立てる（売上とは逆向き）ので符号を戻す
    const recorded = rec !== undefined && isBadDebt(l) ? -rec : rec;
    const exclusive = recorded !== undefined;
    const single = taxableCount.get(`${entryId}:${side}`) === 1 && isTaxable({ entryId, ...l });
    return { ...l, exclusive, ...(exclusive && single ? { recordedTax: recorded } : {}) };
  });
}

/**
 * 期間内の収益・費用の行を、消費税の集計に渡す形（TaxBookLine）で読み込む。
 * 1000行の取得上限で黙って打ち切られないよう全ページ取得する。要確認の仕訳は needsReview で印を付ける。
 */
export async function loadTaxBookLines(
  db: SupabaseClient,
  clientId: string,
  dateFrom: string,
  dateTo: string
): Promise<TaxBookLine[]> {
  type TaxLine = {
    journal_entry_id: string;
    debit_amount: number;
    credit_amount: number;
    tax_category: string | null;
    tax_rate: number | null;
    accounts: { account_categories: { type: string } | null } | null;
    journal_entries: { client_id: string; entry_date: string; needs_review: boolean | null };
  };
  const [data, exclusive] = await Promise.all([
    fetchAllRows<TaxLine>((from, to) =>
      db
        .from("journal_entry_lines")
        .select(`
      journal_entry_id,
      debit_amount,
      credit_amount,
      tax_category,
      tax_rate,
      accounts!inner ( account_categories!inner ( type ) ),
      journal_entries!inner ( client_id, entry_date, needs_review )
    `)
        .eq("journal_entries.client_id", clientId)
        .gte("journal_entries.entry_date", dateFrom)
        .lte("journal_entries.entry_date", dateTo)
        .range(from, to) as unknown as PromiseLike<{ data: TaxLine[] | null; error: { message: string } | null }>
    ),
    loadExclusiveEntries(db, clientId, dateFrom, dateTo),
  ]);
  return toTaxBookLines(
    data.map((l) => ({
      entryId: l.journal_entry_id,
      accountType: l.accounts?.account_categories?.type ?? "",
      taxCategory: l.tax_category,
      taxRate: l.tax_rate,
      debit: Number(l.debit_amount) || 0,
      credit: Number(l.credit_amount) || 0,
      // 要確認の仕訳は決算書と同じく集計に入れない
      needsReview: Boolean(l.journal_entries.needs_review),
    })),
    exclusive
  );
}
