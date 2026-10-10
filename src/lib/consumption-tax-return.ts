/**
 * 消費税及び地方消費税の確定申告書（法人・個人共通の計算部分）。純粋関数。
 *
 * 国税庁「消費税及び地方消費税の申告書（一般用）の書き方」「同（簡易課税用）」
 * 「２割特例用 確定申告の手引き」（いずれも令和7年11月）の各欄の計算に合わせる。
 * 税率は 7.8%（A列: 軽減 6.24%、B列: 標準 7.8%）のみを扱う（旧税率の取引は対象外）。
 *
 *   列 A … 軽減税率 6.24% 適用分（税込 8%）
 *   列 B … 標準税率 7.8% 適用分（税込 10%）
 *   列 C … 合計
 *
 * 端数処理
 *   - 付表の金額計算は 1円未満切り捨て
 *   - 課税標準額は「税率ごとに」千円未満切り捨て（合計してから切り捨てない）
 *   - 差引税額・地方消費税の納税額は百円未満切り捨て。還付税額は 1円単位
 *
 * 売上・仕入の返品や値引き（返還等）は、帳簿で売上・仕入から直接差し引いているものとして扱う
 * （手引き上、直接減額して経理している場合は返還等対価に係る税額の欄は記載不要）。
 */

import { lineTaxAmounts, taxCodeOfLine, type TaxBookLine } from "@/lib/tax-book";
import { taxCategoryInfo } from "@/lib/tax-category";

export type CalcMethod = "standard" | "simplified" | "special_20";
export type PurchaseTaxCalc = "stacked" | "proportional";

/** 簡易課税の事業区分とみなし仕入率（%） */
export const BUSINESS_TYPES: { type: number; label: string; rate: number }[] = [
  { type: 1, label: "第1種（卸売業）", rate: 90 },
  { type: 2, label: "第2種（小売業など）", rate: 80 },
  { type: 3, label: "第3種（製造業など）", rate: 70 },
  { type: 4, label: "第4種（その他の事業）", rate: 60 },
  { type: 5, label: "第5種（サービス業など）", rate: 50 },
  { type: 6, label: "第6種（不動産業）", rate: 40 },
];

export const CALC_METHOD_LABELS: Record<CalcMethod, string> = {
  standard: "本則課税（一般用）",
  simplified: "簡易課税",
  special_20: "2割特例",
};

type Col = "A" | "B";
type Pair = { A: number; B: number };
const pair = (): Pair => ({ A: 0, B: 0 });

/** 申告書の計算に使う、期間の取引の集計 */
export type ReturnInput = {
  /** 課税売上（税込）。返品・値引きを差し引いた後 */
  sales: Pair;
  /** 免税売上（輸出など） */
  taxFree: number;
  /** 非課税売上 */
  exempt: number;
  /** 課税仕入れ（経過措置の対象を除く）の支払対価（税込）と、帳簿に記載された消費税額 */
  purchaseGross: Pair;
  purchaseTax: Pair;
  /** 適格請求書発行事業者以外からの仕入れ（経過措置）。控除できる割合ごと */
  transition: { col: Col; rate: number; gross: number; tax: number }[];
  /** 貸倒れ（税込） */
  badDebt: Pair;
  /** 税区分が付いていない収益・費用の行の数 */
  uncategorized: number;
};

/** 仕訳の行から、申告書の計算に使う集計を作る（要確認の仕訳は除く） */
export function aggregateReturnInput(lines: TaxBookLine[]): ReturnInput {
  const r: ReturnInput = {
    sales: pair(),
    taxFree: 0,
    exempt: 0,
    purchaseGross: pair(),
    purchaseTax: pair(),
    transition: [],
    badDebt: pair(),
    uncategorized: 0,
  };
  for (const l of lines) {
    if (l.needsReview) continue;
    const code = taxCodeOfLine(l);
    if (code === undefined) continue;
    if (code === "none") {
      r.uncategorized++;
      continue;
    }
    const info = taxCategoryInfo(code)!;
    const a = lineTaxAmounts(l);
    const col: Col | null = info.rate === 0.1 ? "B" : info.rate === 0.08 ? "A" : null;
    if (info.badDebt) {
      if (col) r.badDebt[col] += a.gross;
      continue;
    }
    if (info.side === "sales") {
      if (col) r.sales[col] += a.gross;
      else if (code === "sales_tax_free") r.taxFree += a.net;
      else if (code === "sales_exempt") r.exempt += a.net;
      continue;
    }
    if (!col) continue; // 非課税・不課税の仕入れは控除の対象外
    if (info.transitionRate) {
      let t = r.transition.find((x) => x.col === col && x.rate === info.transitionRate);
      if (!t) {
        t = { col, rate: info.transitionRate, gross: 0, tax: 0 };
        r.transition.push(t);
      }
      t.gross += a.gross;
      t.tax += a.tax;
    } else {
      r.purchaseGross[col] += a.gross;
      r.purchaseTax[col] += a.tax;
    }
  }
  return r;
}

