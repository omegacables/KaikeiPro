import { describe, it, expect } from "vitest";
import { partnerByNameIndex, partnerNameFromPaymentDescription, suggestPartnerFromDescription } from "@/lib/partner-sub-accounts";

describe("相手先の判断", () => {
  it("入金消込の摘要から取引先名を取り出す", () => {
    expect(partnerNameFromPaymentDescription("入金消込: 株式会社MRコネクト")).toBe("株式会社MRコネクト");
    expect(partnerNameFromPaymentDescription("入金消込：株式会社A")).toBe("株式会社A");
    expect(partnerNameFromPaymentDescription("入金消込:")).toBeNull();
    expect(partnerNameFromPaymentDescription("売上計上: 株式会社A")).toBeNull();
    expect(partnerNameFromPaymentDescription(null)).toBeNull();
  });

  it("取引先名・別名で引く（全角半角や空白の違いは無視、別人には寄せない）", () => {
    const find = partnerByNameIndex([
      { id: "1", name: "株式会社MRコネクト", aliases: ["MRC"] },
      { id: "2", name: "株式会社MRコンサルティング" },
    ]);
    expect(find("株式会社ＭＲコネクト")?.id).toBe("1");
    expect(find(" MRC ")?.id).toBe("1");
    expect(find("株式会社MRコンサルティング")?.id).toBe("2");
    expect(find("MRコネクト")).toBeNull();
    expect(find("")).toBeNull();
  });
});

describe("摘要からの相手先の候補", () => {
  const partners = [
    { id: "a", name: "株式会社あおば工業" },
    { id: "a2", name: "あおば" },
    { id: "t", name: "有限会社つばさ物産", aliases: ["ツバサ"] },
    { id: "k", name: "株式会社ことぶき食品" },
  ];
  it("摘要に名前があればその取引先（全角半角・空白の違いは無視）", () => {
    expect(suggestPartnerFromDescription("売上計上: 株式会社あおば工業 2026年4月分", partners)?.id).toBe("a");
    expect(suggestPartnerFromDescription("支払:株式会社 ことぶき食品", partners)?.id).toBe("k");
    expect(suggestPartnerFromDescription("入金 ﾂﾊﾞｻ", partners)?.id).toBe("t");
  });
  it("短い名前が長い名前に含まれるときは長い方", () => {
    expect(suggestPartnerFromDescription("入金: 株式会社あおば工業", partners)?.id).toBe("a");
    expect(suggestPartnerFromDescription("入金: あおば", partners)?.id).toBe("a2");
  });
  it("2社以上・見つからないときは候補なし", () => {
    expect(suggestPartnerFromDescription("相殺: 株式会社あおば工業・有限会社つばさ物産", partners)).toBeNull();
    expect(suggestPartnerFromDescription("期首残高（前期繰越）", partners)).toBeNull();
    expect(suggestPartnerFromDescription(null, partners)).toBeNull();
  });
});
