import { describe, it, expect } from "vitest";
import {
  buildDepreciationSchedule,
  depreciationKind,
  serviceMonths,
  rateInfo,
  straightLineOnlyReason,
  type ScheduleAsset,
  type SchedulePeriod,
} from "./depreciation";

const asset = (o: Partial<ScheduleAsset> = {}): ScheduleAsset => ({
  acquisitionDate: "2024-04-01",
  acquisitionCost: 1_000_000,
  usefulLife: 5,
  method: "straight_line",
  ...o,
});

/** 4月始まりの事業年度を from 年から n 期 */
const years = (from: number, n: number): SchedulePeriod[] =>
  Array.from({ length: n }, (_, i) => ({ start: `${from + i}-04-01`, end: `${from + i + 1}-03-31` }));

const booked = (rows: { booked: number }[]) => rows.map((r) => r.booked);

describe("償却の方法の判定", () => {
  it("取得日で200%・250%定率法、旧償却法を分ける", () => {
    expect(depreciationKind("declining_balance", "2012-04-01")).toBe("db200");
    expect(depreciationKind("declining_balance", "2012-03-31")).toBe("db250");
    expect(depreciationKind("declining_balance", "2007-04-01")).toBe("db250");
    expect(depreciationKind("straight_line", "2007-03-31")).toBe("unsupported");
    expect(depreciationKind("straight_line", "2020-01-01")).toBe("sl");
  });

  it("償却率表を引ける", () => {
    expect(rateInfo(10, "db200")).toEqual({ rate: 0.2, revised: 0.25, guarantee: 0.06552 });
    expect(rateInfo(6, "sl")).toEqual({ rate: 0.167, revised: null, guarantee: null });
    expect(rateInfo(2, "db200")).toEqual({ rate: 1, revised: null, guarantee: null });
    expect(rateInfo(51, "sl")).toBeNull();
  });

  it("定額法しか使えない資産を知らせる", () => {
    expect(straightLineOnlyReason("建物", "2020-01-01")).toMatch(/建物/);
    expect(straightLineOnlyReason("建物附属設備", "2016-03-31")).toBeNull();
    expect(straightLineOnlyReason("建物附属設備", "2016-04-01")).toMatch(/建物附属設備/);
    expect(straightLineOnlyReason("ソフトウェア", "2000-01-01")).toMatch(/無形/);
    expect(straightLineOnlyReason("器具備品", "2020-01-01")).toBeNull();
  });
});

describe("使っていた月数", () => {
  const fy = { start: "2024-04-01", end: "2025-03-31" };
  it("1ヶ月未満は1ヶ月とする", () => {
    expect(serviceMonths(fy, "2024-10-31")).toBe(6);
    expect(serviceMonths(fy, "2025-03-31")).toBe(1);
  });
  it("使い始める前・除却した後は0、除却した月までは数える", () => {
    expect(serviceMonths(fy, "2025-04-01")).toBe(0);
    expect(serviceMonths(fy, "2020-01-01", "2024-03-31")).toBe(0);
    expect(serviceMonths(fy, "2020-01-01", "2024-06-10")).toBe(3);
  });
});

