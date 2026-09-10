import { describe, it, expect } from "vitest";
import {
  signOf,
  deltaOf,
  runningBalances,
  currentBalance,
  balanceAsOf,
  balanceByType,
  interestTotals,
  netByCounterparty,
  daysBetween,
  imputedInterest,
  imputedInterestAlert,
  entryTypeLabel,
  buildJournalLines,
  outstandingTranches,
  TAX_EXEMPT_INTEREST_THRESHOLD,
  addMonths,
  endOfMonth,
  generateRepaymentSchedule,
  reconcileLoanLedger,
  type LedgerEntry,
} from "./loan-ledger";

// テスト用の明細を短く書くためのヘルパ
let seq = 0;
function e(
  entry_date: string,
  entry_type: LedgerEntry["entry_type"],
  amount: number,
  extra: Partial<LedgerEntry> = {}
): LedgerEntry {
  seq += 1;
  return {
    id: `e${String(seq).padStart(3, "0")}`,
    entry_date,
    entry_type,
    amount,
    created_at: `2026-01-01T00:00:${String(seq % 60).padStart(2, "0")}Z`,
    ...extra,
  };
}

describe("signOf / deltaOf", () => {
  it("元本の発生・立替・利息は残高を増やし、返済は減らす", () => {
    expect(signOf("borrow")).toBe(1);
    expect(signOf("advance")).toBe(1);
    expect(signOf("interest")).toBe(1);
    expect(signOf("repay")).toBe(-1);
  });

  it("adjust は signed_adjustment の符号をそのまま使う", () => {
    expect(deltaOf(e("2026-03-31", "adjust", 5000, { signed_adjustment: 5000 }))).toBe(5000);
    expect(deltaOf(e("2026-03-31", "adjust", 5000, { signed_adjustment: -5000 }))).toBe(-5000);
  });

  it("adjust で signed_adjustment が無ければ残高を動かさない", () => {
    expect(deltaOf(e("2026-03-31", "adjust", 5000))).toBe(0);
  });
});

describe("runningBalances", () => {
  it("借入・立替・返済・利息を混在させても残高推移が正しい", () => {
    const entries = [
      e("2026-04-10", "borrow", 65_000), //  65,000
      e("2026-04-20", "advance", 17_595), //  82,595
      e("2026-05-15", "repay", 30_000), //  52,595
      e("2026-05-31", "interest", 1_000), //  53,595
    ];

    const rows = runningBalances(entries);

    expect(rows.map((r) => r.balanceAfter)).toEqual([65_000, 82_595, 52_595, 53_595]);
    expect(currentBalance(entries)).toBe(53_595);
  });

  it("入力順がばらばらでも日付順に積み上げる", () => {
    const entries = [
      e("2026-05-15", "repay", 30_000),
      e("2026-04-10", "borrow", 65_000),
      e("2026-04-20", "advance", 17_595),
    ];

    const rows = runningBalances(entries);

    expect(rows.map((r) => r.entry.entry_date)).toEqual([
      "2026-04-10",
      "2026-04-20",
      "2026-05-15",
    ]);
    expect(rows.map((r) => r.balanceAfter)).toEqual([65_000, 82_595, 52_595]);
  });

  it("途中の明細を削除すると以降の残高が再計算される", () => {
    const borrow = e("2026-04-10", "borrow", 65_000);
    const advance = e("2026-04-20", "advance", 17_595);
    const repay = e("2026-05-15", "repay", 30_000);

    const before = runningBalances([borrow, advance, repay]);
    expect(before.at(-1)!.balanceAfter).toBe(52_595);

    // 立替を削除
    const after = runningBalances([borrow, repay]);
    expect(after.map((r) => r.balanceAfter)).toEqual([65_000, 35_000]);
  });

  it("途中の明細を修正すると以降の残高が再計算される", () => {
    const borrow = e("2026-04-10", "borrow", 65_000);
    const repay = e("2026-05-15", "repay", 30_000);

    const fixed = { ...borrow, amount: 100_000 };
    const rows = runningBalances([fixed, repay]);

    expect(rows.map((r) => r.balanceAfter)).toEqual([100_000, 70_000]);
  });

  it("AIの下書き（status=draft）は残高に算入しない", () => {
    const entries = [
      e("2026-04-10", "borrow", 65_000, { status: "confirmed" }),
      e("2026-04-20", "borrow", 999_999, { status: "draft" }),
      e("2026-05-15", "repay", 5_000, { status: "journalized" }),
    ];

    expect(currentBalance(entries)).toBe(60_000);
    expect(runningBalances(entries)).toHaveLength(2);
  });

  it("貸付金でも同じ符号規則で、残高は正の値になる", () => {
    // direction='lend' の台帳。borrow=貸付実行、repay=回収
    const entries = [
      e("2026-04-01", "borrow", 500_000), // 貸付 500,000
      e("2026-06-30", "repay", 200_000), // 回収 200,000
    ];

    const rows = runningBalances(entries);
    expect(rows.map((r) => r.balanceAfter)).toEqual([500_000, 300_000]);
    expect(currentBalance(entries)).toBeGreaterThan(0);
  });

  it("方向によって区分の呼び名が変わる", () => {
    expect(entryTypeLabel("borrow", "borrow")).toBe("借入");
    expect(entryTypeLabel("borrow", "lend")).toBe("貸付");
    expect(entryTypeLabel("repay", "borrow")).toBe("返済");
    expect(entryTypeLabel("repay", "lend")).toBe("回収");
    expect(entryTypeLabel("advance", "borrow")).toBe("立替");
  });
});

