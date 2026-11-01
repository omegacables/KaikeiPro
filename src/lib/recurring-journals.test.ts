import { describe, it, expect } from "vitest";
import {
  END_OF_MONTH,
  addMonths,
  monthsBetween,
  postingDateOf,
  dayOfMonthLabel,
  intervalLabel,
  monthLabel,
  scheduledMonths,
  pendingMonths,
  nextMonthToCreate,
  checkBalance,
  validateRecurringInput,
  MAX_MONTHS,
  type RecurringSchedule,
  type RecurringJournalInput,
} from "./recurring-journals";

const monthly = (over: Partial<RecurringSchedule> = {}): RecurringSchedule => ({
  dayOfMonth: END_OF_MONTH,
  startMonth: "2026-04",
  endMonth: null,
  intervalMonths: 1,
  isActive: true,
  ...over,
});

describe("年月の計算", () => {
  it("年をまたいで足し引きできる", () => {
    expect(addMonths("2026-11", 3)).toBe("2027-02");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-04", 12)).toBe("2027-04");
    expect(monthsBetween("2026-04", "2027-03")).toBe(11);
    expect(monthsBetween("2026-04", "2026-04")).toBe(0);
  });

  it("表示名", () => {
    expect(dayOfMonthLabel(END_OF_MONTH)).toBe("末日");
    expect(dayOfMonthLabel(25)).toBe("25日");
    expect(intervalLabel(1)).toBe("毎月");
    expect(intervalLabel(12)).toBe("毎年");
    expect(intervalLabel(4)).toBe("4か月ごと");
    expect(monthLabel("2026-04")).toBe("2026年4月");
    expect(monthLabel(null)).toBe("");
  });
});

describe("postingDateOf（対象月の計上日）", () => {
  it("日にち指定はそのまま使う", () => {
    expect(postingDateOf("2026-08", 25)).toBe("2026-08-25");
    expect(postingDateOf("2026-08", 1)).toBe("2026-08-01");
  });

  it("末日はその月の末日になる", () => {
    expect(postingDateOf("2026-04", END_OF_MONTH)).toBe("2026-04-30");
    expect(postingDateOf("2026-08", END_OF_MONTH)).toBe("2026-08-31");
    expect(postingDateOf("2026-02", END_OF_MONTH)).toBe("2026-02-28");
    expect(postingDateOf("2028-02", END_OF_MONTH)).toBe("2028-02-29");
  });

  it("31日指定でも、31日が無い月は月末にそろえる", () => {
    expect(postingDateOf("2026-02", 31)).toBe("2026-02-28");
    expect(postingDateOf("2028-02", 30)).toBe("2028-02-29");
    expect(postingDateOf("2026-09", 31)).toBe("2026-09-30");
    expect(postingDateOf("2026-10", 31)).toBe("2026-10-31");
  });

  it("形が不正なら空にする（勝手な日付を作らない）", () => {
    expect(postingDateOf("2026-13", 1)).toBe("");
    expect(postingDateOf("2026-4", 1)).toBe("");
    expect(postingDateOf("2026-04", 32)).toBe("");
    expect(postingDateOf("2026-04", -1)).toBe("");
  });
});

