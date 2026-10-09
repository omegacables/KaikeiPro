import { describe, it, expect } from "vitest";
import {
  BREAKDOWN_FORMS,
  findBreakdownForm,
  isListed,
  selectListedRows,
  LOAN_LISTING_RULE,
  MISC_LISTING_RULE,
  naturalBalance,
  isBorrowingAccount,
  isLendingAccount,
  isInterestExpenseAccount,
  isInterestIncomeAccount,
  personnelKindOf,
  buildPersonnelBreakdown,
  miscKindOf,
  buildMiscRows,
  reconcile,
  type BalanceAccount,
  type MiscSourceLine,
} from "./breakdown";

const acct = (
  name: string,
  category: BalanceAccount["category"],
  currentBalance = 0,
  plClassification: BalanceAccount["plClassification"] = null
): BalanceAccount => ({ id: name, code: "", name, category, plClassification, currentBalance });

describe("様式の一覧", () => {
  it("国税庁のフォーマット区分のキーで重複なく並ぶ", () => {
    const keys = BREAKDOWN_FORMS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(findBreakdownForm("11")?.title).toBe("借入金及び支払利子の内訳書");
    expect(findBreakdownForm("99")).toBeUndefined();
  });

  it("作成できる様式は ④貸付金・⑪借入金・⑭人件費・⑯雑益雑損失", () => {
    const ready = BREAKDOWN_FORMS.filter((f) => f.status === "ready").map((f) => f.key);
    expect(ready).toEqual(["4-2", "11", "14-3", "16"]);
  });
});

describe("isListed（各別に記入するか）", () => {
  it("金額基準ちょうどは各別記入、1円足りなければ一括", () => {
    expect(isListed({ amount: 500_000 }, LOAN_LISTING_RULE)).toBe(true);
    expect(isListed({ amount: 499_999 }, LOAN_LISTING_RULE)).toBe(false);
  });

  it("期中の利息が3万円以上なら残高が無くても各別記入", () => {
    expect(isListed({ amount: 0, secondary: 30_000 }, LOAN_LISTING_RULE)).toBe(true);
    expect(isListed({ amount: 0, secondary: 29_999 }, LOAN_LISTING_RULE)).toBe(false);
  });

  it("副次基準の無い様式では利息は判定に使わない", () => {
    expect(isListed({ amount: 0, secondary: 9_999_999 }, MISC_LISTING_RULE)).toBe(false);
  });

  it("関連者・還付金などは金額に関わらず各別記入", () => {
    expect(isListed({ amount: 1, mustList: true }, MISC_LISTING_RULE)).toBe(true);
  });
});

describe("selectListedRows", () => {
  const rule = LOAN_LISTING_RULE;
  const facts = (x: { a: number; m?: boolean }) => ({ amount: x.a, mustList: x.m });

  it("各別記入を金額の多い順に並べ、関連者を先頭にする", () => {
    const r = selectListedRows([{ a: 600_000 }, { a: 900_000 }, { a: 1, m: true }], rule, facts);
    expect(r.listed.map((x) => x.a)).toEqual([1, 900_000, 600_000]);
  });

  it("基準に満たないものは一括の金額・件数にまとめる", () => {
    const r = selectListedRows([{ a: 600_000 }, { a: 100_000 }, { a: 200_000 }], rule, facts);
    expect(r.listed).toHaveLength(1);
    expect(r.rest).toEqual({ amount: 300_000, secondary: 0, count: 2 });
  });

  it("100口を超えたら99口を各別に残し、残りを100行目用にまとめる。関連者は残す", () => {
    const many = Array.from({ length: 150 }, (_, i) => ({ a: 1_000_000 + i }));
    const r = selectListedRows([...many, { a: 1, m: true }], rule, facts);
    expect(r.listed).toHaveLength(99);
    expect(r.listed[0]).toEqual({ a: 1, m: true });
    expect(r.rest.count).toBe(52);
  });
});

describe("試算表の科目との対応", () => {
  it("負債・収益は貸方残高を正の値にする", () => {
    expect(naturalBalance(acct("短期借入金", "liability", -3_000_000))).toBe(3_000_000);
    expect(naturalBalance(acct("現金", "asset", 50_000))).toBe(50_000);
    expect(naturalBalance(acct("受取利息", "revenue", -1_200))).toBe(1_200);
  });

  it("借入金・貸付金・利息の科目を名前で判定する", () => {
    expect(isBorrowingAccount(acct("長期借入金", "liability"))).toBe(true);
    expect(isBorrowingAccount(acct("役員借入金", "liability"))).toBe(true);
    expect(isBorrowingAccount(acct("借入金", "asset"))).toBe(false);
    expect(isLendingAccount(acct("短期貸付金", "asset"))).toBe(true);
    expect(isInterestExpenseAccount(acct("支払利息", "expense"))).toBe(true);
    expect(isInterestIncomeAccount(acct("受取利息", "revenue"))).toBe(true);
  });
});