describe("balanceAsOf", () => {
  const entries = [
    e("2026-01-10", "borrow", 100_000),
    e("2026-03-31", "repay", 40_000),
    e("2026-04-01", "borrow", 50_000),
  ];

  it("指定日を含めて集計する", () => {
    expect(balanceAsOf(entries, "2026-03-31")).toBe(60_000);
  });

  it("指定日より後の明細は含めない", () => {
    expect(balanceAsOf(entries, "2026-03-30")).toBe(100_000);
  });

  it("全期間なら現在残高と一致する", () => {
    expect(balanceAsOf(entries, "2026-12-31")).toBe(currentBalance(entries));
  });
});

describe("balanceByType", () => {
  it("区分ごとの内訳を集計する（決算時の説明用）", () => {
    const entries = [
      e("2026-04-10", "borrow", 65_000),
      e("2026-04-20", "advance", 17_595),
      e("2026-04-25", "advance", 3_000),
      e("2026-05-15", "repay", 30_000),
      e("2026-05-31", "interest", 1_000),
    ];

    const by = balanceByType(entries);

    expect(by.borrow).toBe(65_000);
    expect(by.advance).toBe(20_595); // 未精算の立替
    expect(by.repay).toBe(30_000);
    expect(by.interest).toBe(1_000);
  });
});

describe("netByCounterparty", () => {
  it("同一相手先の借入金と貸付金を差引で把握できる", () => {
    const headers = [
      { id: "L1", lender_name: "安藤 蓮", direction: "borrow" as const },
      { id: "L2", lender_name: "安藤 蓮", direction: "lend" as const },
    ];
    const entries = {
      L1: [e("2026-04-01", "borrow", 140_885)],
      L2: [e("2026-05-01", "borrow", 500_000)],
    };

    const [pos] = netByCounterparty(headers, entries);

    expect(pos.name).toBe("安藤 蓮");
    expect(pos.borrowBalance).toBe(140_885);
    expect(pos.lendBalance).toBe(500_000);
    // 差引は符号ではなく「どちら側に残るか」で表す
    expect(pos.net).toBe(359_115);
    expect(pos.netSide).toBe("lend");
  });

  it("借入の方が大きければ borrow 側に残る", () => {
    const headers = [
      { id: "L1", lender_name: "社長", direction: "borrow" as const },
      { id: "L2", lender_name: "社長", direction: "lend" as const },
    ];
    const entries = {
      L1: [e("2026-04-01", "borrow", 800_000)],
      L2: [e("2026-04-01", "borrow", 300_000)],
    };

    const [pos] = netByCounterparty(headers, entries);
    expect(pos.net).toBe(500_000);
    expect(pos.netSide).toBe("borrow");
  });

  it("相殺されれば even になる", () => {
    const headers = [
      { id: "L1", lender_name: "社長", direction: "borrow" as const },
      { id: "L2", lender_name: "社長", direction: "lend" as const },
    ];
    const entries = {
      L1: [e("2026-04-01", "borrow", 100_000)],
      L2: [e("2026-04-01", "borrow", 100_000)],
    };

    const [pos] = netByCounterparty(headers, entries);
    expect(pos.net).toBe(0);
    expect(pos.netSide).toBe("even");
  });

  it("相手先が違えば別の行になる", () => {
    const headers = [
      { id: "L1", lender_name: "安藤 蓮", direction: "borrow" as const },
      { id: "L2", lender_name: "○○銀行", direction: "borrow" as const },
    ];
    const entries = {
      L1: [e("2026-04-01", "borrow", 100_000)],
      L2: [e("2026-04-01", "borrow", 5_000_000)],
    };

    expect(netByCounterparty(headers, entries)).toHaveLength(2);
  });
});

describe("daysBetween / imputedInterest", () => {
  it("日数の差を返す", () => {
    expect(daysBetween("2026-04-01", "2027-03-31")).toBe(364);
    expect(daysBetween("2026-04-01", "2026-04-01")).toBe(0);
    expect(daysBetween("2026-04-10", "2026-04-01")).toBe(-9);
  });

  it("うるう日をまたいでも日数がずれない", () => {
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
  });

  it("年利と日数から認定利息を試算する", () => {
    // 1,000,000 × 0.9% × 365/365 = 9,000
    expect(imputedInterest(1_000_000, 0.9, 365)).toBe(9_000);
    // 半年なら概ね半分
    expect(imputedInterest(1_000_000, 0.9, 182)).toBe(4_488);
  });

  it("利率が未設定なら推測せず null を返す", () => {
    expect(imputedInterest(1_000_000, null, 365)).toBeNull();
    expect(imputedInterest(1_000_000, undefined, 365)).toBeNull();
  });

  it("残高が無ければ 0", () => {
    expect(imputedInterest(0, 0.9, 365)).toBe(0);
  });
});

