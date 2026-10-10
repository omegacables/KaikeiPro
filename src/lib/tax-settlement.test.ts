import { describe, it, expect } from "vitest";
import { corporateTaxEntry, consumptionTaxEntry } from "./tax-settlement";

const sum = (e: ReturnType<typeof corporateTaxEntry>) =>
  "lines" in e ? [e.lines.reduce((s, l) => s + l.debit, 0), e.lines.reduce((s, l) => s + l.credit, 0)] : null;

describe("法人税等の計上", () => {
  it("確定分を未払法人税等に、仮払法人税等は取り崩す", () => {
    const e = corporateTaxEntry(1_000_000, 300_000, 300_000);
    expect(e).toEqual({
      lines: [
        { account: "法人税、住民税及び事業税", debit: 1_000_000, credit: 0 },
        { account: "仮払法人税等", debit: 0, credit: 300_000 },
        { account: "未払法人税等", debit: 0, credit: 700_000 },
      ],
    });
  });

  it("中間納付を費用で記帳していれば、確定分だけ計上する", () => {
    const e = corporateTaxEntry(1_000_000, 300_000, 0);
    expect(sum(e)).toEqual([700_000, 700_000]);
  });

  it("還付になるときは作らない", () => {
    expect(corporateTaxEntry(100_000, 300_000, 300_000)).toHaveProperty("error");
  });
});

describe("消費税の計上", () => {
  it("税抜経理: 仮受と仮払を相殺し、納付額を未払消費税等に。差額は雑収入", () => {
    const e = consumptionTaxEntry(499_800, 1_000_000, 500_123);
    expect(e).toEqual({
      lines: [
        { account: "仮受消費税", debit: 1_000_000, credit: 0 },
        { account: "仮払消費税", debit: 0, credit: 500_123 },
        { account: "未払消費税等", debit: 0, credit: 499_800 },
        { account: "雑収入", debit: 0, credit: 77 },
      ],
    });
  });

  it("税抜経理で差額が損なら租税公課", () => {
    const e = consumptionTaxEntry(500_100, 1_000_000, 500_000);
    expect("lines" in e && e.lines.at(-1)).toEqual({ account: "租税公課", debit: 100, credit: 0 });
    expect(sum(e)).toEqual([1_000_100, 1_000_100]);
  });

  it("税込経理: 租税公課で計上", () => {
    expect(consumptionTaxEntry(250_000, 0, 0)).toEqual({
      lines: [
        { account: "租税公課", debit: 250_000, credit: 0 },
        { account: "未払消費税等", debit: 0, credit: 250_000 },
      ],
    });
  });

  it("還付になるときは作らない", () => {
    expect(consumptionTaxEntry(-81_408, 0, 81_408)).toHaveProperty("error");
  });
});
