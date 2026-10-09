import { describe, it, expect } from "vitest";
import {
  getFiscalPeriod,
  fiscalRangeFromStartYear,
  settlementMonth,
  startMonthFromSettlement,
  currentFiscalStartYear,
  resolveFiscalPeriodByKey,
  adjacentFiscalPeriodKeys,
  DEFAULT_FISCAL_START_MONTH,
  toJstDate,
  transitionalPeriodEnd,
  fiscalPeriodsUpTo,
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

describe("transitionalPeriodEnd", () => {
  it("3月決算→12月決算: 当期は期首4月のまま12月末で締める（9ヶ月）", () => {
    expect(transitionalPeriodEnd("2026-04-01", startMonthFromSettlement(12))).toBe("2026-12-31");
  });

  it("3月決算→2月決算: 翌年2月末（うるう年も月末に合わせる）", () => {
    expect(transitionalPeriodEnd("2027-04-01", startMonthFromSettlement(2))).toBe("2028-02-29");
  });

  it("決算月が変わらなければ元の期末日と同じ", () => {
    expect(transitionalPeriodEnd("2026-04-01", 4)).toBe("2027-03-31");
  });

  it("期首月と同じ月を決算月にすると1ヶ月の期間になる", () => {
    expect(transitionalPeriodEnd("2026-04-01", startMonthFromSettlement(4))).toBe("2026-04-30");
  });
});

describe("resolveFiscalPeriodByKey（帳票に使う事業年度）", () => {
  it("年で指定し、記録が無ければ期首月から計算する", () => {
    expect(resolveFiscalPeriodByKey([], 4, "2025")).toEqual({
      startDate: "2025-04-01",
      endDate: "2026-03-31",
      fromFiscalYears: false,
    });
  });

  it("記録された期間があればそれを使う", () => {
    const rows = [{ start_date: "2025-04-01", end_date: "2026-03-31" }];
    expect(resolveFiscalPeriodByKey(rows, 4, "2025")).toEqual({
      startDate: "2025-04-01",
      endDate: "2026-03-31",
      fromFiscalYears: true,
    });
  });

  it("3月決算→12月決算の変則期間（4/1〜12/31）は、新しい期末日で年を引き当てる", () => {
    const rows = [
      { start_date: "2025-04-01", end_date: "2026-03-31" },
      { start_date: "2026-04-01", end_date: "2026-12-31" },
    ];
    // 期首月だけで計算すると 2026-01-01〜2026-12-31 になり誤る
    expect(resolveFiscalPeriodByKey(rows, 1, "2026")).toMatchObject({
      startDate: "2026-04-01",
      endDate: "2026-12-31",
    });
    expect(resolveFiscalPeriodByKey(rows, 1, "2027").startDate).toBe("2027-01-01");
  });

  // MRコネクトの実例: 3月決算→8月決算。2025年に始まる期が2つある
  const mr = [{ start_date: "2025-04-01", end_date: "2025-08-31" }];

  it("同じ年に始まる期が2つあっても、年の指定は今の決算月の期を開く", () => {
    expect(resolveFiscalPeriodByKey(mr, 9, "2025")).toEqual({
      startDate: "2025-09-01",
      endDate: "2026-08-31",
      fromFiscalYears: false,
    });
  });

  it("開始日で指定すれば変則期間も開ける", () => {
    expect(resolveFiscalPeriodByKey(mr, 9, "2025-04-01")).toEqual({
      startDate: "2025-04-01",
      endDate: "2025-08-31",
      fromFiscalYears: true,
    });
  });

  it("記録の無い期を開始日で指定したら12ヶ月とみなす", () => {
    expect(resolveFiscalPeriodByKey(mr, 9, "2024-04-01")).toMatchObject({
      startDate: "2024-04-01",
      endDate: "2025-03-31",
    });
  });

  it("解釈できない指定はエラーにする（別の期にすり替えない）", () => {
    expect(() => resolveFiscalPeriodByKey([], 4, "abc")).toThrow();
    expect(() => resolveFiscalPeriodByKey([], 4, "2025-13-01")).toThrow();
  });
});

describe("adjacentFiscalPeriodKeys（前期・翌期）", () => {
  const mr = [{ start_date: "2025-04-01", end_date: "2025-08-31" }];

  it("翌期は期末日の翌日から、前期は前日に終わる記録の期", () => {
    expect(
      adjacentFiscalPeriodKeys(mr, { startDate: "2025-09-01", endDate: "2026-08-31" })
    ).toEqual({ prevKey: "2025-04-01", nextKey: "2026-09-01" });
  });

  it("変則期間の前期は、記録が無ければ12ヶ月前から", () => {
    expect(
      adjacentFiscalPeriodKeys(mr, { startDate: "2025-04-01", endDate: "2025-08-31" })
    ).toEqual({ prevKey: "2024-04-01", nextKey: "2025-09-01" });
  });

  it("前後にたどると変則期間を含めて期が途切れずにつながる", () => {
    const seq: string[] = [];
    let key = "2024-04-01";
    for (let i = 0; i < 4; i++) {
      const p = resolveFiscalPeriodByKey(mr, 9, key);
      seq.push(`${p.startDate}〜${p.endDate}`);
      key = adjacentFiscalPeriodKeys(mr, p).nextKey;
    }
    expect(seq).toEqual([
      "2024-04-01〜2025-03-31",
      "2025-04-01〜2025-08-31",
      "2025-09-01〜2026-08-31",
      "2026-09-01〜2027-08-31",
    ]);
  });
});

describe("fiscalPeriodsUpTo（使い始めた期から指定の期まで）", () => {
  it("12ヶ月の期を古い順にたどる", () => {
    const target = { startDate: "2026-04-01", endDate: "2027-03-31" };
    expect(fiscalPeriodsUpTo([], 4, target, "2024-10-15")).toEqual([
      { startDate: "2024-04-01", endDate: "2025-03-31" },
      { startDate: "2025-04-01", endDate: "2026-03-31" },
      { startDate: "2026-04-01", endDate: "2027-03-31" },
    ]);
  });

  it("決算月を変えた変則期間を記録どおりにたどる", () => {
    const rows = [{ start_date: "2025-04-01", end_date: "2025-12-31" }];
    const target = { startDate: "2026-01-01", endDate: "2026-12-31" };
    expect(fiscalPeriodsUpTo(rows, 1, target, "2024-06-01")).toEqual([
      { startDate: "2024-04-01", endDate: "2025-03-31" },
      { startDate: "2025-04-01", endDate: "2025-12-31" },
      { startDate: "2026-01-01", endDate: "2026-12-31" },
    ]);
  });

  it("指定の期より後に始まるなら空", () => {
    expect(fiscalPeriodsUpTo([], 4, { startDate: "2024-04-01", endDate: "2025-03-31" }, "2025-04-01")).toEqual([]);
  });
});