describe("imputedInterestAlert", () => {
  // 3月決算（期首4月）を前提にする
  const MARCH_CLOSING = 4;
  const rates = { 2025: 0.9, 2026: 1.3 };

  it("貸付金の残高が無ければ none", () => {
    const alert = imputedInterestAlert({
      entries: [],
      fiscalStartMonth: MARCH_CLOSING,
      today: "2026-09-08",
      rateByLoanYear: rates,
    });

    expect(alert.level).toBe("none");
    expect(alert.balance).toBe(0);
    expect(alert.estimatedInterest).toBe(0);
  });

  it("期中に発生し、まだ期末を跨いでいなければ warning ＋ 決算日までの日数", () => {
    const alert = imputedInterestAlert({
      entries: [e("2026-05-01", "borrow", 1_000_000)],
      fiscalStartMonth: MARCH_CLOSING,
      today: "2026-09-08",
      rateByLoanYear: rates,
    });

    expect(alert.level).toBe("warning");
    expect(alert.balance).toBe(1_000_000);
    expect(alert.fiscalYearEnd).toBe("2027-03-31");
    expect(alert.daysUntilFiscalYearEnd).toBe(daysBetween("2026-09-08", "2027-03-31"));
    expect(alert.balanceAtPriorYearEnd).toBe(0);
  });

  it("期末を跨いで残高があれば required（認定利息の計上が必要）", () => {
    const alert = imputedInterestAlert({
      // 前期（2025-04-01〜2026-03-31）に発生し、期末時点で残っている
      entries: [e("2025-06-01", "borrow", 1_000_000)],
      fiscalStartMonth: MARCH_CLOSING,
      today: "2026-09-08",
      rateByLoanYear: rates,
    });

    expect(alert.level).toBe("required");
    expect(alert.priorFiscalYearEnd).toBe("2026-03-31");
    expect(alert.balanceAtPriorYearEnd).toBe(1_000_000);
    // 期首より前からある貸付は「期首から期末まで」で試算する
    expect(alert.breakdown[0].rate).toBe(0.9);
    expect(alert.breakdown[0].days).toBe(daysBetween("2026-04-01", "2027-03-31"));
    expect(alert.estimatedInterest).toBe(
      imputedInterest(1_000_000, 0.9, daysBetween("2026-04-01", "2027-03-31"))
    );
  });

  it("期末より前に完済していれば required にならない", () => {
    const alert = imputedInterestAlert({
      entries: [
        e("2025-06-01", "borrow", 1_000_000),
        e("2026-03-30", "repay", 1_000_000), // 期末(2026-03-31)より前に完済
      ],
      fiscalStartMonth: MARCH_CLOSING,
      today: "2026-09-08",
      rateByLoanYear: rates,
    });

    expect(alert.balanceAtPriorYearEnd).toBe(0);
    expect(alert.level).toBe("none");
  });

  it("利率が未登録の年度は試算せず null を返す（推測しない）", () => {
    const alert = imputedInterestAlert({
      entries: [e("2025-06-01", "borrow", 1_000_000)],
      fiscalStartMonth: MARCH_CLOSING,
      today: "2026-09-08",
      rateByLoanYear: {}, // 2026年度の利率が未登録
    });

    expect(alert.level).toBe("required");
    expect(alert.missingRateYears).toEqual([2025]);
    expect(alert.estimatedInterest).toBeNull();
  });

  it("12月決算（期首1月）でも決算日が正しく求まる", () => {
    const alert = imputedInterestAlert({
      entries: [e("2026-02-01", "borrow", 500_000)],
      fiscalStartMonth: 1,
      today: "2026-09-08",
      rateByLoanYear: { 2026: 0.9 },
    });

    expect(alert.fiscalYearEnd).toBe("2026-12-31");
    expect(alert.priorFiscalYearEnd).toBe("2025-12-31");
    expect(alert.level).toBe("warning");
  });
});

describe("移行時の差額調整", () => {
  it("旧残高が明細の積み上げより多い場合、調整で埋めて残高が一致する", () => {
    // 旧 current_balance = 100,000 / 明細の積み上げ = 65,000 → 差額 +35,000
    const entries = [
      e("2026-04-10", "borrow", 65_000),
      e("2026-04-10", "adjust", 35_000, { signed_adjustment: 35_000 }),
    ];

    expect(currentBalance(entries)).toBe(100_000);
  });

  it("旧残高が明細の積み上げより少ない場合も調整で一致する", () => {
    // 旧 current_balance = 50,000 / 明細の積み上げ = 65,000 → 差額 -15,000
    const entries = [
      e("2026-04-10", "borrow", 65_000),
      e("2026-04-10", "adjust", 15_000, { signed_adjustment: -15_000 }),
    ];

    expect(currentBalance(entries)).toBe(50_000);
  });
});

