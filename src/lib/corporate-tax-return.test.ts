import { describe, it, expect } from "vitest";
import {
  computeCorporateTaxReturn,
  perCapitaTax,
  defenseTaxApplies,
  STANDARD_LOCAL_RATES,
  type CorporateInput,
  type CorporateTaxReturn,
} from "./corporate-tax-return";

const input = (o: Partial<CorporateInput> = {}): CorporateInput => ({
  period: { start: "2025-04-01", end: "2026-03-31", months: 12 },
  capital: 10_000_000,
  employees: 5,
  netIncome: 0,
  taxExpenseBooked: 0,
  entertainment: 0,
  entertainmentDining: null,
  depreciation: { excess: 0, allowed: 0, openingExcess: 0, closingExcess: 0 },
  withholdingTax: 0,
  adjustments: [],
  losses: [],
  interim: { corporate: 0, localCorporate: 0, prefectural: 0, municipal: 0, enterprise: 0 },
  openingRetained: [],
  retainedEarnings: { opening: 0, closingBeforeIncome: 0 },
  priorEnterpriseTaxPaid: 0,
  localRates: STANDARD_LOCAL_RATES,
  ...o,
});

const val = (r: CorporateTaxReturn, table: string, no: string, col = 0) =>
  r.tables.find((t) => t.key === table)!.rows.find((x) => x.no === no)!.values[col];

describe("法人税（別表一）", () => {
  it("国税庁の設例: 所得688,750円 → 1,000円未満を切り捨てて15% = 103,200円", () => {
    const r = computeCorporateTaxReturn(input({ netIncome: 688_750 }));
    expect(val(r, "beppyo1", "1")).toBe(688_750);
    expect(val(r, "beppyo1", "74")).toBe(688_000);
    expect(val(r, "beppyo1", "2")).toBe(103_200);
  });

  it("中小法人は年800万円以下15%、超える部分23.2%。地方法人税は10.3%", () => {
    const r = computeCorporateTaxReturn(input({ netIncome: 10_000_000 }));
    expect(val(r, "beppyo1", "77")).toBe(1_200_000);
    expect(val(r, "beppyo1", "79")).toBe(464_000);
    expect(val(r, "beppyo1", "13")).toBe(1_664_000);
    // 1,664,000 × 10.3% = 171,392 → 100円未満切り捨て 171,300
    expect(val(r, "beppyo1", "31")).toBe(171_392);
    expect(val(r, "beppyo1", "38")).toBe(171_300);
  });

  it("資本金1億円超は全額23.2%", () => {
    const r = computeCorporateTaxReturn(input({ netIncome: 10_000_000, capital: 200_000_000 }));
    expect(r.isSme).toBe(false);
    expect(val(r, "beppyo1", "2")).toBe(2_320_000);
  });

  it("1年未満の事業年度は800万円を月割りする", () => {
    const r = computeCorporateTaxReturn(input({ netIncome: 5_000_000, period: { start: "2025-04-01", end: "2025-09-30", months: 6 } }));
    expect(val(r, "beppyo1", "74")).toBe(4_000_000);
    expect(val(r, "beppyo1", "2")).toBe(600_000 + 232_000);
  });

  it("所得税額を控除し、中間納付を差し引く（多ければ還付）", () => {
    const r = computeCorporateTaxReturn(
      input({ netIncome: 1_000_000, withholdingTax: 10_000, interim: { corporate: 200_000, localCorporate: 0, prefectural: 0, municipal: 0, enterprise: 0 } })
    );
    // 所得 1,000,000 + 所得税 10,000（別表四で加算）= 1,010,000 → 15% = 151,500 − 10,000 = 141,500
    expect(val(r, "beppyo1", "1")).toBe(1_010_000);
    expect(val(r, "beppyo1", "13")).toBe(141_500);
    expect(val(r, "beppyo1", "22")).toBe(58_500);
    expect(r.taxes.corporate).toBe(-58_500);
  });
});

