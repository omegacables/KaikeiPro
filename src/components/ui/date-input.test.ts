import { describe, it, expect } from "vitest";
import { parseDateInput } from "./date-input";

// 打ち込みの基準日（年・月が省略されたときに補う値）
const BASE = { y: 2026, m: 9, d: 8 };

describe("parseDateInput", () => {
  it("8桁の数字は YYYYMMDD として読む", () => {
    expect(parseDateInput("20260410", BASE)).toBe("2026-04-10");
  });

  it("6桁の数字は YYMMDD として読む", () => {
    expect(parseDateInput("260410", BASE)).toBe("2026-04-10");
  });

  it("4桁の数字は MMDD として読み、年は基準日から補う", () => {
    expect(parseDateInput("0410", BASE)).toBe("2026-04-10");
  });

  it("1〜2桁の数字は日として読み、年月は基準日から補う", () => {
    expect(parseDateInput("10", BASE)).toBe("2026-09-10");
    expect(parseDateInput("3", BASE)).toBe("2026-09-03");
  });

  it("区切り文字つきでも読める", () => {
    expect(parseDateInput("2026/04/10", BASE)).toBe("2026-04-10");
    expect(parseDateInput("2026-4-10", BASE)).toBe("2026-04-10");
    expect(parseDateInput("2026.4.10", BASE)).toBe("2026-04-10");
  });

  it("月日だけの区切り入力は年を補う", () => {
    expect(parseDateInput("4/10", BASE)).toBe("2026-04-10");
  });

  it("2桁の年は2000年代として読む", () => {
    expect(parseDateInput("26/4/10", BASE)).toBe("2026-04-10");
  });

  it("全角数字でも読める（テンキー以外からの入力を拾う）", () => {
    expect(parseDateInput("２０２６０４１０", BASE)).toBe("2026-04-10");
  });

  it("存在しない日は、その月の末日に丸める", () => {
    // 2026年2月は28日まで
    expect(parseDateInput("20260231", BASE)).toBe("2026-02-28");
    // うるう年は29日まで
    expect(parseDateInput("20280231", BASE)).toBe("2028-02-29");
  });

  it("13月のような月は12月に丸める", () => {
    expect(parseDateInput("20261310", BASE)).toBe("2026-12-10");
  });

  it("0日は1日に丸める", () => {
    expect(parseDateInput("20260400", BASE)).toBe("2026-04-01");
  });

  it("解釈できない入力は null を返す（元の値を保つため）", () => {
    expect(parseDateInput("", BASE)).toBeNull();
    expect(parseDateInput("   ", BASE)).toBeNull();
    expect(parseDateInput("あああ", BASE)).toBeNull();
    expect(parseDateInput("2026年4月10日", BASE)).toBeNull();
    expect(parseDateInput("123", BASE)).toBeNull(); // 3桁は曖昧なので受け付けない
    expect(parseDateInput("123456789", BASE)).toBeNull();
  });

  it("前後の空白は無視する", () => {
    expect(parseDateInput("  20260410  ", BASE)).toBe("2026-04-10");
  });

  it("年をまたぐ月日でも基準日の年を使う（勝手に前後の年に送らない）", () => {
    // 12月決算の会社が9月時点で「1/5」と打っても2026年として扱う。
    // 年をまたぐ意図があるなら年を明示して打ってもらう。
    expect(parseDateInput("1/5", BASE)).toBe("2026-01-05");
  });
});