export type ReturnSettings = {
  method: CalcMethod;
  purchaseTaxCalc: PurchaseTaxCalc;
  /** 簡易課税の事業区分（1〜6） */
  businessType: number | null;
  interimNational: number;
  interimLocal: number;
  /** 課税期間の月数（課税売上高5億円の判定を年換算するため） */
  periodMonths: number;
};

/** 表の1行。a/b は列 A・B、c は合計（列の無い欄は c だけ） */
export type FormRow = {
  no: string;
  label: string;
  a?: number | null;
  b?: number | null;
  c: number | null;
  /** 転記先・計算式などの説明 */
  note?: string;
};

export type FormTable = { key: string; title: string; columns: "ABC" | "C"; rows: FormRow[] };

export type ConsumptionTaxReturn = {
  method: CalcMethod;
  /** 第一表・第二表・付表 */
  tables: FormTable[];
  /** 課税売上割合（④/⑦）。本則課税のみ */
  taxableSalesRatio: number | null;
  /** 控除の方法（本則課税）: 全額控除 / 一括比例配分方式 */
  deductionMethod: "full" | "proportional" | null;
  /** 国の消費税・地方消費税・合計。正なら納付、負なら還付 */
  national: number;
  local: number;
  total: number;
  warnings: string[];
};

// ---------------------------------------------------------------------------
// 計算の部品（すべて 1円未満切り捨て）
// ---------------------------------------------------------------------------

const mulDiv = (x: number, num: number, den: number) => Math.floor((x * num) / den);
const floor1000 = (x: number) => Math.floor(x / 1000) * 1000;
const floor100 = (x: number) => Math.floor(x / 100) * 100;
/** 税込 → 税抜（課税資産の譲渡等の対価の額） */
const toNet = (gross: number, col: Col) => (col === "A" ? mulDiv(gross, 100, 108) : mulDiv(gross, 100, 110));
/** 課税標準額 → 消費税額（6.24% / 7.8%） */
const taxOnBase = (base: number, col: Col) => (col === "A" ? mulDiv(base, 624, 10000) : mulDiv(base, 78, 1000));
/** 税込 → 含まれる国の消費税額（6.24/108 / 7.8/110） */
const nationalInGross = (gross: number, col: Col) => (col === "A" ? mulDiv(gross, 624, 10800) : mulDiv(gross, 78, 1100));
const sumPair = (p: Pair) => p.A + p.B;
const mapPair = (f: (col: Col) => number): Pair => ({ A: f("A"), B: f("B") });
const row = (no: string, label: string, p: Pair, note?: string): FormRow => ({ no, label, a: p.A, b: p.B, c: sumPair(p), note });
const single = (no: string, label: string, c: number | null, note?: string): FormRow => ({ no, label, c, note });

/** 課税標準額・消費税額（付表1-3・4-3・6 の上の段。売上は割戻し計算） */
function salesTax(input: ReturnInput) {
  const net = mapPair((c) => toNet(input.sales[c], c));
  const base = mapPair((c) => floor1000(net[c]));
  const tax = mapPair((c) => taxOnBase(base[c], c));
  const badDebt = mapPair((c) => nationalInGross(input.badDebt[c], c));
  return { net, base, tax, badDebt };
}

