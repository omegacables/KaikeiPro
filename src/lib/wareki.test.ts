import { describe, it, expect } from "vitest";
import { toWareki, formatYen } from "./wareki";

describe("toWareki", () => {
  it("令和に直す", () => {
    expect(toWareki("2026-03-31")).toBe("令和8年3月31日");
    expect(toWareki("2020-01-01")).toBe("令和2年1月1日");
  });

  it("令和元年は2019年5月1日から", () => {
    expect(toWareki("2019-05-01")).toBe("令和元年5月1日");
    expect(toWareki("2019-12-31")).toBe("令和元年12月31日");
  });

  it("2019年1〜4月は平成31年（令和元年と誤らない）", () => {
    expect(toWareki("2019-04-30")).toBe("平成31年4月30日");
    expect(toWareki("2019-01-01")).toBe("平成31年1月1日");
  });

  it("平成元年は1989年1月8日から", () => {
    expect(toWareki("1989-01-08")).toBe("平成元年1月8日");
    // それ以前は昭和だが、帳票の対象外なので西暦のまま
    expect(toWareki("1989-01-07")).toBe("1989年1月7日");
  });

  it("日付でない値はそのまま返す", () => {
    expect(toWareki("")).toBe("");
    expect(toWareki("不明")).toBe("不明");
  });

  it("時刻付きの値も日付部分で判定する", () => {
    expect(toWareki("2026-04-01T09:00:00+09:00")).toBe("令和8年4月1日");
  });
});

describe("formatYen", () => {
  it("3桁区切りで表す", () => {
    expect(formatYen(1234567)).toBe("1,234,567");
    expect(formatYen(0)).toBe("0");
  });

  it("マイナスは△で表す", () => {
    expect(formatYen(-500000)).toBe("△500,000");
  });

  it("円未満は四捨五入する", () => {
    expect(formatYen(1000.5)).toBe("1,001");
    expect(formatYen(-0.4)).toBe("0");
  });
});
