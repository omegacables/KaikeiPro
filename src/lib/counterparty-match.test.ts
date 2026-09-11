import { describe, it, expect } from "vitest";
import { normalizeName, matchesCounterparty, findCounterparty, findCounterpartyWithKind } from "./counterparty-match";

describe("normalizeName（比べられる形にそろえる）", () => {
  it("全角英数字を半角にする", () => {
    expect(normalizeName("ＭＲ１２３")).toBe("mr123");
  });

  it("半角カタカナを全角にする", () => {
    expect(normalizeName("ｱﾝﾄﾞｳ ﾚﾝ")).toBe(normalizeName("アンドウ レン"));
  });

  it("通帳に付く「振込」などを落とす", () => {
    expect(normalizeName("振込 アンドウ レン")).toBe(normalizeName("アンドウレン"));
    expect(normalizeName("フリコミ アンドウ")).toBe(normalizeName("アンドウ"));
  });

  it("法人格の表記を落とす", () => {
    expect(normalizeName("カ)オオサカブヒン")).toBe(normalizeName("オオサカブヒン"));
    expect(normalizeName("株式会社Ｒｅｎａｘｉｓ")).toBe(normalizeName("renaxis"));
    expect(normalizeName("㈱大阪部品")).toBe(normalizeName("大阪部品"));
  });

  it("空白・記号を落とす", () => {
    expect(normalizeName("安藤　蓮")).toBe(normalizeName("安藤蓮"));
    expect(normalizeName("A・B-C")).toBe("abc");
  });
});

describe("matchesCounterparty（台帳のものかを判定）", () => {
  const loan = { name: "検証用社長", aliases: ["アンドウ レン", "安藤蓮"] };

  it("別名に一致すれば同じ相手先とみなす", () => {
    expect(matchesCounterparty("振込 アンドウ レン", loan)).toBe(true);
    expect(matchesCounterparty("ｱﾝﾄﾞｳ ﾚﾝ", loan)).toBe(true);
    expect(matchesCounterparty("安藤　蓮", loan)).toBe(true);
  });

  it("台帳の名前そのものにも一致する", () => {
    expect(matchesCounterparty("検証用社長", loan)).toBe(true);
  });

  it("別人には一致しない", () => {
    expect(matchesCounterparty("オオサカブヒン", loan)).toBe(false);
    expect(matchesCounterparty("○○銀行", loan)).toBe(false);
  });

  it("空の名前は一致させない（何にでも当たってしまうため）", () => {
    expect(matchesCounterparty("", loan)).toBe(false);
    expect(matchesCounterparty("振込", loan)).toBe(false);
  });

  it("別名が無くても名前だけで判定できる", () => {
    expect(matchesCounterparty("○○銀行", { name: "○○銀行" })).toBe(true);
  });
});

describe("findCounterparty（当てはまる台帳を選ぶ）", () => {
  const loans = [
    { id: "A", name: "検証用社長", aliases: ["アンドウ レン"] },
    { id: "B", name: "○○銀行", aliases: [] },
    { id: "C", name: "安藤", aliases: [] },
  ];

  it("別名から正しい台帳を選ぶ", () => {
    expect(findCounterparty("振込 アンドウ レン", loans)?.id).toBe("A");
  });

  it("完全一致を部分一致より優先する", () => {
    // 「安藤」は C と完全一致。A の別名「アンドウ レン」とは一致しない
    expect(findCounterparty("安藤", loans)?.id).toBe("C");
  });

  it("当てはまるものが無ければ null", () => {
    expect(findCounterparty("チュウブデンリョク", loans)).toBeNull();
  });
});

describe("取引先マスタでの突き合わせ（借入金台帳と同じ規則）", () => {
  const partners = [
    { id: "p1", name: "株式会社大阪部品", aliases: ["ｶ)ｵｵｻｶﾌﾞﾋﾝ"] },
    { id: "p2", name: "山田商事", aliases: [] as string[] },
  ];

  it("通帳の半角カタカナ表記から取引先を当てられる", () => {
    expect(findCounterparty("振込 ｶ)ｵｵｻｶﾌﾞﾋﾝ", partners)?.id).toBe("p1");
  });

  it("別名が無くても正式名称と一致すれば当たる", () => {
    expect(findCounterparty("ﾌﾘｺﾐ 山田商事", partners)?.id).toBe("p2");
  });

  it("完全一致と部分一致を区別して返す", () => {
    expect(findCounterpartyWithKind("株式会社大阪部品", partners).kind).toBe("exact");
    expect(findCounterpartyWithKind("大阪部品の入金", partners).kind).toBe("partial");
    expect(findCounterpartyWithKind("まったく別の会社", partners).kind).toBe("none");
  });

  it("当てはまらない振込名義には取引先を割り当てない", () => {
    expect(findCounterparty("ﾀﾅｶ ﾀﾛｳ", partners)).toBeNull();
  });
});