/** 付表1-3・4-3・6 の下の段（⑦〜⑬）と、第一表の国・地方の税額 */
function settle(tax: Pair, overAdjust: Pair, deduction: Pair, badDebt: Pair, s: ReturnSettings) {
  const subtotal = mapPair((c) => deduction[c] + badDebt[c]); // ⑦（返還等対価に係る税額 ⑤ は 0）
  const diff = sumPair(tax) + sumPair(overAdjust) - sumPair(subtotal);
  const shortfall = diff < 0 ? -diff : 0; // ⑧ 控除不足還付税額（1円単位）
  const netTax = diff > 0 ? floor100(diff) : 0; // ⑨ 差引税額（百円未満切り捨て）
  const localRefund = mulDiv(shortfall, 22, 78); // ⑫ 譲渡割額 還付額（1円単位）
  const localTax = floor100(mulDiv(netTax, 22, 78)); // ⑬ 譲渡割額 納税額（百円未満切り捨て）

  const interimN = floor100(Math.max(0, s.interimNational));
  const interimL = floor100(Math.max(0, s.interimLocal));
  const payN = Math.max(0, netTax - interimN); // 第一表⑪
  const refundInterimN = Math.max(0, interimN - netTax); // ⑫
  const payL = Math.max(0, localTax - interimL); // ㉒
  const refundInterimL = Math.max(0, interimL - localTax); // ㉓
  const national = payN - shortfall - refundInterimN;
  const local = payL - localRefund - refundInterimL;
  return { subtotal, shortfall, netTax, localRefund, localTax, interimN, interimL, payN, refundInterimN, payL, refundInterimL, national, local };
}

// ---------------------------------------------------------------------------
// 申告書の計算
// ---------------------------------------------------------------------------

