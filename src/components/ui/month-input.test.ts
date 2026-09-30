import { describe, it, expect } from "vitest";
import { parseMonthInput } from "./month-input";

describe("parseMonthInput", () => {
  it("区切りなし6桁・区切りあり・年月の漢字を読む", () => {
    expect(parseMonthInput("202604", 2026)).toBe("2026-04");
    expect(parseMonthInput("2026/4", 2026)).toBe("2026-04");
    expect(parseMonthInput("2026-12", 2026)).toBe("2026-12");
    expect(parseMonthInput("2026年4月", 2026)).toBe("2026-04");
    expect(parseMonthInput("２０２６０４", 2026)).toBe("2026-04");
  });

  it("2桁年・月だけは基準の年で補う", () => {
    expect(parseMonthInput("2604", 2025)).toBe("2026-04");
    expect(parseMonthInput("26/4", 2025)).toBe("2026-04");
    expect(parseMonthInput("4", 2025)).toBe("2025-04");
  });

  it("月が範囲外・形が読めないものは null（黙って丸めない）", () => {
    expect(parseMonthInput("202613", 2026)).toBeNull();
    expect(parseMonthInput("13", 2026)).toBeNull();
    expect(parseMonthInput("2026/4/1", 2026)).toBeNull();
    expect(parseMonthInput("abc", 2026)).toBeNull();
  });
});
