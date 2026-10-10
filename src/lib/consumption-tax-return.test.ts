import { describe, it, expect } from "vitest";
import {
  transitionStackedTax,
  aggregateReturnInput,
  computeConsumptionTaxReturn,
  special20Eligible,
  type ReturnInput,
  type ReturnSettings,
  type ConsumptionTaxReturn,
} from "./consumption-tax-return";
import type { TaxBookLine } from "./tax-book";

const input = (o: Partial<ReturnInput> = {}): ReturnInput => ({
  sales: { A: 0, B: 0 },
  taxFree: 0,
  exempt: 0,
  purchaseGross: { A: 0, B: 0 },
  purchaseTax: { A: 0, B: 0 },
  transition: [],
  badDebt: { A: 0, B: 0 },
  uncategorized: 0,
  ...o,
});

const settings = (o: Partial<ReturnSettings> = {}): ReturnSettings => ({
  method: "standard",
  purchaseTaxCalc: "proportional",
  businessType: null,
  interimNational: 0,
  interimLocal: 0,
  periodMonths: 12,
  ...o,
});

/** 表の欄の値 */
const cell = (r: ConsumptionTaxReturn, table: string, no: string) => {
  const row = r.tables.find((t) => t.key === table)!.rows.find((x) => x.no === no)!;
  return row;
};

describe("課税標準額と消費税額（国税庁の設例）", () => {
  it("税率ごとに税抜きに戻し、千円未満を切り捨てて 6.24% を掛ける", () => {
    // 軽減税率の課税売上（税込）203,878,000 × 100/108 = 188,775,925 → 188,775,000 → × 6.24% = 11,779,560
    const r = computeConsumptionTaxReturn(input({ sales: { A: 203_878_000, B: 0 } }), settings());
    expect(cell(r, "fuhyo1-3", "①-1")).toMatchObject({ a: 188_775_925 });
    expect(cell(r, "fuhyo1-3", "①")).toMatchObject({ a: 188_775_000 });
    expect(cell(r, "fuhyo1-3", "②")).toMatchObject({ a: 11_779_560 });
  });

  it("課税標準額は合計してからではなく、税率ごとに千円未満を切り捨てる", () => {
    const r = computeConsumptionTaxReturn(input({ sales: { A: 1_080_999, B: 1_100_999 } }), settings());
    // A: 1,000,925 → 1,000,000、B: 1,000,908 → 1,000,000（合計 2,001,833 を切り捨てると 2,001,000 になる）
    expect(cell(r, "fuhyo1-3", "①")).toMatchObject({ a: 1_000_000, b: 1_000_000, c: 2_000_000 });
  });

  it("貸倒れに係る税額は 税込 × 7.8/110", () => {
    const r = computeConsumptionTaxReturn(input({ badDebt: { A: 0, B: 1_230_000 } }), settings());
    expect(cell(r, "first", "⑥").c).toBe(87_218);
  });
});

describe("差引税額と地方消費税", () => {
  it("差引税額は百円未満切り捨て、地方消費税は ×22/78 を百円未満切り捨て", () => {
    // 課税売上 11,000,000（税込10%）→ 課税標準額 10,000,000 → 消費税額 780,000
    // 仕入 5,500,000（割戻し）→ 5,500,000 × 7.8/110 = 390,000 → 差引 390,000
    const r = computeConsumptionTaxReturn(
      input({ sales: { A: 0, B: 11_000_000 }, purchaseGross: { A: 0, B: 5_500_123 } }),
      settings()
    );
    // 5,500,123 × 7.8/110 = 390,008.7 → 390,008 → 差引 389,992 → 389,900
    expect(cell(r, "first", "④").c).toBe(390_008);
    expect(cell(r, "first", "⑨").c).toBe(389_900);
    // 389,900 × 22/78 = 109,971.7 → 109,900
    expect(cell(r, "first", "⑳").c).toBe(109_900);
    expect(r).toMatchObject({ national: 389_900, local: 109_900, total: 499_800 });
  });

  it("仕入税額の方が多ければ控除不足還付税額（1円単位）と譲渡割額の還付額", () => {
    const r = computeConsumptionTaxReturn(
      input({ sales: { A: 0, B: 1_100_000 }, purchaseGross: { A: 0, B: 3_300_000 } }),
      settings()
    );
    // 消費税額 78,000、仕入 234,000 → 還付 156,000、地方 156,000 × 22/78 = 44,000
    expect(cell(r, "first", "⑧").c).toBe(156_000);
    expect(cell(r, "first", "⑨").c).toBe(0);
    expect(cell(r, "first", "⑲").c).toBe(44_000);
    expect(r.total).toBe(-200_000);
  });

  it("中間納付税額を差し引き、多く納めていれば中間納付還付税額", () => {
    const base = input({ sales: { A: 0, B: 11_000_000 } }); // 差引税額 780,000、地方 220,000
    const pay = computeConsumptionTaxReturn(base, settings({ interimNational: 300_000, interimLocal: 84_600 }));
    expect(cell(pay, "first", "⑪").c).toBe(480_000);
    expect(cell(pay, "first", "㉒").c).toBe(135_400);
    const refund = computeConsumptionTaxReturn(base, settings({ interimNational: 900_000, interimLocal: 300_000 }));
    expect(cell(refund, "first", "⑫").c).toBe(120_000);
    expect(cell(refund, "first", "㉓").c).toBe(80_000);
    expect(refund.total).toBe(-200_000);
  });
});

