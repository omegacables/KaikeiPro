import { describe, it, expect } from "vitest";
import { buildNotes, depreciationNote } from "./financial-notes";

describe("個別注記表", () => {
  it("定率法の資産があれば法定の定率法の書き方、定額法だけなら定額法", () => {
    expect(depreciationNote(["declining_balance", "straight_line"])).toMatch(/^有形固定資産は定率法/);
    expect(depreciationNote(["straight_line"])).toBe("有形固定資産及び無形固定資産は、定額法によっている。");
    expect(depreciationNote([])).toMatch(/^有形固定資産は定率法/);
  });
  it("一括償却資産・少額減価償却資産の特例を使っていれば書き足す", () => {
    const t = depreciationNote(["straight_line", "lump_sum", "small_immediate"]);
    expect(t).toContain("なお、取得価額10万円以上20万円未満");
    expect(t).toContain("また、取得価額30万円未満");
  });
  it("消費税は税抜・税込を書き分け、自己株式が無ければその旨", () => {
    const n = buildNotes({ depreciationMethods: [], taxAccounting: "inclusive", hasTreasuryStock: false });
    expect(n.map((s) => s.heading)).toEqual(["重要な会計方針に係る事項に関する注記", "株主資本等変動計算書に関する注記", "その他の注記"]);
    expect(n[0].items[1].text).toBe("消費税等の会計処理は、税込方式によっている。");
    expect(n[1].items).toEqual([]);
    expect(n[1].none).toContain("自己株式は保有していない");
  });
});