describe("buildJournalLines", () => {
  const base = {
    amount: 65_000,
    ledgerAccountId: "LEDGER",
    paymentAccountId: "BANK",
    expenseAccountId: "EXPENSE",
    interestAccountId: "INTEREST",
  };

  // 借方・貸方を読みやすい形に畳む
  const shape = (lines: ReturnType<typeof buildJournalLines>) => ({
    debit: lines.find((l) => l.debit > 0)!.accountId,
    credit: lines.find((l) => l.credit > 0)!.accountId,
    amount: lines.find((l) => l.debit > 0)!.debit,
  });

  it("貸借が必ず一致する", () => {
    for (const entryType of ["borrow", "advance", "repay", "interest"] as const) {
      const lines = buildJournalLines({ ...base, direction: "borrow", entryType });
      const d = lines.reduce((s, l) => s + l.debit, 0);
      const c = lines.reduce((s, l) => s + l.credit, 0);
      expect(d).toBe(c);
      expect(d).toBe(65_000);
    }
  });

  describe("借入金台帳", () => {
    it("借入は 借方 普通預金 / 貸方 役員借入金", () => {
      expect(shape(buildJournalLines({ ...base, direction: "borrow", entryType: "borrow" })))
        .toEqual({ debit: "BANK", credit: "LEDGER", amount: 65_000 });
    });

    it("立替は 借方 費用 / 貸方 役員借入金 で、現金科目が動かない（要件3-2）", () => {
      const lines = buildJournalLines({ ...base, direction: "borrow", entryType: "advance" });
      expect(shape(lines)).toEqual({ debit: "EXPENSE", credit: "LEDGER", amount: 65_000 });
      // 現金は動かないので支払科目が一切登場しないこと
      expect(lines.some((l) => l.accountId === "BANK")).toBe(false);
    });

    it("返済は 借方 役員借入金 / 貸方 普通預金", () => {
      expect(shape(buildJournalLines({ ...base, direction: "borrow", entryType: "repay" })))
        .toEqual({ debit: "LEDGER", credit: "BANK", amount: 65_000 });
    });

    it("利息は 借方 支払利息 / 貸方 役員借入金", () => {
      expect(shape(buildJournalLines({ ...base, direction: "borrow", entryType: "interest" })))
        .toEqual({ debit: "INTEREST", credit: "LEDGER", amount: 65_000 });
    });

    it("立替で費用科目が無ければエラーになる", () => {
      expect(() =>
        buildJournalLines({
          ...base,
          direction: "borrow",
          entryType: "advance",
          expenseAccountId: null,
        })
      ).toThrow(/費用科目/);
    });
  });

  describe("貸付金台帳", () => {
    it("貸付は 借方 役員貸付金 / 貸方 普通預金", () => {
      expect(shape(buildJournalLines({ ...base, direction: "lend", entryType: "borrow" })))
        .toEqual({ debit: "LEDGER", credit: "BANK", amount: 65_000 });
    });

    it("回収は 借方 普通預金 / 貸方 役員貸付金", () => {
      expect(shape(buildJournalLines({ ...base, direction: "lend", entryType: "repay" })))
        .toEqual({ debit: "BANK", credit: "LEDGER", amount: 65_000 });
    });

    it("認定利息は 借方 役員貸付金 / 貸方 受取利息", () => {
      expect(shape(buildJournalLines({ ...base, direction: "lend", entryType: "interest" })))
        .toEqual({ debit: "LEDGER", credit: "INTEREST", amount: 65_000 });
    });

    it("立替は貸付金台帳では使えない", () => {
      expect(() =>
        buildJournalLines({ ...base, direction: "lend", entryType: "advance" })
      ).toThrow(/借入金台帳のみ/);
    });
  });

  it("調整の明細は仕訳化できない", () => {
    expect(() =>
      buildJournalLines({ ...base, direction: "borrow", entryType: "adjust" })
    ).toThrow(/調整/);
  });
});

describe("outstandingTranches（貸付年ごとの残高）", () => {
  it("貸付を実行順にトランシェとして積む", () => {
    const t = outstandingTranches(
      [e("2024-06-01", "borrow", 300_000), e("2026-02-01", "borrow", 500_000)],
      "2026-12-31"
    );
    expect(t).toEqual([
      { loanYear: 2024, date: "2024-06-01", outstanding: 300_000 },
      { loanYear: 2026, date: "2026-02-01", outstanding: 500_000 },
    ]);
  });

  it("返済は古い貸付から充当する（FIFO）", () => {
    const t = outstandingTranches(
      [
        e("2024-06-01", "borrow", 300_000),
        e("2026-02-01", "borrow", 500_000),
        e("2026-03-01", "repay", 400_000),
      ],
      "2026-12-31"
    );
    // 2024年分は完済し、2026年分が400,000残る
    expect(t).toEqual([{ loanYear: 2026, date: "2026-02-01", outstanding: 400_000 }]);
  });

  it("指定日より後の明細は含めない", () => {
    const t = outstandingTranches(
      [e("2024-06-01", "borrow", 300_000), e("2026-02-01", "borrow", 500_000)],
      "2025-12-31"
    );
    expect(t).toHaveLength(1);
    expect(t[0].loanYear).toBe(2024);
  });

  it("完済すればトランシェが残らない", () => {
    const t = outstandingTranches(
      [e("2024-06-01", "borrow", 300_000), e("2025-01-01", "repay", 300_000)],
      "2026-12-31"
    );
    expect(t).toEqual([]);
  });
});