describe("人件費の内訳書", () => {
  it("役員給与・従業員給料手当・従業員賃金手当に分ける", () => {
    expect(personnelKindOf(acct("役員報酬", "expense"))).toBe("officer");
    expect(personnelKindOf(acct("役員賞与", "expense"))).toBe("officer");
    expect(personnelKindOf(acct("給料手当", "expense", 0, "sga"))).toBe("salary");
    expect(personnelKindOf(acct("賞与", "expense", 0, "sga"))).toBe("salary");
    // 製造原価・売上原価に入る賃金は「従業員賃金手当」
    expect(personnelKindOf(acct("賃金", "expense", 0, "cogs"))).toBe("wage");
  });

  it("退職金・法定福利費・福利厚生費・引当金は含めない", () => {
    expect(personnelKindOf(acct("役員退職金", "expense"))).toBeNull();
    expect(personnelKindOf(acct("退職給付費用", "expense"))).toBeNull();
    expect(personnelKindOf(acct("法定福利費", "expense"))).toBeNull();
    expect(personnelKindOf(acct("福利厚生費", "expense"))).toBeNull();
    expect(personnelKindOf(acct("賞与引当金繰入額", "expense"))).toBeNull();
    expect(personnelKindOf(acct("地代家賃", "expense"))).toBeNull();
  });

  it("区分ごとの総額と合計を出す", () => {
    const r = buildPersonnelBreakdown([
      acct("役員報酬", "expense", 6_000_000, "sga"),
      acct("給料手当", "expense", 4_800_000, "sga"),
      acct("賞与", "expense", 600_000, "sga"),
      acct("賃金", "expense", 3_000_000, "cogs"),
      acct("法定福利費", "expense", 900_000, "sga"),
    ]);
    expect(r.officer.total).toBe(6_000_000);
    expect(r.salary.total).toBe(5_400_000);
    expect(r.wage.total).toBe(3_000_000);
    expect(r.total).toBe(14_400_000);
    expect(r.salary.accounts.map((a) => a.name)).toEqual(["給料手当", "賞与"]);
  });
});

describe("雑益・雑損失等の内訳書", () => {
  it("雑益・雑損失の科目を判定する", () => {
    expect(miscKindOf(acct("雑収入", "revenue"))).toBe("gain");
    expect(miscKindOf(acct("固定資産売却益", "revenue"))).toBe("gain");
    expect(miscKindOf(acct("雑損失", "expense"))).toBe("loss");
    expect(miscKindOf(acct("貸倒損失", "expense"))).toBe("loss");
    expect(miscKindOf(acct("売上高", "revenue"))).toBeNull();
  });

  const line = (o: Partial<MiscSourceLine>): MiscSourceLine => ({
    kind: "gain",
    accountName: "雑収入",
    description: "",
    counterparty: null,
    address: null,
    registrationNumber: null,
    amount: 0,
    ...o,
  });

  it("同じ科目・同じ相手先は束ねてから10万円基準で判定する", () => {
    const r = buildMiscRows(
      [
        line({ counterparty: "A社", description: "手数料", amount: 60_000 }),
        line({ counterparty: "A社", description: "手数料", amount: 50_000 }),
      ],
      "gain"
    );
    expect(r.listed).toHaveLength(1);
    expect(r.listed[0].amount).toBe(110_000);
    expect(r.listed[0].lineCount).toBe(2);
  });

  it("相手先が分からない仕訳は束ねない（別の相手を1行に混ぜない）", () => {
    const r = buildMiscRows(
      [line({ amount: 60_000 }), line({ amount: 60_000 })],
      "gain"
    );
    expect(r.listed).toHaveLength(0);
    expect(r.rest.count).toBe(2);
  });

  it("税金の還付金は10万円未満でも記入する", () => {
    const r = buildMiscRows(
      [line({ description: "法人税還付金", amount: 8_000 })],
      "gain"
    );
    expect(r.listed).toHaveLength(1);
    expect(r.listed[0].isTaxRefund).toBe(true);
  });

  it("取引の内容が違う仕訳を束ねたら「ほか」を付ける", () => {
    const r = buildMiscRows(
      [
        line({ counterparty: "B社", description: "協賛金", amount: 80_000 }),
        line({ counterparty: "B社", description: "紹介料", amount: 80_000 }),
      ],
      "gain"
    );
    expect(r.listed[0].description).toBe("協賛金ほか");
  });

  it("雑益と雑損失は別々に扱う", () => {
    const r = buildMiscRows(
      [line({ kind: "loss", accountName: "雑損失", counterparty: "C社", amount: 500_000 })],
      "gain"
    );
    expect(r.listed).toHaveLength(0);
    expect(r.rest.count).toBe(0);
  });
});

describe("reconcile（試算表との照合）", () => {
  it("内訳の合計が科目残高と一致すれば一致", () => {
    const r = reconcile([acct("短期借入金", "liability", -2_000_000)], 2_000_000);
    expect(r).toMatchObject({ accountTotal: 2_000_000, difference: 0, matches: true });
  });

  it("一致しなければ差額を返す（自動で埋めない）", () => {
    const r = reconcile(
      [acct("短期借入金", "liability", -2_000_000), acct("長期借入金", "liability", -1_000_000)],
      2_500_000
    );
    expect(r.difference).toBe(500_000);
    expect(r.matches).toBe(false);
    expect(r.accountNames).toEqual(["短期借入金", "長期借入金"]);
  });
});
