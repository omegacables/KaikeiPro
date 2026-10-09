import { describe, it, expect } from "vitest";
import { filterPartners, normalizeForSearch } from "@/components/ui/partner-input";

const partners = [
  { id: "1", name: "株式会社みらい商事" },
  { id: "2", name: "ミライ物流有限会社" },
  { id: "3", name: "東京電力エナジーパートナー", aliases: ["東電"] },
  { id: "4", name: "ＡＢＣ商会" },
];

describe("取引先の候補", () => {
  it("法人格・全角半角・カタカナひらがなの違いを無視して探す", () => {
    expect(normalizeForSearch("株式会社ＡＢＣ")).toBe("abc");
    expect(filterPartners(partners, "みらい").map((p) => p.id)).toEqual(["1", "2"]);
    expect(filterPartners(partners, "abc").map((p) => p.id)).toEqual(["4"]);
  });
  it("別名でも見つかり、前方一致を部分一致より先に出す", () => {
    expect(filterPartners(partners, "東電").map((p) => p.id)).toEqual(["3"]);
    expect(filterPartners(partners, "商").map((p) => p.id)).toEqual(["4", "1"]);
    expect(filterPartners(partners, "ＡＢ").map((p) => p.id)).toEqual(["4"]);
  });
});
