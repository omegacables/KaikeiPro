import { describe, it, expect } from "vitest";
import {
  ITEM_FORM_SPECS,
  findItemFormSpec,
  buildSheetSection,
  reconcileItems,
  emptyItem,
  withFieldValue,
  fieldValue,
  type BreakdownItem,
} from "@/lib/breakdown-items";
import { BREAKDOWN_FORMS, type BalanceAccount } from "@/lib/breakdown";

let seq = 0;
const item = (over: Partial<BreakdownItem>): BreakdownItem => ({
  ...emptyItem("main", seq, `i${seq++}`),
  ...over,
});
const names: Record<string, string> = { ar: "売掛金", other: "未収入金" };
const accountName = (id: string | null) => (id ? names[id] ?? "" : "");
const mainOf = (key: string) => findItemFormSpec(key)!.sections[0];
const labels = (rows: ReturnType<typeof buildSheetSection>["rows"]) =>
  rows.map((r) => (r.kind === "item" ? r.item.name : `その他:${r.label}:${r.amount}:${r.count}`));

describe("様式の定義", () => {
  it("入力が必要な様式はすべて定義がある", () => {
    for (const f of BREAKDOWN_FORMS.filter((f) => f.status === "needs_items")) {
      if (f.key === "12" || f.key === "13") continue; // 対象外
      expect(findItemFormSpec(f.key), f.key).toBeDefined();
    }
  });
  it("様式のキーはDBの制約と一致する", () => {
    expect(ITEM_FORM_SPECS.map((s) => s.key).sort()).toEqual(
      ["2", "3", "4-1", "6", "8", "9", "10-1", "15-1", "15-2"].sort()
    );
  });
});

describe("③売掛金: 50万円以上は各別、5口に満たなければ多額なものから5口", () => {
  it("50万円以上が5口未満なら、多額なものから5口まで記入し、残りは科目ごとに一括", () => {
    const items = [
      item({ name: "A", amount: 800_000, accountId: "ar" }),
      item({ name: "B", amount: 300_000, accountId: "ar" }),
      item({ name: "C", amount: 200_000, accountId: "ar" }),
      item({ name: "D", amount: 100_000, accountId: "other" }),
      item({ name: "E", amount: 90_000, accountId: "ar" }),
      item({ name: "F", amount: 50_000, accountId: "ar" }),
      item({ name: "G", amount: 40_000, accountId: "other" }),
    ];
    const s = buildSheetSection(mainOf("3"), items, accountName);
    expect(labels(s.rows)).toEqual(["A", "B", "C", "D", "E", "その他:売掛金:50000:1", "その他:未収入金:40000:1"]);
    expect(s.total).toBe(1_580_000);
  });

  it("50万円以上が5口以上あれば、50万円未満は各別にしない", () => {
    const items = [1, 2, 3, 4, 5, 6].map((n) => item({ name: `P${n}`, amount: 500_000 + n, accountId: "ar" }));
    items.push(item({ name: "small", amount: 499_999, accountId: "ar" }));
    const s = buildSheetSection(mainOf("3"), items, accountName);
    expect(s.rows.filter((r) => r.kind === "item")).toHaveLength(6);
    expect(labels(s.rows).at(-1)).toBe("その他:売掛金:499999:1");
  });

  it("入力途中の空の行や0円の行は「その他」に数えない", () => {
    const items = [
      item({ name: "A", amount: 800_000, accountId: "ar" }),
      item({}),
      item({ name: "Z", amount: 0, accountId: "ar" }),
    ];
    const s = buildSheetSection(mainOf("3"), items, accountName);
    expect(labels(s.rows)).toEqual(["A"]);
  });

  it("100口を超えたら100行目に残額をまとめる", () => {
    const items = Array.from({ length: 120 }, (_, n) => item({ name: `P${n}`, amount: 1_000_000 + n, accountId: "ar" }));
    const s = buildSheetSection(mainOf("3"), items, accountName);
    expect(s.rows).toHaveLength(100);
    const last = s.rows[99];
    expect(last.kind).toBe("rest");
    expect(last.kind === "rest" && last.count).toBe(21);
  });
});

describe("④仮払金・⑩仮受金: 関連者は金額に関わらず各別", () => {
  it("法人・代表者との関係が入っていれば50万円未満でも記入し、5口の補充はしない", () => {
    const items = [
      item({ name: "社長", amount: 10_000, relationship: "代表取締役" }),
      item({ name: "X", amount: 600_000 }),
      item({ name: "Y", amount: 100_000 }),
    ];
    const s = buildSheetSection(mainOf("4-1"), items, accountName);
    expect(labels(s.rows)).toEqual(["社長", "X", "その他::100000:1"]);
  });
});

