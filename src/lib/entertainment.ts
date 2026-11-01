/**
 * 交際費の決まり（純粋関数）。顧問先ごとの設定（業種・1人当たりの基準額・独自のルール）と、
 * 法人税の損金算入限度額（別表十五）の計算をここにまとめる。
 *
 * ■ 1人当たりの飲食費の基準（措置法61条の4・措置法令37条の5）
 *   取引先などとの飲食で、1人当たりの額が基準額以下のものは「交際費等」から除ける（会議費などにできる）。
 *   基準額は 2024年4月1日以後の支出が 10,000円、それより前は 5,000円。
 *   社内の人（役員・従業員・その親族）だけの飲食は除けない。
 *   比べる額は経理の方式に合わせる（税抜経理なら税抜、税込経理なら税込）。
 *   仕訳の費用の行の額は、仮払消費税を分けていれば税抜・分けていなければ税込なので、その額で比べればよい。
 *   除くには、日付・参加した相手の名前と関係・人数・金額・店名を記録しておく必要がある。
 *
 * ■ 損金算入限度額（法人）
 *   期末の資本金1億円以下の法人（大法人の100%子会社などを除く）… 定額控除（年800万円）と接待飲食費の50% の有利な方
 *   資本金1億円超 100億円以下 … 接待飲食費の50%
 *   資本金100億円超 … 0（全額が損金にならない。2020年4月1日以後に始まる事業年度）
 *   個人事業主には限度額が無い（事業に関係する分は全額が必要経費）。
 *
 * ■ 業種ごとの扱い
 *   税法の限度額は業種で変わらないが、同じような支出でも業種によって交際費にするか
 *   ほかの科目（福利厚生費・販売促進費・研修費・原価など）にするかの判断が分かれる。
 *   業種ごとの目安を INDUSTRY_PRESETS に置き、AIの仕訳と質問、設定画面の説明に使う。
 */

export type IndustryCode =
  | "general"
  | "restaurant"
  | "retail"
  | "wholesale"
  | "manufacturing"
  | "construction"
  | "real_estate"
  | "medical"
  | "care"
  | "professional"
  | "it"
  | "beauty"
  | "transport"
  | "hotel"
  | "education"
  | "agriculture";

/** 交際費の行の区分（別表十五の集計に使う） */
export type EntertainmentKind = "dining" | "dining_under_limit" | "gift" | "golf" | "condolence" | "other";

export const ENTERTAINMENT_KIND_LABELS: Record<EntertainmentKind, string> = {
  dining: "接待飲食費（50%を損金にできる）",
  dining_under_limit: "1人当たり基準額以下の飲食費（交際費から除く）",
  gift: "贈答（お中元・お歳暮・手土産）",
  golf: "ゴルフ・旅行・観劇などの招待",
  condolence: "慶弔・見舞い",
  other: "その他の交際費",
};

export const ENTERTAINMENT_KINDS = Object.keys(ENTERTAINMENT_KIND_LABELS) as EntertainmentKind[];

export function isEntertainmentKind(v: unknown): v is EntertainmentKind {
  return typeof v === "string" && (ENTERTAINMENT_KINDS as string[]).includes(v);
}

export type IndustryPreset = { label: string; rules: string[] };

/** どの業種にも当てはまる目安（業種ごとの目安の前に置く） */
export const COMMON_RULES: string[] = [
  "取引先・仕入先・得意先との会食 → 接待交際費（1人当たり基準額以下なら会議費にできる。社内の人だけの飲食は除けない）",
  "社内の打合せでの弁当・飲み物・茶菓子 → 会議費",
  "従業員の全員が対象の忘年会・新年会・慰安旅行 → 福利厚生費（一部の人だけなら交際費か給与）",
  "取引先へのお中元・お歳暮・手土産、取引先の慶弔（香典・祝い金・供花） → 接待交際費",
  "不特定多数に配るカレンダー・手帳・うちわなどの粗品 → 広告宣伝費",
  "取引先とのゴルフのプレー代・送迎 → 接待交際費",
  "同業者団体・商工会などの会費 → 諸会費（懇親会の部分は接待交際費）",
];

