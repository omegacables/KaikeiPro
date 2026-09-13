import { describe, it, expect } from "vitest";
import {
  normalizeTaxCategory,
  normalizeTaxRate,
  taxFromGross,
  taxCategoryInfo,
  TAX_CATEGORY_LIST,
} from "./tax-category";

describe("税率の持ち方を揃える", () => {
  it("小数でもパーセントでも同じ値になる", () => {
    expect(normalizeTaxRate(0.1)).toBe(0.1);
    expect(normalizeTaxRate(10)).toBe(0.1);
    expect(normalizeTaxRate(0.08)).toBe(0.08);
    expect(normalizeTaxRate(8)).toBe(0.08);
  });

  it("0 と 未設定 を区別する", () => {
    expect(normalizeTaxRate(0)).toBe(0);
    expect(normalizeTaxRate(null)).toBeNull();
    expect(normalizeTaxRate(undefined)).toBeNull();
  });

  it("読み取れない税率は判断しない", () => {
    expect(normalizeTaxRate(5)).toBeNull();
  });
});

describe("税区分の読み替え", () => {
  it("費用・収益以外の行には税区分を持たせない", () => {
    // 1,100円の買い物で 消耗品費／仮払消費税／現金 の3行すべてに
    // purchase_10 が付いていた。このまま足すと三重計上になる
    expect(normalizeTaxCategory("purchase_10", "assets", 0.1)).toBeNull();
    expect(normalizeTaxCategory("purchase_10", "liabilities", 0.1)).toBeNull();
    expect(normalizeTaxCategory("purchase_10", "equity", 0.1)).toBeNull();
    expect(normalizeTaxCategory("purchase_10", "expenses", 0.1)).toBe("purchase_10");
  });

  it("既に正しいコードはそのまま通す", () => {
    for (const c of TAX_CATEGORY_LIST) {
      const accountType = c.side === "sales" ? "revenue" : "expenses";
      expect(normalizeTaxCategory(c.code, accountType, c.rate)).toBe(c.code);
    }
  });

  it("意味を持たない表記は税区分なしにする", () => {
    for (const v of ["none", "なし", "no_tax", "not_applicable", "n/a", "不明"]) {
      expect(normalizeTaxCategory(v, "expenses", 0)).toBeNull();
    }
  });

  it("売上は税率から課税区分を決める（パーセント表記も拾う）", () => {
    expect(normalizeTaxCategory("taxable_sales", "revenue", 10)).toBe("sales_10");
    expect(normalizeTaxCategory("課税売上", "revenue", 0.08)).toBe("sales_08_reduced");
  });

  it("軽減税率の仕入れを 8% の区分に寄せる", () => {
    expect(normalizeTaxCategory("purchase_8", "expenses", 0.08)).toBe("purchase_08_reduced");
  });

  it("経過措置は割合を読み取って対応する区分にする", () => {
    expect(normalizeTaxCategory("purchase_10_80", "expenses", 0.1)).toBe("purchase_10_trans_80");
    expect(normalizeTaxCategory("purchase_80_percent_deductible", "expenses", 0.1)).toBe(
      "purchase_10_trans_80"
    );
    expect(normalizeTaxCategory("経過措置70", "expenses", 0.08)).toBe("purchase_08_trans_70");
  });

  it("非課税・不課税の仕入れを区別する", () => {
    expect(normalizeTaxCategory("non_taxable_purchase", "expenses", 0)).toBe("purchase_out_of_scope");
    expect(normalizeTaxCategory("purchase_non_taxable", "expenses", 0)).toBe("purchase_out_of_scope");
    expect(normalizeTaxCategory("exempt", "expenses", 0)).toBe("purchase_exempt");
  });

  it("判断できないものは課税取引に寄せない（納税額が変わるため）", () => {
    expect(normalizeTaxCategory("よく分からない何か", "expenses", null)).toBeNull();
    expect(normalizeTaxCategory("", "expenses", 0.1)).toBeNull();
    expect(normalizeTaxCategory(null, "expenses", 0.1)).toBeNull();
  });

  it("読み替えた結果は必ずマスタに存在する", () => {
    const samples: [string, "expenses" | "revenue", number][] = [
      ["purchase_10", "expenses", 0.1],
      ["purchase_10_80", "expenses", 0.1],
      ["purchase_8", "expenses", 0.08],
      ["taxable_sales", "revenue", 10],
      ["non_taxable_purchase", "expenses", 0],
      ["purchase_80_percent_deductible", "expenses", 0.1],
    ];
    for (const [raw, type, rate] of samples) {
      const code = normalizeTaxCategory(raw, type, rate);
      expect(code, `${raw} が読み替えられない`).not.toBeNull();
      expect(taxCategoryInfo(code), `${code} がマスタに無い`).not.toBeNull();
    }
  });
});

describe("税込金額からの消費税額", () => {
  it("1円未満は切り捨てる", () => {
    expect(taxFromGross(1100, 0.1)).toBe(100);
    expect(taxFromGross(1080, 0.08)).toBe(80);
    expect(taxFromGross(999, 0.1)).toBe(90); // 90.8... → 90
  });

  it("0円は0円", () => {
    expect(taxFromGross(0, 0.1)).toBe(0);
  });
});