describe("scheduledMonths（指定日までに作るべき月）", () => {
  it("末日計上の毎月: その月の末日が来た月まで", () => {
    // 11/1 時点では10月分（10/31）までが対象。11月分（11/30）はまだ
    expect(scheduledMonths(monthly(), "2026-11-01")).toEqual([
      "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10",
    ]);
    expect(scheduledMonths(monthly(), "2026-11-30")).toContain("2026-11");
  });

  it("日にち指定: 計上日の当日から対象にする", () => {
    const s = monthly({ dayOfMonth: 25, startMonth: "2026-10" });
    expect(scheduledMonths(s, "2026-10-24")).toEqual([]);
    expect(scheduledMonths(s, "2026-10-25")).toEqual(["2026-10"]);
  });

  it("四半期・毎年は開始月から数える", () => {
    expect(scheduledMonths(monthly({ intervalMonths: 3, startMonth: "2026-01" }), "2026-12-31")).toEqual([
      "2026-01", "2026-04", "2026-07", "2026-10",
    ]);
    expect(scheduledMonths(monthly({ intervalMonths: 12, startMonth: "2024-06" }), "2026-11-01")).toEqual([
      "2024-06", "2025-06", "2026-06",
    ]);
  });

  it("終了月を過ぎたら作らない", () => {
    const s = monthly({ startMonth: "2026-04", endMonth: "2026-06" });
    expect(scheduledMonths(s, "2027-01-01")).toEqual(["2026-04", "2026-05", "2026-06"]);
  });

  it("開始月がまだ先なら空", () => {
    expect(scheduledMonths(monthly({ startMonth: "2027-01" }), "2026-11-01")).toEqual([]);
  });

  it("形が不正な決まり・日付なら空", () => {
    expect(scheduledMonths(monthly({ startMonth: "2026/04" }), "2026-11-01")).toEqual([]);
    expect(scheduledMonths(monthly(), "2026/11/01")).toEqual([]);
    expect(scheduledMonths(monthly({ intervalMonths: 0 }), "2026-11-01")).toEqual([]);
  });

  it("開始月の打ち間違い（何十年も前）でも上限で止まる", () => {
    expect(scheduledMonths(monthly({ startMonth: "1950-01" }), "2026-11-01")).toHaveLength(MAX_MONTHS);
  });
});

describe("pendingMonths（まだ作っていない月）", () => {
  it("作成済みの月を除く（途中の抜けも拾う）", () => {
    expect(pendingMonths(monthly({ startMonth: "2026-07" }), "2026-11-01", ["2026-07", "2026-09"])).toEqual([
      "2026-08", "2026-10",
    ]);
  });

  it("全部作ってあれば空", () => {
    expect(pendingMonths(monthly({ startMonth: "2026-09" }), "2026-11-01", ["2026-09", "2026-10"])).toEqual([]);
  });

  it("停止中は作らない", () => {
    expect(pendingMonths(monthly({ isActive: false }), "2026-11-01", [])).toEqual([]);
  });
});

describe("nextMonthToCreate（次に作る月）", () => {
  it("未作成の月があれば、その最初の月", () => {
    expect(nextMonthToCreate(monthly({ startMonth: "2026-08" }), "2026-11-01", ["2026-08"])).toBe("2026-09");
  });

  it("今日までの分を作り終えていれば、次の予定の月", () => {
    expect(nextMonthToCreate(monthly({ startMonth: "2026-09" }), "2026-11-01", ["2026-09", "2026-10"])).toBe("2026-11");
    // 四半期: 10月の次は翌年1月
    expect(
      nextMonthToCreate(monthly({ startMonth: "2026-04", intervalMonths: 3 }), "2026-11-01", ["2026-04", "2026-07", "2026-10"])
    ).toBe("2027-01");
  });

  it("先の月を作成済みなら、それも飛ばす", () => {
    expect(nextMonthToCreate(monthly({ startMonth: "2026-10" }), "2026-11-01", ["2026-10", "2026-11"])).toBe("2026-12");
  });

  it("開始月がまだ先なら開始月", () => {
    expect(nextMonthToCreate(monthly({ startMonth: "2027-04" }), "2026-11-01", [])).toBe("2027-04");
  });

  it("終了月まで作り終えた・停止中なら無し", () => {
    expect(
      nextMonthToCreate(monthly({ startMonth: "2026-09", endMonth: "2026-10" }), "2026-11-01", ["2026-09", "2026-10"])
    ).toBeNull();
    expect(nextMonthToCreate(monthly({ isActive: false }), "2026-11-01", [])).toBeNull();
  });
});

