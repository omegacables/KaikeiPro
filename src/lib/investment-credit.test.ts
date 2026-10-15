import { describe, it, expect } from "vitest";
import { computeInvestmentCredit } from "@/lib/investment-credit";

const machine = { name: "工作機械", code: "00031", acquisitionCost: 10_000_000 };
const ship = { name: "漁船", code: "00040", acquisitionCost: 4_000_000 };
const aType = { name: "生産設備", code: "00712", acquisitionCost: 5_000_000 };
const bType = { name: "検査装置", code: "00714", acquisitionCost: 3_000_000 };

describe("設備投資の税額控除", () => {
  it("投資促進税制: 取得価額×7%（法人税額の20%まで）", () => {
    const r = computeInvestmentCredit({ assets: [machine], capital: 10_000_000, adjustedTax: 10_000_000 });
    expect(r.promotion).toMatchObject({ base: 10_000_000, limit: 700_000, cap: 2_000_000, credit: 700_000, carryover: 0 });
    expect(r.total).toBe(700_000);
  });

  it("船舶は取得価額の75%が基準", () => {
    const r = computeInvestmentCredit({ assets: [ship], capital: 10_000_000, adjustedTax: 10_000_000 });
    expect(r.promotion).toMatchObject({ base: 3_000_000, limit: 210_000 });
  });

  it("20%を超える分は控除せず、翌期への繰越額として出す", () => {
    const r = computeInvestmentCredit({ assets: [machine], capital: 10_000_000, adjustedTax: 2_000_000 });
    expect(r.promotion).toMatchObject({ limit: 700_000, cap: 400_000, credit: 400_000, carryover: 300_000 });
    expect(r.warnings.some((w) => w.includes("繰り越せます"))).toBe(true);
  });

  it("投資促進税制は資本金3,000万円超では使えない", () => {
    const r = computeInvestmentCredit({ assets: [machine], capital: 50_000_000, adjustedTax: 10_000_000 });
    expect(r.promotion).toBeNull();
    expect(r.total).toBe(0);
  });

  it("経営強化税制: 資本金3,000万円以下は10%、超えると7%", () => {
    expect(computeInvestmentCredit({ assets: [aType], capital: 30_000_000, adjustedTax: 10_000_000 }).strengthen).toMatchObject({ rate: 0.1, limit: 500_000, credit: 500_000 });
    expect(computeInvestmentCredit({ assets: [aType], capital: 50_000_000, adjustedTax: 10_000_000 }).strengthen).toMatchObject({ rate: 0.07, limit: 350_000 });
    expect(computeInvestmentCredit({ assets: [aType], capital: 200_000_000, adjustedTax: 10_000_000 }).strengthen).toBeNull();
  });

  it("2つ合わせて20%まで。投資促進税制を先に当てる", () => {
    const r = computeInvestmentCredit({ assets: [machine, aType], capital: 10_000_000, adjustedTax: 5_000_000 });
    // 20% = 1,000,000。投資促進 700,000 → 経営強化は残り 300,000 まで（限度額 500,000）
    expect(r.promotion?.credit).toBe(700_000);
    expect(r.strengthen).toMatchObject({ cap: 300_000, credit: 300_000, carryover: 200_000 });
    expect(r.total).toBe(1_000_000);
  });

  it("経営強化税制の類型ごとの適用額は、税額控除限度額の割合で分ける", () => {
    const r = computeInvestmentCredit({ assets: [aType, bType], capital: 10_000_000, adjustedTax: 2_000_000 });
    // 限度額 800,000（A 500,000 / B 300,000）、上限 400,000 → A 250,000・B 150,000
    expect(r.strengthen?.lines).toEqual([
      { code: "00720", base: 5_000_000, limit: 500_000, credit: 250_000 },
      { code: "00721", base: 3_000_000, limit: 300_000, credit: 150_000 },
    ]);
  });

  it("法人税額が0（欠損）なら控除は0で、全額を繰り越す", () => {
    const r = computeInvestmentCredit({ assets: [machine], capital: 10_000_000, adjustedTax: 0 });
    expect(r.promotion).toMatchObject({ credit: 0, carryover: 700_000 });
  });
});
