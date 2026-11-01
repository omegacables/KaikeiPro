import { describe, it, expect } from "vitest";
import { classifyTable, findHeaderRow, inboxFileKind, reviewQuestionFor, splitTable, statementLinesToTable, chunk } from "./inbox";

describe("inboxFileKind", () => {
  it("拡張子と種類で見分ける", () => {
    expect(inboxFileKind("a.csv")).toBe("table");
    expect(inboxFileKind("a.xlsx")).toBe("table");
    expect(inboxFileKind("通帳.PDF")).toBe("pdf");
    expect(inboxFileKind("IMG_0001.HEIC")).toBe("image");
    expect(inboxFileKind("photo", "image/jpeg")).toBe("image");
    expect(inboxFileKind("a.docx")).toBe("unsupported");
  });
});

describe("表の見出しと種類", () => {
  it("通帳CSVの先頭の口座情報の行を飛ばして見出しを見つける", () => {
    const grid = [
      ["口座番号", "1234567"],
      ["期間", "2026/04/01〜2026/04/30"],
      ["取引日", "お取引内容", "お支払金額", "お預り金額", "残高"],
      ["2026/04/01", "デンキ", "5000", "", "100000"],
      ["", "", "", "", ""],
    ];
    expect(findHeaderRow(grid)).toBe(2);
    const t = splitTable(grid);
    expect(t.header[0]).toBe("取引日");
    expect(t.rows).toHaveLength(1);
    expect(classifyTable(t.header)).toBe("bank");
  });
  it("仕訳・カード・給与の表を見分ける", () => {
    expect(classifyTable(["日付", "借方勘定科目", "借方金額", "貸方勘定科目", "貸方金額", "摘要"])).toBe("journal");
    expect(classifyTable(["ご利用日", "ご利用店名", "ご利用金額"])).toBe("card");
    expect(classifyTable(["氏名", "基本給", "総支給額"])).toBe("payroll");
    expect(classifyTable(["A", "B"])).toBe("unknown");
  });
});

describe("statementLinesToTable", () => {
  it("入金と出金の列に分ける", () => {
    const t = statementLinesToTable([
      { date: "2026-04-01", description: "振込 カ）エー", counterparty: "エー", amount: 50000, direction: "deposit", balanceAfter: 150000 },
      { date: "2026-04-02", description: "デンキ", counterparty: null, amount: -5000, direction: "withdrawal", balanceAfter: null },
    ]);
    expect(t.rows[0]).toEqual(["2026-04-01", "振込 カ）エー", "エー", "", "50000", "150000"]);
    expect(t.rows[1]).toEqual(["2026-04-02", "デンキ", "", "5000", "", ""]);
  });
  it("chunk で50件ずつに分ける", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe("reviewQuestionFor", () => {
  const base = { fileName: "r.jpg", perPersonLimit: 10_000, underLimitAccount: "会議費" };
  const journal = (over: Partial<NonNullable<Parameters<typeof reviewQuestionFor>[0]["journal"]>> = {}) => ({
    needsReview: false,
    description: "テスト",
    lines: [
      { accountName: "消耗品費", debit: 1000, credit: 0, entertainmentKind: null, attendees: null },
      { accountName: "現金", debit: 0, credit: 1000, entertainmentKind: null, attendees: null },
    ],
    ...over,
  });

  it("読み取れないものは撮り直しを頼む", () => {
    const q = reviewQuestionFor({ ...base, ocr: { legibility: "unreadable", confidence: 0.2 }, journal: null });
    expect(q?.reason).toBe("unreadable");
  });
  it("重複の可能性を先に聞く", () => {
    const q = reviewQuestionFor({ ...base, ocr: { amount_total: 1000, possible_duplicate: true, legibility: "partly_unclear" }, journal: journal() });
    expect(q?.reason).toBe("duplicate");
  });
  it("交際費の飲食で人数が無ければ人数と相手を聞く", () => {
    const q = reviewQuestionFor({
      ...base,
      ocr: { amount_total: 12000, vendor_name: "居酒屋A", confidence: 0.9 },
      journal: journal({
        lines: [
          { accountName: "接待交際費", debit: 12000, credit: 0, entertainmentKind: "dining", attendees: null },
          { accountName: "現金", debit: 0, credit: 12000, entertainmentKind: null, attendees: null },
        ],
      }),
    });
    expect(q?.reason).toBe("entertainment");
    expect(q?.question).toContain("10,000円");
    expect(q?.question).toContain("会議費");
  });
  it("源泉徴収税額の記載があり預り金が無ければ聞く", () => {
    const q = reviewQuestionFor({ ...base, ocr: { amount_total: 110000, withholding_tax: 10210, confidence: 0.9 }, journal: journal() });
    expect(q?.reason).toBe("withholding");
  });
  it("AIが迷った仕訳はAIの質問をそのまま使う", () => {
    const q = reviewQuestionFor({ ...base, ocr: { amount_total: 1000, confidence: 0.9 }, journal: journal({ needsReview: true, question: "私用ですか？" }) });
    expect(q).toMatchObject({ reason: "low_confidence", question: "私用ですか？" });
  });
  it("見積書など仕訳の無い書類は知らせる", () => {
    const q = reviewQuestionFor({ ...base, ocr: { amount_total: 50000, document_type: "estimate", confidence: 0.9 }, journal: null });
    expect(q?.reason).toBe("unknown_document");
    expect(q?.question).toContain("見積書");
  });
  it("問題が無ければ聞かない", () => {
    expect(reviewQuestionFor({ ...base, ocr: { amount_total: 1000, confidence: 0.95, legibility: "clear" }, journal: journal() })).toBeNull();
  });
});