describe("認定利息の利率は貸付を行った暦年で決まる", () => {
  // 国税庁 タックスアンサー No.2606 の公表値
  const OFFICIAL = { 2021: 1.0, 2022: 0.9, 2023: 0.9, 2024: 0.9, 2025: 0.9, 2026: 1.3 };

  it("古い貸付には当時の利率が、新しい貸付には新しい利率が適用される", () => {
    const alert = imputedInterestAlert({
      entries: [
        e("2024-06-01", "borrow", 1_000_000), // 2024年の貸付 → 0.9%
        e("2026-02-01", "borrow", 1_000_000), // 2026年の貸付 → 1.3%
      ],
      fiscalStartMonth: 4, // 3月決算
      today: "2026-09-08",
      rateByLoanYear: OFFICIAL,
    });

    expect(alert.level).toBe("required");
    const rates = alert.breakdown.map((b) => ({ year: b.loanYear, rate: b.rate }));
    expect(rates).toEqual([
      { year: 2024, rate: 0.9 },
      { year: 2026, rate: 1.3 },
    ]);
  });

  it("年が変わっても既存の貸付の利率は変わらない（当年の利率で上書きしない）", () => {
    const alert = imputedInterestAlert({
      entries: [e("2022-05-01", "borrow", 1_000_000)],
      fiscalStartMonth: 4,
      today: "2026-09-08",
      rateByLoanYear: OFFICIAL,
    });
    // 2026年時点でも2022年の 0.9% が適用される（1.3% にはならない）
    expect(alert.breakdown[0].rate).toBe(0.9);
  });

  it("利率が未登録の貸付年が1つでもあれば合計を出さない", () => {
    const alert = imputedInterestAlert({
      entries: [
        e("2024-06-01", "borrow", 1_000_000),
        e("2019-06-01", "borrow", 1_000_000), // 利率未登録
      ],
      fiscalStartMonth: 4,
      today: "2026-09-08",
      rateByLoanYear: OFFICIAL,
    });

    expect(alert.missingRateYears).toEqual([2019]);
    expect(alert.estimatedInterest).toBeNull();
  });

  it("試算額が年5,000円以下なら給与課税の例外の目安を立てる", () => {
    const alert = imputedInterestAlert({
      entries: [e("2024-06-01", "borrow", 300_000)], // 300,000 × 0.9% ≒ 2,700円
      fiscalStartMonth: 4,
      today: "2026-09-08",
      rateByLoanYear: OFFICIAL,
    });

    expect(alert.estimatedInterest).toBeLessThanOrEqual(TAX_EXEMPT_INTEREST_THRESHOLD);
    expect(alert.withinTaxExemptThreshold).toBe(true);
  });

  it("試算額が5,000円を超えれば例外の目安は立たない", () => {
    const alert = imputedInterestAlert({
      entries: [e("2024-06-01", "borrow", 5_000_000)],
      fiscalStartMonth: 4,
      today: "2026-09-08",
      rateByLoanYear: OFFICIAL,
    });

    expect(alert.withinTaxExemptThreshold).toBe(false);
  });
});

describe("addMonths", () => {
  it("月を加算する", () => {
    expect(addMonths("2026-04-10", 1)).toBe("2026-05-10");
    expect(addMonths("2026-04-10", 12)).toBe("2027-04-10");
  });

  it("年をまたぐ", () => {
    expect(addMonths("2026-11-30", 2)).toBe("2027-01-30");
  });

  it("末日は繰り上がらず、その月の末日に丸める", () => {
    // 1月31日の1か月後は「3月3日」ではなく2月末
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29"); // うるう年
  });
});

