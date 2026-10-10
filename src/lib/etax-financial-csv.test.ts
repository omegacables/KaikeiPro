import { describe, it, expect } from "vitest";
import { balanceSheetCsv, incomeStatementCsv, checkLevels, type FsInput } from "./etax-financial-csv";

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
