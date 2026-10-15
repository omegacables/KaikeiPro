import { describe, it, expect } from "vitest";
import { searchFeatures, featureHref, FEATURES } from "@/lib/feature-search";

const labels = (q: string, o: Partial<Parameters<typeof searchFeatures>[1]> = {}) =>
  searchFeatures(q, { inClient: true, entityType: "corporation", ...o }).map((f) => f.label);

describe("機能を探す", () => {
  it("名前で探す（頭が当たるものが先）", () => {
    expect(labels("消費税")[0]).toBe("消費税集計表");
    expect(labels("消費税")).toEqual(expect.arrayContaining(["消費税申告書", "消費税の設定", "科目別税区分表"]));
  });

  it("ひらがな・カタカナ・ローマ字でも探せる", () => {
    expect(labels("しょうひぜいしゅう")[0]).toBe("消費税集計表");
    expect(labels("ソウカンジョウ")[0]).toBe("総勘定元帳");
    expect(labels("soukanjou")[0]).toBe("総勘定元帳");
  });

  it("言い換えの言葉で探せる（メニューの名前と違っても）", () => {
    expect(labels("内訳")).toContain("総勘定元帳");
    expect(labels("BS")).toContain("貸借対照表");
    expect(labels("家事按分")).toContain("私的利用の按分");
    expect(labels("減価償却")[0]).toBe("固定資産・減価償却");
  });

  it("個人事業主には法人税申告書を、法人には青色申告決算書を出さない", () => {
    expect(labels("申告", { entityType: "individual" })).not.toContain("法人税申告書");
    expect(labels("青色")).not.toContain("青色申告決算書");
    expect(labels("青色", { entityType: "individual" })).toContain("青色申告決算書");
  });

  it("顧問先を選んでいないときは全体の画面だけ", () => {
    expect(labels("仕訳", { inClient: false })).toEqual([]);
    expect(labels("顧問先", { inClient: false })).toEqual(["顧問先一覧"]);
  });

  it("移る先: 顧問先の中の画面は顧問先の ID をつける", () => {
    const f = FEATURES.find((x) => x.label === "消費税集計表")!;
    expect(featureHref(f, "abc")).toBe("/clients/abc/tax-summary?view=table");
    expect(featureHref(FEATURES.find((x) => x.label === "ダッシュボード")!, "abc")).toBe("/dashboard");
  });
});
