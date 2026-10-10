import { describe, it, expect } from "vitest";
import { balanceSheetCsv, incomeStatementCsv, changesInEquityCsv, notesCsv, checkLevels, type FsInput } from "./etax-financial-csv";
import { buildEquityChanges } from "./equity-changes";
import { buildNotes } from "./financial-notes";

const input: FsInput = {
  companyName: "株式会社MR Connect",
  period: { start: "2025-04-01", end: "2026-03-31" },
  bs: {
    assetGroups: [
      {
        title: "流動資産",
        lines: [
          { name: "現金", amount: 100_000 },
          { name: "普通預金", amount: 2_900_000 },
          { name: "売掛金", amount: 500_000 },
          { name: "貸倒引当金", amount: -5_000 },
          { name: "仮払消費税", amount: 80_000 },
        ],
        total: 3_575_000,
      },
      {
        title: "固定資産",
        lines: [],
        total: 800_000,
        subgroups: [
          { title: "有形固定資産", lines: [{ name: "器具備品", amount: 1_000_000 }, { name: "減価償却累計額", amount: -200_000 }], total: 800_000 },
        ],
      },
    ],
    liabilityGroups: [{ title: "流動負債", lines: [{ name: "未払金", amount: 375_000 }, { name: "未払法人税等", amount: 70_000 }], total: 445_000 }],
    equityGroups: [{ title: "株主資本", lines: [{ name: "資本金", amount: 1_000_000 }, { name: "繰越利益剰余金", amount: 2_930_000 }], total: 3_930_000 }],
    totalAssets: 4_375_000,
    totalLiabilities: 445_000,
    totalEquity: 3_930_000,
  },
  pl: {
    sales: [{ name: "売上高", amount: 10_000_000 }],
    cogs: [{ name: "仕入高", amount: 4_000_000 }],
    sga: [{ name: "役員報酬", amount: 3_000_000 }, { name: "接待交際費", amount: 769_911 }, { name: "サブスク利用料", amount: 120_000 }],
    nonOpRev: [],
    nonOpExp: [{ name: "支払利息", amount: 10_000 }],
    extraGain: [],
    extraLoss: [],
    tax: [{ name: "法人税、住民税及び事業税", amount: 70_000 }],
    salesT: 10_000_000,
    cogsT: 4_000_000,
    grossProfit: 6_000_000,
    sgaT: 3_889_911,
    operatingProfit: 2_110_089,
    nonOpRevT: 0,
    nonOpExpT: 10_000,
    ordinaryProfit: 2_100_089,
    extraGainT: 0,
    extraLossT: 0,
    pretaxProfit: 2_100_089,
    taxT: 70_000,
    netIncome: 2_030_089,
  },
};

const codes = (rows: string[][]) => rows.slice(5).map((r) => r[4]);

describe("財務諸表 e-Tax CSV（HOT010 Ver.3.0）", () => {
  it("貸借対照表: 先頭5行、全行5列、階層番号の決まり、コードの重複なし", () => {
    const { fileName, rows } = balanceSheetCsv(input);
    expect(fileName).toBe("HOT010_3.0_BS.csv");
    expect(rows.slice(0, 5)).toEqual([
      ["A", "BS", "", "", ""],
      ["B", "株式会社ＭＲ　Ｃｏｎｎｅｃｔ", "", "", ""],
      ["C1", "2025-04-01", "", "", ""],
      ["C2", "2026-03-31", "", "", ""],
      ["貸借対照表", "", "", "", ""],
    ]);
    expect(rows.every((r) => r.length === 5)).toBe(true);
    expect(checkLevels(rows)).toBe(true);
    expect(new Set(codes(rows)).size).toBe(codes(rows).length);
  });

  it("コード表に無い科目は区分のタイトルに枝番、控除科目はマイナス", () => {
    const { rows } = balanceSheetCsv(input);
    const find = (name: string) => rows.find((r) => r[0] === name)!;
    expect(find("現金")).toEqual(["現金", "100000", "1", "4", "10A100010-1"]);
    expect(find("普通預金")[4]).toBe("10A100010-2");
    expect(find("仮払消費税")[4]).toBe("10A100010-3");
    expect(find("売掛金")[4]).toBe("10A100090");
    expect(find("貸倒引当金")).toEqual(["貸倒引当金", "-5000", "1", "4", "10A101050"]);
    expect(find("減価償却累計額")).toEqual(["減価償却累計額", "-200000", "1", "5", "10A210920"]);
    expect(find("負債純資産合計")).toEqual(["負債純資産合計", "4375000", "1", "2", "10C000040"]);
  });

  it("損益計算書: 段階利益と合計を自分で書き、販管費の独自科目は枝番", () => {
    const { fileName, rows } = incomeStatementCsv(input);
    expect(fileName).toBe("HOT010_3.0_PL.csv");
    expect(checkLevels(rows)).toBe(true);
    const find = (name: string) => rows.find((r) => r[0] === name)!;
    expect(find("売上総利益")).toEqual(["売上総利益", "6000000", "1", "2", "10F000010"]);
    expect(find("接待交際費")[4]).toBe("10E200150");
    expect(find("サブスク利用料")[4]).toBe("10E200010-1");
    expect(find("法人税、住民税及び事業税")).toEqual(["法人税、住民税及び事業税", "70000", "1", "3", "10F100070"]);
    expect(find("当期純利益")).toEqual(["当期純利益", "2030089", "1", "2", "10F000160"]);
  });

  it("損失は名前を変えてマイナスで", () => {
    const { rows } = incomeStatementCsv({ ...input, pl: { ...input.pl, operatingProfit: -100, ordinaryProfit: -100, pretaxProfit: -100, netIncome: -100 } });
    expect(rows.find((r) => r[4] === "10F000110")).toEqual(["営業損失", "-100", "1", "2", "10F000110"]);
    expect(rows.find((r) => r[4] === "10F000160")).toEqual(["当期純損失", "-100", "1", "2", "10F000160"]);
  });
});