export function computeConsumptionTaxReturn(input: ReturnInput, s: ReturnSettings): ConsumptionTaxReturn {
  const warnings: string[] = [];
  if (input.uncategorized > 0)
    warnings.push(`税区分が付いていない売上・経費の行が ${input.uncategorized} 件あります。申告書の計算に入っていないので、税区分を付けてください。`);

  const st = salesTax(input);
  const tables: FormTable[] = [];
  let deduction: Pair = pair();
  let overAdjust: Pair = pair(); // 控除過大調整税額（一般）/ 貸倒回収に係る消費税額（簡易・2割）。この画面では 0
  let ratio: number | null = null;
  let deductionMethod: ConsumptionTaxReturn["deductionMethod"] = null;
  /** 第一表⑮⑯（一般）または⑮（簡易） */
  let firstRefRows: FormRow[] = [];

  if (s.method === "standard") {
    // ---- 付表2-3 課税売上割合・控除対象仕入税額等の計算表 ----
    const taxableSales = st.net; // ① 課税売上額（税抜。返還等は直接減額済み）
    const r4 = sumPair(taxableSales) + input.taxFree; // ④
    const r7 = r4 + input.exempt; // ⑦
    ratio = r7 > 0 ? r4 / r7 : null;
    const purchaseGross = input.purchaseGross; // ⑨
    const purchaseTax = mapPair((c) =>
      s.purchaseTaxCalc === "stacked" ? mulDiv(input.purchaseTax[c], 78, 100) : nationalInGross(purchaseGross[c], c)
    ); // ⑩
    const transGross = mapPair((c) => input.transition.filter((t) => t.col === c).reduce((x, t) => x + t.gross, 0)); // ⑪
    const transTax = mapPair((c) =>
      input.transition
        .filter((t) => t.col === c)
        .reduce(
          (x, t) =>
            x +
            (s.purchaseTaxCalc === "stacked"
              ? Math.floor(mulDiv(t.tax, 78, 100) * t.rate)
              : Math.floor(nationalInGross(t.gross, c) * t.rate)),
          0
        )
    ); // ⑫
    const total = mapPair((c) => purchaseTax[c] + transTax[c]); // ⑰
    const annualSales = s.periodMonths > 0 && s.periodMonths < 12 ? Math.floor((r4 * 12) / s.periodMonths) : r4;
    const full = annualSales <= 500_000_000 && (r7 === 0 || r4 * 100 >= r7 * 95);
    deductionMethod = full ? "full" : "proportional";
    const proportional = mapPair((c) => (r7 > 0 ? Math.floor((total[c] * r4) / r7) : 0)); // ㉒
    deduction = full ? total : proportional; // ㉖
    if (!full) {
      warnings.push(
        annualSales > 500_000_000
          ? "課税売上高が5億円（年換算）を超えるため、仕入税額の全額は控除できません。一括比例配分方式で計算しています（個別対応方式は未対応）。"
          : "課税売上割合が95%未満のため、仕入税額の全額は控除できません。一括比例配分方式で計算しています（個別対応方式は未対応。2年間は継続適用が必要です）。"
      );
    }
    if (r7 === 0) warnings.push("この期は売上がありません。課税売上割合は計算できないため、全額控除として計算しています。");

    const ratioPct = ratio === null ? null : Math.floor(ratio * 100);
    tables.push({
      key: "fuhyo2-3",
      title: "付表2-3 課税売上割合・控除対象仕入税額等の計算表",
      columns: "ABC",
      rows: [
        row("①", "課税売上額（税抜き）", taxableSales),
        single("②", "免税売上額", input.taxFree),
        single("③", "非課税資産の輸出等の金額、海外支店等へ移送した資産の価額", 0),
        single("④", "課税資産の譲渡等の対価の額（①＋②＋③）", r4, "第一表⑮へ"),
        single("⑤", "課税資産の譲渡等の対価の額（④の金額）", r4),
        single("⑥", "非課税売上額", input.exempt),
        single("⑦", "資産の譲渡等の対価の額（⑤＋⑥）", r7, "第一表⑯へ"),
        single("⑧", "課税売上割合（④／⑦）", ratioPct, "%（端数切り捨て）"),
        row("⑨", "課税仕入れに係る支払対価の額（税込み）", purchaseGross),
        row(
          "⑩",
          "課税仕入れに係る消費税額",
          purchaseTax,
          s.purchaseTaxCalc === "stacked" ? "積上げ計算: 帳簿の消費税額 × 78/100" : "割戻し計算: ⑨ × 6.24/108・7.8/110"
        ),
        row("⑪", "適格請求書発行事業者以外の者から行った課税仕入れに係る経過措置の適用を受ける課税仕入れに係る支払対価の額（税込み）", transGross),
        row("⑫", "⑪の経過措置により課税仕入れに係る消費税額とみなされる額", transTax, "控除できる割合（80%など）を掛けた額"),
        row("⑬", "特定課税仕入れに係る支払対価の額", pair()),
        row("⑭", "特定課税仕入れに係る消費税額", pair()),
        row("⑮", "課税貨物に係る消費税額", pair()),
        row("⑯", "納税義務の免除を受けない（受ける）こととなった場合における消費税額の調整（加算又は減算）額", pair()),
        row("⑰", "課税仕入れ等の税額の合計額（⑩＋⑫＋⑭＋⑮±⑯）", total),
        row("⑱", "課税売上高が5億円以下、かつ、課税売上割合が95%以上の場合（⑰の金額）", full ? total : pair()),
        row("㉒", "一括比例配分方式により控除する課税仕入れ等の税額（⑰×④／⑦）", full ? pair() : proportional),
        row("㉖", "差引 控除対象仕入税額", deduction, "付表1-3④へ"),
        row("㉗", "差引 控除過大調整税額", pair()),
        row("㉘", "貸倒回収に係る消費税額", pair()),
      ],
    });
    firstRefRows = [
      single("⑮", "課税売上割合: 課税資産の譲渡等の対価の額", r4),
      single("⑯", "課税売上割合: 資産の譲渡等の対価の額", r7),
    ];
  } else if (s.method === "simplified") {
    const bt = BUSINESS_TYPES.find((b) => b.type === s.businessType);
    if (!bt) warnings.push("簡易課税の事業区分が選ばれていません。");
    const deemed = bt?.rate ?? 0;
    const base4 = mapPair((c) => st.tax[c] + overAdjust[c]); // 付表5-3 ④ ＝ ①＋②－③
    deduction = mapPair((c) => Math.floor((base4[c] * deemed) / 100)); // ⑤
    tables.push({
      key: "fuhyo5-3",
      title: "付表5-3 控除対象仕入税額等の計算表（簡易課税）",
      columns: "ABC",
      rows: [
        row("①", "課税標準額に対する消費税額", st.tax, "付表4-3②"),
        row("②", "貸倒回収に係る消費税額", overAdjust),
        row("③", "売上対価の返還等に係る消費税額", pair()),
        row("④", "控除対象仕入税額の計算の基礎となる消費税額（①＋②－③）", base4),
        row("⑤", `④ × みなし仕入率（${bt ? `${bt.label} ${deemed}%` : "未選択"}）`, deduction, "付表4-3④へ"),
      ],
    });
    firstRefRows = [single("⑮", "この課税期間の課税売上高", sumPair(st.net) + input.taxFree)];
    warnings.push("事業区分が2つ以上ある場合（みなし仕入率の加重平均・75%特例）は未対応です。1つの事業区分として計算しています。");
  } else {
    // ---- 2割特例（付表6）----
    const base6 = mapPair((c) => st.tax[c] + overAdjust[c]); // ⑥ ＝ ③＋④－⑤
    deduction = mapPair((c) => Math.floor((base6[c] * 80) / 100)); // ⑦ 特別控除税額
    tables.push({
      key: "fuhyo6",
      title: "付表6 税率別消費税額計算表（2割特例）",
      columns: "ABC",
      rows: [
        row("①", "課税資産の譲渡等の対価の額", st.net, "第二表⑤⑥⑦へ"),
        row("②", "課税標準額", st.base, "第二表①へ（税率ごとに千円未満切り捨て）"),
        row("③", "課税標準額に対する消費税額", st.tax, "第二表⑪へ"),
        row("④", "貸倒回収に係る消費税額", overAdjust, "第一表③へ"),
        row("⑤", "売上対価の返還等に係る消費税額", pair()),
        row("⑥", "控除対象仕入税額の計算の基礎となる消費税額（③＋④－⑤）", base6),
        row("⑦", "特別控除税額（⑥×80%）", deduction, "第一表④へ"),
        row("⑧", "貸倒れに係る税額", st.badDebt, "第一表⑥へ"),
      ],
    });
  }

  const z = settle(st.tax, overAdjust, deduction, st.badDebt, s);

  // ---- 付表1-3（一般）/ 付表4-3（簡易）: 税率別消費税額計算表 ----
  if (s.method !== "special_20") {
    const isStd = s.method === "standard";
    tables.unshift({
      key: isStd ? "fuhyo1-3" : "fuhyo4-3",
      title: isStd
        ? "付表1-3 税率別消費税額計算表 兼 地方消費税の課税標準となる消費税額計算表"
        : "付表4-3 税率別消費税額計算表 兼 地方消費税の課税標準となる消費税額計算表（簡易課税）",
      columns: "ABC",
      rows: [
        row("①-1", "課税資産の譲渡等の対価の額（税込み × 100/108・100/110）", st.net, "第二表⑤⑥⑦へ"),
        row("①", "課税標準額（税率ごとに千円未満切り捨て）", st.base, "第二表①へ"),
        row("②", "消費税額（① × 6.24%・7.8%）", st.tax, "第二表⑪⑮⑯へ"),
        row("③", isStd ? "控除過大調整税額" : "貸倒回収に係る消費税額", overAdjust, "第一表③へ"),
        row("④", "控除対象仕入税額", deduction, isStd ? "付表2-3㉖から" : "付表5-3⑤から"),
        row("⑤", "返還等対価に係る税額", pair(), "売上から直接差し引いているため記載不要"),
        row("⑥", "貸倒れに係る税額（税込 × 6.24/108・7.8/110）", st.badDebt, "第一表⑥へ"),
        row("⑦", "控除税額小計（④＋⑤＋⑥）", z.subtotal, "第一表⑦へ"),
        single("⑧", "控除不足還付税額（⑦－②－③）", z.shortfall, "第一表⑧へ"),
        single("⑨", "差引税額（②＋③－⑦、百円未満切り捨て）", z.netTax, "第一表⑨へ"),
        single("⑩", "地方消費税の課税標準となる消費税額: 控除不足還付税額（⑧）", z.shortfall, "第一表⑰へ"),
        single("⑪", "地方消費税の課税標準となる消費税額: 差引税額（⑨）", z.netTax, "第一表⑱へ"),
        single("⑫", "譲渡割額: 還付額（⑩×22/78）", z.localRefund, "第一表⑲へ"),
        single("⑬", "譲渡割額: 納税額（⑪×22/78、百円未満切り捨て）", z.localTax, "第一表⑳へ"),
      ],
    });
  }

  // ---- 第二表 課税標準額等の内訳書 ----
  // 地方消費税の課税標準となる消費税額: 納付なら差引税額、還付なら控除不足還付税額に「－」
  const localBase = z.netTax > 0 ? z.netTax : z.shortfall > 0 ? -z.shortfall : 0;
  tables.unshift({
    key: "second",
    title: "第二表 課税標準額等の内訳書",
    columns: "C",
    rows: [
      single("①", "課税標準額", sumPair(st.base), "第一表①へ"),
      single("⑤", "課税資産の譲渡等の対価の額 6.24%適用分", st.net.A),
      single("⑥", "課税資産の譲渡等の対価の額 7.8%適用分", st.net.B),
      single("⑦", "課税資産の譲渡等の対価の額の合計額", sumPair(st.net)),
      single("⑪", "消費税額", sumPair(st.tax), "第一表②へ"),
      single("⑮", "⑪の内訳 6.24%適用分", st.tax.A),
      single("⑯", "⑪の内訳 7.8%適用分", st.tax.B),
      single("⑰", "返還等対価に係る税額", 0, "第一表⑤へ"),
      single("⑳", "地方消費税の課税標準となる消費税額", localBase, "還付のときは様式どおり「－」を付けます"),
      single("㉓", "⑳の内訳 6.24%及び7.8%適用分", localBase),
    ],
  });

  // ---- 第一表 ----
  const total = z.national + z.local;
  tables.unshift({
    key: "first",
    title: `第一表 消費税及び地方消費税の申告書（${s.method === "simplified" ? "簡易課税用" : "一般用"}）`,
    columns: "C",
    rows: [
      single("①", "課税標準額", sumPair(st.base)),
      single("②", "消費税額", sumPair(st.tax)),
      single("③", s.method === "standard" ? "控除過大調整税額" : "貸倒回収に係る消費税額", sumPair(overAdjust)),
      single("④", s.method === "special_20" ? "控除対象仕入税額（2割特例の特別控除税額）" : "控除対象仕入税額", sumPair(deduction)),
      single("⑤", "返還等対価に係る税額", 0),
      single("⑥", "貸倒れに係る税額", sumPair(st.badDebt)),
      single("⑦", "控除税額小計（④＋⑤＋⑥）", sumPair(z.subtotal)),
      single("⑧", "控除不足還付税額（⑦－②－③）", z.shortfall),
      single("⑨", "差引税額（②＋③－⑦）", z.netTax),
      single("⑩", "中間納付税額", z.interimN),
      single("⑪", "納付税額（⑨－⑩）", z.payN),
      single("⑫", "中間納付還付税額（⑩－⑨）", z.refundInterimN),
      ...firstRefRows,
      single("⑰", "地方消費税の課税標準となる消費税額: 控除不足還付税額", z.shortfall),
      single("⑱", "地方消費税の課税標準となる消費税額: 差引税額", z.netTax),
      single("⑲", "譲渡割額: 還付額", z.localRefund),
      single("⑳", "譲渡割額: 納税額", z.localTax),
      single("㉑", "中間納付譲渡割額", z.interimL),
      single("㉒", "納付譲渡割額（⑳－㉑）", z.payL),
      single("㉓", "中間納付還付譲渡割額（㉑－⑳）", z.refundInterimL),
      single("㉖", "消費税及び地方消費税の合計（納付又は還付）税額", total, total < 0 ? "還付（様式では「－」を付けます）" : "納付"),
    ],
  });

  return {
    method: s.method,
    tables,
    taxableSalesRatio: ratio,
    deductionMethod,
    national: z.national,
    local: z.local,
    total,
    warnings,
  };
}

/** 2割特例を使える課税期間か（令和5年10月1日〜令和8年9月30日の日を含む課税期間） */
export function special20Eligible(period: { start: string; end: string }): boolean {
  return period.start <= "2026-09-30" && period.end >= "2023-10-01";
}
