/**
 * 売上・仕入を税区分ごとにまとめる（帳簿閲覧の「税区分別」）。
 *
 * 判定と金額の取り方は消費税の集計（src/actions/tax.ts の getTaxSummary）とそろえる。
 *   - 税区分が意味を持つのは収益・費用の行だけ
 *   - 収益は貸方−借方、費用は借方−貸方（戻しの仕訳は差し引きで消える）
 *   - 金額は税込として消費税額を取り出す
 */

import {
  normalizeTaxCategory,
  taxCategoryInfo,
  taxFromGross,
  TAX_CATEGORY_LIST,
  type AccountType,
  type TaxCategoryCode,
} from "@/lib/tax-category";

export type TaxBookLine = {
  accountType: string;
  taxCategory: string | null;
  taxRate: number | null;
  debit: number;
  credit: number;
  needsReview: boolean;
};

export type TaxBookRow = {
  /** 税区分。未設定の行は "none" */
  code: TaxCategoryCode | "none";
  name: string;
  side: "sales" | "purchase";
  count: number;
  /** 税込金額 */
  amount: number;
  /** 金額に含まれる消費税額（課税取引のみ。経過措置の控除制限は反映しない） */
  tax: number;
};

/** 行の税区分（読み替え後）。収益・費用以外は対象外（undefined） */
export function taxCodeOfLine(l: Pick<TaxBookLine, "accountType" | "taxCategory" | "taxRate">):
  | TaxCategoryCode
  | "none"
  | undefined {
  if (l.accountType !== "revenue" && l.accountType !== "expenses") return undefined;
  return normalizeTaxCategory(l.taxCategory, l.accountType as AccountType, l.taxRate) ?? "none";
}

/** 行の金額（収益は貸方−借方、費用は借方−貸方） */
export function taxBookAmount(l: Pick<TaxBookLine, "accountType" | "debit" | "credit">): number {
  return l.accountType === "revenue" ? l.credit - l.debit : l.debit - l.credit;
}

/** 税区分ごとの件数・金額・消費税額。要確認の仕訳は消費税の集計と同じく含めない */
export function summarizeByTaxCategory(lines: TaxBookLine[]): TaxBookRow[] {
  const map = new Map<string, TaxBookRow>();
  for (const l of lines) {
    if (l.needsReview) continue;
    const code = taxCodeOfLine(l);
    if (code === undefined) continue;
    const side = l.accountType === "revenue" ? "sales" : "purchase";
    const key = `${side}:${code}`;
    let r = map.get(key);
    if (!r) {
      const info = code === "none" ? null : taxCategoryInfo(code);
      r = { code, name: info?.name ?? "税区分未設定", side, count: 0, amount: 0, tax: 0 };
      map.set(key, r);
    }
    const amount = taxBookAmount(l);
    r.count++;
    r.amount += amount;
    const info = code === "none" ? null : taxCategoryInfo(code);
    if (info && info.rate > 0) r.tax += taxFromGross(amount, info.rate as 0.1 | 0.08);
  }
  // 税区分マスタの並び（売上→仕入）、未設定は各側の最後
  const order = new Map(TAX_CATEGORY_LIST.map((c, i) => [c.code as string, i]));
  return [...map.values()].sort((a, b) => {
    if (a.side !== b.side) return a.side === "sales" ? -1 : 1;
    return (order.get(a.code) ?? 999) - (order.get(b.code) ?? 999);
  });
}
