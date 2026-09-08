import { describe, it, expect } from "vitest";
import {
  signOf,
  deltaOf,
  runningBalances,
  currentBalance,
  balanceAsOf,
  balanceByType,
  netByCounterparty,
  daysBetween,
  imputedInterest,
  imputedInterestAlert,
  entryTypeLabel,
  buildJournalLines,
  outstandingTranches,
  TAX_EXEMPT_INTEREST_THRESHOLD,
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
    // 前期末→当期末の 365 日分を試算
    expect(alert.breakdown[0].rate).toBe(0.9);
    expect(alert.estimatedInterest).toBe(
      imputedInterest(1_000_000, 0.9, daysBetween("2026-03-31", "2027-03-31"))
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
