import { describe, it, expect } from "vitest";
import { normalizeAmount, formatAmount } from "./amount-input";

describe("normalizeAmount（計算に使う値の取り出し）", () => {
  it("カンマと空白を取り除く", () => {
    expect(normalizeAmount("1,200,000")).toBe("1200000");
    expect(normalizeAmount(" 1 200 000 ")).toBe("1200000");
  });

  it("全角の数字とカンマも読む", () => {
    expect(normalizeAmount("１２００，０００")).toBe("1200000");
  });

  it("未入力は空のまま", () => {
    expect(normalizeAmount("")).toBe("");
  });

  it("数字以外が混ざれば空にする（不正な値を通さない）", () => {
    expect(normalizeAmount("1200円")).toBe("");
    expect(normalizeAmount("abc")).toBe("");
  });

  it("マイナスは受け付けない（帳簿にマイナスは使わない）", () => {
    expect(normalizeAmount("-1000")).toBe("");
  });

  it("既定では小数を受け付けない（金額は整数）", () => {
    expect(normalizeAmount("1000.5")).toBe("");
  });

  it("小数を許すと年利のような値を扱える", () => {
    expect(normalizeAmount("2.4", true)).toBe("2.4");
    expect(normalizeAmount("0.", true)).toBe("0."); // 入力途中も通す
  });

  it("結果は Number() でそのまま計算できる", () => {
    expect(Number(normalizeAmount("1,200,000"))).toBe(1200000);
  });
});

describe("formatAmount（表示）", () => {
  it("3桁ごとにカンマを付ける", () => {
    expect(formatAmount("1200000")).toBe("1,200,000");
    expect(formatAmount("100")).toBe("100");
    expect(formatAmount("1000")).toBe("1,000");
  });

  it("小数部はそのまま残す", () => {
    expect(formatAmount("1234.5")).toBe("1,234.5");
  });

  it("未入力は空のまま（0 を表示しない）", () => {
    expect(formatAmount("")).toBe("");
  });

  it("0 は 0 のまま", () => {
    expect(formatAmount("0")).toBe("0");
  });

  it("往復させても値が変わらない", () => {
    for (const v of ["0", "5", "1000", "1200000", "999999999"]) {
      expect(normalizeAmount(formatAmount(v))).toBe(v);
    }
  });
});