describe("防衛特別法人税", () => {
  it("2026年4月1日以後に開始する事業年度から。（法人税額 − 500万円）× 4%", () => {
    expect(defenseTaxApplies("2026-03-31")).toBe(false);
    expect(defenseTaxApplies("2026-04-01")).toBe(true);
    const r = computeCorporateTaxReturn(input({ netIncome: 30_000_000, period: { start: "2026-04-01", end: "2027-03-31", months: 12 } }));
    // 法人税額 1,200,000 + 22,000,000×23.2% = 6,304,000 → 6,304,000 − 5,000,000 = 1,304,000 × 4% = 52,160 → 52,100
    expect(val(r, "beppyo1-defense", "67")).toBe(1_304_000);
    expect(val(r, "beppyo1-defense", "57")).toBe(52_100);
  });

  it("法人税額が500万円以下なら0円（申告は必要）", () => {
    const r = computeCorporateTaxReturn(input({ netIncome: 10_000_000, period: { start: "2026-04-01", end: "2027-03-31", months: 12 } }));
    expect(r.taxes.defense).toBe(0);
  });
});

describe("別表四・別表七(一)・別表十五", () => {
  it("交際費は年800万円を超えた分を加算する（社外流出）", () => {
    const r = computeCorporateTaxReturn(input({ netIncome: 1_000_000, entertainment: 9_000_000 }));
    expect(val(r, "beppyo15", "5")).toBe(1_000_000);
    expect(val(r, "beppyo4", "8", 2)).toBe(1_000_000);
    expect(r.income).toBe(2_000_000);
  });

  it("接待飲食費の50%の方が大きければそちらを限度にする", () => {
    const r = computeCorporateTaxReturn(input({ entertainment: 20_000_000, entertainmentDining: 18_000_000 }));
    expect(val(r, "beppyo15", "4")).toBe(9_000_000);
    expect(val(r, "beppyo15", "5")).toBe(11_000_000);
  });

  it("減価償却の超過額は加算、認容額は減算（留保）", () => {
    const r = computeCorporateTaxReturn(input({ netIncome: 1_000_000, depreciation: { excess: 70_000, allowed: 20_000, openingExcess: 20_000, closingExcess: 70_000 } }));
    expect(val(r, "beppyo4", "6", 1)).toBe(70_000);
    expect(val(r, "beppyo4", "12", 1)).toBe(20_000);
    expect(r.income).toBe(1_050_000);
  });

  it("繰越欠損金は古い順に、中小法人は所得の100%まで控除する", () => {
    const r = computeCorporateTaxReturn(
      input({
        netIncome: 2_000_000,
        losses: [
          { periodEnd: "2024-03-31", amount: 1_500_000 },
          { periodEnd: "2023-03-31", amount: 1_000_000 },
        ],
      })
    );
    expect(r.income).toBe(0);
    expect(r.nextLosses).toEqual([{ periodEnd: "2024-03-31", amount: 500_000 }]);
  });

  it("期限切れの欠損金は控除しない", () => {
    const r = computeCorporateTaxReturn(input({ netIncome: 1_000_000, losses: [{ periodEnd: "2015-03-31", amount: 5_000_000 }] }));
    expect(r.income).toBe(1_000_000);
    expect(r.warnings.some((w) => w.includes("繰越期限"))).toBe(true);
  });

  it("赤字なら当期の欠損金を翌期へ繰り越す", () => {
    const r = computeCorporateTaxReturn(input({ netIncome: -3_000_000 }));
    expect(r.income).toBe(-3_000_000);
    expect(r.nextLosses).toEqual([{ periodEnd: "2026-03-31", amount: 3_000_000 }]);
    expect(r.taxes.corporate).toBe(0);
  });
});