describe("定額法", () => {
  it("取得価額 × 償却率で償却し、最後は1円を残す", () => {
    const rows = buildDepreciationSchedule(asset(), years(2024, 6), {}, "floor");
    expect(booked(rows)).toEqual([200000, 200000, 200000, 200000, 199999, 0]);
    expect(rows[4].closingBook).toBe(1);
  });

  it("期の途中から使い始めたら月割りする", () => {
    const rows = buildDepreciationSchedule(asset({ acquisitionDate: "2024-10-15" }), years(2024, 1), {}, "floor");
    expect(rows[0].months).toBe(6);
    expect(rows[0].booked).toBe(100000);
  });

  it("事業に使い始めた日から償却する（取得日ではなく）", () => {
    const rows = buildDepreciationSchedule(
      asset({ acquisitionDate: "2024-04-01", serviceStartDate: "2025-01-10" }),
      years(2024, 2),
      {},
      "floor"
    );
    expect(rows.map((r) => r.months)).toEqual([3, 12]);
    expect(booked(rows)).toEqual([50000, 200000]);
  });

  it("12ヶ月に満たない期（決算月の変更）は、償却率 × 月数 ÷ 12 を小数3位未満で切り上げた率を使う", () => {
    // 0.200 × 9/12 = 0.150（端数なし）
    expect(buildDepreciationSchedule(asset(), [{ start: "2024-04-01", end: "2024-12-31" }], {}, "floor")[0].booked).toBe(150000);
    // 0.167 × 5/12 = 0.06958… → 0.070
    const six = asset({ usefulLife: 6 });
    expect(buildDepreciationSchedule(six, [{ start: "2024-04-01", end: "2024-08-31" }], {}, "floor")[0].booked).toBe(70000);
  });

  it("12ヶ月に満たない期の途中から使い始めたら、使った月数 ÷ その期の月数 を掛ける", () => {
    // 5ヶ月の期のうち3ヶ月: 100万 × 0.084（0.2×5/12 を切り上げ）× 3/5 = 50,400
    const rows = buildDepreciationSchedule(
      asset({ acquisitionDate: "2024-06-10" }),
      [{ start: "2024-04-01", end: "2024-08-31" }],
      {},
      "floor"
    );
    expect(rows[0]).toMatchObject({ months: 3, booked: 50400 });
  });

  it("除却した期は除却した月まで、その後は償却しない", () => {
    const rows = buildDepreciationSchedule(asset({ disposedAt: "2025-06-20" }), years(2024, 3), {}, "floor");
    expect(booked(rows)).toEqual([200000, 50000]);
  });

  it("端数処理を選べる（切り捨て・切り上げ・四捨五入）", () => {
    // 100,001円 × 0.334 × 7/12 = 19,483.5...
    const a = asset({ acquisitionCost: 100001, usefulLife: 3, acquisitionDate: "2024-09-01" });
    const one = (r: "floor" | "ceil" | "round") => buildDepreciationSchedule(a, years(2024, 1), {}, r)[0].booked;
    expect(one("floor")).toBe(19483);
    expect(one("ceil")).toBe(19484);
    expect(one("round")).toBe(19484);
  });
});

describe("定率法", () => {
  it("200%定率法: 償却保証額を下回った期から改定償却率に切り替える（国税庁の計算例）", () => {
    // 取得価額100万円・耐用年数10年: 償却率0.200、改定償却率0.250、保証率0.06552（償却保証額65,520円）
    const rows = buildDepreciationSchedule(
      asset({ method: "declining_balance", usefulLife: 10 }),
      years(2024, 11),
      {},
      "floor"
    );
    expect(booked(rows)).toEqual([
      200000, 160000, 128000, 102400, 81920, 65536, 65536, 65536, 65536, 65535, 0,
    ]);
    expect(rows.map((r) => r.revised)).toEqual([false, false, false, false, false, false, true, true, true, true, true]);
    expect(rows[9].closingBook).toBe(1);
  });

  it("250%定率法（2007年4月〜2012年3月の取得）", () => {
    // 耐用年数5年: 償却率0.500、改定償却率1.000、保証率0.06249（償却保証額62,490円）
    const rows = buildDepreciationSchedule(
      asset({ method: "declining_balance", acquisitionDate: "2010-04-01" }),
      years(2010, 5),
      {},
      "floor"
    );
    expect(booked(rows)).toEqual([500000, 250000, 125000, 62500, 62499]);
  });

  it("12ヶ月に満たない期は、償却率を月数で調整するが、償却保証額との比べ方は調整前の率で行う", () => {
    // 耐用年数10年（償却率0.200・保証率0.06552、償却保証額65,520円）
    const a = asset({ method: "declining_balance", usefulLife: 10 });
    const periods = [
      ...years(2024, 6),
      { start: "2030-04-01", end: "2030-08-31" }, // 5ヶ月の期
    ];
    const rows = buildDepreciationSchedule(a, periods, {}, "floor");
    // 7期目の期首残高 262,144 × 0.200 = 52,428 < 65,520 → 改定償却率 0.250 を 5/12 で調整 → 0.105
    expect(rows[6]).toMatchObject({ openingBook: 262144, revised: true, booked: 27525 });
    // 6期目: 327,680 × 0.200 = 65,536 ≥ 65,520 → 切り替えない（月数で調整した率で比べると切り替わってしまう）
    const short6 = buildDepreciationSchedule(a, [...years(2024, 5), { start: "2029-04-01", end: "2029-08-31" }], {}, "floor");
    // 0.200 × 5/12 = 0.0833… → 0.084: 327,680 × 0.084 = 27,525.12
    expect(short6[5]).toMatchObject({ openingBook: 327680, revised: false, booked: 27525 });
  });

  it("初年度の月割りは、1年分の額に月数を掛ける", () => {
    const rows = buildDepreciationSchedule(
      asset({ method: "declining_balance", usefulLife: 10, acquisitionDate: "2024-07-01" }),
      years(2024, 2),
      {},
      "floor"
    );
    // 100万 × 0.2 × 9/12 = 150,000 → 翌期 85万 × 0.2 = 170,000
    expect(booked(rows)).toEqual([150000, 170000]);
  });
});

