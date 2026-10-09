import { describe, it, expect } from "vitest";
import { parseMonthDay, toIsoDate, monthDayText } from "@/lib/month-day";

describe("月日の手入力", () => {
  it("区切りあり・なし・全角・「月日」を読む", () => {
    for (const t of ["4/1", "04/01", "4-1", "4.1", "4月1日", "0401", "401", "４／１"]) {
      expect(parseMonthDay(t, 2026), t).toEqual({ month: 4, day: 1 });
    }
    expect(parseMonthDay("1231", 2026)).toEqual({ month: 12, day: 31 });
  });
  it("存在しない日付や読めない入力は null（うるう年は年で判断）", () => {
    expect(parseMonthDay("2/30", 2026)).toBeNull();
    expect(parseMonthDay("2/29", 2026)).toBeNull();
    expect(parseMonthDay("2/29", 2028)).toEqual({ month: 2, day: 29 });
    expect(parseMonthDay("13/1", 2026)).toBeNull();
    expect(parseMonthDay("abc", 2026)).toBeNull();
    expect(parseMonthDay("", 2026)).toBeNull();
  });
  it("年と組み合わせて日付にする", () => {
    expect(toIsoDate(2026, "4/1")).toBe("2026-04-01");
    expect(toIsoDate(2026, "x")).toBeNull();
    expect(monthDayText("2026-04-01")).toBe("04/01");
  });
});
