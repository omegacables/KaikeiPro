/**
 * 減価償却の計算（純粋関数）。税法（法人税・所得税）の償却限度額に沿って計算する。
 *
 * ■ 普通償却（耐用年数省令 別表第八〜第十の償却率）
 *   定額法            … 取得価額 × 定額法の償却率
 *   定率法（200%/250%）… 期首の未償却残高 × 定率法の償却率。
 *                       その額が「償却保証額（取得価額 × 保証率）」を下回った期からは、
 *                       「改定取得価額（その期の期首の未償却残高）× 改定償却率」の均等額に切り替える。
 *   2012年4月1日以後の取得は200%定率法、2007年4月1日〜2012年3月31日の取得は250%定率法。
 *   2007年3月31日以前の取得（旧定額法・旧定率法）はここでは計算しない（計上額を入力してもらう）。
 *   どの方法も、帳簿価額が1円（備忘価額）になるまで償却する。
 *   期の途中から使い始めた資産は、使った月数 ÷ その期の月数 を掛ける（1ヶ月未満は1ヶ月）。
 *   12ヶ月に満たない期（決算月の変更など）は、償却率・改定償却率に「その期の月数 ÷ 12」を掛け、
 *   小数点以下3位未満を切り上げた率を使う（耐用年数省令5条2項、耐用年数通達5-1-1）。
 *   このとき償却保証額との比べ方は、調整する前の償却率で行う（同通達の注）。
 *
 * ■ 端数処理
 *   償却限度額の1円未満の端数は、切り捨て・切り上げ・四捨五入から選べる（顧問先ごとの設定）。
 *
 * ■ 特別償却
 *   事業に使い始めた期に、普通償却に上乗せして「取得価額 × 特別償却率」まで償却できる
 *   （中小企業投資促進税制の30%、中小企業経営強化税制の即時償却100% など）。
 *
 * ■ 任意償却（法人）
 *   法人は、償却限度額の範囲内で、帳簿に計上する額（会計上の償却額）を自由に決められる。
 *   個人事業主は普通償却の額を必ず計上する（強制償却）。
 *
 * ■ 償却超過額
 *   計上額が償却限度額を超えた分は、その期の損金にならない（償却超過額。別表四で加算）。
 *   後の期で計上額が限度額に満たないときは、その不足分まで、繰り越した償却超過額を損金にできる（認容。減算）。
 *   税務上の未償却残高 ＝ 帳簿価額 ＋ 繰越償却超過額。定率法の計算はこの税務上の残高を使う。
 *
 * ■ 特別償却不足額の繰越
 *   特別償却の限度額まで計上しなかったときの不足分（特別償却不足額）は、翌期に1年だけ繰り越して上乗せできる。
 *
 * ■ 一括償却資産（取得価額20万円未満）
 *   取得価額 × その期の月数 ÷ 36 を、使い始めた期から3年で均等に損金にする（1円も残さない。除却しても続ける）。
 *
 * ■ 少額減価償却資産（中小企業者等の特例、取得価額30万円未満、年300万円まで）
 *   使い始めた期に取得価額の全額を損金にする。
 */

export type DepreciationMethod = "straight_line" | "declining_balance" | "lump_sum" | "small_immediate";
export type DepreciationRounding = "floor" | "ceil" | "round";
/** 実際に使う償却の方法 */
export type DepreciationKind = "sl" | "db200" | "db250" | "lump" | "immediate" | "unsupported";

export const ROUNDING_LABELS: Record<DepreciationRounding, string> = {
  floor: "切り捨て",
  ceil: "切り上げ",
  round: "四捨五入",
};

export const KIND_LABELS: Record<DepreciationKind, string> = {
  sl: "定額法",
  db200: "定率法（200%）",
  db250: "定率法（250%）",
  lump: "一括償却資産（3年均等）",
  immediate: "少額減価償却資産（全額）",
  unsupported: "旧定額法・旧定率法（手入力）",
};

/**
 * 償却率表（耐用年数 2〜50年）。
 * 耐用年数, 定額法の償却率, 200%定率法の償却率・改定償却率・保証率, 250%定率法の償却率・改定償却率・保証率
 * 「—」は該当なし（耐用年数2年の定率法は1年で償却し終わるため）。
 */
