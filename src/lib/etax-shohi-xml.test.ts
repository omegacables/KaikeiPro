import { describe, it, expect } from "vitest";
import { computeConsumptionTaxReturn, type ReturnInput, type ReturnSettings } from "./consumption-tax-return";
import { consumptionTaxXml } from "./etax-shohi-xml";
import { etaxKana, etaxText, missingFilerInfo, splitTel, type Filer } from "./etax-xml";

// 国税庁のスキーマ（shohi/RSH0020-232.xsd・RSH0040-232.xsd）での検証は開発時に xmllint で行った。
// ここでは、スキーマでは見つからない誤り（参照先の無い IDREF・空の要素・帳票間の数字の食い違い）を確かめる。

const input = (o: Partial<ReturnInput> = {}): ReturnInput => ({
  sales: { A: 0, B: 0 }, taxFree: 0, exempt: 0, purchaseGross: { A: 0, B: 0 }, purchaseTax: { A: 0, B: 0 },
  transition: [], badDebt: { A: 0, B: 0 }, uncategorized: 0, ...o,
});
const settings = (o: Partial<ReturnSettings> = {}): ReturnSettings => ({
  method: "standard", purchaseTaxCalc: "proportional", businessType: null, interimNational: 0, interimLocal: 0, periodMonths: 12, ...o,
});
const filer: Filer = {
  taxOfficeCode: "01101", taxOfficeName: "麹町", etaxUserId: "1234567890123456", corporateNumber: "1234567890123",
  name: "株式会社ＭＲコネクト", nameKana: null, postalCode: "100-0001", address: "東京都千代田区千代田1-1",
  telephone: "09074095516090", representativeName: null, representativeKana: null,
};
const make = (i: ReturnInput, s: ReturnSettings) =>
  consumptionTaxXml({
    ret: computeConsumptionTaxReturn(i, s),
    filer,
    period: { start: "2025-04-01", end: "2026-03-31" },
    basePeriodSales: null,
    today: "2026-05-20",
  });
const val = (xml: string, tag: string) => xml.match(new RegExp(`<${tag}>(-?[\\d.]+)</${tag}>`))?.[1] ?? null;

