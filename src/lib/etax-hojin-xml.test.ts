import { describe, it, expect } from "vitest";
import { computeCorporateTaxReturn, STANDARD_LOCAL_RATES, type CorporateInput } from "./corporate-tax-return";
import { corporateTaxXml } from "./etax-hojin-xml";
import type { Filer } from "./etax-xml";

// 国税庁のスキーマ（hojin/RHO0012-260.xsd）での検証は開発時に xmllint で行った（利益・欠損・防衛特別法人税の3通り）。
// ここでは、スキーマでは見つからない誤り（参照先の無い IDREF・空の要素・帳票間の数字の食い違い・符号）を確かめる。

const input = (o: Partial<CorporateInput> = {}): CorporateInput => ({
  period: { start: "2025-09-01", end: "2026-08-31", months: 12 }, capital: 10_000_000, employees: 5, netIncome: 0, taxExpenseBooked: 0,
  entertainment: 0, entertainmentDining: null, depreciation: { excess: 0, allowed: 0, openingExcess: 0, closingExcess: 0 }, withholdingTax: 0,
  adjustments: [], losses: [], interim: { corporate: 0, localCorporate: 0, prefectural: 0, municipal: 0, enterprise: 0 }, openingRetained: [],
  retainedEarnings: { opening: 0, closingBeforeIncome: 0 }, priorEnterpriseTaxPaid: 0, localRates: STANDARD_LOCAL_RATES, ...o,
});
const filer: Filer = {
  taxOfficeCode: "01101", taxOfficeName: "麹町", etaxUserId: "1234567890123456", corporateNumber: "1234567890123",
  name: "株式会社テスト", nameKana: "カブシキガイシャテスト", postalCode: "100-0001", address: "東京都千代田区千代田1-1",
  telephone: null, representativeName: "山田 太郎", representativeKana: null,
};
const make = (i: CorporateInput, defenseApplies = false) =>
  corporateTaxXml({
    ret: computeCorporateTaxReturn(i),
    filer,
    period: i.period,
    priorPeriod: { start: "2024-09-01", end: "2025-08-31" },
    capital: i.capital,
    businessDescription: "ソフトウェア開発",
    defenseApplies,
    today: "2026-10-11",
  });
const val = (xml: string, tag: string) => xml.match(new RegExp(`<${tag}>(-?\\d+)</${tag}>`))?.[1] ?? null;

const profit = input({
  netIncome: 8_000_000, taxExpenseBooked: 900_000, entertainment: 9_500_000, entertainmentDining: 3_000_000, withholdingTax: 15_315,
  depreciation: { excess: 120_000, allowed: 30_000, openingExcess: 200_000, closingExcess: 290_000 },
  adjustments: [
    { kind: "add", name: "役員賞与引当金繰入額", amount: 300_000, treatment: "retained" },
    { kind: "add", name: "寄附金の損金不算入額", amount: 50_000, treatment: "outflow" },
    { kind: "deduct", name: "未収還付事業税", amount: 40_000, treatment: "retained" },
  ],
  losses: [{ periodEnd: "2023-08-31", amount: 1_000_000 }],
  interim: { corporate: 300_000, localCorporate: 30_900, prefectural: 20_000, municipal: 60_000, enterprise: 150_000 },
  openingRetained: [{ name: "納税充当金", amount: 500_000 }, { name: "未納法人税等", amount: -250_000 }, { name: "利益準備金", amount: 100_000 }],
  retainedEarnings: { opening: 3_000_000, closingBeforeIncome: 3_000_000 },
});

