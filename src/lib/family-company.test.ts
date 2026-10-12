import { describe, it, expect } from "vitest";
import { judgeFamilyCompany, type Shareholder } from "./family-company";

const sh = (groupNo: number, name: string, shares: number, relationship: string | null = null): Shareholder => ({
  groupNo, name, address: null, relationship, isCorporation: false, shares,
});

describe("同族会社の判定", () => {
  it("上位3グループで50%超なら同族会社。グループは持株数の多い順に順位を付け、判定基準となる株主（本人）を先頭に", () => {
    const r = judgeFamilyCompany({
      shareholders: [sh(1, "山田花子", 200, "妻"), sh(1, "山田太郎", 600, "本人"), sh(2, "A", 100, "本人"), sh(3, "B", 100, "本人")],
      issuedShares: 1000,
      treasuryShares: 0,
      capital: 10_000_000,
    });
    expect(r.kind).toBe(1);
    expect(r.top3Ratio).toBe(100);
    expect(r.groups.map((g) => [g.rank, g.shares, g.members[0].name])).toEqual([
      [1, 800, "山田太郎"],
      [2, 100, "A"],
      [3, 100, "B"],
    ]);
  });

  it("自己株式は発行済株式の総数から除く。上位3グループで50%以下なら非同族会社", () => {
    const shareholders = Array.from({ length: 10 }, (_, k) => sh(k + 1, `株主${k}`, 90));
    const r = judgeFamilyCompany({ shareholders, issuedShares: 1000, treasuryShares: 100, capital: 10_000_000 });
    expect(r.outstanding).toBe(900);
    expect(r.top3Ratio).toBe(30);
    expect(r.kind).toBe(3);
  });

  it("資本金1億円超で上位1グループが50%超なら特定同族会社。中小法人は当たらない", () => {
    const shareholders = [sh(1, "親会社", 600), sh(2, "X", 400)];
    expect(judgeFamilyCompany({ shareholders, issuedShares: 1000, treasuryShares: 0, capital: 200_000_000 }).kind).toBe(4);
    expect(judgeFamilyCompany({ shareholders, issuedShares: 1000, treasuryShares: 0, capital: 100_000_000 }).kind).toBe(1);
  });

  it("名簿の合計が発行済株式と合わなければ知らせる", () => {
    const r = judgeFamilyCompany({ shareholders: [sh(1, "X", 500)], issuedShares: 1000, treasuryShares: 0, capital: 10_000_000 });
    expect(r.warnings.some((w) => w.includes("合いません"))).toBe(true);
  });
});

describe("資本金が分からないとき", () => {
  it("中小法人として扱い、特定同族会社にしない", () => {
    const r = judgeFamilyCompany({ shareholders: [sh(1, "X", 700), sh(2, "Y", 300)], issuedShares: 1000, treasuryShares: 0, capital: null });
    expect(r.kind).toBe(1);
    expect(r.warnings.some((w) => w.includes("資本金"))).toBe(true);
  });
});