export const INDUSTRY_PRESETS: Record<IndustryCode, IndustryPreset> = {
  general: { label: "一般（業種を選ばない）", rules: [] },
  restaurant: {
    label: "飲食業",
    rules: [
      "従業員のまかない → 福利厚生費（材料は仕入のまま扱う例も多い）",
      "他店の視察・メニュー研究のための飲食 → 研修費（目的・店名・気づいた点を記録。取引先や知人と一緒なら接待交際費）",
      "お客様への無料の一品・誕生日のデザートなど自店の料理のサービス → 追加の経費にしない（材料は仕入のまま）",
      "常連客など特定のお客様への贈答 → 接待交際費（来店者の全員に配るノベルティは広告宣伝費）",
      "仕入先・業者との会食 → 接待交際費",
    ],
  },
  retail: {
    label: "小売業",
    rules: [
      "一般のお客様向けの景品・くじ引き・来店特典 → 販売促進費または広告宣伝費（交際費にしない）",
      "試供品・サンプルの配布 → 広告宣伝費",
      "仕入先との会食・贈答 → 接待交際費",
    ],
  },
  wholesale: {
    label: "卸売業",
    rules: [
      "得意先にあらかじめ決めた基準で金銭で払う販売奨励金・リベート → 販売促進費（売上値引）",
      "得意先を旅行・観劇に招待する費用 → 接待交際費",
      "得意先との会食・贈答 → 接待交際費",
    ],
  },
  manufacturing: {
    label: "製造業",
    rules: [
      "取引先の工場見学での簡単な昼食・飲み物 → 会議費（宴会にしたら接待交際費）",
      "販売店に基準を決めて金銭で払う販売奨励金 → 販売促進費（旅行・観劇への招待は接待交際費）",
      "自社の従業員の永年勤続の表彰品 → 福利厚生費",
    ],
  },
  construction: {
    label: "建設業",
    rules: [
      "自社の従業員への現場での差し入れ（飲み物・弁当） → 福利厚生費",
      "下請業者・協力会社の職人への差し入れ・慰労・御祝儀 → 接待交際費（現場での少額の飲み物は会議費として扱う例もあるので確認する）",
      "施主・元請への接待・贈答 → 接待交際費",
      "工事で負担する地鎮祭・上棟式の費用 → その工事の原価（未成工事支出金など）として扱う例が多い",
      "安全大会・協力会の会議の費用 → 会議費（宴会の部分は接待交際費）",
    ],
  },
  real_estate: {
    label: "不動産業",
    rules: [
      "物件・お客様を紹介してくれた人への謝礼 → 接待交際費。あらかじめ契約で決めた情報提供料で、相手が情報提供を仕事にしている場合は支払手数料",
      "成約したお客様への記念品 → 接待交際費（来店者の全員に配る粗品は広告宣伝費）",
      "物件オーナーとの会食 → 接待交際費",
    ],
  },
  medical: {
    label: "医療・歯科",
    rules: [
      "患者さんに配る歯ブラシ・カレンダーなどの粗品 → 広告宣伝費",
      "医師会・歯科医師会の会費 → 諸会費（懇親会・新年会は接待交際費）",
      "患者さんを紹介してくれる医療機関への贈答・会食 → 接待交際費",
      "院内のスタッフ全員の食事会 → 福利厚生費",
    ],
  },
  care: {
    label: "介護・福祉",
    rules: [
      "利用者のレクリエーション・行事の費用 → 行事費・消耗品費（交際費にしない）",
      "ケアマネジャー・利用者のご家族への贈答 → 接待交際費",
      "職員全員の研修後の懇親会 → 福利厚生費",
    ],
  },
  professional: {
    label: "士業・コンサルティング",
    rules: [
      "顧客・紹介者との会食 → 接待交際費（1人当たり基準額以下なら会議費）",
      "セミナー・研修の後の懇親会の参加費 → 研修費（飲食が主なら接待交際費）",
      "顧問先への年末の贈答 → 接待交際費",
    ],
  },
  it: {
    label: "IT・Web・クリエイター",
    rules: [
      "勉強会・ミートアップの会場費・軽食 → 会議費または研修費",
      "取引先との打合せを兼ねた飲食 → 会議費（1人当たり基準額以下）、超えれば接待交際費",
      "取引先に送るデジタルギフト券 → 接待交際費",
    ],
  },
  beauty: {
    label: "美容・サロン",
    rules: [
      "来店客の全員が対象の誕生日特典・ポイントの景品 → 販売促進費（特定の常連客への贈答は接待交際費）",
      "練習用のウィッグ・カットモデルへの謝礼 → 研修費または支払報酬",
      "他のサロンの視察・施術の体験 → 研修費",
    ],
  },
  transport: {
    label: "運送業",
    rules: [
      "自社のドライバーへの差し入れ → 福利厚生費",
      "荷主への接待・贈答 → 接待交際費",
      "交通安全協会などの会費 → 諸会費",
    ],
  },
  hotel: {
    label: "宿泊・観光",
    rules: [
      "旅行会社の担当者を招く視察旅行 → 接待交際費（宣伝が主で広く招くなら広告宣伝費）",
      "宿泊客の全員に出すウェルカムドリンク・アメニティ → 仕入・消耗品費（交際費にしない）",
    ],
  },
  education: {
    label: "教室・塾・スクール",
    rules: [
      "生徒の全員が対象の賞品・記念品 → 販売促進費または広告宣伝費",
      "生徒を紹介してくれた保護者への謝礼 → 接待交際費",
    ],
  },
  agriculture: {
    label: "農業",
    rules: [
      "農協・部会の懇親会 → 接待交際費（会議が主なら会議費）",
      "収穫体験の来場者への振る舞い → 広告宣伝費",
    ],
  },
};

