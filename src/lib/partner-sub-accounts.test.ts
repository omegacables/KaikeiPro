import { describe, it, expect } from "vitest";
import { partnerByNameIndex, partnerNameFromPaymentDescription } from "@/lib/partner-sub-accounts";

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
