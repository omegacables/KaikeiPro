import { describe, it, expect } from "vitest";
import { toTaxBookLines, type ExclusiveEntries, type RawTaxLine } from "@/lib/tax-exclusive";
import { computeTaxSummary } from "@/lib/tax-book";

const raw = (over: Partial<RawTaxLine>): RawTaxLine => ({
  entryId: "e1",
  accountType: "expenses",
  taxCategory: "purchase_10",
  taxRate: 0.1,
  debit: 0,
  credit: 0,
  needsReview: false,
  ...over,
});
const ex = (purchase: Record<string, number> = {}, sales: Record<string, number> = {}): ExclusiveEntries => ({
  sales: new Map(Object.entries(sales)),
  purchase: new Map(Object.entries(purchase)),
});

describe("税抜経理の判断と、記録された消費税額", () => {
  it("仮払消費税のある仕訳は税抜経理。課税の仕入が1行ならレシートの消費税額をそのまま使う", () => {
    // 税込26,102円のレシート: 税抜23,729円・消費税2,373円（23,729×10%=2,372.9 とは1円違う）
    const lines = toTaxBookLines([raw({ debit: 23_729 })], ex({ e1: 2_373 }));
    expect(lines[0]).toMatchObject({ exclusive: true, recordedTax: 2_373 });
    expect(computeTaxSummary(lines).purchase10Tax).toBe(2_373);
  });

  it("税率の違う仕入が複数行ある仕訳は、行ごとに税抜金額×税率", () => {
    const lines = toTaxBookLines(
      [raw({ debit: 10_000 }), raw({ debit: 5_000, taxCategory: "purchase_08_reduced", taxRate: 0.08 })],
      ex({ e1: 1_400 })
    );
    expect(lines.every((l) => l.exclusive && l.recordedTax === undefined)).toBe(true);
    const s = computeTaxSummary(lines);
    expect([s.purchase10Tax, s.purchase8Tax]).toEqual([1_000, 400]);
  });

  it("消費税の行が無い仕訳は税込経理", () => {
    const lines = toTaxBookLines([raw({ entryId: "e2", debit: 11_000 })], ex({ e1: 1 }));
    expect(lines[0].exclusive).toBe(false);
    expect(computeTaxSummary(lines).purchase10Tax).toBe(1_000);
  });

  it("売上は仮受消費税、仕入は仮払消費税で判断する（同じ仕訳でも側ごと）", () => {
    const lines = toTaxBookLines(
      [raw({ accountType: "revenue", taxCategory: "sales_10", credit: 100_000 }), raw({ debit: 11_000 })],
      ex({}, { e1: 10_000 })
    );
    expect(lines.map((l) => l.exclusive)).toEqual([true, false]);
  });
});