describe("generateRepaymentSchedule", () => {
  it("元金均等: 元金が一定で、利息は残高に応じて減る", () => {
    const rows = generateRepaymentSchedule({
      principal: 1_200_000,
      annualRatePercent: 2.4, // 月利 0.2%
      termMonths: 12,
      firstDueDate: "2026-04-30",
      method: "equal_principal",
    });

    expect(rows).toHaveLength(12);
    expect(rows[0].principal_amount).toBe(100_000);
    expect(rows[0].interest_amount).toBe(2_400); // 1,200,000 × 0.2%
    // 残高が減るので利息も減る
    expect(rows[1].interest_amount).toBeLessThan(rows[0].interest_amount);
    expect(rows.at(-1)!.interest_amount).toBeLessThan(rows[0].interest_amount);
  });

  it("元利均等: 毎回の支払総額がほぼ一定になる", () => {
    const rows = generateRepaymentSchedule({
      principal: 1_200_000,
      annualRatePercent: 2.4,
      termMonths: 12,
      firstDueDate: "2026-04-30",
      method: "equal_payment",
    });

    const totals = rows.slice(0, -1).map((r) => r.principal_amount + r.interest_amount);
    const min = Math.min(...totals);
    const max = Math.max(...totals);
    // 端数処理の分だけの差に収まる
    expect(max - min).toBeLessThanOrEqual(2);
  });

  it("どちらの方式でも、元金の合計が借入額に必ず一致する", () => {
    for (const method of ["equal_principal", "equal_payment"] as const) {
      const rows = generateRepaymentSchedule({
        principal: 1_000_000,
        annualRatePercent: 1.875, // 割り切れない利率
        termMonths: 7,            // 割り切れない回数
        firstDueDate: "2026-04-30",
        method,
      });
      const sum = rows.reduce((s, r) => s + r.principal_amount, 0);
      expect(sum).toBe(1_000_000);
    }
  });

  it("無利息なら利息はすべて0で、元金だけを等分する", () => {
    const rows = generateRepaymentSchedule({
      principal: 300_000,
      annualRatePercent: 0,
      termMonths: 3,
      firstDueDate: "2026-04-30",
      method: "equal_payment",
    });
    expect(rows.every((r) => r.interest_amount === 0)).toBe(true);
    expect(rows.map((r) => r.principal_amount)).toEqual([100_000, 100_000, 100_000]);
  });

  it("返済日は初回から1か月ずつ進む", () => {
    const rows = generateRepaymentSchedule({
      principal: 300_000,
      annualRatePercent: 0,
      termMonths: 3,
      firstDueDate: "2026-01-31",
      method: "equal_principal",
    });
    expect(rows.map((r) => r.due_date)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });

  it("借入額や回数が0以下なら予定表を作らない", () => {
    const base = { annualRatePercent: 1, firstDueDate: "2026-04-30", method: "equal_principal" as const };
    expect(generateRepaymentSchedule({ ...base, principal: 0, termMonths: 12 })).toEqual([]);
    expect(generateRepaymentSchedule({ ...base, principal: 100, termMonths: 0 })).toEqual([]);
  });
});

describe("reconcileLoanLedger（整合性チェック）", () => {
  const j = (
    journalEntryId: string,
    date: string,
    debit: number,
    credit: number,
    description?: string
  ) => ({ journalEntryId, date, debit, credit, description });

  it("すべて仕訳化されていれば一致する", () => {
    const entries = [
      { ...e("2026-04-10", "borrow", 65_000), status: "journalized" as const, journal_entry_id: "J1" },
      { ...e("2026-05-15", "repay", 30_000), status: "journalized" as const, journal_entry_id: "J2" },
    ];
    const result = reconcileLoanLedger({
      direction: "borrow",
      entries,
      journalLines: [j("J1", "2026-04-10", 0, 65_000), j("J2", "2026-05-15", 30_000, 0)],
    });

    expect(result.ledgerBalance).toBe(35_000);
    expect(result.journalBalance).toBe(35_000);
    expect(result.matched).toBe(true);
    expect(result.suspects).toHaveLength(0);
  });

  it("仕訳にしていない明細があると、差額とその明細を挙げる", () => {
    const entries = [
      { ...e("2026-04-10", "borrow", 65_000), status: "journalized" as const, journal_entry_id: "J1" },
      // まだ仕訳にしていない
      { ...e("2026-04-20", "advance", 17_595), status: "confirmed" as const },
    ];
    const result = reconcileLoanLedger({
      direction: "borrow",
      entries,
      journalLines: [j("J1", "2026-04-10", 0, 65_000)],
    });

    expect(result.matched).toBe(false);
    expect(result.difference).toBe(17_595);
    expect(result.largerSide).toBe("ledger"); // 台帳の方が大きい
    expect(result.suspects.some((s) => s.kind === "not_journalized")).toBe(true);
  });

  it("台帳に無い仕訳があると、その仕訳を挙げる", () => {
    const entries = [
      { ...e("2026-04-10", "borrow", 65_000), status: "journalized" as const, journal_entry_id: "J1" },
    ];
    const result = reconcileLoanLedger({
      direction: "borrow",
      entries,
      journalLines: [
        j("J1", "2026-04-10", 0, 65_000),
        // 台帳を通さず直接入力された仕訳
        j("J9", "2026-06-01", 0, 50_000, "手入力の借入"),
      ],
    });

    expect(result.matched).toBe(false);
    expect(result.difference).toBe(50_000);
    expect(result.largerSide).toBe("journal"); // 仕訳の方が大きい
    const s = result.suspects.find((x) => x.kind === "journal_without_entry");
    expect(s?.refId).toBe("J9");
  });

  it("AIの下書きは残高に入らないが、原因候補として挙げる", () => {
    const entries = [
      { ...e("2026-04-10", "borrow", 65_000), status: "journalized" as const, journal_entry_id: "J1" },
      { ...e("2026-04-25", "borrow", 99_999), status: "draft" as const },
    ];
    const result = reconcileLoanLedger({
      direction: "borrow",
      entries,
      journalLines: [j("J1", "2026-04-10", 0, 65_000)],
    });

    expect(result.ledgerBalance).toBe(65_000); // 下書きは含まない
    expect(result.matched).toBe(true);
    expect(result.suspects.some((s) => s.kind === "draft_entry")).toBe(true);
  });

  it("貸付金は借方・貸方が逆になる", () => {
    const entries = [
      { ...e("2026-04-01", "borrow", 500_000), status: "journalized" as const, journal_entry_id: "J1" },
    ];
    const result = reconcileLoanLedger({
      direction: "lend",
      entries,
      // 貸付は 借方 役員貸付金 / 貸方 普通預金
      journalLines: [j("J1", "2026-04-01", 500_000, 0)],
    });

    expect(result.journalBalance).toBe(500_000);
    expect(result.matched).toBe(true);
  });
});

describe("返済と同時に支払う利息（銀行返済）", () => {
  const base = {
    ledgerAccountId: "LOAN",
    paymentAccountId: "BANK",
    expenseAccountId: "EXPENSE",
    interestAccountId: "INTEREST",
  };

  it("元金と利息を同時に払うと、貸方は合計額の1行になる", () => {
    const lines = buildJournalLines({
      ...base,
      direction: "borrow",
      entryType: "repay",
      amount: 100_000,
      paidInterest: 2_400,
    });

    expect(lines).toEqual([
      { accountId: "LOAN", debit: 100_000, credit: 0 },
      { accountId: "INTEREST", debit: 2_400, credit: 0 },
      { accountId: "BANK", debit: 0, credit: 102_400 },
    ]);
  });

  it("利息を払っても、借入金が減るのは元金の分だけ", () => {
    const lines = buildJournalLines({
      ...base,
      direction: "borrow",
      entryType: "repay",
      amount: 100_000,
      paidInterest: 2_400,
    });
    const loanLine = lines.find((l) => l.accountId === "LOAN")!;
    // 借入金の借方は元金のみ。利息分だけ借入金が動いてはいけない
    expect(loanLine.debit).toBe(100_000);
    expect(lines.filter((l) => l.accountId === "LOAN")).toHaveLength(1);
  });

  it("利息が0なら2行のままにする", () => {
    const lines = buildJournalLines({
      ...base,
      direction: "borrow",
      entryType: "repay",
      amount: 100_000,
      paidInterest: 0,
    });
    expect(lines).toHaveLength(2);
    expect(lines.some((l) => l.accountId === "INTEREST")).toBe(false);
  });

  it("利息があっても貸借は一致する", () => {
    const lines = buildJournalLines({
      ...base,
      direction: "borrow",
      entryType: "repay",
      amount: 100_000,
      paidInterest: 2_400,
    });
    expect(lines.reduce((s, l) => s + l.debit, 0)).toBe(
      lines.reduce((s, l) => s + l.credit, 0)
    );
  });

  it("支払済みの利息は残高を動かさない（未払利息の計上とは別物）", () => {
    const repayWithInterest = {
      ...e("2026-04-30", "repay", 100_000),
      interest_amount: 2_400,
    };
    const entries = [e("2026-04-01", "borrow", 1_200_000), repayWithInterest];

    // 1,200,000 − 100,000 = 1,100,000。利息の2,400は残高に影響しない
    expect(currentBalance(entries)).toBe(1_100_000);
  });

  it("未払利息の計上（entry_type=interest）は従来どおり残高を増やす", () => {
    const entries = [e("2026-04-01", "borrow", 100_000), e("2026-04-30", "interest", 500)];
    expect(currentBalance(entries)).toBe(100_500);
  });
});

describe("返済日の決め方（月末 / 同じ日にち）", () => {
  const base = {
    principal: 1_200_000,
    annualRatePercent: 0,
    termMonths: 12,
    firstDueDate: "2026-04-30",
    method: "equal_principal" as const,
  };

  it("endOfMonth はその月の末日を返す", () => {
    expect(endOfMonth("2026-05-01")).toBe("2026-05-31");
    expect(endOfMonth("2026-02-10")).toBe("2026-02-28");
    expect(endOfMonth("2028-02-10")).toBe("2028-02-29"); // うるう年
  });

  it("月末を選ぶと、各月の末日になる", () => {
    const rows = generateRepaymentSchedule({ ...base, dueDateMode: "month_end" });
    expect(rows.map((r) => r.due_date).slice(0, 4)).toEqual([
      "2026-04-30",
      "2026-05-31", // 30日ではなく末日
      "2026-06-30",
      "2026-07-31",
    ]);
    // 2月も末日になる
    expect(rows.map((r) => r.due_date)).toContain("2027-02-28");
    expect(rows.at(-1)!.due_date).toBe("2027-03-31");
  });

  it("同じ日にちを選ぶと、初回の日にちで揃う", () => {
    const rows = generateRepaymentSchedule({ ...base, dueDateMode: "same_day" });
    expect(rows.map((r) => r.due_date).slice(0, 3)).toEqual([
      "2026-04-30",
      "2026-05-30",
      "2026-06-30",
    ]);
    // 2月は28日に丸めるが、翌月は元の日にちに戻る（ずれを蓄積させない）
    expect(rows.map((r) => r.due_date)).toContain("2027-02-28");
    expect(rows.at(-1)!.due_date).toBe("2027-03-30");
  });

  it("指定しなければ従来どおり「同じ日にち」で動く", () => {
    const rows = generateRepaymentSchedule(base);
    expect(rows[1].due_date).toBe("2026-05-30");
  });

  it("25日など月中の日でも、月末を選べば末日になる", () => {
    const rows = generateRepaymentSchedule({
      ...base,
      termMonths: 3,
      firstDueDate: "2026-04-25",
      dueDateMode: "month_end",
    });
    expect(rows.map((r) => r.due_date)).toEqual(["2026-04-30", "2026-05-31", "2026-06-30"]);
  });
});

describe("interestTotals（利息の集計）", () => {
  it("返済と同時に払った利息を数える（銀行返済で0にならないこと）", () => {
    const entries = [
      e("2026-04-01", "borrow", 1_200_000),
      { ...e("2026-04-30", "repay", 100_000), interest_amount: 2_400 },
      { ...e("2026-05-31", "repay", 100_000), interest_amount: 2_200 },
    ];
    const t = interestTotals(entries);

    expect(t.paid).toBe(4_600);
    expect(t.accrued).toBe(0);
    expect(t.total).toBe(4_600);
  });

  it("元本に加算した利息と、支払った利息を分けて数える", () => {
    const entries = [
      { ...e("2026-04-30", "repay", 100_000), interest_amount: 2_400 },
      e("2026-06-30", "interest", 500), // 未払利息を元本に加算
    ];
    const t = interestTotals(entries);

    expect(t.paid).toBe(2_400);
    expect(t.accrued).toBe(500);
    expect(t.total).toBe(2_900);
  });

  it("期間を指定するとその期間だけを数える（内訳明細書の期中集計に使う）", () => {
    const entries = [
      { ...e("2026-03-31", "repay", 100_000), interest_amount: 9_999 }, // 前期
      { ...e("2026-04-30", "repay", 100_000), interest_amount: 2_400 },
      { ...e("2027-04-30", "repay", 100_000), interest_amount: 1_111 }, // 翌期
    ];
    const t = interestTotals(entries, { from: "2026-04-01", to: "2027-03-31" });

    expect(t.total).toBe(2_400);
  });

  it("AIの下書きは数えない", () => {
    const entries = [
      { ...e("2026-04-30", "repay", 100_000), interest_amount: 2_400, status: "draft" as const },
    ];
    expect(interestTotals(entries).paid).toBe(0);
  });
});

describe("認定利息の試算期間", () => {
  const OFFICIAL = { 2024: 0.9, 2025: 0.9, 2026: 1.3 };
  const MARCH = 4; // 3月決算（期首4月）

  it("期中に実行した貸付は、実行日から期末までで数える（今日からではない）", () => {
    const alert = imputedInterestAlert({
      entries: [e("2026-05-01", "borrow", 1_000_000)],
      fiscalStartMonth: MARCH,
      today: "2026-09-10",
      rateByLoanYear: OFFICIAL,
    });

    // 5/1〜3/31。「今日(9/10)から3/31」の202日で数えると経過分が抜けて過小になる
    expect(alert.breakdown[0].days).toBe(daysBetween("2026-05-01", "2027-03-31"));
    expect(alert.breakdown[0].days).toBeGreaterThan(daysBetween("2026-09-10", "2027-03-31"));
  });

  it("期首より前からある貸付は、期首から期末までで数える（前期以前まで遡らない）", () => {
    const alert = imputedInterestAlert({
      entries: [e("2024-08-01", "borrow", 1_000_000)],
      fiscalStartMonth: MARCH,
      today: "2026-09-10",
      rateByLoanYear: OFFICIAL,
    });

    expect(alert.breakdown[0].days).toBe(daysBetween("2026-04-01", "2027-03-31"));
  });

  it("古い貸付と当期の貸付が混在しても、それぞれの利率と期間で数える", () => {
    const alert = imputedInterestAlert({
      entries: [
        e("2025-06-01", "borrow", 1_000_000), // 前期から継続 → 0.9% / 期首から
        e("2026-05-01", "borrow", 2_000_000), // 当期に実行   → 1.3% / 実行日から
      ],
      fiscalStartMonth: MARCH,
      today: "2026-09-10",
      rateByLoanYear: OFFICIAL,
    });

    expect(alert.level).toBe("required");
    expect(alert.breakdown).toHaveLength(2);

    const [older, newer] = alert.breakdown;
    expect(older).toMatchObject({ loanYear: 2025, outstanding: 1_000_000, rate: 0.9 });
    expect(older.days).toBe(daysBetween("2026-04-01", "2027-03-31"));
    expect(newer).toMatchObject({ loanYear: 2026, outstanding: 2_000_000, rate: 1.3 });
    expect(newer.days).toBe(daysBetween("2026-05-01", "2027-03-31"));

    // 合計は両方の合算。片方だけで数えていないこと
    expect(alert.estimatedInterest).toBe((older.interest ?? 0) + (newer.interest ?? 0));
    expect(alert.estimatedInterest).toBeGreaterThan(older.interest ?? 0);
  });
});