describe("仕入税額（本則課税）", () => {
  it("積上げ計算は帳簿の消費税額 × 78/100、割戻し計算は 税込 × 7.8/110", () => {
    const i = input({ sales: { A: 0, B: 11_000_000 }, purchaseGross: { A: 108_000, B: 1_100_000 }, purchaseTax: { A: 8_000, B: 100_003 } });
    const stacked = computeConsumptionTaxReturn(i, settings({ purchaseTaxCalc: "stacked" }));
    expect(cell(stacked, "fuhyo2-3", "⑩")).toMatchObject({ a: 6_240, b: 78_002 });
    const prop = computeConsumptionTaxReturn(i, settings({ purchaseTaxCalc: "proportional" }));
    expect(cell(prop, "fuhyo2-3", "⑩")).toMatchObject({ a: 6_240, b: 78_000 });
  });

  it("経過措置（適格請求書発行事業者以外からの仕入れ）は控除できる割合を掛ける", () => {
    // 設例: (21,600,000 − 2,160,000) × 6.24/108 = 1,123,200 → × 80% = 898,560
    const r = computeConsumptionTaxReturn(
      input({ sales: { A: 0, B: 110_000_000 }, transition: [{ col: "A", rate: 0.8, gross: 19_440_000, tax: 1_440_000 }] }),
      settings()
    );
    expect(cell(r, "fuhyo2-3", "⑫")).toMatchObject({ a: 898_560 });
  });

  it("積上げ計算では、経過措置の分も取引ごとに 支払対価×7.8/110×80% を切り捨てて合計する", () => {
    // 1,100円の仕入れ3件: 1件ごと 1,100×7.8/110×80% = 62.4 → 62円 ×3 = 186円（まとめて計算すると 187円）
    expect(transitionStackedTax(1_100, "B", 0.8)).toBe(62);
    expect(transitionStackedTax(1_080, "A", 0.8)).toBe(49); // 1,080×6.24/108×80% = 49.92
    const t = { col: "B" as const, rate: 0.8, gross: 3_300, tax: 300, stackedTax: 186 };
    const stacked = computeConsumptionTaxReturn(input({ sales: { A: 0, B: 1_100_000 }, transition: [t] }), settings({ purchaseTaxCalc: "stacked" }));
    expect(cell(stacked, "fuhyo2-3", "⑫")).toMatchObject({ b: 186 });
    const prop = computeConsumptionTaxReturn(input({ sales: { A: 0, B: 1_100_000 }, transition: [t] }), settings({ purchaseTaxCalc: "proportional" }));
    expect(cell(prop, "fuhyo2-3", "⑫")).toMatchObject({ b: 187 });
  });

  it("課税売上割合が95%未満なら一括比例配分方式", () => {
    // 課税売上（税抜）9,000,000、非課税売上 1,000,000 → 90%
    const r = computeConsumptionTaxReturn(
      input({ sales: { A: 0, B: 9_900_000 }, exempt: 1_000_000, purchaseGross: { A: 0, B: 1_100_000 } }),
      settings()
    );
    expect(r.deductionMethod).toBe("proportional");
    expect(cell(r, "fuhyo2-3", "⑧").c).toBe(90);
    expect(cell(r, "fuhyo2-3", "㉖")).toMatchObject({ b: 70_200 }); // 78,000 × 90%
    expect(r.warnings.some((w) => w.includes("95%未満"))).toBe(true);
  });

  it("課税売上割合が95%以上なら全額控除", () => {
    const r = computeConsumptionTaxReturn(
      input({ sales: { A: 0, B: 10_450_000 }, exempt: 400_000, purchaseGross: { A: 0, B: 1_100_000 } }),
      settings()
    );
    expect(r.deductionMethod).toBe("full");
    expect(cell(r, "fuhyo2-3", "㉖")).toMatchObject({ b: 78_000 });
  });
});