export const INDUSTRY_CODES = Object.keys(INDUSTRY_PRESETS) as IndustryCode[];

export function isIndustryCode(v: unknown): v is IndustryCode {
  return typeof v === "string" && (INDUSTRY_CODES as string[]).includes(v);
}

/** 顧問先の「業種」欄（自由入力）から業種を推し量る。分からなければ general */
export function guessIndustry(businessType: string | null | undefined): IndustryCode {
  const t = (businessType ?? "").trim();
  if (!t) return "general";
  const table: [RegExp, IndustryCode][] = [
    [/飲食|レストラン|居酒屋|カフェ|食堂|ラーメン|焼肉|寿司|バー|喫茶/, "restaurant"],
    [/建設|建築|工務店|土木|設備工事|内装|リフォーム|塗装|電気工事|解体/, "construction"],
    [/不動産|賃貸|仲介|管理会社/, "real_estate"],
    [/歯科|医院|クリニック|病院|医療|薬局|整骨|接骨|鍼灸/, "medical"],
    [/介護|福祉|デイサービス|訪問看護|障害|保育/, "care"],
    [/税理士|会計事務所|社労士|社会保険労務士|行政書士|司法書士|弁護士|コンサル|士業/, "professional"],
    [/IT|ＩＴ|システム|ソフトウェア|Web|ウェブ|アプリ|デザイン|クリエイ|映像|動画/i, "it"],
    [/美容|理容|サロン|エステ|ネイル|まつ|アイラッシュ|ヘア/, "beauty"],
    [/運送|物流|運輸|配送|タクシー|トラック/, "transport"],
    [/旅館|ホテル|宿泊|民宿|観光/, "hotel"],
    [/塾|教室|スクール|学校|教育|研修/, "education"],
    [/農業|農園|畜産|漁業|林業/, "agriculture"],
    [/卸/, "wholesale"],
    [/製造|工場|メーカー|加工/, "manufacturing"],
    [/小売|販売|ショップ|店舗|EC|通販/i, "retail"],
  ];
  for (const [re, code] of table) if (re.test(t)) return code;
  return "general";
}

/** 顧問先ごとの交際費の設定（clients.entertainment_settings） */
export type EntertainmentSettings = {
  /** 1人当たりの飲食費の基準額。null は法令どおり（2024年4月以後 10,000円・それより前 5,000円） */
  perPersonLimit: number | null;
  /** 基準額以下の飲食を移す科目の名前 */
  underLimitAccount: string;
  /** 大法人（資本金5億円以上）の100%子会社など、定額控除（800万円）を使えない法人 */
  noFixedDeduction: boolean;
  /** 顧問先が独自に決めているルール（1行1つ。AIの仕訳と質問に渡す） */
  customRules: string[];
};

export const DEFAULT_ENTERTAINMENT_SETTINGS: EntertainmentSettings = {
  perPersonLimit: null,
  underLimitAccount: "会議費",
  noFixedDeduction: false,
  customRules: [],
};

/** DBの jsonb を設定に直す（足りない項目は既定値。おかしな値は受け付けない） */
export function parseEntertainmentSettings(v: unknown): EntertainmentSettings {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const limit = Number(o.perPersonLimit);
  return {
    perPersonLimit: o.perPersonLimit == null || o.perPersonLimit === "" || !Number.isFinite(limit) || limit <= 0 ? null : Math.floor(limit),
    underLimitAccount:
      typeof o.underLimitAccount === "string" && o.underLimitAccount.trim() ? o.underLimitAccount.trim() : DEFAULT_ENTERTAINMENT_SETTINGS.underLimitAccount,
    noFixedDeduction: o.noFixedDeduction === true,
    customRules: Array.isArray(o.customRules)
      ? o.customRules.filter((r): r is string => typeof r === "string").map((r) => r.trim()).filter(Boolean).slice(0, 50)
      : [],
  };
}

/** 法令の1人当たりの基準額（支出した日で決まる） */
export function statutoryPerPersonLimit(date: string): number {
  return date >= "2024-04-01" ? 10_000 : 5_000;
}

