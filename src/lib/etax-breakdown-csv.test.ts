import { describe, it, expect } from "vitest";
import {
  zen,
  han,
  era,
  regOrCorp,
  decimal,
  notesReceivable,
  receivables,
  advancesAndLoans,
  securities,
  notesPayable,
  payables,
  deposits,
  borrowings,
  personnel,
  rents,
  miscGainsLosses,
  toCsvText,
  type EtaxItem,
} from "./etax-breakdown-csv";

const item = (o: Partial<EtaxItem> = {}): EtaxItem => ({
  account: "売掛金",
  name: "株式会社国税商事",
  address: "東京都千代田区霞が関3-1-1",
  regNo: "T1234567890123",
  relationship: "",
  amount: 3_000_000,
  note: "",
  d: {},
  ...o,
});
const loan = { name: "みらい信用金庫", address: "", regNo: "", relationship: "", balance: 5_000_000, interest: 51_000, rate: 1.25, collateral: "" };

describe("項目の整形", () => {
  it("全角の項目は半角の英数字・記号・カナを全角に、カンマは全角に、文字数で切り詰める", () => {
    expect(zen("(株)ABC,1-2 ｶﾞｽ", 30)).toBe("（株）ＡＢＣ，１－２　ガス");
    expect(zen("㈱髙橋", 30)).toBe("（株）高橋");
    expect(zen("あいうえお", 3)).toBe("あいう");
  });

  it("半角の項目は英数字だけ、カンマは除く", () => {
    expect(han("１２３,４", 10)).toBe("1234");
  });

  it("日付は元号コード（令和5・平成4）と年月日に分ける", () => {
    expect(era("2026-03-31")).toEqual(["5", "8", "3", "31"]);
    expect(era("2019-04-30")).toEqual(["4", "31", "4", "30"]);
    expect(era("")).toEqual(["", "", "", ""]);
  });

  it("登録番号は T を除いた13桁、法人番号は13桁。どちらか一方だけ", () => {
    expect(regOrCorp("T1234567890123")).toEqual(["1234567890123", ""]);
    expect(regOrCorp("1234567890123")).toEqual(["", "1234567890123"]);
    expect(regOrCorp("abc")).toEqual(["", ""]);
  });

  it("利率・数量は整数部と小数部の桁数まで", () => {
    expect(decimal(5.1, 4, 4)).toBe("5.1");
    expect(decimal(1.23456, 4, 4)).toBe("1.2346");
    expect(decimal(100, 12, 3)).toBe("100");
    expect(decimal(null, 4, 4)).toBe("");
  });
});

describe("様式ごとの項目数（記載要領どおり）", () => {
  const counts = (rows: string[][]) => rows.map((r) => r.length);
  it("各様式の行は既定の項目数ちょうど", () => {
    expect(counts(notesReceivable([item()]).rows)).toEqual([18]);
    expect(counts(receivables([item()]).rows)).toEqual([9]);
    expect(counts(advancesAndLoans([item({ account: "仮払金" })], [loan]).rows)).toEqual([10, 11]);
    expect(counts(securities([item()]).rows)).toEqual([18]);
    expect(counts(notesPayable([item()]).rows)).toEqual([17]);
    expect(counts(payables([item({ account: "買掛金" })], [item({ d: { fixed_date: "2026-03-31" } })], []).rows)).toEqual([9, 7]);
    expect(counts(deposits([item({ account: "預り金" })]).rows)).toEqual([10]);
    expect(counts(borrowings([loan]).rows)).toEqual([9]);
    expect(counts(personnel({ officer: 1, salary: 2, wage: 3 }).rows)).toEqual([10]);
    expect(counts(rents([item()], [item()], [item()]).rows)).toEqual([19, 13, 21]);
    expect(counts(miscGainsLosses([{ account: "雑収入", description: "", name: "", address: "", regNo: "", amount: 1 }], []).rows)).toEqual([9]);
  });

  it("売掛金の行（ファイル名・区分・科目・登録番号・金額）", () => {
    const f = receivables([item()]);
    expect(f.fileName).toBe("HOI030_4.0_売掛金（未収入金）の内訳書.csv");
    expect(toCsvText(f)).toBe("3,0,売掛金,1234567890123,,株式会社国税商事,東京都千代田区霞が関３－１－１,3000000,\r\n");
  });

  it("借入金は利率を%で、人件費は計を自分で足す", () => {
    expect(borrowings([loan]).rows[0]).toEqual(["11", "0", "みらい信用金庫", "", "", "5000000", "51000", "1.25", ""]);
    expect(personnel({ officer: 100, salary: 200, wage: 300 }).rows[0]).toEqual(["14-3", "0", "100", "", "200", "", "300", "", "600", ""]);
  });
});