describe("簡易課税", () => {
  it("消費税額 × みなし仕入率を控除する", () => {
    // 第5種（50%）: 消費税額 780,000 × 50% = 390,000
    const r = computeConsumptionTaxReturn(
      input({ sales: { A: 0, B: 11_000_000 }, purchaseGross: { A: 0, B: 9_999_999 } }),
      settings({ method: "simplified", businessType: 5 })
    );
    expect(cell(r, "fuhyo5-3", "⑤")).toMatchObject({ b: 390_000 });
    expect(cell(r, "first", "⑨").c).toBe(390_000);
    expect(r.tables.map((t) => t.key)).toEqual(["first", "second", "fuhyo4-3", "fuhyo5-3"]);
  });
});

describe("2割特例", () => {
  it("消費税額の80%を控除する（国税庁の設例の売上）", () => {
    // 6,609,330 × 100/110 = 6,008,481 → 6,008,000 → × 7.8% = 468,624 → × 80% = 374,899
    const r = computeConsumptionTaxReturn(input({ sales: { A: 0, B: 6_609_330 } }), settings({ method: "special_20" }));
    expect(cell(r, "fuhyo6", "②")).toMatchObject({ b: 6_008_000 });
    expect(cell(r, "fuhyo6", "③")).toMatchObject({ b: 468_624 });
    expect(cell(r, "fuhyo6", "⑦")).toMatchObject({ b: 374_899 });
    // 差引 93,725 → 93,700、地方 93,700 × 22/78 = 26,428 → 26,400
    expect(cell(r, "first", "⑨").c).toBe(93_700);
    expect(cell(r, "first", "⑳").c).toBe(26_400);
  });

  it("令和5年10月1日〜令和8年9月30日の日を含む課税期間だけ", () => {
    expect(special20Eligible({ start: "2026-04-01", end: "2027-03-31" })).toBe(true);
    expect(special20Eligible({ start: "2026-10-01", end: "2027-09-30" })).toBe(false);
    expect(special20Eligible({ start: "2022-10-01", end: "2023-09-30" })).toBe(false);
  });
});

describe("仕訳の行の集計", () => {
  const line = (o: Partial<TaxBookLine>): TaxBookLine => ({
    accountType: "revenue",
    taxCategory: "sales_10",
    taxRate: null,
    debit: 0,
    credit: 0,
    needsReview: false,
    exclusive: false,
    ...o,
  });

  it("税率・区分ごとに税込で集計する（税抜経理は税額を足して税込に）", () => {
    const r = aggregateReturnInput([
      line({ credit: 110_000 }),
      line({ credit: 100_000, exclusive: true, recordedTax: 10_000 }),
      line({ debit: 11_000 }), // 返品は差し引く
      line({ taxCategory: "sales_08_reduced", credit: 10_800 }),
      line({ taxCategory: "sales_exempt", credit: 50_000 }),
      line({ taxCategory: "sales_tax_free", credit: 30_000 }),
      line({ accountType: "expenses", taxCategory: "purchase_10", debit: 33_000 }),
      line({ accountType: "expenses", taxCategory: "purchase_10_trans_80", debit: 11_000 }),
      line({ accountType: "expenses", taxCategory: "purchase_out_of_scope", debit: 5_000 }),
      line({ accountType: "expenses", taxCategory: "bad_debt_10", debit: 22_000 }),
      line({ accountType: "expenses", taxCategory: null, debit: 1_000 }),
      line({ credit: 999_999, needsReview: true }),
    ]);
    expect(r.sales).toEqual({ A: 10_800, B: 209_000 });
    expect(r).toMatchObject({ exempt: 50_000, taxFree: 30_000, uncategorized: 1 });
    expect(r.purchaseGross).toEqual({ A: 0, B: 33_000 });
    expect(r.purchaseTax).toEqual({ A: 0, B: 3_000 });
    expect(r.transition).toEqual([{ col: "B", rate: 0.8, gross: 11_000, tax: 1_000, stackedTax: 624 }]);
    expect(r.badDebt).toEqual({ A: 0, B: 22_000 });
  });
});