describe("地方税（標準税率）", () => {
  it("法人住民税: 法人税割は法人税額 × 1.0%・6.0%、均等割は資本金・従業者数で決まる", () => {
    const r = computeCorporateTaxReturn(input({ netIncome: 10_000_000 }));
    // 法人税額計 1,664,000 → 道府県 16,640 → 16,600、市町村 99,840 → 99,800
    expect(val(r, "local-resident", "⑬・⑫", 0)).toBe(16_600);
    expect(val(r, "local-resident", "⑬・⑫", 1)).toBe(99_800);
    expect(val(r, "local-resident", "⑱・⑰", 0)).toBe(20_000);
    expect(val(r, "local-resident", "⑱・⑰", 1)).toBe(50_000);
  });

  it("均等割の年額表", () => {
    expect(perCapitaTax(10_000_000, 50)).toEqual({ prefectural: 20_000, municipal: 50_000 });
    expect(perCapitaTax(10_000_001, 51)).toEqual({ prefectural: 50_000, municipal: 150_000 });
    expect(perCapitaTax(100_000_001, 10)).toEqual({ prefectural: 130_000, municipal: 160_000 });
  });

  it("赤字でも均等割はかかり、1年未満は月割り", () => {
    const r = computeCorporateTaxReturn(input({ netIncome: -1, period: { start: "2025-04-01", end: "2025-09-30", months: 6 } }));
    expect(r.taxes.prefectural).toBe(10_000);
    expect(r.taxes.municipal).toBe(25_000);
  });

  it("法人事業税は 3.5%・5.3%・7.0%、特別法人事業税は所得割 × 37%", () => {
    const r = computeCorporateTaxReturn(input({ netIncome: 10_000_000 }));
    // 400万×3.5% 140,000 + 400万×5.3% 212,000 + 200万×7.0% 140,000 = 492,000
    expect(val(r, "local-enterprise", "㊹", 2)).toBe(492_000);
    // 492,000 × 37% = 182,040 → 182,000
    expect(r.taxes.specialEnterprise).toBe(182_000);
  });

  it("軽減税率不適用法人は全額7.0%", () => {
    const r = computeCorporateTaxReturn(input({ netIncome: 10_000_000, localRates: { ...STANDARD_LOCAL_RATES, reducedRateExcluded: true } }));
    expect(val(r, "local-enterprise", "㊹", 2)).toBe(700_000);
  });
});

describe("別表五(一) 利益積立金の検算", () => {
  it("期首の納税充当金・未納税額と法人税等の計上が合っていれば検算が一致する", () => {
    // 当期: 税引前利益 10,000,000、中間納付なし。決算で当期の税額を納税充当金に計上した後の当期利益
    const pre = computeCorporateTaxReturn(input({ netIncome: 10_000_000 }));
    const provision = pre.totalTaxForPeriod;
    const r = computeCorporateTaxReturn(
      input({
        netIncome: 10_000_000 - provision,
        taxExpenseBooked: provision,
        openingRetained: [
          { name: "納税充当金", amount: 300_000 },
          { name: "未納法人税等", amount: -200_000 },
          { name: "未納道府県民税", amount: -20_000 },
          { name: "未納市町村民税", amount: -50_000 },
        ],
        priorEnterpriseTaxPaid: 30_000,
        retainedEarnings: { opening: 5_000_000, closingBeforeIncome: 5_000_000 },
      })
    );
    // 納税充当金の繰入を加算するので、所得は税引前と同じ（事業税の減算30,000円を除く）
    expect(r.income).toBe(10_000_000 - 30_000);
    expect(r.warnings.filter((w) => w.includes("検算"))).toEqual([]);
  });

  it("期首の納税充当金で足りない前期分の住民税は、当期の経費で払ったものとして加算し、検算も合う", () => {
    // 前期に納税充当金を計上していない会社: 前期分の均等割 70,000円を当期に租税公課で納付
    const r = computeCorporateTaxReturn(
      input({
        netIncome: 930_000, // 租税公課 70,000円を差し引いた後
        openingRetained: [
          { name: "未納道府県民税", amount: -20_000 },
          { name: "未納市町村民税", amount: -50_000 },
        ],
      })
    );
    expect(val(r, "beppyo4", "2・3", 1)).toBe(70_000);
    expect(r.income).toBe(1_000_000);
    expect(r.warnings.filter((w) => w.includes("検算"))).toEqual([]);
  });
});
