import { describe, it, expect } from "vitest";
import { buildLedger, summarizeBySubAccount, type LedgerLine } from "@/lib/ledger";

let n = 0;
const line = (date: string, debit: number, credit: number, over: Partial<LedgerLine> = {}): LedgerLine => ({
  lineId: `l${n}`,
  entryId: `e${n}`,
  entryDate: date,
  createdAt: `2026-01-01T00:00:${String(n++).padStart(2, "0")}`,
  description: "",
  source: null,
  needsReview: false,
  debit,
  credit,
  subAccountId: null,
  ...over,
});

describe("総勘定元帳", () => {
  it("資産科目は表示期間より前の全期間を前期繰越にする", () => {
    const lines = [
      line("2024-12-01", 100_000, 0),
      line("2025-03-01", 50_000, 0),
      line("2025-05-10", 30_000, 0),
      line("2025-05-20", 0, 20_000),
      line("2025-06-01", 999, 0), // 期間外
    ];
    const l = buildLedger("asset", lines, "2025-05-01", "2025-05-31", "2025-04-01");
    expect(l.opening).toBe(150_000);
    expect(l.rows.map((r) => r.balance)).toEqual([180_000, 160_000]);
    expect([l.debitTotal, l.creditTotal, l.closing]).toEqual([30_000, 20_000, 160_000]);
  });

  it("負債科目は貸方残高を正とする", () => {
    const lines = [line("2025-04-10", 0, 300_000), line("2025-05-10", 100_000, 0)];
    const l = buildLedger("liability", lines, "2025-05-01", "2025-05-31", "2025-04-01");
    expect(l.opening).toBe(300_000);
    expect(l.closing).toBe(200_000);
  });

  it("収益・費用は前の事業年度から繰り越さず、期首から前日までを繰り越す", () => {
    const lines = [
      line("2025-03-31", 999_999, 0), // 前期
      line("2025-04-15", 10_000, 0),
      line("2025-05-15", 5_000, 0),
    ];
    const l = buildLedger("expense", lines, "2025-05-01", "2025-05-31", "2025-04-01");
    expect(l.opening).toBe(10_000);
    expect(l.closing).toBe(15_000);
  });

  it("期首の開始仕訳は前期繰越として扱う", () => {
    const lines = [line("2025-04-01", 500_000, 0, { source: "closing" }), line("2025-04-01", 1_000, 0)];
    const l = buildLedger("asset", lines, "2025-04-01", "2026-03-31", "2025-04-01");
    expect(l.opening).toBe(500_000);
    expect(l.rows).toHaveLength(1);
  });

  it("要確認の仕訳は行として出すが、残高・合計には入れない（試算表と一致させる）", () => {
    const lines = [line("2025-05-01", 1_000, 0), line("2025-05-02", 9_999, 0, { needsReview: true })];
    const l = buildLedger("asset", lines, "2025-05-01", "2025-05-31", "2025-04-01");
    expect(l.rows).toHaveLength(2);
    expect(l.rows[1].balance).toBe(1_000);
    expect(l.debitTotal).toBe(1_000);
  });

  it("同じ日付は登録順に並べる", () => {
    const a = line("2025-05-02", 1, 0);
    const b = line("2025-05-01", 2, 0);
    const c = line("2025-05-02", 3, 0);
    const l = buildLedger("asset", [c, a, b], "2025-05-01", "2025-05-31", "2025-04-01");
    expect(l.rows.map((r) => r.debit)).toEqual([2, 1, 3]);
  });
});

describe("補助科目（相手先）ごとの集計", () => {
  it("売掛金: 相手先ごとに前期繰越・発生・回収・残高を出し、補助科目なしは別にまとめる", () => {
    const lines = [
      line("2025-03-01", 100_000, 0, { subAccountId: "A" }),
      line("2025-05-01", 50_000, 0, { subAccountId: "A" }),
      line("2025-05-20", 0, 120_000, { subAccountId: "A" }),
      line("2025-05-05", 30_000, 0, { subAccountId: "B" }),
      line("2025-05-06", 7_000, 0),
    ];
    const rows = summarizeBySubAccount("asset", lines, "2025-05-01", "2025-05-31", "2025-04-01");
    const byId = Object.fromEntries(rows.map((r) => [String(r.subAccountId), r]));
    expect(byId.A).toMatchObject({ opening: 100_000, increase: 50_000, decrease: 120_000, closing: 30_000, count: 2 });
    expect(byId.B).toMatchObject({ opening: 0, increase: 30_000, closing: 30_000 });
    expect(byId.null).toMatchObject({ increase: 7_000, closing: 7_000 });
  });

  it("買掛金: 貸方が発生、借方が支払", () => {
    const lines = [line("2025-05-01", 0, 80_000, { subAccountId: "S" }), line("2025-05-25", 50_000, 0, { subAccountId: "S" })];
    const [r] = summarizeBySubAccount("liability", lines, "2025-05-01", "2025-05-31", "2025-04-01");
    expect(r).toMatchObject({ increase: 80_000, decrease: 50_000, closing: 30_000 });
  });

  it("前期繰越も動きも無い相手先は出さない", () => {
    const lines = [line("2025-03-01", 10, 0, { subAccountId: "A" }), line("2025-03-02", 0, 10, { subAccountId: "A" })];
    expect(summarizeBySubAccount("asset", lines, "2025-05-01", "2025-05-31", "2025-04-01")).toEqual([]);
  });
});
