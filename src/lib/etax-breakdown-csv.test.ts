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
  bankDeposits,
  inventories,
  landAndBuildings,
  landSales,
  salesByOffice,
  eraAll,
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

describe("残りの様式（①⑤⑦⑩-2⑫⑬⑭）", () => {
  const counts = (rows: string[][]) => rows.map((r) => r.length);
  it("項目数は記載要領どおり", () => {
    expect(counts(bankDeposits([item({ d: { bank: "みらい信用金庫", branch: "本店", kind: "普通預金", account_no: "1234567" } })]).rows)).toEqual([8]);
    expect(counts(inventories([item({ account: "商品", d: { item: "紳士用革靴", quantity: 120, unit_price: 8500 } })]).rows)).toEqual([8]);
    expect(counts(landAndBuildings([item()]).rows)).toEqual([21]);
    expect(counts(landSales([item()]).rows)).toEqual([18]);
    expect(counts(salesByOffice([item()]).rows)).toEqual([12]);
    expect(counts(deposits([], [item({ d: { paid_month: "2026-03-01", income_kind: "1 給与所得" } })]).rows)).toEqual([7]);
    expect(counts(personnel(null, [item({ d: { title: "01 代表取締役" } }), item()]).rows)).toEqual([15, 15]);
  });

  it("①預貯金・⑤棚卸資産の行", () => {
    expect(bankDeposits([item({ amount: 5_000_000, note: "", d: { bank: "みらい信用金庫", branch: "本店", kind: "普通預金", account_no: "123-4567" } })]).rows[0]).toEqual([
      "1", "0", "みらい信用金庫", "本店", "普通預金", "123-4567", "5000000", "",
    ]);
    expect(inventories([item({ account: "商品", amount: 1_020_000, d: { item: "紳士用革靴", quantity: 120, unit_price: 8500 } })]).rows[0]).toEqual([
      "5", "0", "商品", "紳士用革靴", "120", "8500", "1020000", "",
    ]);
  });

  it("⑩-2 は支払年月と所得の種類コード", () => {
    expect(deposits([], [item({ amount: 45_000, d: { paid_month: "2026-03-01", income_kind: "3 報酬・料金等" } })]).rows[0]).toEqual([
      "10-2", "0", "5", "8", "3", "3", "45000",
    ]);
  });

  it("⑭ は代表者を先頭の 14-1 に、ほかを 14-2 に。役職名・関係・常勤はコード", () => {
    const rows = personnel(null, [
      item({ name: "鈴木 一郎", d: { title: "04 取締役", relation: "90 その他", fulltime: "1 常勤" } }),
      item({ name: "山田 太郎", amount: 6_000_000, d: { title: "01 代表取締役", relation: "01 本人", fulltime: "1 常勤", fixed: 6_000_000 } }),
    ]).rows;
    expect(rows.map((r) => [r[0], r[2], r[4], r[5], r[7]])).toEqual([
      ["14-1", "01", "山田　太郎", "01", "1"],
      ["14-2", "04", "鈴木　一郎", "90", "1"],
    ]);
    expect(rows[0][8]).toBe("6000000");
    expect(rows[0][10]).toBe("6000000");
  });

  it("取得年月は明治〜令和の元号コード", () => {
    expect(eraAll("1985-04-01")).toEqual(["3", "60", "4"]);
    expect(eraAll("1989-01-08")).toEqual(["4", "1", "1"]);
    expect(eraAll("2019-05-01")).toEqual(["5", "1", "5"]);
    const r = landSales([item({ d: { acquired_year: 1989 } })]).rows[0];
    expect(r.slice(-2)).toEqual(["4", "1"]);
  });
});

