import { describe, it, expect } from "vitest";
import { buildEquityChanges, equityKind } from "./equity-changes";

describe("株主資本等変動計算書の列", () => {
  it("科目名から項目を決める", () => {
    expect(["資本金", "資本準備金", "その他資本剰余金", "利益準備金", "別途積立金", "繰越利益剰余金", "自己株式", "元入金"].map(equityKind)).toEqual([
      "capital", "capital_reserve", "other_capital_surplus", "legal_reserve", "voluntary_reserve", "retained", "treasury", "other",
    ]);
  });

  it("当期純利益は繰越利益剰余金にだけ入れ、それ以外の増減は「その他の変動額」に", () => {
    const ce = buildEquityChanges(
      [
        { name: "繰越利益剰余金", opening: 2_000_000, closing: 1_900_000 }, // 配当10万円（試算表には当期純利益はまだ入っていない）
        { name: "資本金", opening: 1_000_000, closing: 1_000_000 },
        { name: "利益準備金", opening: 0, closing: 10_000 },
      ],
      500_000
    );
    expect(ce.columns.map((c) => c.label)).toEqual(["資本金", "利益準備金", "繰越利益剰余金"]);
    const re = ce.columns.find((c) => c.kind === "retained")!;
    expect(re).toMatchObject({ opening: 2_000_000, netIncome: 500_000, other: -100_000, change: 400_000, closing: 2_400_000 });
    expect(ce.total).toEqual({ opening: 3_000_000, netIncome: 500_000, other: -90_000, change: 410_000, closing: 3_410_000 });
  });

  it("残高の無い項目は出さないが、繰越利益剰余金は必ず出す", () => {
    const ce = buildEquityChanges([{ name: "資本準備金", opening: 0, closing: 0 }], -30_000);
    expect(ce.columns.map((c) => [c.label, c.closing])).toEqual([["繰越利益剰余金", -30_000]]);
  });

  it("任意積立金は科目ごとに列を分ける", () => {
    const ce = buildEquityChanges(
      [
        { name: "別途積立金", opening: 100, closing: 100 },
        { name: "圧縮積立金", opening: 50, closing: 50 },
      ],
      0
    );
    expect(ce.columns.map((c) => c.label)).toEqual(["別途積立金", "圧縮積立金", "繰越利益剰余金"]);
  });
});
