import { describe, it, expect } from "vitest";
import { computeBlueReturn, type BlueTbRow } from "@/lib/blue-return";

// 試算表の1行。PL科目は期中の借方・貸方、BS科目は期首・期末残高（借方プラス）
const pl = (name: string, category: "revenue" | "expense", amount: number, o: Partial<BlueTbRow> = {}): BlueTbRow => ({
  code: name, name, category, prevBalance: 0,
  debitTotal: category === "expense" ? amount : 0,
  creditTotal: category === "revenue" ? amount : 0,
  currentBalance: category === "expense" ? amount : -amount,
  ...o,
});
const bs = (name: string, category: "asset" | "liability" | "equity", prev: number, cur: number, dr = 0, cr = 0): BlueTbRow => ({
  code: name, name, category, prevBalance: prev, debitTotal: dr, creditTotal: cr, currentBalance: cur,
});

// 期首: 現金 100,000・普通預金 900,000・商品 200,000 ／ 買掛金 300,000 → 元入金 900,000
// 期中: 売上 5,000,000、仕入 2,000,000（商品が 50,000 増えた結果、売上原価 1,950,000）、経費、事業主貸 1,200,000・事業主借 100,000
const tb: BlueTbRow[] = [
  pl("売上高", "revenue", 5_000_000),
  pl("売上原価", "expense", 1_950_000, { costOfSales: true }),
  pl("地代家賃", "expense", 600_000),
  pl("通信費", "expense", 120_000),
  pl("旅費交通費", "expense", 80_000),
  pl("会議費", "expense", 30_000),
  pl("新聞図書費", "expense", 20_000),
  pl("支払手数料", "expense", 15_000),
  pl("車両費", "expense", 90_000),
  pl("諸会費", "expense", 12_000),
  pl("研修費", "expense", 50_000),
  pl("リース料", "expense", 40_000),
  pl("専従者給与", "expense", 1_200_000),
  bs("現金", "asset", 100_000, 150_000),
  bs("普通預金", "asset", 900_000, 543_000),
  bs("商品", "asset", 200_000, 250_000),
  bs("買掛金", "liability", -300_000, -350_000),
  bs("事業主貸", "asset", 0, 1_200_000, 1_200_000, 0),
  bs("事業主借", "equity", 0, -100_000, 0, 100_000),
  bs("元入金", "equity", -900_000, -900_000),
];

describe("青色申告決算書 1ページ（損益計算書）", () => {
  const r = computeBlueReturn({ tb, deductionLimit: 650_000 });
  const line = (no: string) => r.pl.find((l) => l.no === no)!;

  it("売上原価: 期首・期末の棚卸高は棚卸資産の残高、仕入金額は原価に増減を足し戻した総額", () => {
    expect(line("1").amount).toBe(5_000_000);
    expect(line("2").amount).toBe(200_000);
    expect(line("3").amount).toBe(2_000_000);
    expect(line("5").amount).toBe(250_000);
    expect(line("6").amount).toBe(1_950_000);
    expect(line("7").amount).toBe(3_050_000);
  });

  it("決まった行に振り分け、無い科目は大きい順に自由記入の6行（7つ目からは雑費）", () => {
    expect(line("23").amount).toBe(600_000);
    expect(line("12").amount).toBe(120_000);
    expect(r.pl.filter((l) => Number(l.no) >= 25 && Number(l.no) <= 30).map((l) => l.label)).toEqual([
      "車両費", "研修費", "リース料", "会議費", "新聞図書費", "支払手数料",
    ]);
    expect(line("31")).toMatchObject({ amount: 12_000, accounts: ["諸会費"] });
    expect(r.warnings.some((w) => w.includes("諸会費"))).toBe(true);
  });

  it("専従者給与は経費でなく ㊳。㊸ ＝ ㉝ ＋ ㊲ － ㊷、65万円控除", () => {
    expect(line("32").amount).toBe(1_057_000);
    expect(line("33").amount).toBe(1_993_000);
    expect(line("38").amount).toBe(1_200_000);
    expect(r.incomeBeforeDeduction).toBe(793_000);
    expect(r.deduction).toBe(650_000);
    expect(r.income).toBe(143_000);
  });

  it("青色申告特別控除は控除前の所得まで（赤字なら0）", () => {
    const small = computeBlueReturn({ tb: tb.map((x) => (x.name === "売上高" ? pl("売上高", "revenue", 4_500_000) : x)), deductionLimit: 650_000 });
    expect(small.incomeBeforeDeduction).toBe(293_000);
    expect(small.deduction).toBe(293_000);
    expect(small.income).toBe(0);
    const loss = computeBlueReturn({ tb: tb.map((x) => (x.name === "売上高" ? pl("売上高", "revenue", 3_000_000) : x)), deductionLimit: 100_000 });
    expect(loss.deduction).toBe(0);
  });
});

describe("青色申告決算書 4ページ（貸借対照表）", () => {
  const r = computeBlueReturn({ tb, deductionLimit: 650_000 });
  const a = (label: string) => r.bs.assets.find((l) => l.label === label)!;

  it("普通預金は「その他の預金」、商品は「棚卸資産」、事業主貸は期末だけ", () => {
    expect(a("その他の預金")).toMatchObject({ opening: 900_000, closing: 543_000 });
    expect(a("棚卸資産")).toMatchObject({ opening: 200_000, closing: 250_000 });
    expect(a("事業主貸")).toMatchObject({ opening: null, closing: 1_200_000 });
  });

  it("元入金 ＝ 期首の資産 − 負債。期末は 資産 ＝ 負債 ＋ 事業主借 ＋ 元入金 ＋ ㊸ でそろう", () => {
    expect(r.bs.capital.find((l) => l.label === "元入金")).toMatchObject({ opening: 900_000, closing: 900_000 });
    expect(r.bs.capital.find((l) => l.label === "事業主借")?.closing).toBe(100_000);
    expect(r.bs.capital.find((l) => l.label === "青色申告特別控除前の所得金額")?.closing).toBe(793_000);
    expect(r.bs.assetTotal).toEqual({ opening: 1_200_000, closing: 2_143_000 });
    expect(r.bs.liabilityTotal).toEqual({ opening: 1_200_000, closing: 2_143_000 });
    expect(r.warnings.some((w) => w.includes("合いません"))).toBe(false);
  });

  it("所得税・住民税が経費に入っていたら知らせる", () => {
    const w = computeBlueReturn({ tb: [...tb, pl("所得税", "expense", 10_000)], deductionLimit: 650_000 }).warnings;
    expect(w.some((x) => x.includes("所得税") && x.includes("事業主貸"))).toBe(true);
  });
});

describe("記帳の誤りを知らせる", () => {
  it("期末の資産と負債・資本が合わないとき", () => {
    const off = tb.map((x) => (x.name === "普通預金" ? bs("普通預金", "asset", 900_000, 1_043_000) : x));
    expect(computeBlueReturn({ tb: off, deductionLimit: 650_000 }).warnings.some((w) => w.includes("合いません"))).toBe(true);
  });
});