describe("株主資本等変動計算書・個別注記表の e-Tax CSV", () => {
  const ce = buildEquityChanges(
    [
      { name: "資本金", opening: 1_000_000, closing: 1_000_000 },
      { name: "繰越利益剰余金", opening: 900_000, closing: 800_000 },
      { name: "別途積立金", opening: 0, closing: 100_000 },
    ],
    2_030_089
  );
  const ss = changesInEquityCsv({ companyName: input.companyName, period: input.period, ce });

  it("SS: 先頭5行、全行5列、階層番号の決まり、コードの重複なし", () => {
    expect(ss.fileName).toBe("HOT010_3.0_SS.csv");
    expect(ss.rows.slice(0, 5).map((r) => r[0])).toEqual(["A", "B", "C1", "C2", "株主資本等変動計算書"]);
    expect(ss.rows[0][1]).toBe("SS");
    expect(ss.rows.every((r) => r.length === 5)).toBe(true);
    expect(checkLevels(ss.rows)).toBe(true);
    const c = codes(ss.rows);
    expect(new Set(c).size).toBe(c.length);
  });

  it("SS: 項目ごとに 期首→当期変動額→事由→合計→期末。純利益は繰越利益剰余金と合計の列に", () => {
    const row = (code: string) => ss.rows.find((r) => r[4] === code);
    expect(row("SS0201")?.slice(1, 4)).toEqual(["1000000", "1", "4"]);
    expect(row("SS2000")?.slice(0, 4)).toEqual(["繰越利益剰余金", "", "T", "5"]);
    expect(row("SS2006")?.[1]).toBe("2030089");
    expect(row("SS2002-1")?.[1]).toBe("-100000"); // 別途積立金への積立
    expect(row("SS2099")?.[1]).toBe("2830089");
    expect(row("SS0900-1")?.[0]).toBe("別途積立金");
    expect(row("SS0900-1-2-15")?.[1]).toBe("100000");
    expect(row("SS0906")?.[1]).toBe("2030089");
    expect(row("SS3106")?.[1]).toBe("2030089");
    expect(row("SS3199")?.[1]).toBe("3930089");
    expect(row("SS2306")).toBeDefined();
    expect(row("SS0300")).toBeUndefined(); // 資本剰余金が無ければ書かない
  });

  it("NT: 減価償却は NT0205、消費税は「その他」の項目名・内容。行区分は2、カンマは全角", () => {
    const notes = buildNotes({ depreciationMethods: ["declining_balance"], taxAccounting: "exclusive", hasTreasuryStock: false });
    notes[0].items[0].text += "（A,B）";
    const nt = notesCsv({ companyName: input.companyName, period: input.period, notes });
    expect(nt.fileName).toBe("HOT010_3.0_NT.csv");
    expect(nt.rows[0][1]).toBe("NT");
    expect(nt.rows.every((r) => r.length === 5)).toBe(true);
    expect(checkLevels(nt.rows)).toBe(true);
    expect(codes(nt.rows)).toEqual(["NT0201", "NT0205", "NT0208", "NT0210", "NT0211", "NT0212", "NT0501", "NT0522"]);
    const dep = nt.rows.find((r) => r[4] === "NT0205")!;
    expect(dep[2]).toBe("2");
    expect(dep[1]).toContain("（A，B）");
    expect(nt.rows.find((r) => r[4] === "NT0211")![1]).toBe("消費税等の会計処理");
    expect(nt.rows.find((r) => r[4] === "NT0212")![1]).toBe("消費税等の会計処理は、税抜方式によっている。");
    expect(nt.rows.find((r) => r[4] === "NT0210")!.slice(1, 4)).toEqual(["", "T", "4"]);
    expect(nt.rows.find((r) => r[4] === "NT0522")![1]).toContain("自己株式は保有していない");
  });
});
