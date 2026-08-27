import { describe, it, expect } from "vitest";
import { escapeCsvValue, buildCsvContent } from "./export";

describe("escapeCsvValue（CSVフォーミュラインジェクション対策）", () => {
  it("数式として解釈されうる先頭文字を無害化する", () => {
    // Excel/Sheets で実行される危険のある文字列
    expect(escapeCsvValue("=1+1")).toBe("'=1+1");
    expect(escapeCsvValue("+1234")).toBe("'+1234");
    expect(escapeCsvValue("-1+2")).toBe("'-1+2");
    expect(escapeCsvValue("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(escapeCsvValue("\tfoo")).toContain("'");
  });

  it("外部プログラム起動を狙う数式も無害化する", () => {
    const attack = '=cmd|\' /C calc\'!A0';
    const escaped = escapeCsvValue(attack);
    expect(escaped.startsWith('"\'=') || escaped.startsWith("'=")).toBe(true);
    expect(escaped).not.toMatch(/^=/);
  });

  it("通常の文字列はそのまま返す", () => {
    expect(escapeCsvValue("株式会社テスト")).toBe("株式会社テスト");
    expect(escapeCsvValue(12345)).toBe("12345");
  });

  it("カンマ・改行・引用符を含む値は引用符で囲む", () => {
    expect(escapeCsvValue("a,b")).toBe('"a,b"');
    expect(escapeCsvValue("a\nb")).toBe('"a\nb"');
    expect(escapeCsvValue('say "hi"')).toBe('"say ""hi"""');
  });

  it("マイナス金額は数値なら囲まないが、文字列の先頭 - は無害化される", () => {
    // 会計データでよくある「-1000」は文字列として渡ると数式扱いを避けるため ' が付く
    expect(escapeCsvValue(-1000)).toBe("'-1000");
  });
});

describe("buildCsvContent", () => {
  it("BOM付きでCRLF区切りのCSVを生成する", () => {
    const csv = buildCsvContent(["日付", "金額"], [["2026-08-01", 1000]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toBe("﻿日付,金額\r\n2026-08-01,1000");
  });

  it("ヘッダーにも同じエスケープを適用する", () => {
    const csv = buildCsvContent(["=danger"], [["ok"]]);
    expect(csv).toContain("'=danger");
  });

  it("行がなくてもヘッダーだけを出力する", () => {
    expect(buildCsvContent(["a", "b"], [])).toBe("﻿a,b");
  });
});
