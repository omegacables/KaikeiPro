import { describe, it, expect } from "vitest";
import {
  aggregateTrialBalance,
  isRetainedEarningsAccount,
  type AggregatableAccount,
  type AggregatableLine,
} from "./trial-balance";

// 3月決算（期首4/1）を前提としたテスト用の勘定科目
const ACCOUNTS: AggregatableAccount[] = [
  { id: "cash", code: "1100", name: "現金", category: "asset" },
  { id: "ar", code: "1150", name: "売掛金", category: "asset" },
  { id: "ap", code: "2100", name: "買掛金", category: "liability" },
  { id: "capital", code: "3100", name: "資本金", category: "equity" },
  { id: "retained", code: "3310", name: "繰越利益剰余金", category: "equity" },
  { id: "sales", code: "4100", name: "売上高", category: "revenue" },
  { id: "purchase", code: "5100", name: "仕入高", category: "expense" },
];

const line = (
  account_id: string,
  debit: number,
  credit: number,
  entry_date: string,
  source: string | null = "manual"
): AggregatableLine => ({
  account_id,
  debit_amount: debit,
  credit_amount: credit,
  entry_date,
  source,
});

describe("aggregateTrialBalance", () => {
  it("当期の借方・貸方を科目ごとに合計する", () => {
    const lines = [
      line("cash", 100000, 0, "2025-05-10"),
      line("sales", 0, 100000, "2025-05-10"),
      line("cash", 50000, 0, "2025-06-10"),
      line("sales", 0, 50000, "2025-06-10"),
    ];
    const r = aggregateTrialBalance(ACCOUNTS, lines, "2025-04-01", "2026-03-31");

    expect(r.get("cash")!.debitTotal).toBe(150000);
    expect(r.get("cash")!.currentBalance).toBe(150000);
    expect(r.get("sales")!.creditTotal).toBe(150000);
    // 収益は貸方残高なので currentBalance は負
    expect(r.get("sales")!.currentBalance).toBe(-150000);
  });

  it("貸借が一致する（借方残高の合計 = 貸方残高の合計）", () => {
    const lines = [
      line("cash", 500000, 0, "2025-04-01", "closing"),
      line("capital", 0, 500000, "2025-04-01", "closing"),
      line("ar", 330000, 0, "2025-07-31"),
      line("sales", 0, 330000, "2025-07-31"),
      line("purchase", 200000, 0, "2025-08-31"),
      line("ap", 0, 200000, "2025-08-31"),
    ];
    const r = aggregateTrialBalance(ACCOUNTS, lines, "2025-04-01", "2026-03-31");
    const total = [...r.values()].reduce((s, a) => s + a.currentBalance, 0);
    expect(total).toBe(0); // 借方プラス・貸方マイナスの総和が0 = 貸借一致
  });

  it("期首残高仕訳（source=closing）は当期発生ではなく前期繰越として扱う", () => {
    const lines = [
      line("cash", 500000, 0, "2025-04-01", "closing"),
      line("capital", 0, 500000, "2025-04-01", "closing"),
    ];
    const r = aggregateTrialBalance(ACCOUNTS, lines, "2025-04-01", "2026-03-31");

    expect(r.get("cash")!.prevBalance).toBe(500000);
    expect(r.get("cash")!.debitTotal).toBe(0); // 当期合計には入れない
    expect(r.get("cash")!.currentBalance).toBe(500000);
  });

  it("B/S科目は前期残高を当期に繰り越す", () => {
    const lines = [
      line("cash", 800000, 0, "2025-06-30"), // 前期
      line("sales", 0, 800000, "2025-06-30"),
    ];
    // 当期は2026年度
    const r = aggregateTrialBalance(ACCOUNTS, lines, "2026-04-01", "2027-03-31");
    expect(r.get("cash")!.prevBalance).toBe(800000);
    expect(r.get("cash")!.currentBalance).toBe(800000);
  });

  // ── リグレッション: 翌期に前期の損益が繰り越されていたバグ ──
  it("損益科目は前期残高を当期に繰り越さない", () => {
    const lines = [
      line("ar", 18000000, 0, "2026-03-31"), // 前期の売上
      line("sales", 0, 18000000, "2026-03-31"),
      line("purchase", 7200000, 0, "2026-03-31"),
      line("ap", 0, 7200000, "2026-03-31"),
    ];
    // 翌期（2026年度）の試算表
    const r = aggregateTrialBalance(ACCOUNTS, lines, "2026-04-01", "2027-03-31");

    // 前期の損益は当期に持ち越さない（売上・仕入は当期0）
    expect(r.get("sales")).toBeUndefined();
    expect(r.get("purchase")).toBeUndefined();
    // B/S科目は繰り越す
    expect(r.get("ar")!.currentBalance).toBe(18000000);
  });

  // ── リグレッション: 過年度損益が繰越利益剰余金に振り替わらず貸借不一致だったバグ ──
  it("過年度の純損益を繰越利益剰余金へ振り替え、翌期も貸借が一致する", () => {
    const lines = [
      // 前期: 売上1,000万 / 仕入600万 → 純利益400万
      line("ar", 10000000, 0, "2026-02-28"),
      line("sales", 0, 10000000, "2026-02-28"),
      line("purchase", 6000000, 0, "2026-02-28"),
      line("ap", 0, 6000000, "2026-02-28"),
    ];
    const r = aggregateTrialBalance(ACCOUNTS, lines, "2026-04-01", "2027-03-31");

    // 過年度純利益 400万が繰越利益剰余金（貸方）に振り替わる
    expect(r.get("retained")!.currentBalance).toBe(-4000000);

    // 貸借一致
    const total = [...r.values()].reduce((s, a) => s + a.currentBalance, 0);
    expect(total).toBe(0);
  });

  it("過年度が損失なら繰越利益剰余金は借方（マイナス残高）になる", () => {
    const lines = [
      line("purchase", 3000000, 0, "2026-01-31"), // 費用のみ = 損失300万
      line("ap", 0, 3000000, "2026-01-31"),
    ];
    const r = aggregateTrialBalance(ACCOUNTS, lines, "2026-04-01", "2027-03-31");
    expect(r.get("retained")!.currentBalance).toBe(3000000); // 借方 = 繰越損失
    const total = [...r.values()].reduce((s, a) => s + a.currentBalance, 0);
    expect(total).toBe(0);
  });

  it("endDate より後の仕訳は集計しない", () => {
    const lines = [
      line("cash", 100000, 0, "2025-05-10"),
      line("sales", 0, 100000, "2025-05-10"),
      line("cash", 999999, 0, "2026-05-10"), // 期間外
    ];
    const r = aggregateTrialBalance(ACCOUNTS, lines, "2025-04-01", "2026-03-31");
    expect(r.get("cash")!.currentBalance).toBe(100000);
  });

  it("動きも残高もない科目は結果に含めない", () => {
    const lines = [line("cash", 1000, 0, "2025-05-01"), line("sales", 0, 1000, "2025-05-01")];
    const r = aggregateTrialBalance(ACCOUNTS, lines, "2025-04-01", "2026-03-31");
    expect(r.has("ap")).toBe(false);
  });
});

describe("isRetainedEarningsAccount", () => {
  it("コード3310・繰越利益剰余金・元入金を判定する", () => {
    expect(isRetainedEarningsAccount({ code: "3310", name: "繰越利益剰余金", category: "equity" })).toBe(true);
    expect(isRetainedEarningsAccount({ code: "3999", name: "元入金", category: "equity" })).toBe(true);
    expect(isRetainedEarningsAccount({ code: "3100", name: "資本金", category: "equity" })).toBe(false);
    // 純資産以外は対象外
    expect(isRetainedEarningsAccount({ code: "3310", name: "繰越利益剰余金", category: "asset" })).toBe(false);
  });
});