describe("法人税申告書の e-Tax ファイル（.xtx）", () => {
  const r = make(profit);

  it("RHO0012（令和8年度版）。IT部・別表一・次葉一・次葉二・別表四・五(一)・五(二)・七(一)・十五 の順", () => {
    expect(r.fileName).toBe("RHO0012_20250901_20260831.xtx");
    expect(r.xml).toContain('<RHO0012 VR="26.0.0" id="RHO0012">');
    const order = ["<IT ", "<HOA112 ", "<HOA114 ", "<HOA116 ", "<HOA420 ", "<HOA511 ", "<HOA522 ", "<HOB710 ", "<HOE200 "].map((t) => r.xml.indexOf(t));
    expect(order.every((p, k) => p > 0 && (k === 0 || p > order[k - 1]))).toBe(true);
    expect(r.xml).toContain("<SHINKOKU_KBN ID=\"SHINKOKU_KBN\"><kubun_CD>30</kubun_CD></SHINKOKU_KBN>"); // 確定／確定
    expect(r.xml).toContain('<SHIHON_KIN ID="SHIHON_KIN">10000000</SHIHON_KIN>');
  });

  it("IDREF は IT部にある ID だけ、空の要素は無い", () => {
    const ids = new Set([...r.xml.matchAll(/ ID="([A-Z_]+)"/g)].map((m) => m[1]));
    const refs = [...r.xml.matchAll(/IDREF="([A-Z_]+)"/g)].map((m) => m[1]);
    expect(refs.filter((x) => !ids.has(x))).toEqual([]);
    expect(r.xml).not.toMatch(/<([A-Za-z0-9-]+)[^>/]*><\/\1>/);
  });

  it("帳票間の数字が一致する（e-Tax の帳票間チェック）", () => {
    expect(val(r.xml, "BGB00010")).toBe(val(r.xml, "ARV00010")); // 別表一1 ＝ 別表四52①
    expect(Number(val(r.xml, "BGB00020"))).toBe(Number(val(r.xml, "QHB00100")) + Number(val(r.xml, "QHB00140"))); // 2 ＝ 77＋79
    expect(val(r.xml, "BGC00060")).toBe(val(r.xml, "QHC00050")); // 31 ＝ 82
    expect(val(r.xml, "ARC00215")).toBe(val(r.xml, "EGE00000")); // 別表四8 ＝ 別表十五5
    expect(val(r.xml, "MCB00002")).toBe(val(r.xml, "ARS50010")); // 別表七1 ＝ 別表四43
  });

  it("別表四: 法人税等（2）と住民税（3）を分け、自由記入行は社外流出を「その他」で。欠損金の控除（44）は正の数", () => {
    expect(val(r.xml, "ARC00020")).toBe("330900"); // 中間の法人税＋地方法人税
    expect(val(r.xml, "ARC00050")).toBe("80000"); // 中間の住民税
    expect(r.xml).toContain("<ARC00230>役員賞与引当金繰入額</ARC00230><ARC00240>300000</ARC00240><ARC00250>300000</ARC00250>");
    expect(r.xml).toContain("<ARC00280>寄附金の損金不算入額</ARC00280><ARC00290>50000</ARC00290><ARC00310>その他</ARC00310><ARC00320>50000</ARC00320>");
    expect(val(r.xml, "ART00010")).toBe("1000000");
    expect(val(r.xml, "ARV00040")).toBe("-1000000"); // 52の社外流出（※）は△
  });

  it("別表五(一): 未納法人税等は正の数で書き、増は中間・確定に分ける。利益準備金は1行目", () => {
    expect(val(r.xml, "ICB00540")).toBe("250000");
    expect(val(r.xml, "ICB00580")).toBe("330900");
    expect(r.xml).toContain("<ICB00010><ICB00020>100000</ICB00020>");
    expect(r.xml).toMatch(/<ICB00150>減価償却超過額<\/ICB00150><ICB00160>200000<\/ICB00160>/);
  });

  it("別表五(二): 前期分の行に前事業年度の自・至", () => {
    expect(r.xml).toMatch(/<IEB00010><IEB00020><gen:era>5<\/gen:era><gen:yy>6<\/gen:yy><gen:mm>9<\/gen:mm><gen:dd>1<\/gen:dd><\/IEB00020>/);
  });

  it("防衛特別法人税: 対象外の年度は見出しだけ、対象の年度は税額が0でも書く", () => {
    expect(r.xml).toMatch(/<HOA114 [^>]*><KZA00000>.*?<\/KZA00000><\/HOA114>/);
    const d = make(input({ period: { start: "2026-04-01", end: "2027-03-31", months: 12 }, netIncome: 1_000_000 }), true);
    expect(d.xml).toContain("<BGA00365><kubun_CD>1</kubun_CD></BGA00365>");
    expect(val(d.xml, "KZB00130")).toBe("0"); // 50
    expect(val(d.xml, "KZB00200")).toBe("0"); // 57
  });

  it("欠損の期は別表七に当期分の欠損金、翌期繰越額は別表一27と一致", () => {
    const l = make(input({ netIncome: -2_500_000, losses: [{ periodEnd: "2024-08-31", amount: 400_000 }] }));
    expect(val(l.xml, "BGB00010")).toBe("-2500000");
    expect(val(l.xml, "MCB00270")).toBe("2500000");
    expect(val(l.xml, "MCB00370")).toBe(val(l.xml, "BGB00470"));
    expect(val(l.xml, "MCB00370")).toBe("2900000");
  });

  it("令和8年4月1日より前に終わる事業年度・自由記入行が多すぎるときは作らない", () => {
    expect(() => make(input({ period: { start: "2025-04-01", end: "2026-03-31", months: 12 } }))).toThrow(/令和8年4月1日以後/);
    const many = Array.from({ length: 5 }, (_, k) => ({ kind: "add" as const, name: `加算${k}`, amount: 1000, treatment: "retained" as const }));
    expect(() => make(input({ netIncome: 100_000, adjustments: many }))).toThrow(/4行/);
  });
});