/** この顧問先で使う1人当たりの基準額 */
export function perPersonLimit(date: string, s: EntertainmentSettings): number {
  return s.perPersonLimit ?? statutoryPerPersonLimit(date);
}

export type DiningJudgement =
  | { kind: "needs_attendees" }
  | { kind: "internal_only" }
  | { kind: "under_limit"; perPerson: number; limit: number }
  | { kind: "over_limit"; perPerson: number; limit: number };

/**
 * 飲食の1人当たりの額を基準額と比べる。
 * amount は費用の行の額（税抜経理なら税抜・税込経理なら税込）。1人当たりは円未満を切り上げて比べる
 * （切り捨てると 10,000.5円が基準内に見える。少なく見せる誤差を出さない）。
 */
export function judgeDining(p: { amount: number; attendees: number | null; date: string; internalOnly?: boolean }, s: EntertainmentSettings): DiningJudgement {
  if (p.internalOnly) return { kind: "internal_only" };
  if (!p.attendees || p.attendees <= 0) return { kind: "needs_attendees" };
  const limit = perPersonLimit(p.date, s);
  const perPerson = Math.ceil(p.amount / p.attendees);
  return perPerson <= limit ? { kind: "under_limit", perPerson, limit } : { kind: "over_limit", perPerson, limit };
}

/** 交際費の科目か（名前で見分ける。既存の集計と同じく「交際費」を含む費用科目） */
export function isEntertainmentAccount(name: string | null | undefined): boolean {
  return /交際費/.test(name ?? "");
}

/** 資本金の区分。null（不明）は中小法人として扱う（呼び出し側で注意を出す） */
export type CapitalClass = "sme" | "large" | "mega";

export const SME_CAPITAL = 100_000_000;
export const MEGA_CAPITAL = 10_000_000_000;

export function capitalClass(capital: number | null, noFixedDeduction = false): CapitalClass {
  if (capital !== null && capital > MEGA_CAPITAL) return "mega";
  if (noFixedDeduction) return "large";
  if (capital === null || capital <= SME_CAPITAL) return "sme";
  return "large";
}

export const CAPITAL_CLASS_LABELS: Record<CapitalClass, string> = {
  sme: "中小法人（資本金1億円以下）… 800万円の定額控除と接待飲食費の50%の有利な方",
  large: "資本金1億円超（または大法人の子会社）… 接待飲食費の50%だけ",
  mega: "資本金100億円超 … 全額が損金にならない",
};

export type EntertainmentLimit = {
  /** 定額控除限度額（800万円×月数/12 と支出額の少ない方） */
  fixedLimit: number;
  /** 接待飲食費の50% */
  diningLimit: number;
  /** 損金算入限度額（有利な方） */
  limit: number;
  /** 損金不算入額 */
  disallowed: number;
};

/**
 * 法人の交際費等の損金算入限度額（別表十五）。
 * total: 支出交際費等の額、dining: うち接待飲食費（不明は null＝50%基準を使わない）、months: 事業年度の月数
 */
export function entertainmentLimit(p: { total: number; dining: number | null; months: number; cls: CapitalClass }): EntertainmentLimit {
  const total = Math.max(0, p.total);
  if (p.cls === "mega") return { fixedLimit: 0, diningLimit: 0, limit: 0, disallowed: total };
  const fixedLimit = p.cls === "sme" ? Math.min(total, Math.floor((8_000_000 * p.months) / 12)) : 0;
  const diningLimit = p.dining !== null ? Math.floor((Math.max(0, p.dining) * 50) / 100) : 0;
  const limit = Math.max(fixedLimit, diningLimit);
  return { fixedLimit, diningLimit, limit, disallowed: Math.max(0, total - limit) };
}

/** AIに渡す、この顧問先の交際費の判断の目安（共通 → 業種 → 顧問先の独自ルールの順） */
export function entertainmentRulesForPrompt(industry: IndustryCode, s: EntertainmentSettings, sampleDate: string): string {
  const preset = INDUSTRY_PRESETS[industry] ?? INDUSTRY_PRESETS.general;
  const limit = perPersonLimit(sampleDate, s);
  const lines = [
    `- 業種: ${preset.label}`,
    `- 1人当たりの飲食費の基準額: ${limit.toLocaleString()}円（これ以下の取引先との飲食は「${s.underLimitAccount}」。社内の人だけの飲食は除けない）`,
    ...COMMON_RULES.map((r) => `- ${r}`),
    ...preset.rules.map((r) => `- 【${preset.label}】${r}`),
    ...s.customRules.map((r) => `- 【この会社の決まり】${r}`),
  ];
  return lines.join("\n");
}
