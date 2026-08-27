import { describe, it, expect } from "vitest";
import { calculateAnnualDepreciation, type DepreciableAsset } from "./depreciation";

const asset = (o: Partial<DepreciableAsset> = {}): DepreciableAsset => ({
  acquisition_date: "2025-04-01",
  acquisition_cost: 1200000,
  salvage_value: 0,
  useful_life: 6,
  depreciation_method: "straight_line",
  ...o,
});

const fyEnd = (y: number, m: number, d: number) => new Date(y, m - 1, d);

describe("定額法", () => {
  it("期首に取得した資産は年額（取得価額÷耐用年数）を償却する", () => {
    // 120万 ÷ 6年 = 20万/年
    expect(calculateAnnualDepreciation(asset(), fyEnd(2026, 3, 31))).toBe(200000);
  });

  it("期中取得は月割りする", () => {
    // 10月取得 → 当期は6ヶ月分 = 20万 × 6/12 = 10万
    const a = asset({ acquisition_date: "2025-10-01" });
    expect(calculateAnnualDepreciation(a, fyEnd(2026, 3, 31))).toBe(100000);
  });

  it("残存価額を差し引いて償却する", () => {
    // (120万 - 20万) ÷ 5年 = 20万/年
    const a = asset({ salvage_value: 200000, useful_life: 5 });
    expect(calculateAnnualDepreciation(a, fyEnd(2026, 3, 31))).toBe(200000);
  });

  it("償却可能限度額を超えない（耐用年数経過後は0）", () => {
    // 6年で償却済み → 7年目は0
    expect(calculateAnnualDepreciation(asset(), fyEnd(2032, 3, 31))).toBe(0);
  });

  it("最終年度は残額のみを償却する（積み上げが取得価額を超えない）", () => {
    // 10月取得・6年: 各年20万だが初年度10万のため最終年度に10万残る
    const a = asset({ acquisition_date: "2025-10-01" });
    const years = [2026, 2027, 2028, 2029, 2030, 2031, 2032].map((y) =>
      calculateAnnualDepreciation(a, fyEnd(y, 3, 31))
    );
    const total = years.reduce((s, v) => s + v, 0);
    expect(total).toBeLessThanOrEqual(1200000);
    expect(years[0]).toBe(100000);
  });

  it("取得日が期末より後なら償却しない", () => {
    const a = asset({ acquisition_date: "2026-05-01" });
    expect(calculateAnnualDepreciation(a, fyEnd(2026, 3, 31))).toBe(0);
  });
});

describe("定率法", () => {
  it("残存価額0なら200%定率法（償却率 = 2 ÷ 耐用年数）", () => {
    // 120万 × (2/6) = 40万
    const a = asset({ depreciation_method: "declining_balance" });
    expect(calculateAnnualDepreciation(a, fyEnd(2026, 3, 31))).toBe(400000);
  });

  it("翌期は期首帳簿価額に償却率を掛ける", () => {
    // 1年目40万償却 → 帳簿価額80万 → 80万 × (2/6) = 約26.6万
    const a = asset({ depreciation_method: "declining_balance" });
    expect(calculateAnnualDepreciation(a, fyEnd(2027, 3, 31))).toBe(266666);
  });

  it("償却額が帳簿価額を超えない", () => {
    const a = asset({ depreciation_method: "declining_balance", useful_life: 2 });
    // 耐用年数2年 → 償却率100%。2年目以降は残高0で0になる
    const y1 = calculateAnnualDepreciation(a, fyEnd(2026, 3, 31));
    const y2 = calculateAnnualDepreciation(a, fyEnd(2027, 3, 31));
    expect(y1).toBe(1200000);
    expect(y2).toBe(0);
  });

  it("償却額は常に0以上", () => {
    const a = asset({ depreciation_method: "declining_balance" });
    for (const y of [2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033]) {
      expect(calculateAnnualDepreciation(a, fyEnd(y, 3, 31))).toBeGreaterThanOrEqual(0);
    }
  });
});
