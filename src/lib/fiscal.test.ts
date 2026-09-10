import { describe, it, expect } from "vitest";
import {
  getFiscalPeriod,
  fiscalRangeFromStartYear,
  settlementMonth,
  startMonthFromSettlement,
  currentFiscalStartYear,
  DEFAULT_FISCAL_START_MONTH,
  toJstDate,
} from "./fiscal";

describe("fiscalRangeFromStartYear", () => {
  it("3月決算（期首4月）の期間を返す", () => {
    expect(fiscalRangeFromStartYear(4, 2025)).toEqual({
      startDate: "2025-04-01",
      endDate: "2026-03-31",
    });
  });

  it("12月決算（期首1月）は暦年と一致する", () => {
    expect(fiscalRangeFromStartYear(1, 2025)).toEqual({
      startDate: "2025-01-01",
      endDate: "2025-12-31",
    });
  });

  it("2月決算（期首3月）はうるう年の期末を正しく扱う", () => {
    // 期首3月 → 期末は翌年2月末。2028年はうるう年なので2/29
    expect(fiscalRangeFromStartYear(3, 2027)).toEqual({
      startDate: "2027-03-01",
      endDate: "2028-02-29",
    });
  });

  it("未設定なら既定の期首月を使う", () => {
    expect(fiscalRangeFromStartYear(null, 2025).startDate).toBe(
      `2025-${String(DEFAULT_FISCAL_START_MONTH).padStart(2, "0")}-01`
    );
  });
});

describe("getFiscalPeriod", () => {
  it("期首月以降の月は同じ年度に属する", () => {
    // 3月決算: 2025年8月 → 2025年度（2025-04-01〜2026-03-31）
    expect(getFiscalPeriod(4, 2025, 8)).toEqual({
      startYear: 2025,
      startDate: "2025-04-01",
      endDate: "2026-03-31",
    });
  });

  it("期首月より前の月は前年度に属する", () => {
    // 3月決算: 2026年2月 → 2025年度
    expect(getFiscalPeriod(4, 2026, 2)).toEqual({
      startYear: 2025,
      startDate: "2025-04-01",
      endDate: "2026-03-31",
    });
  });

  it("期首月ちょうどは新年度の初月", () => {
    expect(getFiscalPeriod(4, 2026, 4).startYear).toBe(2026);
  });
});

describe("settlementMonth / startMonthFromSettlement", () => {
  it("期首月と決算月は相互に変換できる", () => {
    expect(settlementMonth(4)).toBe(3); // 期首4月 → 3月決算
    expect(settlementMonth(1)).toBe(12); // 期首1月 → 12月決算
    expect(startMonthFromSettlement(3)).toBe(4);
    expect(startMonthFromSettlement(12)).toBe(1);
  });

  it("全ての月で往復変換が一致する", () => {
    for (let m = 1; m <= 12; m++) {
      expect(startMonthFromSettlement(settlementMonth(m))).toBe(m);
    }
  });
});

describe("currentFiscalStartYear", () => {
  it("基準日が属する会計年度の開始年を返す", () => {
    expect(currentFiscalStartYear(4, new Date(2026, 7, 15))).toBe(2026); // 8月
    expect(currentFiscalStartYear(4, new Date(2026, 1, 15))).toBe(2025); // 2月
  });
});

describe("toJstDate", () => {
  it("日本時間の午前中に登録したものが前日にならない", () => {
    // 2026-09-11 03:08 JST = 2026-09-10 18:08 UTC
    expect(toJstDate("2026-09-10T18:08:00Z")).toBe("2026-09-11");
  });

  it("日本時間の夜に登録したものはその日のまま", () => {
    // 2026-09-10 23:00 JST = 2026-09-10 14:00 UTC
    expect(toJstDate("2026-09-10T14:00:00Z")).toBe("2026-09-10");
  });

  it("空やおかしな値では空文字を返す", () => {
    expect(toJstDate(null)).toBe("");
    expect(toJstDate("")).toBe("");
    expect(toJstDate("not-a-date")).toBe("");
  });
});
