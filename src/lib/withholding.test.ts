import { describe, it, expect } from "vitest";
import { withholdingOnFee, pickWithholdingAccount } from "./withholding";

describe("withholdingOnFee", () => {
  it("100万円以下は10.21%（1円未満切り捨て）", () => {
    expect(withholdingOnFee(100_000)).toBe(10_210);
    expect(withholdingOnFee(55_555)).toBe(5_672); // 5,672.1655
    expect(withholdingOnFee(1_000_000)).toBe(102_100);
  });
  it("100万円を超える部分は20.42%", () => {
    expect(withholdingOnFee(1_500_000)).toBe(204_200); // 102,100 + 102,100
    expect(withholdingOnFee(1_000_001)).toBe(102_100); // 0.2042 は切り捨て
  });
  it("0や負の数は0", () => {
    expect(withholdingOnFee(0)).toBe(0);
    expect(withholdingOnFee(-5)).toBe(0);
  });
});

describe("pickWithholdingAccount", () => {
  it("預り金（源泉所得税）を先に使う", () => {
    expect(pickWithholdingAccount([{ name: "預り金" }, { name: "預り金（源泉所得税）" }])?.name).toBe("預り金（源泉所得税）");
    expect(pickWithholdingAccount([{ name: "預り金" }, { name: "預り金（住民税）" }])?.name).toBe("預り金");
    expect(pickWithholdingAccount([{ name: "未払金" }])).toBeUndefined();
  });
});
