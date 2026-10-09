import { describe, it, expect } from "vitest";
import { summarizeByTaxCategory, computeTaxSummary, taxAmounts, splitInvoiceByRate, type TaxBookLine } from "@/lib/tax-book";

const l = (over: Partial<TaxBookLine>): TaxBookLine => ({
  accountType: "revenue",
  taxCategory: null,
  taxRate: null,
  debit: 0,
  credit: 0,
  needsReview: false,
  exclusive: false,
  ...over,
});

describe("税抜・消費税・税込の出し方", () => {
  it("税込経理は金額から取り出す（11,000円 → 消費税1,000円）", () => {
    expect(taxAmounts(11_000, 0.1, false)).toEqual({ net: 10_000, tax: 1_000, gross: 11_000 });
    expect(taxAmounts(10_800, 0.08, false)).toEqual({ net: 10_000, tax: 800, gross: 10_800 });
  });
  it("税抜経理は金額×税率（10,000円 → 消費税1,000円）。以前はここが909円になっていた", () => {
    expect(taxAmounts(10_000, 0.1, true)).toEqual({ net: 10_000, tax: 1_000, gross: 11_000 });
    expect(taxAmounts(9_723, 0.08, true)).toEqual({ net: 9_723, tax: 777, gross: 10_500 });
  });
  it("返品のマイナスは同じ額を符号だけ逆にする", () => {
    expect(taxAmounts(-11_000, 0.1, false)).toEqual({ net: -10_000, tax: -1_000, gross: -11_000 });
    expect(taxAmounts(-10_000, 0.1, true)).toEqual({ net: -10_000, tax: -1_000, gross: -11_000 });
  });
  it("非課税・不課税は消費税なし", () => {
    expect(taxAmounts(5_000, 0, true)).toEqual({ net: 5_000, tax: 0, gross: 5_000 });
  });
});

describe("税区分別の集計", () => {
  it("売上・仕入を税区分ごとにまとめ、税込・税抜経理の仕訳が混ざっても正しく出す", () => {
    const rows = summarizeByTaxCategory([
      l({ taxCategory: "sales_10", credit: 110_000 }),
      l({ taxCategory: "sales_10", credit: 10_000, exclusive: true }),
      l({ taxCategory: "sales_08_reduced", credit: 10_800 }),
      l({ accountType: "expenses", taxCategory: "purchase_10", debit: 50_000, exclusive: true }),
      l({ accountType: "expenses", taxCategory: "purchase_10_trans_80", debit: 1_100 }),
    ]);
    expect(rows.map((r) => [r.code, r.count, r.net, r.tax, r.gross])).toEqual([
      ["sales_10", 2, 110_000, 11_000, 121_000],
      ["sales_08_reduced", 1, 10_000, 800, 10_800],
      ["purchase_10", 1, 50_000, 5_000, 55_000],
      ["purchase_10_trans_80", 1, 1_000, 100, 1_100],
    ]);
  });

  it("資産・負債の行は数えず、税区分の無い収益・費用は「未設定」にまとめる", () => {
    const rows = summarizeByTaxCategory([
      l({ accountType: "assets", taxCategory: "sales_10", debit: 110_000 }),
      l({ accountType: "expenses", debit: 3_000 }),
      l({ accountType: "revenue", credit: 2_000 }),
    ]);
    expect(rows.map((r) => [r.side, r.code, r.gross])).toEqual([
      ["sales", "none", 2_000],
      ["purchase", "none", 3_000],
    ]);
  });

  it("古い表記の税区分は読み替え、要確認の仕訳は含めない", () => {
    const rows = summarizeByTaxCategory([
      l({ accountType: "expenses", taxCategory: "taxable", taxRate: 10, debit: 1_100 }),
      l({ accountType: "expenses", taxCategory: "purchase_10", debit: 999, needsReview: true }),
    ]);
    expect(rows).toEqual([
      { code: "purchase_10", name: "課税仕入10%", side: "purchase", count: 1, net: 1_000, tax: 100, gross: 1_100 },
    ]);
  });
});

describe("消費税計算の画面の集計", () => {
  it("税抜経理の売上10,000円の消費税は1,000円（以前は909円と少なく出ていた）", () => {
    const s = computeTaxSummary([l({ taxCategory: "sales_10", credit: 10_000, exclusive: true })]);
    expect([s.sales10, s.sales10Tax]).toEqual([10_000, 1_000]);
  });

  it("税込経理の売上は金額から取り出し、課税売上は税抜で出す", () => {
    const s = computeTaxSummary([l({ taxCategory: "sales_10", credit: 11_000 })]);
    expect([s.sales10, s.sales10Tax]).toEqual([10_000, 1_000]);
  });

  it("経過措置の仕入は控除できる割合だけ控除し、残りを控除できない額に出す", () => {
    const s = computeTaxSummary([
      l({ accountType: "expenses", taxCategory: "purchase_10_trans_80", debit: 10_000, exclusive: true }),
    ]);
    expect([s.purchase10, s.purchase10Tax, s.transitionNotDeductible]).toEqual([10_000, 800, 200]);
  });

  it("非課税売上・不課税は区分ごとに、税区分なしは件数を数える", () => {
    const s = computeTaxSummary([
      l({ taxCategory: "sales_exempt", credit: 3_000 }),
      l({ taxCategory: "sales_out_of_scope", credit: 4_000 }),
      l({ accountType: "expenses", debit: 500 }),
      l({ accountType: "expenses", taxCategory: "purchase_exempt", debit: 9_999 }),
    ]);
    expect([s.salesExempt, s.salesOutOfScope, s.uncategorizedLines, s.purchase10]).toEqual([3_000, 4_000, 1, 0]);
  });
});

describe("請求書を税率ごとに分ける", () => {
  it("10%と8%が混ざる請求書は税率ごとに分ける", () => {
    const r = splitInvoiceByRate(
      [
        { taxRate: 10, subtotal: 10_000, taxAmount: 1_000 },
        { taxRate: 8, subtotal: 5_000, taxAmount: 400 },
        { taxRate: 10, subtotal: 2_000, taxAmount: 200 },
      ],
      17_000,
      1_600
    );
    expect(r).toEqual([
      { rate: 0.1, net: 12_000, tax: 1_200 },
      { rate: 0.08, net: 5_000, tax: 400 },
    ]);
  });
  it("明細の端数で合わないときは、請求書の合計に合わせる", () => {
    const r = splitInvoiceByRate([{ taxRate: 10, subtotal: 333, taxAmount: 33 }, { taxRate: 10, subtotal: 333, taxAmount: 33 }], 666, 67);
    expect(r).toEqual([{ rate: 0.1, net: 666, tax: 67 }]);
  });
  it("明細が無ければ小計と消費税の比から税率を判断し、判断できなければ税率なし", () => {
    expect(splitInvoiceByRate([], 10_000, 1_000)).toEqual([{ rate: 0.1, net: 10_000, tax: 1_000 }]);
    expect(splitInvoiceByRate([], 10_000, 800)).toEqual([{ rate: 0.08, net: 10_000, tax: 800 }]);
    expect(splitInvoiceByRate([], 10_000, 0)).toEqual([{ rate: null, net: 10_000, tax: 0 }]);
    expect(splitInvoiceByRate([], 10_000, 1_234)).toEqual([{ rate: null, net: 10_000, tax: 1_234 }]);
  });
});
