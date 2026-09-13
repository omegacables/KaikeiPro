import { describe, it, expect } from "vitest";
import {
  retentionYears,
  retentionStartDate,
  retentionEndDate,
  isWithinRetention,
} from "./retention";

const corp = { entityType: "corporation" as const, fiscalYearEnd: "2026-03-31" };
const indiv = { entityType: "individual" as const, fiscalYearEnd: "2026-12-31" };

describe("保存年数", () => {
  it("法人は会社法の10年を採る（税法の7年では足りない）", () => {
    expect(retentionYears(corp)).toBe(10);
  });

  it("欠損金があっても10年で足りる", () => {
    expect(retentionYears({ ...corp, hasLossCarryforward: true })).toBe(10);
  });

  it("個人は7年", () => {
    expect(retentionYears(indiv)).toBe(7);
  });
});

describe("起算日", () => {
  it("法人は事業年度終了の翌日から2か月経過した日", () => {
    // 2026-03-31 終了 → 翌日 04-01 → 2か月後 06-01
    expect(retentionStartDate(corp)).toBe("2026-06-01");
  });

  it("申告期限の延長特例があればその月数を足す", () => {
    expect(retentionStartDate({ ...corp, filingExtensionMonths: 1 })).toBe("2026-07-01");
  });

  it("個人は翌年3月15日の翌日", () => {
    expect(retentionStartDate(indiv)).toBe("2027-03-16");
  });
});

describe("満了日と判定", () => {
  it("法人は起算日から10年後の前日まで", () => {
    expect(retentionEndDate(corp)).toBe("2036-05-31");
  });

  it("個人は起算日から7年後の前日まで", () => {
    expect(retentionEndDate(indiv)).toBe("2034-03-15");
  });

  it("満了日までは削除できない", () => {
    expect(isWithinRetention(corp, "2036-05-31")).toBe(true);
    expect(isWithinRetention(corp, "2036-06-01")).toBe(false);
  });

  it("直近の事業年度はもちろん保存期間内", () => {
    expect(isWithinRetention(corp, "2026-09-13")).toBe(true);
  });
});
