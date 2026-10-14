/**
 * 仕訳入力の「連想」。純粋関数。
 *
 *   ① 科目から連想 … 科目を選ぶと、その科目で過去に使った摘要・補助科目を候補に出す
 *   ② 言葉から連想 … 摘要や科目の欄に「ドコモ」「スマホ」と打つと、科目の組み合わせを予測する
 *
 * 予測の元は、その会社の過去の仕訳（同じ摘要・科目・補助科目の組み合わせを数える）と、
 * 組み込みの言葉の辞書（使い始めの会社でも連想できるように）。
 * 例: 通信費 / 普通預金・補助科目ドコモ・摘要「スマホ代支払い」を一度登録すると、
 *     次から「ドコモ」「スマホ」「通信費」のどれからでもこの組み合わせが候補に出る。
 */

/** 仕訳の片側（借方または貸方）に入れる内容 */
export type LineFill = {
  accountId: string;
  subId: string | null;
  subName: string;
  tax: string | null;
};

/** 過去の仕訳から作った「よく使う組み合わせ」 */
export type JournalPattern = {
  description: string;
  /** 1借1貸の仕訳だけ。複合仕訳は摘要だけを覚える */
  debit: LineFill | null;
  credit: LineFill | null;
  count: number;
  lastDate: string;
};

export type PastEntry = {
  description: string | null;
  entryDate: string;
  lines: { accountId: string; subId: string | null; subName: string | null; debit: number; credit: number; tax: string | null }[];
};

type AccountLike = { id: string; name: string; categoryType: string };

/** 全角半角・カタカナひらがな・大文字小文字・空白の違いを無視した比較用の文字列 */
export function normalizeText(v: string): string {
  return v
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(/\s+/g, "");
}

