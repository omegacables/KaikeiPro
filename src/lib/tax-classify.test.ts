import { describe, it, expect } from "vitest";
import { suggestTaxCategory, checkTaxCategory, resolveTaxCategory } from "./tax-classify";

const s = (type: string, account: string, desc = "") => suggestTaxCategory(type, account, desc);

describe("税区分の候補", () => {
  it("給与・役員報酬・社会保険料は不課税（はっきりした決まり）", () => {
    expect(s("expenses", "給料手当", "2026-06 給与")).toMatchObject({ code: "purchase_out_of_scope", strength: "strong" });
    expect(s("expenses", "役員報酬")).toMatchObject({ code: "purchase_out_of_scope", strength: "strong" });
    expect(s("expenses", "法定福利費", "社会保険料の納付")).toMatchObject({ code: "purchase_out_of_scope", strength: "strong" });
  });

  it("通勤手当は課税（給料手当の科目でも）", () => {
    expect(s("expenses", "給料手当", "通勤手当 6月分")).toMatchObject({ code: "purchase_10", strength: "hint" });
  });

  it("利息・保険料・収入印紙・行政手数料は非課税、税金は不課税", () => {
    expect(s("expenses", "支払利息", "返済 みらい信用金庫")).toMatchObject({ code: "purchase_exempt", strength: "strong" });
    expect(s("expenses", "支払保険料")).toMatchObject({ code: "purchase_exempt", strength: "strong" });
    expect(s("expenses", "租税公課", "収入印紙 200円")).toMatchObject({ code: "purchase_exempt", strength: "strong" });
    expect(s("expenses", "租税公課", "印鑑証明 発行手数料")).toMatchObject({ code: "purchase_exempt" });
    expect(s("expenses", "租税公課", "自動車税")).toMatchObject({ code: "purchase_out_of_scope", strength: "strong" });
    expect(s("expenses", "支払手数料", "税理士報酬 法人税申告書作成")).toMatchObject({ code: "purchase_10", strength: "account" });
  });

  it("香典・祝い金は不課税、供花や品物は課税", () => {
    expect(s("expenses", "接待交際費", "取引先 香典")).toMatchObject({ code: "purchase_out_of_scope", strength: "strong" });
    expect(s("expenses", "接待交際費", "開店祝い 生花")).toMatchObject({ code: "purchase_10" });
  });

  it("取引の中身で変わるものは確認をすすめる", () => {
    expect(s("expenses", "諸会費", "商工会 年会費")).toMatchObject({ code: "purchase_out_of_scope", strength: "hint" });
    expect(s("expenses", "地代家賃", "社宅 家賃")).toMatchObject({ code: "purchase_exempt", strength: "hint" });
    expect(s("expenses", "地代家賃", "月極駐車場")).toMatchObject({ code: "purchase_10" });
    expect(s("expenses", "消耗品費", "QUOカード 購入")).toMatchObject({ code: "purchase_exempt", strength: "hint" });
    expect(s("expenses", "通信費", "日本郵便 レターパックプラス購入")).toMatchObject({ code: "purchase_10", strength: "hint" });
    expect(s("expenses", "旅費交通費", "交通費精算")).toMatchObject({ code: "purchase_10", strength: "hint" });
  });

  it("売上側: 受取利息は非課税、配当・補助金は不課税、輸出は免税の候補", () => {
    expect(s("revenue", "受取利息")).toMatchObject({ code: "sales_exempt", strength: "strong" });
    expect(s("revenue", "受取配当金")).toMatchObject({ code: "sales_out_of_scope", strength: "strong" });
    expect(s("revenue", "雑収入", "雇用調整助成金")).toMatchObject({ code: "sales_out_of_scope", strength: "strong" });
    expect(s("revenue", "売上高", "海外向け 輸出売上")).toMatchObject({ code: "sales_tax_free", strength: "hint" });
    expect(s("revenue", "売上高", "デザイン料")).toMatchObject({ code: "sales_10", strength: "account" });
  });

  it("資産・負債や貸倒損失は判別しない", () => {
    expect(s("assets", "普通預金")).toBeNull();
    expect(s("expenses", "貸倒損失")).toBeNull();
  });
});

describe("付いている税区分の確認", () => {
  it("未設定なら候補を出す", () => {
    expect(checkTaxCategory("expenses", "給料手当", "給与", null)).toMatchObject({ kind: "missing", suggestion: { code: "purchase_out_of_scope" } });
  });

  it("はっきりした決まりと違えば直すべきもの", () => {
    expect(checkTaxCategory("expenses", "支払利息", "", "purchase_10")).toMatchObject({ kind: "conflict" });
  });

  it("仕入側の非課税・不課税どうしの違いは、税額に影響しないので確認だけ", () => {
    expect(checkTaxCategory("expenses", "租税公課", "収入印紙購入", "purchase_out_of_scope")).toMatchObject({ kind: "review" });
    expect(resolveTaxCategory("expenses", "租税公課", "収入印紙購入", "purchase_out_of_scope")).toBe("purchase_out_of_scope");
    // 売上側は課税売上割合に響くので直す
    expect(checkTaxCategory("revenue", "受取利息", "", "sales_out_of_scope")).toMatchObject({ kind: "conflict" });
  });

  it("課税どうし（10%・8%・経過措置）の違いは問題にしない", () => {
    expect(checkTaxCategory("expenses", "旅費交通費", "タクシー", "purchase_10_trans_80")).toEqual({ kind: "ok" });
    expect(checkTaxCategory("expenses", "消耗品費", "", "purchase_08_reduced")).toEqual({ kind: "ok" });
  });

  it("取引の中身で変わるものは確認をすすめるだけ", () => {
    expect(checkTaxCategory("expenses", "通信費", "日本郵便 レターパックプラス購入", "purchase_out_of_scope")).toMatchObject({ kind: "review" });
    expect(checkTaxCategory("expenses", "地代家賃", "事務所家賃", "purchase_10")).toEqual({ kind: "ok" });
  });
});

describe("自動の仕訳で保存する税区分", () => {
  it("未設定は候補、はっきりした決まりと違えば直し、それ以外はそのまま", () => {
    expect(resolveTaxCategory("expenses", "給料手当", "給与", null)).toBe("purchase_out_of_scope");
    expect(resolveTaxCategory("expenses", "支払利息", "", "purchase_10")).toBe("purchase_exempt");
    expect(resolveTaxCategory("expenses", "通信費", "レターパック", "purchase_out_of_scope")).toBe("purchase_out_of_scope");
    expect(resolveTaxCategory("expenses", "旅費交通費", "交通費精算", null)).toBe("purchase_10");
    expect(resolveTaxCategory("assets", "普通預金", "", null)).toBeNull();
  });
});
