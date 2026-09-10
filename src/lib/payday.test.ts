import { describe, it, expect } from "vitest";
import { paydayOf, paydayLabel, PAYDAY_END_OF_MONTH } from "./payday";

describe("paydayOf（支給日の算出）", () => {
  it("日にち指定はそのまま使う", () => {
    expect(paydayOf("2026-08", 25)).toBe("2026-08-25");
    expect(paydayOf("2026-08", 10)).toBe("2026-08-10");
  });

  it("末日はその月の末日になる（月ごとに変わる）", () => {
    expect(paydayOf("2026-08", PAYDAY_END_OF_MONTH)).toBe("2026-08-31");
    expect(paydayOf("2026-09", PAYDAY_END_OF_MONTH)).toBe("2026-09-30");
    expect(paydayOf("2026-02", PAYDAY_END_OF_MONTH)).toBe("2026-02-28");
  });

  it("うるう年の2月は29日になる", () => {
    expect(paydayOf("2028-02", PAYDAY_END_OF_MONTH)).toBe("2028-02-29");
  });

  it("その月に無い日にちは末日に丸める", () => {
    // 31日が給料日でも、2月や9月には31日が無い
    expect(paydayOf("2026-02", 31)).toBe("2026-02-28");
    expect(paydayOf("2026-09", 31)).toBe("2026-09-30");
    expect(paydayOf("2026-08", 31)).toBe("2026-08-31");
  });

  it("未設定なら空にする（勝手な日付を入れない）", () => {
    expect(paydayOf("2026-08", null)).toBe("");
    expect(paydayOf("2026-08", undefined)).toBe("");
  });

  it("月の形式が不正なら空にする", () => {
    expect(paydayOf("", 25)).toBe("");
    expect(paydayOf("2026-8", 25)).toBe("");
    expect(paydayOf("2026-08-01", 25)).toBe("");
  });
});

describe("paydayLabel（表示名）", () => {
  it("日にちと末日と未設定を書き分ける", () => {
    expect(paydayLabel(25)).toBe("25日");
    expect(paydayLabel(PAYDAY_END_OF_MONTH)).toBe("末日");
    expect(paydayLabel(null)).toBe("未設定");
  });
});