describe("特別償却", () => {
  it("使い始めた期に、取得価額 × 特別償却率を上乗せする", () => {
    const rows = buildDepreciationSchedule(asset({ specialRate: 0.3 }), years(2024, 5), {}, "floor");
    expect(rows[0]).toMatchObject({ ordinaryLimit: 200000, specialLimit: 300000, limit: 500000 });
    // 翌期以降の定額法は取得価額 × 償却率のまま、1円まで
    expect(booked(rows)).toEqual([500000, 200000, 200000, 99999, 0]);
  });

  it("即時償却（100%）は1円を残して全額", () => {
    const rows = buildDepreciationSchedule(asset({ specialRate: 1 }), years(2024, 2), {}, "floor");
    expect(rows[0]).toMatchObject({ ordinaryLimit: 200000, specialLimit: 799999, limit: 999999, closingBook: 1 });
    expect(rows[1].booked).toBe(0);
  });
});

describe("任意償却と償却超過額", () => {
  it("限度額を超えて計上した分は償却超過額になり、後の期の不足分で認容される", () => {
    const rows = buildDepreciationSchedule(asset(), years(2024, 3), { "2024-04-01": 300000, "2025-04-01": 100000 }, "floor");
    expect(rows[0]).toMatchObject({ limit: 200000, booked: 300000, excess: 100000, allowed: 0, closingExcess: 100000, overridden: true });
    expect(rows[1]).toMatchObject({ limit: 200000, booked: 100000, excess: 0, allowed: 100000, closingExcess: 0 });
    expect(rows[2]).toMatchObject({ booked: 200000, overridden: false });
  });

  it("計上しなかった期は償却不足になるだけ（定額法は期間が延びる）", () => {
    const rows = buildDepreciationSchedule(asset(), years(2024, 6), { "2024-04-01": 0 }, "floor");
    expect(booked(rows)).toEqual([0, 200000, 200000, 200000, 200000, 199999]);
    expect(rows.every((r) => r.excess === 0)).toBe(true);
  });

  it("定率法の限度額は、帳簿価額に繰越償却超過額を足した税務上の残高で計算する", () => {
    const rows = buildDepreciationSchedule(
      asset({ method: "declining_balance", usefulLife: 10 }),
      years(2024, 2),
      { "2024-04-01": 300000 },
      "floor"
    );
    expect(rows[1]).toMatchObject({ openingBook: 700000, openingExcess: 100000, limit: 160000 });
    // 限度額いっぱいの計上なら認容は無い
    expect(rows[1]).toMatchObject({ booked: 160000, allowed: 0, closingExcess: 100000 });
  });

  it("計上額は帳簿価額1円を残すところまで", () => {
    const rows = buildDepreciationSchedule(asset(), years(2024, 1), { "2024-04-01": 2_000_000 }, "floor");
    expect(rows[0]).toMatchObject({ booked: 999999, excess: 799999, closingBook: 1 });
  });

  it("旧定額法・旧定率法の資産は限度額を出さず、入力した額を計上する", () => {
    const rows = buildDepreciationSchedule(asset({ acquisitionDate: "2005-04-01" }), years(2024, 2), { "2024-04-01": 50000 }, "floor");
    expect(rows[0]).toMatchObject({ limit: null, booked: 50000, excess: 0 });
    expect(rows[1]).toMatchObject({ limit: null, booked: 0 });
  });
});