const RATE_TABLE_TEXT = `
2,0.500,1.000,—,—,1.000,—,—
3,0.334,0.667,1.000,0.11089,0.833,1.000,0.02789
4,0.250,0.500,1.000,0.12499,0.625,1.000,0.05274
5,0.200,0.400,0.500,0.10800,0.500,1.000,0.06249
6,0.167,0.333,0.334,0.09911,0.417,0.500,0.05776
7,0.143,0.286,0.334,0.08680,0.357,0.500,0.05496
8,0.125,0.250,0.334,0.07909,0.313,0.334,0.05111
9,0.112,0.222,0.250,0.07126,0.278,0.334,0.04731
10,0.100,0.200,0.250,0.06552,0.250,0.334,0.04448
11,0.091,0.182,0.200,0.05992,0.227,0.250,0.04123
12,0.084,0.167,0.200,0.05566,0.208,0.250,0.03870
13,0.077,0.154,0.167,0.05180,0.192,0.200,0.03633
14,0.072,0.143,0.167,0.04854,0.179,0.200,0.03389
15,0.067,0.133,0.143,0.04565,0.167,0.200,0.03217
16,0.063,0.125,0.143,0.04294,0.156,0.167,0.03063
17,0.059,0.118,0.125,0.04038,0.147,0.167,0.02905
18,0.056,0.111,0.112,0.03884,0.139,0.143,0.02757
19,0.053,0.105,0.112,0.03693,0.132,0.143,0.02616
20,0.050,0.100,0.112,0.03486,0.125,0.143,0.02517
21,0.048,0.095,0.100,0.03335,0.119,0.125,0.02408
22,0.046,0.091,0.100,0.03182,0.114,0.125,0.02296
23,0.044,0.087,0.091,0.03052,0.109,0.112,0.02226
24,0.042,0.083,0.084,0.02969,0.104,0.112,0.02157
25,0.040,0.080,0.084,0.02841,0.100,0.112,0.02058
26,0.039,0.077,0.084,0.02716,0.096,0.100,0.01989
27,0.038,0.074,0.077,0.02624,0.093,0.100,0.01902
28,0.036,0.071,0.072,0.02568,0.089,0.091,0.01866
29,0.035,0.069,0.072,0.02463,0.086,0.091,0.01803
30,0.034,0.067,0.072,0.02366,0.083,0.084,0.01766
31,0.033,0.065,0.067,0.02286,0.081,0.084,0.01688
32,0.032,0.063,0.067,0.02216,0.078,0.084,0.01655
33,0.031,0.061,0.063,0.02161,0.076,0.077,0.01585
34,0.030,0.059,0.063,0.02097,0.074,0.077,0.01532
35,0.029,0.057,0.059,0.02051,0.071,0.072,0.01532
36,0.028,0.056,0.059,0.01974,0.069,0.072,0.01494
37,0.028,0.054,0.056,0.01950,0.068,0.072,0.01425
38,0.027,0.053,0.056,0.01882,0.066,0.067,0.01393
39,0.026,0.051,0.053,0.01860,0.064,0.067,0.01370
40,0.025,0.050,0.053,0.01791,0.063,0.067,0.01317
41,0.025,0.049,0.050,0.01741,0.061,0.063,0.01306
42,0.024,0.048,0.050,0.01694,0.060,0.063,0.01261
43,0.024,0.047,0.048,0.01664,0.058,0.059,0.01248
44,0.023,0.045,0.046,0.01664,0.057,0.059,0.01210
45,0.023,0.044,0.046,0.01634,0.056,0.059,0.01175
46,0.022,0.043,0.044,0.01601,0.054,0.056,0.01175
47,0.022,0.043,0.044,0.01532,0.053,0.056,0.01153
48,0.021,0.042,0.044,0.01499,0.052,0.053,0.01126
49,0.021,0.041,0.042,0.01475,0.051,0.053,0.01102
50,0.020,0.040,0.042,0.01440,0.050,0.053,0.01072
`;

