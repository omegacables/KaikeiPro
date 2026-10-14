import { describe, it, expect } from "vitest";
import { buildPatterns, associateAccountIds, suggestEntries, dictionaryHits, type PastEntry } from "@/lib/journal-association";

const accounts = [
  { id: "tsushin", name: "通信費", categoryType: "expenses" },
  { id: "futsu", name: "普通預金", categoryType: "assets" },
  { id: "genkin", name: "現金", categoryType: "assets" },
  { id: "kounetsu", name: "水道光熱費", categoryType: "expenses" },
  { id: "uriage", name: "売上高", categoryType: "revenue" },
  { id: "urikake", name: "売掛金", categoryType: "assets" },
];

const docomo = (date: string): PastEntry => ({
  description: "スマホ代支払い",
  entryDate: date,
  lines: [
    { accountId: "tsushin", subId: "s-docomo", subName: "ドコモ", debit: 8800, credit: 0, tax: "purchase_10" },
    { accountId: "futsu", subId: null, subName: null, debit: 0, credit: 8800, tax: null },
  ],
});
const patterns = buildPatterns([
  docomo("2026-09-25"),
  docomo("2026-08-25"),
  {
    description: "インターネット代",
    entryDate: "2026-09-10",
    lines: [
      { accountId: "tsushin", subId: "s-ntt", subName: "NTT", debit: 5500, credit: 0, tax: "purchase_10" },
      { accountId: "futsu", subId: null, subName: null, debit: 0, credit: 5500, tax: null },
    ],
  },
]);

describe("過去の仕訳を組み合わせごとに数える", () => {
  it("同じ摘要・科目・補助科目は1つにまとめて回数を数える", () => {
    expect(patterns).toHaveLength(2);
    expect(patterns[0]).toMatchObject({ description: "スマホ代支払い", count: 2, lastDate: "2026-09-25" });
    expect(patterns[0].debit).toMatchObject({ accountId: "tsushin", subName: "ドコモ", tax: "purchase_10" });
  });

  it("複合仕訳は摘要だけを覚える（科目は入れない）", () => {
    const p = buildPatterns([
      {
        description: "給与支払",
        entryDate: "2026-09-25",
        lines: [
          { accountId: "a", subId: null, subName: null, debit: 300000, credit: 0, tax: null },
          { accountId: "b", subId: null, subName: null, debit: 0, credit: 250000, tax: null },
          { accountId: "c", subId: null, subName: null, debit: 0, credit: 50000, tax: null },
        ],
      },
    ]);
    expect(p[0]).toMatchObject({ description: "給与支払", debit: null, credit: null });
  });
});

describe("① 科目から連想", () => {
  it("通信費を選ぶと、通信費で使った摘要と補助科目が候補に出る（多い順）", () => {
    const s = suggestEntries({ query: "", debitAccountId: "tsushin", creditAccountId: "", patterns, accounts });
    expect(s.map((x) => [x.description, x.debit?.subName])).toEqual([
      ["スマホ代支払い", "ドコモ"],
      ["インターネット代", "NTT"],
    ]);
  });

  it("別の科目を選んでいるときは出さない", () => {
    expect(suggestEntries({ query: "", debitAccountId: "kounetsu", creditAccountId: "", patterns, accounts })).toEqual([]);
  });
});

describe("② 言葉から連想", () => {
  it("「ドコモ」「スマホ」のどちらでも、通信費・ドコモ・スマホ代支払い・普通預金の組み合わせが出る", () => {
    for (const q of ["ドコモ", "どこも", "スマホ"]) {
      const s = suggestEntries({ query: q, debitAccountId: "", creditAccountId: "", patterns, accounts });
      expect(s[0]).toMatchObject({ description: "スマホ代支払い", source: "history" });
      expect(s[0].debit).toMatchObject({ accountId: "tsushin", subName: "ドコモ" });
      expect(s[0].credit).toMatchObject({ accountId: "futsu" });
    }
  });

  it("過去の仕訳が無くても、辞書で科目と会社名の補助科目を連想する（初めての会社）", () => {
    const s = suggestEntries({ query: "ドコモ", debitAccountId: "", creditAccountId: "", patterns: [], accounts });
    expect(s).toEqual([
      { key: "d:tsushin|ドコモ", description: "ドコモ", debit: { accountId: "tsushin", subId: null, subName: "ドコモ", tax: null }, credit: null, source: "dictionary" },
    ]);
  });

  it("科目が同じだけの過去の仕訳（レターパック）は「ドコモ」の候補に出さず、辞書の候補を出す", () => {
    const withPost = buildPatterns([
      {
        description: "日本郵便 レターパック購入",
        entryDate: "2026-09-01",
        lines: [
          { accountId: "tsushin", subId: null, subName: null, debit: 600, credit: 0, tax: "purchase_10" },
          { accountId: "genkin", subId: null, subName: null, debit: 0, credit: 600, tax: null },
        ],
      },
    ]);
    const s = suggestEntries({ query: "ドコモ", debitAccountId: "", creditAccountId: "", patterns: withPost, accounts });
    expect(s.map((x) => [x.source, x.description, x.debit?.subName])).toEqual([["dictionary", "ドコモ", "ドコモ"]]);
  });

  it("一般的な言葉（電気）は科目だけを連想し、補助科目は付けない", () => {
    expect(dictionaryHits("電気代", accounts)).toEqual([{ account: accounts[3], subName: null }]);
  });

  it("収益の科目は貸方に入れる", () => {
    const s = suggestEntries({ query: "業務委託料", debitAccountId: "", creditAccountId: "", patterns: [], accounts });
    expect(s[0]).toMatchObject({ debit: null, credit: { accountId: "uriage" } });
  });

  it("短い語（au）は単語として現れたときだけ当てる", () => {
    expect(dictionaryHits("au", accounts)).toHaveLength(1);
    expect(dictionaryHits("audio", accounts)).toHaveLength(0);
  });

  it("選んだ科目と食い違う組み合わせは出さない", () => {
    const s = suggestEntries({ query: "ドコモ", debitAccountId: "kounetsu", creditAccountId: "", patterns, accounts });
    expect(s).toEqual([]);
  });
});

describe("科目の欄で打った言葉から科目を連想", () => {
  it("「ドコモ」→ 通信費（科目名・読みでは見つからない言葉）", () => {
    expect(associateAccountIds("ドコモ", accounts, patterns)).toEqual(["tsushin"]);
    expect(associateAccountIds("ドコモ", accounts, [])).toEqual(["tsushin"]);
  });

  it("1文字では連想しない（科目コード・頭文字の検索とぶつかるため）", () => {
    expect(associateAccountIds("ど", accounts, patterns)).toEqual([]);
  });
});
