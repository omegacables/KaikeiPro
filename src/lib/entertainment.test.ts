import { describe, it, expect } from "vitest";
import {
  capitalClass,
  entertainmentLimit,
  guessIndustry,
  judgeDining,
  parseEntertainmentSettings,
  perPersonLimit,
  DEFAULT_ENTERTAINMENT_SETTINGS,
  entertainmentRulesForPrompt,
} from "./entertainment";

const s = DEFAULT_ENTERTAINMENT_SETTINGS;

describe("1人当たりの基準額", () => {
  it("2024年4月1日以後は10,000円、それより前は5,000円", () => {
    expect(perPersonLimit("2024-04-01", s)).toBe(10_000);
    expect(perPersonLimit("2024-03-31", s)).toBe(5_000);
  });
  it("顧問先の設定があればそちらを使う", () => {
    expect(perPersonLimit("2026-05-01", { ...s, perPersonLimit: 8_000 })).toBe(8_000);
  });
});

describe("judgeDining", () => {
  it("ちょうど基準額は基準内", () => {
    expect(judgeDining({ amount: 40_000, attendees: 4, date: "2026-05-01" }, s)).toEqual({ kind: "under_limit", perPerson: 10_000, limit: 10_000 });
  });
  it("1円でも超えれば超える（1人当たりは切り上げて比べる）", () => {
    expect(judgeDining({ amount: 40_001, attendees: 4, date: "2026-05-01" }, s)).toEqual({ kind: "over_limit", perPerson: 10_001, limit: 10_000 });
  });
  it("人数が分からなければ聞く", () => {
    expect(judgeDining({ amount: 8_000, attendees: null, date: "2026-05-01" }, s).kind).toBe("needs_attendees");
  });
  it("社内の人だけの飲食は除けない", () => {
    expect(judgeDining({ amount: 3_000, attendees: 3, date: "2026-05-01", internalOnly: true }, s).kind).toBe("internal_only");
  });
});

describe("capitalClass", () => {
  it("資本金で区分する", () => {
    expect(capitalClass(10_000_000)).toBe("sme");
    expect(capitalClass(100_000_000)).toBe("sme");
    expect(capitalClass(100_000_001)).toBe("large");
    expect(capitalClass(10_000_000_000)).toBe("large");
    expect(capitalClass(10_000_000_001)).toBe("mega");
    expect(capitalClass(null)).toBe("sme");
  });
  it("大法人の子会社は資本金が小さくても定額控除を使えない", () => {
    expect(capitalClass(10_000_000, true)).toBe("large");
  });
});

describe("entertainmentLimit", () => {
  it("中小法人は800万円と接待飲食費の50%の有利な方", () => {
    expect(entertainmentLimit({ total: 5_000_000, dining: 4_000_000, months: 12, cls: "sme" })).toEqual({
      fixedLimit: 5_000_000,
      diningLimit: 2_000_000,
      limit: 5_000_000,
      disallowed: 0,
    });
    // 飲食が多いと50%の方が有利
    expect(entertainmentLimit({ total: 20_000_000, dining: 18_000_000, months: 12, cls: "sme" }).limit).toBe(9_000_000);
  });
  it("12か月に満たない期は800万円を月割りする", () => {
    expect(entertainmentLimit({ total: 9_000_000, dining: null, months: 6, cls: "sme" }).fixedLimit).toBe(4_000_000);
  });
  it("資本金1億円超は接待飲食費の50%だけ", () => {
    expect(entertainmentLimit({ total: 3_000_000, dining: 2_000_000, months: 12, cls: "large" })).toEqual({
      fixedLimit: 0,
      diningLimit: 1_000_000,
      limit: 1_000_000,
      disallowed: 2_000_000,
    });
  });
  it("資本金100億円超は全額が損金にならない", () => {
    expect(entertainmentLimit({ total: 3_000_000, dining: 2_000_000, months: 12, cls: "mega" }).disallowed).toBe(3_000_000);
  });
});

describe("parseEntertainmentSettings", () => {
  it("空なら既定値", () => {
    expect(parseEntertainmentSettings(null)).toEqual(DEFAULT_ENTERTAINMENT_SETTINGS);
  });
  it("おかしな値は受け付けない", () => {
    const p = parseEntertainmentSettings({ perPersonLimit: -1, underLimitAccount: " ", customRules: ["a", 1, "  ", "b"] });
    expect(p.perPersonLimit).toBeNull();
    expect(p.underLimitAccount).toBe("会議費");
    expect(p.customRules).toEqual(["a", "b"]);
  });
});

describe("guessIndustry", () => {
  it("業種の欄から推し量る", () => {
    expect(guessIndustry("飲食店（居酒屋）")).toBe("restaurant");
    expect(guessIndustry("総合建設業")).toBe("construction");
    expect(guessIndustry("歯科医院")).toBe("medical");
    expect(guessIndustry("")).toBe("general");
    expect(guessIndustry("よく分からない")).toBe("general");
  });
});

describe("entertainmentRulesForPrompt", () => {
  it("業種のルールと独自のルールを含める", () => {
    const t = entertainmentRulesForPrompt("construction", { ...s, customRules: ["朝礼の差し入れは福利厚生費"] }, "2026-05-01");
    expect(t).toContain("建設業");
    expect(t).toContain("10,000円");
    expect(t).toContain("朝礼の差し入れは福利厚生費");
  });
});
