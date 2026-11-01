import { describe, it, expect } from "vitest";
import { buildDepreciationSchedule } from "./depreciation";
import { planDisposal, recordOnlyReason, type DisposalInput, type DisposalJournalPlan, type DisposalLine } from "./asset-disposal";

/** 取得100万円・定額法5年（償却率0.200）・2024年4月取得、4月始まりの期 */
const base = (o: Partial<DisposalInput> = {}): DisposalInput => ({
  type: "sale",
  kind: "sl",
  entityType: "corporation",
  entryMethod: "direct",
  acquisitionCost: 1_000_000,
  // 2026年4月期首: 100万 − 20万 × 2期
  openingBook: 600_000,
  // 2026年9月に手放した: 4月〜9月の6か月分
  depreciation: 100_000,
  salePrice: 660_000,
  saleTaxCategory: "sales_10",
  exclusive: true,
  ...o,
});

const journal = (input: DisposalInput): DisposalJournalPlan => {
  const p = planDisposal(input);
  if (p.mode !== "journal") throw new Error(`仕訳になりませんでした: ${p.reason}`);
  return p;
};

/** 行を「役割 借方/貸方 金額 税区分」の短い形にして比べる */
const short = (lines: DisposalLine[]) =>
  lines.map((l) => [l.role, l.debit ? "借" : "貸", l.debit || l.credit, l.taxCategory ?? ""].join(" "));

const balanced = (lines: DisposalLine[]) => lines.reduce((s, l) => s + l.debit - l.credit, 0) === 0;

describe("当期の償却費（償却スケジュールから）", () => {
  it("期首から手放した月までを月割りにする（1か月未満は1か月）", () => {
    const rows = buildDepreciationSchedule(
      { acquisitionDate: "2024-04-01", acquisitionCost: 1_000_000, usefulLife: 5, method: "straight_line", disposedAt: "2026-09-15" },
      [2024, 2025, 2026].map((y) => ({ start: `${y}-04-01`, end: `${y + 1}-03-31` })),
      {},
      "floor"
    );
    const row = rows.find((r) => r.start === "2026-04-01")!;
    // 9月15日に手放しても9月は1か月と数える
    expect(row).toMatchObject({ months: 6, openingBook: 600_000, booked: 100_000, closingBook: 500_000 });
  });
});

describe("売却", () => {
  it("売却益・直接法・税抜経理: 売却代金の全額を課税売上の行に、帳簿価額は不課税の行で消す", () => {
    const p = journal(base());
    expect(short(p.lines)).toEqual([
      "receipt 借 660000 ",
      "expense 借 100000 purchase_out_of_scope",
      "gain 借 500000 sales_out_of_scope",
      "asset 貸 600000 ",
      "gain 貸 600000 sales_10",
      "output_tax 貸 60000 ",
    ]);
    expect(p).toMatchObject({ bookValue: 500_000, tax: 60_000, netPrice: 600_000, gain: 100_000, loss: 0 });
    expect(balanced(p.lines)).toBe(true);
    // 簡易課税の事業区分は第四種（売却代金の行だけ）
    expect(p.lines.find((l) => l.taxCategory === "sales_10")?.businessType).toBe(4);
    expect(p.lines.filter((l) => l.businessType !== null)).toHaveLength(1);
  });

  it("売却益・間接法: 減価償却累計額（前期までの分）を取り崩し、資産は取得価額で消す", () => {
    const p = journal(base({ entryMethod: "indirect" }));
    expect(short(p.lines)).toEqual([
      "receipt 借 660000 ",
      "expense 借 100000 purchase_out_of_scope",
      "accumulated 借 400000 ",
      "gain 借 500000 sales_out_of_scope",
      "asset 貸 1000000 ",
      "gain 貸 600000 sales_10",
      "output_tax 貸 60000 ",
    ]);
    expect(p.gain).toBe(100_000);
    expect(balanced(p.lines)).toBe(true);
  });

  it("売却損: 帳簿価額が売却代金を上回る分を固定資産売却損に（売却益の残高は0）", () => {
    const p = journal(base({ salePrice: 330_000 }));
    expect(short(p.lines)).toEqual([
      "receipt 借 330000 ",
      "expense 借 100000 purchase_out_of_scope",
      "gain 借 300000 sales_out_of_scope",
      "loss 借 200000 purchase_out_of_scope",
      "asset 貸 600000 ",
      "gain 貸 300000 sales_10",
      "output_tax 貸 30000 ",
    ]);
    expect(p).toMatchObject({ gain: 0, loss: 200_000 });
    const gainBalance = p.lines.filter((l) => l.role === "gain").reduce((s, l) => s + l.credit - l.debit, 0);
    expect(gainBalance).toBe(0);
    expect(balanced(p.lines)).toBe(true);
  });

  it("売却損・間接法", () => {
    const p = journal(base({ salePrice: 330_000, entryMethod: "indirect" }));
    expect(p.lines.find((l) => l.role === "accumulated")?.debit).toBe(400_000);
    expect(p.lines.find((l) => l.role === "asset")?.credit).toBe(1_000_000);
    expect(p.loss).toBe(200_000);
    expect(balanced(p.lines)).toBe(true);
  });

  it("税込経理: 仮受消費税を立てず、売却益の行は税込（消費税は集計で金額から取り出す）", () => {
    const p = journal(base({ exclusive: false }));
    expect(p.lines.some((l) => l.role === "output_tax")).toBe(false);
    expect(p.lines.find((l) => l.role === "gain" && l.credit > 0)).toMatchObject({ credit: 660_000, taxCategory: "sales_10" });
    expect(p.gain).toBe(160_000);
    expect(balanced(p.lines)).toBe(true);
  });

  it("免税売上（輸出）は税抜経理でも消費税を取り出さない", () => {
    const p = journal(base({ saleTaxCategory: "sales_tax_free" }));
    expect(p.tax).toBe(0);
    expect(p.lines.find((l) => l.role === "gain" && l.credit > 0)).toMatchObject({ credit: 660_000, taxCategory: "sales_tax_free" });
  });

  it("売却代金が無い・選べない税区分は受け付けない", () => {
    expect(() => planDisposal(base({ salePrice: 0 }))).toThrow(/売却代金/);
    expect(() => planDisposal(base({ saleTaxCategory: "purchase_10" }))).toThrow(/税区分/);
  });

  it("一括償却資産の売却は、帳簿価額を消さずに売却代金だけを収益にする（残りの償却は続ける）", () => {
    const p = journal(base({ kind: "lump", acquisitionCost: 150_000, openingBook: 100_000, depreciation: 50_000, salePrice: 55_000 }));
    expect(short(p.lines)).toEqual(["receipt 借 55000 ", "gain 貸 50000 sales_10", "output_tax 貸 5000 "]);
    expect(p).toMatchObject({ depreciation: 0, bookValue: 0, gain: 50_000 });
  });

  it("個人事業主の売却は仕訳を作らない（譲渡所得のため）", () => {
    const p = planDisposal(base({ entityType: "individual" }));
    expect(p.mode).toBe("record_only");
  });
});