/** 過去の仕訳を「摘要＋科目＋補助科目」の組み合わせごとに数える。新しい順の仕訳を渡す */
export function buildPatterns(entries: PastEntry[]): JournalPattern[] {
  const map = new Map<string, JournalPattern>();
  for (const e of entries) {
    const description = (e.description ?? "").trim();
    if (!description) continue;
    const debits = e.lines.filter((l) => l.debit > 0);
    const credits = e.lines.filter((l) => l.credit > 0);
    const simple = debits.length === 1 && credits.length === 1;
    const fill = (l: PastEntry["lines"][number]): LineFill => ({
      accountId: l.accountId,
      subId: l.subId,
      subName: l.subName ?? "",
      tax: l.tax,
    });
    const debit = simple ? fill(debits[0]) : null;
    const credit = simple ? fill(credits[0]) : null;
    const key = [description, debit?.accountId, debit?.subId, credit?.accountId, credit?.subId].join("|");
    const hit = map.get(key);
    if (hit) {
      hit.count++;
      if (e.entryDate > hit.lastDate) hit.lastDate = e.entryDate;
    } else {
      map.set(key, { description, debit, credit, count: 1, lastDate: e.entryDate });
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || b.lastDate.localeCompare(a.lastDate));
}

/**
 * 組み込みの言葉の辞書。words のどれかを含めば account の科目を連想する。
 * brand は会社・サービスの名前で、補助科目の名前にもする（例: ドコモ → 通信費の補助科目「ドコモ」）。
 * 一般的な言葉（スマホ・電気など）は科目の予測だけに使う。
 * その会社に無い科目は使わない。
 */
type DictEntry = { account: string; words: string[]; brands?: Record<string, string> };

export const ASSOCIATION_DICTIONARY: DictEntry[] = [
  {
    account: "通信費",
    words: ["スマホ", "携帯", "電話", "インターネット", "プロバイダ", "光回線", "wifi", "wi-fi", "ポケットwifi", "切手", "レターパック", "ゆうパック", "郵便", "郵送", "はがき", "ドメイン", "サーバー"],
    brands: {
      ドコモ: "ドコモ",
      docomo: "ドコモ",
      ahamo: "ドコモ",
      ソフトバンク: "ソフトバンク",
      softbank: "ソフトバンク",
      ワイモバイル: "ワイモバイル",
      ymobile: "ワイモバイル",
      楽天モバイル: "楽天モバイル",
      kddi: "KDDI",
      au: "au",
      uqモバイル: "UQモバイル",
      ntt: "NTT",
      日本郵便: "日本郵便",
    },
  },
  {
    account: "水道光熱費",
    words: ["電気", "電力", "ガス", "水道", "灯油"],
    brands: { 東京電力: "東京電力", 関西電力: "関西電力", 中部電力: "中部電力", 東京ガス: "東京ガス", 大阪ガス: "大阪ガス" },
  },
  {
    account: "旅費交通費",
    words: ["電車", "新幹線", "タクシー", "バス", "交通費", "乗車券", "特急", "航空券", "高速", "駐車", "パーキング", "宿泊", "ホテル", "出張"],
    brands: { jr: "JR", suica: "Suica", pasmo: "PASMO", ana: "ANA", jal: "JAL", 東京メトロ: "東京メトロ" },
  },
  {
    account: "消耗品費",
    words: ["文具", "文房具", "事務用品", "コピー用紙", "トナー", "インク", "電池", "日用品"],
    brands: { amazon: "Amazon", アマゾン: "Amazon", アスクル: "アスクル", askul: "アスクル", ヨドバシ: "ヨドバシカメラ", ビックカメラ: "ビックカメラ", ダイソー: "ダイソー", ニトリ: "ニトリ", カインズ: "カインズ" },
  },
  {
    account: "会議費",
    words: ["打合せ", "打ち合わせ", "会議", "カフェ", "喫茶", "コーヒー"],
    brands: { スターバックス: "スターバックス", スタバ: "スターバックス", ドトール: "ドトール", タリーズ: "タリーズ", コメダ: "コメダ珈琲" },
  },
  { account: "接待交際費", words: ["接待", "会食", "懇親会", "贈答", "お中元", "お歳暮", "手土産", "居酒屋", "慶弔", "香典", "祝い金"] },
  { account: "新聞図書費", words: ["書籍", "新聞", "雑誌", "図書", "書店", "kindle"] },
  { account: "地代家賃", words: ["家賃", "賃料", "地代", "月極", "管理費"] },
  { account: "租税公課", words: ["印紙", "固定資産税", "自動車税", "登録免許税", "印鑑証明", "住民票", "登記簿"] },
  { account: "支払利息", words: ["利息", "利子"] },
  { account: "給料手当", words: ["給与", "給料", "賃金", "アルバイト代"] },
  { account: "役員報酬", words: ["役員報酬"] },
  { account: "法定福利費", words: ["社会保険料", "厚生年金", "健康保険", "雇用保険", "労働保険", "労災保険"] },
  { account: "福利厚生費", words: ["健康診断", "社員旅行", "忘年会", "新年会"] },
  { account: "売上高", words: ["売上", "業務委託料", "報酬入金"] },
];

/** 言葉が辞書の語に当たるか。2文字以下の語（au・jr など）は完全一致か区切られた単語のときだけ */
function wordHit(q: string, word: string): boolean {
  const w = normalizeText(word);
  if (w.length <= 2) return q === w || new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(q);
  return q.includes(w) || (q.length >= 2 && w.startsWith(q));
}

/** 打った言葉から、辞書で連想する科目と補助科目の名前（会社名に当たったときだけ） */
export function dictionaryHits(query: string, accounts: AccountLike[]): { account: AccountLike; subName: string | null }[] {
  const q = normalizeText(query);
  if (!q) return [];
  const out: { account: AccountLike; subName: string | null }[] = [];
  for (const d of ASSOCIATION_DICTIONARY) {
    const account = accounts.find((a) => a.name === d.account);
    if (!account) continue;
    const brand = Object.entries(d.brands ?? {}).find(([w]) => wordHit(q, w));
    if (brand) out.push({ account, subName: brand[1] });
    else if (d.words.some((w) => wordHit(q, w))) out.push({ account, subName: null });
  }
  return out;
}

/** 摘要・補助科目の名前が言葉に当たる度合い（前方一致 2、部分一致 1、当たらない 0） */
function textScore(p: JournalPattern, q: string): number {
  let best = 0;
  for (const t of [p.description, p.debit?.subName ?? "", p.credit?.subName ?? ""]) {
    const n = normalizeText(t);
    if (!n) continue;
    if (n.startsWith(q)) best = Math.max(best, 2);
    else if (n.includes(q)) best = Math.max(best, 1);
  }
  return best;
}

/** 科目の欄で打った言葉から連想する科目（名前・読みで見つからない「ドコモ」→ 通信費 など）。多い順に最大3つ */
export function associateAccountIds(query: string, accounts: AccountLike[], patterns: JournalPattern[]): string[] {
  const q = normalizeText(query);
  if (q.length < 2) return [];
  const score = new Map<string, number>();
  const add = (id: string, s: number) => score.set(id, (score.get(id) ?? 0) + s);
  for (const p of patterns) {
    if (!p.debit || !p.credit || textScore(p, q) === 0) continue;
    // 「ドコモ」で見つかった仕訳なら、補助科目にドコモが付いている側の科目を連想する
    const side = normalizeText(p.credit.subName).includes(q) && !normalizeText(p.debit.subName).includes(q) ? p.credit : p.debit;
    add(side.accountId, 10 + p.count);
  }
  for (const h of dictionaryHits(query, accounts)) add(h.account.id, 5);
  return [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => id);
}

export type EntrySuggestion = {
  key: string;
  description: string;
  debit: LineFill | null;
  credit: LineFill | null;
  /** history: 過去の仕訳 / dictionary: 言葉の辞書から推測 */
  source: "history" | "dictionary";
};

/**
 * 摘要の欄の候補。
 *   何も打っていないとき … 選んだ科目で過去に使った組み合わせ（①）。科目が未選択ならよく使う順
 *   打ったとき           … 摘要・補助科目がその言葉に当たる過去の組み合わせ。無ければ辞書で連想した科目（②）
 *                          （辞書の科目が同じだけの過去の仕訳は出さない。「ドコモ」でレターパックの仕訳が出ても役に立たない）
 * 選んだ科目と食い違う組み合わせは出さない（選び直した科目を勝手に変えないため）。
 */
export function suggestEntries(p: {
  query: string;
  debitAccountId: string;
  creditAccountId: string;
  patterns: JournalPattern[];
  accounts: AccountLike[];
  limit?: number;
}): EntrySuggestion[] {
  const limit = p.limit ?? 8;
  const q = normalizeText(p.query);
  const consistent = (x: JournalPattern) =>
    (!p.debitAccountId || !x.debit || x.debit.accountId === p.debitAccountId) &&
    (!p.creditAccountId || !x.credit || x.credit.accountId === p.creditAccountId);
  const accountMatch = (x: JournalPattern) =>
    Number(!!p.debitAccountId && x.debit?.accountId === p.debitAccountId) +
    Number(!!p.creditAccountId && x.credit?.accountId === p.creditAccountId);

  const dict = q ? dictionaryHits(p.query, p.accounts) : [];

  const scored: { s: EntrySuggestion; score: number }[] = [];
  for (const x of p.patterns) {
    if (!consistent(x)) continue;
    let score: number;
    if (!q) {
      // 何も打っていない: 科目を選んでいればその科目の組み合わせだけ
      if ((p.debitAccountId || p.creditAccountId) && accountMatch(x) === 0) continue;
      score = accountMatch(x) * 100;
    } else {
      const t = textScore(x, q);
      if (t === 0) continue;
      score = t * 100 + accountMatch(x) * 30;
    }
    scored.push({
      s: { key: `h:${x.description}|${x.debit?.accountId}|${x.debit?.subId}|${x.credit?.accountId}|${x.credit?.subId}`, description: x.description, debit: x.debit, credit: x.credit, source: "history" },
      score: score + Math.min(x.count, 20) + (x.debit ? 1 : 0),
    });
  }
  scored.sort((a, b) => b.score - a.score);
  const out = scored.slice(0, limit).map((x) => x.s);

  // 辞書で連想した科目で、過去の組み合わせが無いもの: 打った言葉を摘要に、科目（と会社名なら補助科目）だけ入れる
  for (const h of dict) {
    if (out.length >= limit) break;
    // 同じ科目（会社名なら同じ補助科目）の過去の組み合わせが出ていれば、そちらで足りる
    const covered = (f: LineFill | null) => f?.accountId === h.account.id && (!h.subName || normalizeText(f.subName) === normalizeText(h.subName));
    if (out.some((s) => covered(s.debit) || covered(s.credit))) continue;
    const fill: LineFill = { accountId: h.account.id, subId: null, subName: h.subName ?? "", tax: null };
    // 収益の科目は貸方、それ以外（費用）は借方に入れる
    const isRevenue = h.account.categoryType === "revenue";
    if (isRevenue ? p.creditAccountId && p.creditAccountId !== h.account.id : p.debitAccountId && p.debitAccountId !== h.account.id) continue;
    out.push({
      key: `d:${h.account.id}|${h.subName ?? ""}`,
      description: p.query.trim(),
      debit: isRevenue ? null : fill,
      credit: isRevenue ? fill : null,
      source: "dictionary",
    });
  }
  return out;
}