describe("②受取手形: 一取引先の総額100万円以上で判定", () => {
  const spec = mainOf("2");
  it("1枚ずつは100万円未満でも、同じ振出人の合計が100万円以上なら全て各別", () => {
    const items = [
      item({ name: "甲", amount: 600_000 }),
      item({ name: "甲", amount: 500_000 }),
      ...[1, 2, 3, 4, 5].map((n) => item({ name: `乙${n}`, amount: 1_000_000 + n })),
      item({ name: "丙", amount: 300_000 }),
      item({ name: "丁", amount: 200_000, details: { discount_bank: "みらい銀行本店" } }),
    ];
    const s = buildSheetSection(spec, items, accountName);
    expect(labels(s.rows)).toEqual([
      "甲", "甲", "乙5", "乙4", "乙3", "乙2", "乙1",
      "その他::300000:1",
      "その他:割引分（みらい銀行本店）:200000:1",
    ]);
  });
  it("融通手形は金額に関わらず各別", () => {
    const items = [
      ...[1, 2, 3, 4, 5].map((n) => item({ name: `乙${n}`, amount: 2_000_000 })),
      item({ name: "融", amount: 10_000, details: { accommodation: true } }),
    ];
    const s = buildSheetSection(spec, items, accountName);
    expect(labels(s.rows)[0]).toBe("融");
  });
});

describe("⑮地代家賃: 金額基準なし（全件）", () => {
  it("少額でもすべて記入する", () => {
    const items = [item({ name: "大家", amount: 12_000 }), item({ name: "地主", amount: 1_000 })];
    const s = buildSheetSection(mainOf("15-1"), items, accountName);
    expect(labels(s.rows)).toEqual(["大家", "地主"]);
  });
  it("下段（権利金等）は主たる表に混ざらない", () => {
    const items = [item({ name: "大家", amount: 120_000 }), item({ name: "権利", amount: 300_000, section: "key_money" })];
    const spec = findItemFormSpec("15-1")!;
    expect(labels(buildSheetSection(spec.sections[0], items, accountName).rows)).toEqual(["大家"]);
    expect(labels(buildSheetSection(spec.sections[1], items, accountName).rows)).toEqual(["権利"]);
  });
});

describe("試算表との照合", () => {
  const acc = (id: string, name: string, category: BalanceAccount["category"], currentBalance: number): BalanceAccount => ({
    id, code: id, name, category, plClassification: null, currentBalance,
  });

  it("科目欄のある様式は科目ごとに照合し、科目未選択の明細は別に示す", () => {
    const balances = [
      acc("ar", "売掛金", "asset", 1_000_000),
      acc("other", "未収入金", "asset", 50_000),
      acc("cash", "現金", "asset", 999),
    ];
    const items = [
      item({ accountId: "ar", amount: 700_000 }),
      item({ accountId: "ar", amount: 300_000 }),
      item({ accountId: null, amount: 50_000 }),
    ];
    const checks = reconcileItems(findItemFormSpec("3")!, items, balances);
    expect(checks.map((c) => [c.label, c.check.difference])).toEqual([
      ["売掛金", 0],
      ["未収入金", 50_000],
      ["科目未選択", -50_000],
    ]);
  });

  it("負債科目は貸方残高を正として照合する。税金の未払は対象外", () => {
    const balances = [acc("ap", "買掛金", "liability", -400_000), acc("tax", "未払法人税等", "liability", -90_000)];
    const items = [item({ accountId: "ap", amount: 400_000 }), item({ section: "dividend", amount: 1_000_000 })];
    const checks = reconcileItems(findItemFormSpec("9")!, items, balances);
    expect(checks).toHaveLength(1);
    expect(checks[0].check.matches).toBe(true);
  });

  it("割引した手形は照合から除く", () => {
    const balances = [acc("n", "受取手形", "asset", 500_000)];
    const items = [item({ amount: 500_000 }), item({ amount: 300_000, details: { discount_bank: "A銀行" } })];
    const [c] = reconcileItems(findItemFormSpec("2")!, items, balances);
    expect(c.check.matches).toBe(true);
  });

  it("科目欄の無い様式で、残高も明細も無ければ照合しない", () => {
    expect(reconcileItems(findItemFormSpec("8")!, [], [acc("n", "支払手形", "liability", 0)])).toEqual([]);
    expect(reconcileItems(findItemFormSpec("8")!, [], [])).toEqual([]);
  });

  it("照合する科目が無い様式は照合しない", () => {
    expect(reconcileItems(findItemFormSpec("15-2")!, [item({ amount: 1 })], [])).toEqual([]);
  });
});

describe("欄の読み書き", () => {
  it("列と details の両方に書ける", () => {
    let i = item({});
    i = withFieldValue(i, "name", "株式会社A");
    i = withFieldValue(i, "amount", "1200");
    i = withFieldValue(i, "d.due_date", "2026-03-31");
    i = withFieldValue(i, "account", "ar");
    expect([fieldValue(i, "name"), fieldValue(i, "amount"), fieldValue(i, "d.due_date"), fieldValue(i, "account")])
      .toEqual(["株式会社A", 1200, "2026-03-31", "ar"]);
  });
});
