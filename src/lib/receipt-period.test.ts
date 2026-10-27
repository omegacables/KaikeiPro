import { describe, it, expect } from "vitest";
import { hiddenMonthsOutside, monthLabel, monthRange } from "./receipt-period";

describe("期間の外にある証憑", () => {
  const dates = ["2026-06-10", "2026-06-30", "2026-09-01", "2026-10-27", "2025-12-31", "不明"];

  it("期間の外の証憑を、新しい月から月ごとに数える", () => {
    expect(hiddenMonthsOutside(dates, "2026-10-01", "2026-10-31")).toEqual([
      { ym: "2026-09", count: 1 },
      { ym: "2026-06", count: 2 },
      { ym: "2025-12", count: 1 },
    ]);
  });

  it("全期間（絞り込みなし）なら隠れている証憑は無い", () => {
    expect(hiddenMonthsOutside(dates, "", "")).toEqual([]);
  });

  it("期間の中の証憑は数えない", () => {
    expect(hiddenMonthsOutside(["2026-10-01", "2026-10-31"], "2026-10-01", "2026-10-31")).toEqual([]);
  });

  it("月の初日と末日・表示名", () => {
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthRange("2026-06")).toEqual({ from: "2026-06-01", to: "2026-06-30" });
    expect(monthLabel("2026-06")).toBe("2026年6月");
  });
});