describe("消費税申告書の e-Tax ファイル（.xtx）", () => {
  const std = make(
    input({ sales: { A: 1_080_000, B: 22_000_000 }, purchaseGross: { A: 540_000, B: 8_800_000 }, badDebt: { A: 0, B: 110_000 } }),
    settings({ interimNational: 300_000, interimLocal: 84_600 })
  );

  it("一般用は RSH0020、外枠・IT部・帳票の順", () => {
    expect(std.fileName).toBe("RSH0020_20250401_20260331.xtx");
    expect(std.xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<DATA ')).toBe(true);
    const order = ["<CATALOG", "<IT ", "<SHA010 ", "<SHB017 ", "<SHB033 "].map((t) => std.xml.indexOf(t));
    expect(order.every((p, k) => p > 0 && (k === 0 || p > order[k - 1]))).toBe(true);
    expect(std.xml).toContain('<RSH0020 VR="23.2.0" id="RSH0020">');
    expect(std.xml).toContain('<SHA010 VR="10.0" id="SHA010-1"');
  });

  it("IDREF は IT部にある ID だけを参照し、空の要素は無い", () => {
    const ids = new Set([...std.xml.matchAll(/ ID="([A-Z_]+)"/g)].map((m) => m[1]));
    const refs = [...std.xml.matchAll(/IDREF="([A-Z_]+)"/g)].map((m) => m[1]);
    expect(refs.length).toBeGreaterThan(10);
    expect(refs.filter((r) => !ids.has(r))).toEqual([]);
    // 電話番号を分けられないとき・フリガナが無いときは IT部にも帳票にも書かない
    expect(ids.has("NOZEISHA_TEL")).toBe(false);
    expect(std.xml).not.toMatch(/<([A-Za-z0-9-]+)[^>/]*><\/\1>/);
    expect(std.xml).not.toMatch(/<[A-Z]{3}\d{5}\/>/);
  });

  it("第一表・第二表・付表の数字が一致する（e-Tax の帳票間チェック）", () => {
    expect(val(std.xml, "AAP00000")).toBe(val(std.xml, "DSB00030")); // 第二表① ＝ 付表1-3 ①C
    expect(val(std.xml, "AAS00000")).toBe(val(std.xml, "DSD00030")); // 第二表⑪ ＝ 付表1-3 ②C
    expect(val(std.xml, "AAJ00050")).toBe(val(std.xml, "DSF00040")); // 第一表④ ＝ 付表1-3 ④C
    expect(val(std.xml, "DSF00040")).toBe(val(std.xml, "DTI00040")); // 付表1-3 ④ ＝ 付表2-3 ㉖
    expect(val(std.xml, "AAJ00100")).toBe(val(std.xml, "DSH00000")); // 第一表⑨ ＝ 付表1-3 ⑨
    expect(val(std.xml, "AAJ00110")).toBe("300000");
    expect(Number(val(std.xml, "AAK00130"))).toBe(Number(val(std.xml, "AAJ00120")) + Number(val(std.xml, "AAK00080"))); // ㉖ ＝ ⑪＋㉒
    expect(val(std.xml, "DTD00000")).toBe("100");
  });

  it("還付は合計税額（第一表㉖）と第二表⑳㉓にマイナス", () => {
    const r = make(input({ sales: { A: 0, B: 1_100_000 }, taxFree: 5_000_000, purchaseGross: { A: 0, B: 4_400_000 } }), settings());
    expect(val(r.xml, "AAK00130")).toBe("-300000");
    expect(val(r.xml, "AAW00010")).toBe("-234000");
    expect(val(r.xml, "AAJ00090")).toBe("234000"); // 控除不足還付税額は正の数
  });

  it("簡易課税は RSH0040。事業区分が2つ以上なら付表5-3 に区分ごとの明細と選んだ計算", () => {
    const r = make(
      input({ sales: { A: 1_080_000, B: 22_000_000 }, salesByType: { 1: { A: 1_080_000, B: 17_600_000 }, 5: { A: 0, B: 4_400_000 } } }),
      settings({ method: "simplified", businessType: 1 })
    );
    expect(r.fileName.startsWith("RSH0040_")).toBe(true);
    expect(r.xml).toContain('<SHA020 VR="9.0"');
    expect(val(r.xml, "DVD00100")).toBe("17000000"); // 第1種の課税売上高
    expect(val(r.xml, "DVD00110")).toBe("80.9"); // 売上割合
    expect(val(r.xml, "DVD00340")).toBe("4000000"); // 第5種
    expect(r.xml).toMatch(/<DVE00060><DVE00070><kubun_CD>1<\/kubun_CD><\/DVE00070>/); // 第1種で75%以上
    expect(val(r.xml, "DVE00750")).toBe(val(r.xml, "ABI00050")); // ㊲ ＝ 第一表④
    expect(val(r.xml, "ABL00040")).toBe("17000"); // 参考事項の課税売上高は千円単位
  });

  it("2割特例はまだ作れない", () => {
    expect(() => make(input({ sales: { A: 0, B: 1_100_000 } }), settings({ method: "special_20" }))).toThrow(/2割特例/);
  });
});

describe("e-Tax の文字・番号", () => {
  it("半角カナは全角に、全角英字はそのまま。フリガナはカタカナに", () => {
    expect(etaxText("ｶﾌﾞｼｷ ＭＲ\n")).toBe("カブシキ ＭＲ");
    expect(etaxKana("かぶしき")).toBe("カブシキ");
  });
  it("電話番号は区切りがあるときだけ3つに分ける", () => {
    expect(splitTel("03-1234-5678")).toEqual(["03", "1234", "5678"]);
    expect(splitTel("０９０（１２３４）５６７８")).toEqual(["090", "1234", "5678"]);
    expect(splitTel("09012345678")).toBeNull();
  });
  it("提出に必要な情報が足りなければ知らせる", () => {
    expect(missingFilerInfo({ name: "A", address: "B" })).toEqual(["提出先の税務署", "利用者識別番号"]);
  });
});
