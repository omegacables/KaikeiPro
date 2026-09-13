import { describe, it, expect } from "vitest";
import {
  getInvoiceTransitionRate,
  transitionTaxCategoryCode,
  TAX_CATEGORIES,
} from "./constants";

/**
 * 免税事業者等からの仕入れに係る経過措置。
 * 境界日を1日でも取り違えると納税額が変わるため、各段階の
 * 初日・末日・その前後を確かめる。
 */
const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("経過措置の控除割合", () => {
  it("制度開始から令和8年9月30日までは80%", () => {
    expect(getInvoiceTransitionRate(d("2023-10-01"))).toBe(0.8);
    expect(getInvoiceTransitionRate(d("2026-09-30"))).toBe(0.8);
  });

  it("令和8年10月1日から70%に切り替わる（令和8年度改正）", () => {
    // 改正前の実装ではここが 50% になっていた
    expect(getInvoiceTransitionRate(d("2026-10-01"))).toBe(0.7);
    expect(getInvoiceTransitionRate(d("2028-09-30"))).toBe(0.7);
  });

  it("令和10年10月1日から50%", () => {
    expect(getInvoiceTransitionRate(d("2028-10-01"))).toBe(0.5);
    expect(getInvoiceTransitionRate(d("2030-09-30"))).toBe(0.5);
  });

  it("令和12年10月1日から30%", () => {
    expect(getInvoiceTransitionRate(d("2030-10-01"))).toBe(0.3);
    expect(getInvoiceTransitionRate(d("2031-09-30"))).toBe(0.3);
  });

  it("令和13年10月1日以後は控除できない", () => {
    expect(getInvoiceTransitionRate(d("2031-10-01"))).toBe(0);
    expect(getInvoiceTransitionRate(d("2040-01-01"))).toBe(0);
  });

  it("段階は下がる一方で、逆転しない", () => {
    const dates = [
      "2023-10-01", "2026-09-30", "2026-10-01", "2028-09-30",
      "2028-10-01", "2030-09-30", "2030-10-01", "2031-09-30", "2031-10-01",
    ];
    const rates = dates.map((s) => getInvoiceTransitionRate(d(s)));
    for (let i = 1; i < rates.length; i++) {
      expect(rates[i]).toBeLessThanOrEqual(rates[i - 1]);
    }
  });
});

describe("控除割合に対応する税区分", () => {
  it("4段階すべてに税区分が用意されている（10%・8%とも）", () => {
    for (const rate of [0.8, 0.7, 0.5, 0.3]) {
      for (const taxRate of [0.1, 0.08] as const) {
        const code = transitionTaxCategoryCode(rate, taxRate);
        expect(code).not.toBeNull();
        const found = TAX_CATEGORIES.find((c) => c.code === code);
        expect(found, `${code} が税区分に無い`).toBeDefined();
        expect((found as { transition_rate?: number }).transition_rate).toBe(rate);
      }
    }
  });

  it("控除できない時期には税区分を割り当てない", () => {
    expect(transitionTaxCategoryCode(0, 0.1)).toBeNull();
  });

  it("日付から税区分まで一気に引ける", () => {
    const rate = getInvoiceTransitionRate(d("2026-10-01"));
    expect(transitionTaxCategoryCode(rate, 0.1)).toBe("purchase_10_trans_70");
  });
});
