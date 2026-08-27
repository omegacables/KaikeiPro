import { describe, it, expect } from "vitest";
import {
  checkInvoiceNumber,
  getReviewReasons,
  OCR_CONFIDENCE_THRESHOLD,
  type ReviewInput,
} from "./receipt-review";

const base = (o: Partial<ReviewInput> = {}): ReviewInput => ({
  amount: 11000,
  date: "2026-08-01",
  vendor: "テスト商店",
  needsReview: false,
  ocrConfidence: 0.9,
  ...o,
});

describe("checkInvoiceNumber（適格請求書発行事業者の登録番号）", () => {
  it("T + 数字13桁は適格", () => {
    expect(checkInvoiceNumber("T1234567890123")).toBe("valid");
  });

  it("ハイフン・空白は無視して判定する", () => {
    expect(checkInvoiceNumber("T-1234-5678-90123")).toBe("valid");
    expect(checkInvoiceNumber(" t1234567890123 ")).toBe("valid");
  });

  it("Tで始まるが桁数が違うものは不正", () => {
    expect(checkInvoiceNumber("T123")).toBe("invalid");
    expect(checkInvoiceNumber("T12345678901234")).toBe("invalid");
  });

  it("Tで始まらない番号は登録番号ではない（none）", () => {
    // 請求書番号などを「形式不正」と誤判定しないこと
    expect(checkInvoiceNumber("INV-2026-001")).toBe("none");
    expect(checkInvoiceNumber("1234567890123")).toBe("none");
  });

  it("未入力はnone", () => {
    expect(checkInvoiceNumber(undefined)).toBe("none");
    expect(checkInvoiceNumber("")).toBe("none");
    expect(checkInvoiceNumber("   ")).toBe("none");
  });
});

describe("getReviewReasons（要確認の判定）", () => {
  it("問題がなければ要確認にならない", () => {
    expect(getReviewReasons(base(), true)).toEqual([]);
  });

  it("受領側は登録番号の形式不正を要確認にする", () => {
    const r = getReviewReasons(base({ invoiceNumber: "T123" }), true);
    expect(r).toContain("invoice");
  });

  it("発行側は登録番号チェックを行わない", () => {
    const r = getReviewReasons(base({ invoiceNumber: "T123" }), false);
    expect(r).not.toContain("invoice");
  });

  it("OCR信頼度が閾値未満なら要確認", () => {
    const r = getReviewReasons(base({ ocrConfidence: OCR_CONFIDENCE_THRESHOLD - 0.01 }), true);
    expect(r).toContain("low_confidence");
  });

  it("金額・日付・取引先が欠けていれば要確認", () => {
    expect(getReviewReasons(base({ amount: 0 }), true)).toContain("missing_fields");
    expect(getReviewReasons(base({ date: "" }), true)).toContain("missing_fields");
    expect(getReviewReasons(base({ vendor: "不明" }), true)).toContain("missing_fields");
  });

  it("同一日付・同額の重複候補は要確認にする", () => {
    const r = getReviewReasons(base({ possibleDuplicate: true }), true);
    expect(r).toContain("possible_duplicate");
  });

  it("明細書は判定対象外", () => {
    const r = getReviewReasons(base({ documentType: "statement", amount: 0, needsReview: true }), true);
    expect(r).toEqual([]);
  });

  it("複数の理由が同時に付く", () => {
    const r = getReviewReasons(
      base({ invoiceNumber: "T1", ocrConfidence: 0.1, amount: 0, needsReview: true }),
      true
    );
    expect(r).toEqual(
      expect.arrayContaining(["invoice", "low_confidence", "missing_fields", "needs_review"])
    );
  });
});