/** 率は小数3桁（保証率は5桁）なので、誤差が出ないよう 100000 倍の整数で持つ */
// tsconfig の target が ES2017 のため BigInt のリテラル（ZERO など）は使えない
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const TWELVE = BigInt(12);
const SCALE = BigInt(100000);

type DecliningRates = { rate: bigint; revised: bigint; guarantee: bigint };
type RateRow = { sl: bigint; db200: DecliningRates; db250: DecliningRates };

const toScaled = (s: string): bigint => (s === "—" ? ZERO : BigInt(Math.round(Number(s) * 100000)));

const RATE_TABLE: Map<number, RateRow> = new Map(
  RATE_TABLE_TEXT.trim()
    .split("\n")
    .map((line) => {
      const [n, sl, r2, v2, g2, r25, v25, g25] = line.split(",");
      return [
        Number(n),
        {
          sl: toScaled(sl),
          db200: { rate: toScaled(r2), revised: toScaled(v2), guarantee: toScaled(g2) },
          db250: { rate: toScaled(r25), revised: toScaled(v25), guarantee: toScaled(g25) },
        },
      ] as const;
    })
);

export const MIN_USEFUL_LIFE = 2;
export const MAX_USEFUL_LIFE = 50;

/** 耐用年数の償却率（画面の表示用。小数） */
export function rateInfo(usefulLife: number, kind: DepreciationKind) {
  const row = RATE_TABLE.get(usefulLife);
  if (!row || kind === "unsupported" || kind === "lump" || kind === "immediate") return null;
  const f = (v: bigint) => Number(v) / 100000;
  if (kind === "sl") return { rate: f(row.sl), revised: null, guarantee: null };
  const r = row[kind];
  return { rate: f(r.rate), revised: r.revised ? f(r.revised) : null, guarantee: r.guarantee ? f(r.guarantee) : null };
}

/** 取得日と選んだ方法から、実際に使う償却の方法を決める */
export function depreciationKind(method: DepreciationMethod, acquisitionDate: string): DepreciationKind {
  if (method === "lump_sum") return "lump";
  if (method === "small_immediate") return "immediate";
  if (acquisitionDate < "2007-04-01") return "unsupported";
  if (method === "straight_line") return "sl";
  return acquisitionDate >= "2012-04-01" ? "db200" : "db250";
}

/** a × num ÷ den を、指定した端数処理で整数にする（金額が大きくても誤差が出ないよう BigInt で計算） */
function mulDiv(a: bigint, num: bigint, den: bigint, rounding: DepreciationRounding): bigint {
  const p = a * num;
  const q = p / den;
  const r = p % den;
  if (r === ZERO) return q;
  if (rounding === "ceil") return q + ONE;
  if (rounding === "round") return r * TWO >= den ? q + ONE : q;
  return q;
}

const monthIndex = (iso: string) => {
  const [y, m] = iso.split("-").map(Number);
  return y * 12 + (m - 1);
};

/** その期のうち、資産を使っていた月数（1ヶ月未満は1ヶ月。除却した月まで） */
export function serviceMonths(
  period: { start: string; end: string },
  serviceStart: string,
  disposedAt?: string | null
): number {
  if (serviceStart > period.end) return 0;
  if (disposedAt && disposedAt < period.start) return 0;
  const from = Math.max(monthIndex(period.start), monthIndex(serviceStart));
  const to = Math.min(monthIndex(period.end), disposedAt ? monthIndex(disposedAt) : Infinity);
  return Math.max(0, to - from + 1);
}

/** その期の月数（期首の月から期末の月まで） */
function periodMonths(p: { start: string; end: string }): number {
  return Math.max(1, monthIndex(p.end) - monthIndex(p.start) + 1);
}

/**
 * 12ヶ月に満たない期の率: 率 × 月数 ÷ 12 の、小数点以下3位未満を切り上げる。
 * 率は 100000 倍の整数（小数3桁なので 100 の倍数）。
 */
function shortPeriodRate(rate: bigint, months: bigint): bigint {
  if (months >= TWELVE) return rate;
  const unit = BigInt(100); // 0.001
  const scaled = rate * months; // ÷12 する前
  const den = TWELVE * unit;
  const q = scaled / den;
  return (scaled % den === ZERO ? q : q + ONE) * unit;
}