describe("除却", () => {
  it("直接法: 当期の償却費と除却損で、期首の帳簿価額を消す", () => {
    const p = journal(base({ type: "retire", salePrice: null }));
    expect(short(p.lines)).toEqual([
      "expense 借 100000 purchase_out_of_scope",
      "retire_loss 借 500000 purchase_out_of_scope",
      "asset 貸 600000 ",
    ]);
    expect(p.retireLoss).toBe(500_000);
  });

  it("間接法", () => {
    const p = journal(base({ type: "retire", entryMethod: "indirect" }));
    expect(short(p.lines)).toEqual([
      "expense 借 100000 purchase_out_of_scope",
      "accumulated 借 400000 ",
      "retire_loss 借 500000 purchase_out_of_scope",
      "asset 貸 1000000 ",
    ]);
    expect(balanced(p.lines)).toBe(true);
  });

  it("償却し終わった資産は、備忘価額の1円を除却損にする", () => {
    const p = journal(base({ type: "retire", openingBook: 1, depreciation: 0 }));
    expect(short(p.lines)).toEqual(["retire_loss 借 1 purchase_out_of_scope", "asset 貸 1 "]);
  });

  it("少額減価償却資産（償却済み）: 間接法は取得価額と累計額を消すだけ、直接法は仕訳が無い", () => {
    const indirect = journal(base({ type: "retire", kind: "immediate", acquisitionCost: 250_000, openingBook: 0, depreciation: 0, entryMethod: "indirect" }));
    expect(short(indirect.lines)).toEqual(["accumulated 借 250000 ", "asset 貸 250000 "]);
    const direct = planDisposal(base({ type: "retire", kind: "immediate", acquisitionCost: 250_000, openingBook: 0, depreciation: 0 }));
    expect(direct.mode).toBe("record_only");
  });

  it("個人事業主の家事と共用の資産: 償却費と除却損の私用分を事業主貸に", () => {
    const p = journal(base({ type: "retire", entityType: "individual", businessRatio: 60 }));
    expect(short(p.lines)).toEqual([
      "expense 借 60000 purchase_out_of_scope",
      "owner_draw 借 240000 ",
      "retire_loss 借 300000 purchase_out_of_scope",
      "asset 貸 600000 ",
    ]);
    expect(p.privatePart).toBe(240_000);
    expect(balanced(p.lines)).toBe(true);
  });

  it("法人には事業専用割合を使わない", () => {
    const p = journal(base({ type: "retire", businessRatio: 60 }));
    expect(p.lines.some((l) => l.role === "owner_draw")).toBe(false);
  });
});

describe("仕訳を作らないもの", () => {
  it("一括償却資産の除却・旧定額法・旧定率法", () => {
    expect(recordOnlyReason("retire", "lump", "corporation")).toMatch(/3年/);
    expect(recordOnlyReason("sale", "lump", "corporation")).toBeNull();
    expect(recordOnlyReason("retire", "unsupported", "corporation")).toMatch(/旧定額法/);
    expect(recordOnlyReason("sale", "sl", "individual")).toMatch(/譲渡所得/);
    expect(recordOnlyReason("retire", "sl", "individual")).toBeNull();
  });

  it("計算の食い違いは止める", () => {
    expect(() => planDisposal(base({ depreciation: 700_000 }))).toThrow(/期首の帳簿価額を超え/);
    expect(() => planDisposal(base({ openingBook: 1_200_000 }))).toThrow(/取得価額を超え/);
  });
});
