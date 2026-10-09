import { describe, it, expect } from "vitest";
import { calcAllowance, writeOffLines, STATUTORY_RATES } from "@/lib/bad-debt";

describe("貸倒引当金", () => {
  it("法定繰入率（その他 6/1000）で限度額を出す。円未満は切り捨て", () => {
    const rate = STATUTORY_RATES.find((r) => r.key === "other")!.perMille / 1000;
    const r = calcAllowance({ receivables: 12_345_678, deduction: 345_678, rate, priorBalance: 0, method: "reversal" });
    expect([r.base, r.limit]).toEqual([12_000_000, 72_000]);
    expect(r.entries).toEqual([{ kind: "provide", amount: 72_000 }]);
  });

  it("洗替法は前期末残高を全額戻し入れ、限度額を繰り入れる", () => {
    const r = calcAllowance({ receivables: 10_000_000, deduction: 0, rate: 0.01, priorBalance: 80_000, method: "reversal" });
    expect(r.entries).toEqual([
      { kind: "reverse", amount: 80_000 },
      { kind: "provide", amount: 100_000 },
    ]);
  });

  it("差額補充法は差額だけ。限度額が下がれば戻し入れ", () => {
    expect(calcAllowance({ receivables: 10_000_000, deduction: 0, rate: 0.01, priorBalance: 80_000, method: "difference" }).entries)
      .toEqual([{ kind: "provide", amount: 20_000 }]);
    expect(calcAllowance({ receivables: 5_000_000, deduction: 0, rate: 0.01, priorBalance: 80_000, method: "difference" }).entries)
      .toEqual([{ kind: "reverse", amount: 30_000 }]);
  });

  it("相殺できる額が債権より多くても限度額はマイナスにしない", () => {
    expect(calcAllowance({ receivables: 100, deduction: 500, rate: 0.01, priorBalance: 0, method: "reversal" }).limit).toBe(0);
  });

  it("貸倒実績率（小数の率）でも誤差なく切り捨てる", () => {
    expect(calcAllowance({ receivables: 1_000_000, deduction: 0, rate: 0.0123, priorBalance: 0, method: "reversal" }).limit).toBe(12_300);
  });
});

describe("貸倒れの仕訳", () => {
  it("税込経理: 貸倒損失（貸倒れ10%）／売掛金", () => {
    expect(writeOffLines({ amount: 110_000, rate: 0.1, exclusive: false, useAllowance: 0 })).toEqual([
      { role: "loss", debit: 110_000, credit: 0, taxCategory: "bad_debt_10" },
      { role: "receivable", debit: 0, credit: 110_000, taxCategory: null },
    ]);
  });

  it("税抜経理: 消費税分は仮受消費税を減らす", () => {
    expect(writeOffLines({ amount: 110_000, rate: 0.1, exclusive: true, useAllowance: 0 })).toEqual([
      { role: "loss", debit: 100_000, credit: 0, taxCategory: "bad_debt_10" },
      { role: "output_tax", debit: 10_000, credit: 0, taxCategory: null },
      { role: "receivable", debit: 0, credit: 110_000, taxCategory: null },
    ]);
  });

  it("引き当てていた分は貸倒引当金を取り崩し、超えた分だけ貸倒損失", () => {
    expect(writeOffLines({ amount: 110_000, rate: 0.1, exclusive: false, useAllowance: 30_000 })).toEqual([
      { role: "allowance", debit: 30_000, credit: 0, taxCategory: null },
      { role: "loss", debit: 80_000, credit: 0, taxCategory: "bad_debt_10" },
      { role: "receivable", debit: 0, credit: 110_000, taxCategory: null },
    ]);
  });

  it("課税売上でない債権（貸付金など）は税区分なし", () => {
    expect(writeOffLines({ amount: 50_000, rate: null, exclusive: true, useAllowance: 0 })).toEqual([
      { role: "loss", debit: 50_000, credit: 0, taxCategory: null },
      { role: "receivable", debit: 0, credit: 50_000, taxCategory: null },
    ]);
  });

  it("貸借は必ず一致する", () => {
    for (const exclusive of [true, false]) {
      for (const useAllowance of [0, 5_000, 999_999]) {
        const lines = writeOffLines({ amount: 108_001, rate: 0.08, exclusive, useAllowance });
        const d = lines.reduce((s, l) => s + l.debit, 0);
        const c = lines.reduce((s, l) => s + l.credit, 0);
        expect(d).toBe(c);
      }
    }
  });
});