describe("個別対応方式", () => {
  const g = (gross: number) => ({ gross: { A: 0, B: gross }, tax: { A: 0, B: Math.floor((gross * 10) / 110) }, transition: [] });
  it("課税売上げにのみ要するものは全額、共通は課税売上割合、非課税売上げにのみ要するものは控除しない", () => {
    const r = computeConsumptionTaxReturn(
      input({
        sales: { A: 0, B: 9_900_000 },
        exempt: 1_000_000,
        purchaseGross: { A: 0, B: 3_300_000 },
        purchaseTax: { A: 0, B: 300_000 },
        purchaseByUse: { taxable: g(1_100_000), common: g(1_100_000), non_taxable: g(1_100_000) },
        unclassifiedPurchases: 0,
      }),
      settings({ deductionMethod: "individual" })
    );
    expect(r.deductionMethod).toBe("individual");
    // 78,000 + 78,000 × 90% = 148,200
    expect(cell(r, "fuhyo2-3", "⑲")).toMatchObject({ b: 78_000 });
    expect(cell(r, "fuhyo2-3", "⑳")).toMatchObject({ b: 78_000 });
    expect(cell(r, "fuhyo2-3", "㉖")).toMatchObject({ b: 148_200 });
  });

  it("95%以上なら個別対応方式を選んでいても全額控除", () => {
    const r = computeConsumptionTaxReturn(
      input({ sales: { A: 0, B: 11_000_000 }, purchaseGross: { A: 0, B: 1_100_000 }, purchaseByUse: { taxable: g(0), common: g(1_100_000), non_taxable: g(0) } }),
      settings({ deductionMethod: "individual" })
    );
    expect(r.deductionMethod).toBe("full");
  });
});

describe("簡易課税（事業区分が2つ以上）", () => {
  it("1種類の事業で売上の75%以上なら、その区分のみなし仕入率を全体に使う（有利なら）", () => {
    const r = computeConsumptionTaxReturn(
      input({ sales: { A: 0, B: 11_000_000 }, salesByType: { 1: { A: 0, B: 8_800_000 }, 5: { A: 0, B: 2_200_000 } } }),
      settings({ method: "simplified", businessType: 5 })
    );
    // 消費税額 780,000。原則計算は (624,000×90% + 156,000×50%) = 639,600、特例（第1種80%）は 780,000×90% = 702,000
    expect(cell(r, "fuhyo5-3", "㊲")).toMatchObject({ b: 702_000 });
    expect(cell(r, "fuhyo5-3", "㊲").label).toContain("第1種で75%以上");
  });

  it("75%に届かなければ原則計算（加重平均）", () => {
    const r = computeConsumptionTaxReturn(
      input({ sales: { A: 0, B: 11_000_000 }, salesByType: { 1: { A: 0, B: 5_500_000 }, 5: { A: 0, B: 3_300_000 }, 6: { A: 0, B: 2_200_000 } } }),
      settings({ method: "simplified", businessType: 5 })
    );
    // 第1種 390,000×90 + 第5種 234,000×50 + 第6種 156,000×40 = 351,000+117,000+62,400 = 530,400
    // 2種類で75%以上（第1種＋第5種＝80%）: 390,000×90% + (780,000−390,000)×50% = 351,000+195,000 = 546,000 → 有利
    expect(cell(r, "fuhyo5-3", "㊲")).toMatchObject({ b: 546_000 });
  });

  it("区分の無い売上は設定の事業区分として扱う", () => {
    const r = computeConsumptionTaxReturn(
      input({ sales: { A: 0, B: 11_000_000 }, salesByType: { 0: { A: 0, B: 11_000_000 } } }),
      settings({ method: "simplified", businessType: 2 })
    );
    expect(cell(r, "fuhyo5-3", "⑤")).toMatchObject({ b: 624_000 });
  });
});

