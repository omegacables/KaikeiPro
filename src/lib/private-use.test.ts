import { describe, it, expect } from "vitest";
import { buildPrivateUseAdjustment, type PrivateUseSourceLine } from "./private-use";

const line = (o: Partial<PrivateUseSourceLine> = {}): PrivateUseSourceLine => ({
  accountId: "rent",
  taxCategory: "purchase_10",
  taxRate: 0.1,
  exclusive: false,
  amount: 100000,
  ...o,
});

describe("私的利用分の按分", () => {
  it("事業割合で分け、私用分を税区分ごとに経費から減らす（税込経理）", () => {
    const r = buildPrivateUseAdjustment(
      [line(), line({ amount: 50000 }), line({ taxCategory: "purchase_exempt", taxRate: 0, amount: 20000 })],
      { rent: 40 }
    );
    expect(r.groups).toEqual([
      { accountId: "rent", taxCategory: "purchase_10", exclusive: false, ratio: 40, total: 150000, business: 60000, private: 90000, privateTax: 0 },
      { accountId: "rent", taxCategory: "purchase_exempt", exclusive: false, ratio: 40, total: 20000, business: 8000, private: 12000, privateTax: 0 },
    ]);
    expect(r).toMatchObject({ transfer: 102000, inputTax: 0 });
  });

  it("税抜経理の仕訳から来た分は、私用分の消費税も仮払消費税から減らす", () => {
    const r = buildPrivateUseAdjustment([line({ exclusive: true, amount: 33333 })], { rent: 30 });
    // 事業分 9,999.9 → 10,000、私用分 23,333、その消費税 2,333
    expect(r.groups[0]).toMatchObject({ business: 10000, private: 23333, privateTax: 2333 });
    expect(r).toMatchObject({ transfer: 25666, inputTax: 2333 });
  });

  it("税抜経理と税込経理の仕訳は分けて扱う", () => {
    const r = buildPrivateUseAdjustment([line({ exclusive: true }), line({ exclusive: false })], { rent: 50 });
    expect(r.groups.map((g) => [g.exclusive, g.private, g.privateTax])).toEqual([
      [true, 50000, 5000],
      [false, 50000, 0],
    ]);
  });

  it("割合を決めていない科目・事業100%・合計が0以下は振り替えない", () => {
    const r = buildPrivateUseAdjustment(
      [line({ accountId: "other" }), line({ accountId: "car" }), line({ accountId: "phone", amount: -100 })],
      { car: 100, phone: 50 }
    );
    expect(r.groups).toEqual([]);
    expect(r.transfer).toBe(0);
  });

  it("返金などの貸方も差し引いて合計する", () => {
    const r = buildPrivateUseAdjustment([line({ amount: 120000 }), line({ amount: -20000 })], { rent: 70 });
    expect(r.groups[0]).toMatchObject({ total: 100000, business: 70000, private: 30000 });
  });
});
