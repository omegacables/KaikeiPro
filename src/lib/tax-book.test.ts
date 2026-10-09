import { describe, it, expect } from "vitest";
import { summarizeByTaxCategory, type TaxBookLine } from "@/lib/tax-book";

const l = (over: Partial<TaxBookLine>): TaxBookLine => ({
  accountType: "revenue",
  taxCategory: null,
  taxRate: null,
  debit: 0,
  credit: 0,
  needsReview: false,
  ...over,
});

describe("税区分別の集計", () => {
  it("売上・仕入を税区分ごとにまとめ、消費税額を取り出す", () => {
    const rows = summarizeByTaxCategory([
      l({ taxCategory: "sales_10", credit: 110_000 }),
      l({ taxCategory: "sales_10", credit: 11_000 }),
      l({ taxCategory: "sales_08_reduced", credit: 10_800 }),
      l({ accountType: "expenses", taxCategory: "purchase_10", debit: 55_000 }),
      l({ accountType: "expenses", taxCategory: "purchase_10_trans_80", debit: 1_100 }),
    ]);
    expect(rows.map((r) => [r.code, r.count, r.amount, r.tax])).toEqual([
      ["sales_10", 2, 121_000, 11_000],
      ["sales_08_reduced", 1, 10_800, 800],
      ["purchase_10", 1, 55_000, 5_000],
      ["purchase_10_trans_80", 1, 1_100, 100],
    ]);
  });

  it("資産・負債の行は数えず、税区分の無い収益・費用は「未設定」にまとめる", () => {
    const rows = summarizeByTaxCategory([
      l({ accountType: "assets", taxCategory: "sales_10", debit: 110_000 }),
      l({ accountType: "expenses", debit: 3_000 }),
      l({ accountType: "revenue", credit: 2_000 }),
    ]);
    expect(rows.map((r) => [r.side, r.code, r.amount])).toEqual([
      ["sales", "none", 2_000],
      ["purchase", "none", 3_000],
    ]);
  });

  it("古い表記の税区分は消費税の集計と同じく読み替え、要確認の仕訳は含めない", () => {
    const rows = summarizeByTaxCategory([
      l({ accountType: "expenses", taxCategory: "taxable", taxRate: 10, debit: 1_100 }),
      l({ accountType: "expenses", taxCategory: "purchase_10", debit: 999, needsReview: true }),
    ]);
    expect(rows).toEqual([
      { code: "purchase_10", name: "課税仕入10%", side: "purchase", count: 1, amount: 1_100, tax: 100 },
    ]);
  });

  it("返品などの戻しは差し引く", () => {
    const rows = summarizeByTaxCategory([
      l({ taxCategory: "sales_10", credit: 11_000 }),
      l({ taxCategory: "sales_10", debit: 1_100 }),
    ]);
    expect(rows[0]).toMatchObject({ amount: 9_900, count: 2 });
  });
});