export type ScheduleAsset = {
  acquisitionDate: string;
  /** 事業に使い始めた日。無ければ取得日 */
  serviceStartDate?: string | null;
  acquisitionCost: number;
  usefulLife: number;
  method: DepreciationMethod;
  /** 特別償却率（0.3 = 30%、1 = 即時償却）。使い始めた期だけ */
  specialRate?: number | null;
  disposedAt?: string | null;
};

export type SchedulePeriod = { start: string; end: string };

export type ScheduleRow = {
  start: string;
  end: string;
  /** その期に使っていた月数 */
  months: number;
  /** 期首の帳簿価額（会計上） */
  openingBook: number;
  /** 期首の繰越償却超過額 */
  openingExcess: number;
  /** 普通償却限度額 */
  ordinaryLimit: number;
  /** 特別償却限度額（前期から繰り越した特別償却不足額を含む） */
  specialLimit: number;
  /** 翌期へ繰り越す特別償却不足額 */
  specialShortfall: number;
  /** 償却限度額（普通＋特別）。旧定額法・旧定率法は計算しないので null */
  limit: number | null;
  /** 帳簿に計上する償却額（会計上） */
  booked: number;
  /** 当期の償却超過額（計上額が限度額を超えた分。別表四で加算） */
  excess: number;
  /** 償却超過額の当期認容額（繰り越した超過額のうち当期の損金になる分。別表四で減算） */
  allowed: number;
  closingExcess: number;
  closingBook: number;
  /** 定率法で改定償却率に切り替わっているか */
  revised: boolean;
  /** 計上額を指定（任意償却・仕訳済み）しているか */
  overridden: boolean;
};

/**
 * 資産の償却スケジュール。periods は使い始めた期から古い順に並べる。
 * booked には、計上額を決めている期（期首日 → 計上額）を渡す。無い期は償却限度額を計上したものとする。
 */