describe("checkBalance（貸借の検査）", () => {
  it("合っていれば合計を返す", () => {
    expect(
      checkBalance([
        { debit_amount: 100000, credit_amount: 0 },
        { debit_amount: 10000, credit_amount: 0 },
        { debit_amount: 0, credit_amount: 110000 },
      ])
    ).toEqual({ ok: true, total: 110000 });
  });

  it("合っていなければ止める", () => {
    const r = checkBalance([
      { debit_amount: 100000, credit_amount: 0 },
      { debit_amount: 0, credit_amount: 99000 },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("貸借が一致していません");
  });

  it("0円どうしは合っていても不可", () => {
    expect(checkBalance([{ debit_amount: 0, credit_amount: 0 }]).ok).toBe(false);
  });
});

describe("validateRecurringInput（保存の前の検査）", () => {
  const base = (over: Partial<RecurringJournalInput> = {}): RecurringJournalInput => ({
    name: " 事務所家賃 ",
    description: "",
    dayOfMonth: 27,
    startMonth: "2026-11",
    endMonth: null,
    intervalMonths: 1,
    lines: [
      { account_id: "rent", sub_account_id: null, debit_amount: 110000, credit_amount: 0, tax_category: "purchase_10" },
      { account_id: "bank", sub_account_id: "", debit_amount: 0, credit_amount: 110000, tax_category: null },
    ],
    ...over,
  });

  it("名前の前後の空白を取り、空の摘要は null、空の補助科目は null にする", () => {
    const r = validateRecurringInput(base());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.name).toBe("事務所家賃");
      expect(r.value.description).toBeNull();
      expect(r.value.lines[1].sub_account_id).toBeNull();
    }
  });

  it("空の行は落とす", () => {
    const r = validateRecurringInput(
      base({
        lines: [
          ...base().lines,
          { account_id: "", sub_account_id: null, debit_amount: 0, credit_amount: 0, tax_category: null },
        ],
      })
    );
    expect(r.ok && r.value.lines).toHaveLength(2);
  });

  it("用途区分・事業区分は渡されたときだけ持つ", () => {
    const r = validateRecurringInput(
      base({
        lines: [
          { ...base().lines[0], purchase_use: "common" },
          base().lines[1],
        ],
      })
    );
    expect(r.ok && r.value.lines[0].purchase_use).toBe("common");
    expect(r.ok && "purchase_use" in r.value.lines[1]).toBe(false);
  });

  it("名前・周期・月の不備を止める", () => {
    expect(validateRecurringInput(base({ name: "  " })).ok).toBe(false);
    expect(validateRecurringInput(base({ intervalMonths: 5 })).ok).toBe(false);
    expect(validateRecurringInput(base({ dayOfMonth: 32 })).ok).toBe(false);
    expect(validateRecurringInput(base({ startMonth: "" })).ok).toBe(false);
    expect(validateRecurringInput(base({ endMonth: "2026-10" })).ok).toBe(false);
    expect(validateRecurringInput(base({ endMonth: "2027-03" })).ok).toBe(true);
  });

  it("金額があって科目が無い行・両側に金額がある行・小数の金額を止める", () => {
    const [d, c] = base().lines;
    expect(validateRecurringInput(base({ lines: [{ ...d, account_id: "" }, c] })).ok).toBe(false);
    expect(validateRecurringInput(base({ lines: [{ ...d, credit_amount: 1 }, c] })).ok).toBe(false);
    expect(validateRecurringInput(base({ lines: [{ ...d, debit_amount: 110000.5 }, c] })).ok).toBe(false);
  });

  it("借方だけ・貸借が合わないものを止める", () => {
    const [d, c] = base().lines;
    expect(validateRecurringInput(base({ lines: [d] })).ok).toBe(false);
    const r = validateRecurringInput(base({ lines: [d, { ...c, credit_amount: 100000 }] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("貸借が一致していません");
  });
});