export function buildDepreciationSchedule(
  asset: ScheduleAsset,
  periods: SchedulePeriod[],
  booked: Record<string, number>,
  rounding: DepreciationRounding
): ScheduleRow[] {
  const kind = depreciationKind(asset.method, asset.acquisitionDate);
  const serviceStart = asset.serviceStartDate || asset.acquisitionDate;
  const cost = BigInt(Math.round(asset.acquisitionCost));
  const rates = RATE_TABLE.get(asset.usefulLife);
  const rows: ScheduleRow[] = [];

  let openingBook = cost;
  let openingExcess = ZERO;
  /** 定率法の改定取得価額（切り替わった期の期首の税務上の未償却残高） */
  let revisedBase: bigint | null = null;
  let firstPeriod = true;
  /** 前期から繰り越した特別償却不足額（1年だけ） */
  let specialCarry = ZERO;
  /** 一括償却資産は除却しても3年で損金にする */
  const ignoresDisposal = kind === "lump";
  /** 一括償却資産: 使い始めた期からの月数の合計（36か月に達した期で残りをすべて損金にする） */
  let lumpMonths = 0;

  for (const p of periods) {
    const months = serviceMonths(p, serviceStart, ignoresDisposal ? null : asset.disposedAt);
    if (months === 0) {
      if (rows.length > 0) break; // 除却した後
      continue; // 使い始める前
    }
    const m = BigInt(months);
    const pm = BigInt(periodMonths(p));
    const taxOpening = openingBook + openingExcess;
    // 1円（備忘価額）を残す。一括償却資産・少額減価償却資産は全額を損金にする
    const keepsOne = kind !== "lump" && kind !== "immediate";
    const room = keepsOne ? (taxOpening > ONE ? taxOpening - ONE : ZERO) : taxOpening;
    const min = (a: bigint, b: bigint) => (a < b ? a : b);
    /** base × 率（その期の月数で調整）× 使った月数 ÷ その期の月数 */
    const depreciate = (base: bigint, rate: bigint) => mulDiv(base, shortPeriodRate(rate, pm) * m, SCALE * pm, rounding);

    let ordinary = ZERO;
    let special = ZERO;
    let revised = false;
    let limit: bigint | null = null;

    let specialThisPeriod = ZERO;
    if (kind === "lump") {
      // 取得価額 × その期の月数 ÷ 36（使った月数ではなく、その期の月数）
      lumpMonths += Number(pm);
      ordinary = lumpMonths >= 36 ? room : min(mulDiv(cost, pm, BigInt(36), rounding), room);
      limit = ordinary;
    } else if (kind === "immediate") {
      ordinary = firstPeriod ? room : ZERO;
      limit = ordinary;
    } else if (kind !== "unsupported" && rates) {
      if (kind === "sl") {
        ordinary = depreciate(cost, rates.sl);
      } else {
        const r = rates[kind];
        // 調整前償却額（調整する前の率で1年分）が償却保証額を下回ったら、改定償却率に切り替える（以後ずっと）
        if (revisedBase === null && r.guarantee > ZERO && taxOpening * r.rate < cost * r.guarantee) {
          revisedBase = taxOpening;
        }
        revised = revisedBase !== null;
        ordinary = revisedBase !== null ? depreciate(revisedBase, r.revised) : depreciate(taxOpening, r.rate);
      }
      ordinary = min(ordinary, room);
      if (firstPeriod && asset.specialRate && asset.specialRate > 0) {
        const sr = BigInt(Math.round(asset.specialRate * 100000));
        specialThisPeriod = min(mulDiv(cost, sr, SCALE, rounding), room - ordinary);
      }
      special = min(specialThisPeriod + specialCarry, room - ordinary);
      limit = ordinary + special;
    }

    const bookRoom = keepsOne ? (openingBook > ONE ? openingBook - ONE : ZERO) : openingBook;
    const fixed = booked[p.start];
    const overridden = fixed !== undefined;
    let amount = overridden ? BigInt(Math.max(0, Math.round(fixed))) : (limit ?? ZERO);
    amount = min(amount, bookRoom);

    let excess = ZERO;
    let allowed = ZERO;
    if (limit !== null) {
      if (amount > limit) excess = amount - limit;
      else allowed = min(limit - amount, openingExcess);
    }
    const closingExcess = openingExcess + excess - allowed;
    const closingBook = openingBook - amount;
    // 当期に生じた特別償却不足額（計上額のうち普通償却を超える部分で、特別償却の限度額に届かなかった分）を翌期へ。
    // 繰り越してきた不足額は、さらに繰り越せない
    const specialUsed = amount > ordinary ? amount - ordinary : ZERO;
    const shortfall = specialThisPeriod > specialUsed ? specialThisPeriod - specialUsed : ZERO;
    specialCarry = limit === null ? ZERO : min(shortfall, specialThisPeriod);

    rows.push({
      start: p.start,
      end: p.end,
      months,
      openingBook: Number(openingBook),
      openingExcess: Number(openingExcess),
      ordinaryLimit: Number(ordinary),
      specialLimit: Number(special),
      specialShortfall: Number(specialCarry),
      limit: limit === null ? null : Number(limit),
      booked: Number(amount),
      excess: Number(excess),
      allowed: Number(allowed),
      closingExcess: Number(closingExcess),
      closingBook: Number(closingBook),
      revised,
      overridden,
    });

    openingBook = closingBook;
    openingExcess = closingExcess;
    firstPeriod = false;
  }
  return rows;
}

/** 法律で定額法しか使えない資産（建物は1998年4月以後、建物附属設備・構築物は2016年4月以後の取得。無形固定資産） */
export function straightLineOnlyReason(accountName: string, acquisitionDate: string): string | null {
  if (/ソフトウェア|特許権|商標権|営業権|のれん/.test(accountName)) return "無形固定資産は定額法で償却します";
  if (/建物附属設備|構築物/.test(accountName) && acquisitionDate >= "2016-04-01")
    return "2016年4月1日以後に取得した建物附属設備・構築物は定額法で償却します";
  if (/^建物$/.test(accountName) && acquisitionDate >= "1998-04-01")
    return "1998年4月1日以後に取得した建物は定額法で償却します";
  return null;
}
