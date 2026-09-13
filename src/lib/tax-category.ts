/**
 * 消費税の税区分。
 *
 * 税区分はこれまで自由記述で、AIが毎回それらしい名前を書いていた。
 * 同じ意味に対して purchase_10 / purchase_80_percent_deductible /
 * non_taxable / none / なし / no_tax / not_applicable / exempt …と
 * 13通りの表記が生まれ、集計側が探している名前とは一つも一致していなかった。
 * その結果、消費税の集計で仕入れが1件も計上されていなかった。
 *
 * ここでコードを確定させ、読み替えと集計の判定を1箇所に集める。
 *
 * 大原則: **税区分は費用・収益の行にだけ意味を持つ。**
 * 現金・預金・未払金・仮払消費税の行に付けると、同じ取引を
 * 何重にも数えることになる（1,100円の買い物で3行すべてに付いていた）。
 */

export type TaxCategoryCode =
  | "sales_10"
  | "sales_08_reduced"
  | "sales_exempt"
  | "sales_tax_free"
  | "sales_out_of_scope"
  | "purchase_10"
  | "purchase_08_reduced"
  | "purchase_10_trans_80"
  | "purchase_10_trans_70"
  | "purchase_10_trans_50"
  | "purchase_10_trans_30"
  | "purchase_08_trans_80"
  | "purchase_08_trans_70"
  | "purchase_08_trans_50"
  | "purchase_08_trans_30"
  | "purchase_exempt"
  | "purchase_out_of_scope";

export type TaxCategoryInfo = {
  code: TaxCategoryCode;
  name: string;
  /** 課税取引なら 0.1 / 0.08、それ以外は 0 */
  rate: 0.1 | 0.08 | 0;
  side: "sales" | "purchase";
  /** 免税事業者からの仕入れの経過措置。控除できる割合 */
  transitionRate?: 0.8 | 0.7 | 0.5 | 0.3;
};

export const TAX_CATEGORY_LIST: TaxCategoryInfo[] = [
  { code: "sales_10", name: "課税売上10%", rate: 0.1, side: "sales" },
  { code: "sales_08_reduced", name: "課税売上8%（軽減）", rate: 0.08, side: "sales" },
  { code: "sales_exempt", name: "非課税売上", rate: 0, side: "sales" },
  { code: "sales_tax_free", name: "免税売上", rate: 0, side: "sales" },
  { code: "sales_out_of_scope", name: "不課税売上", rate: 0, side: "sales" },
  { code: "purchase_10", name: "課税仕入10%", rate: 0.1, side: "purchase" },
  { code: "purchase_08_reduced", name: "課税仕入8%（軽減）", rate: 0.08, side: "purchase" },
  { code: "purchase_10_trans_80", name: "課税仕入10%（経過措置80%）", rate: 0.1, side: "purchase", transitionRate: 0.8 },
  { code: "purchase_10_trans_70", name: "課税仕入10%（経過措置70%）", rate: 0.1, side: "purchase", transitionRate: 0.7 },
  { code: "purchase_10_trans_50", name: "課税仕入10%（経過措置50%）", rate: 0.1, side: "purchase", transitionRate: 0.5 },
  { code: "purchase_10_trans_30", name: "課税仕入10%（経過措置30%）", rate: 0.1, side: "purchase", transitionRate: 0.3 },
  { code: "purchase_08_trans_80", name: "課税仕入8%（経過措置80%）", rate: 0.08, side: "purchase", transitionRate: 0.8 },
  { code: "purchase_08_trans_70", name: "課税仕入8%（経過措置70%）", rate: 0.08, side: "purchase", transitionRate: 0.7 },
  { code: "purchase_08_trans_50", name: "課税仕入8%（経過措置50%）", rate: 0.08, side: "purchase", transitionRate: 0.5 },
  { code: "purchase_08_trans_30", name: "課税仕入8%（経過措置30%）", rate: 0.08, side: "purchase", transitionRate: 0.3 },
  { code: "purchase_exempt", name: "非課税仕入", rate: 0, side: "purchase" },
  { code: "purchase_out_of_scope", name: "不課税仕入（租税公課など）", rate: 0, side: "purchase" },
];

const BY_CODE = new Map(TAX_CATEGORY_LIST.map((c) => [c.code, c]));

export function taxCategoryInfo(code: string | null | undefined): TaxCategoryInfo | null {
  if (!code) return null;
  return BY_CODE.get(code as TaxCategoryCode) ?? null;
}

/** 勘定科目の種類。税区分が意味を持つのは費用と収益だけ */
export type AccountType = "assets" | "liabilities" | "equity" | "revenue" | "expenses";

/**
 * 自由記述で入っていた税区分を、決まったコードに読み替える。
 *
 * 読み替えられない場合や、資産・負債の行の場合は null を返す
 * （＝税区分を持たせない）。推測で課税取引に寄せない。納税額が変わるため。
 *
 * @param raw         これまで入っていた文字列
 * @param accountType その行の勘定科目の種類
 * @param taxRate     その行の税率。0.1 と 10 のどちらの持ち方でも受ける
 */
export function normalizeTaxCategory(
  raw: string | null | undefined,
  accountType: AccountType,
  taxRate: number | null | undefined
): TaxCategoryCode | null {
  // 費用・収益以外の行には税区分を持たせない（同じ取引の多重計上を防ぐ）
  if (accountType !== "expenses" && accountType !== "revenue") return null;
  if (!raw) return null;

  const v = raw.trim().toLowerCase();
  // 既に正しいコードならそのまま
  if (BY_CODE.has(v as TaxCategoryCode)) return v as TaxCategoryCode;

  // 意味を持たない表記
  if (["none", "なし", "no_tax", "not_applicable", "n/a", "不明", ""].includes(v)) return null;

  const rate = normalizeTaxRate(taxRate);

  if (accountType === "revenue") {
    if (v.includes("exempt") || v.includes("非課税")) return "sales_exempt";
    if (v.includes("tax_free") || v.includes("免税")) return "sales_tax_free";
    if (v.includes("out_of_scope") || v.includes("non_taxable") || v.includes("不課税"))
      return "sales_out_of_scope";
    if (rate === 0.08) return "sales_08_reduced";
    if (rate === 0.1) return "sales_10";
    return null;
  }

  // 費用側。まず経過措置の割合を読み取る（80/70/50/30 のいずれか）。
  // \b は使えない。purchase_10_80 の "_80" は下線も語の一部として扱われ、
  // 語の境界と見なされないため一致しない
  const trans = v.match(/(?:^|[^0-9])(80|70|50|30)(?:[^0-9]|$)/);
  if (trans && rate) {
    const pct = trans[1];
    const prefix = rate === 0.08 ? "purchase_08" : "purchase_10";
    return `${prefix}_trans_${pct}` as TaxCategoryCode;
  }

  if (v.includes("exempt") || v.includes("非課税")) return "purchase_exempt";
  if (v.includes("out_of_scope") || v.includes("non_taxable") || v.includes("不課税"))
    return "purchase_out_of_scope";

  if (rate === 0.08) return "purchase_08_reduced";
  if (rate === 0.1) return "purchase_10";
  // 税率が無く、非課税・不課税とも読めないものは判断しない
  return null;
}

/**
 * 税率の持ち方を小数に揃える。
 * 0.1 と 10 が混在していた（AIの書き方が揃っていなかった）。
 * 集計側が rate === 10 で判定していたため、小数で入った行が弾かれていた。
 */
export function normalizeTaxRate(v: number | null | undefined): 0.1 | 0.08 | 0 | null {
  if (v == null) return null;
  if (v === 0.1 || v === 10) return 0.1;
  if (v === 0.08 || v === 8) return 0.08;
  if (v === 0) return 0;
  return null;
}

/**
 * 税込金額から消費税額を取り出す（1円未満切捨て）。
 *
 * gross * 0.1 / 1.1 で計算すると、小数の誤差で 1,100円 の消費税が
 * 99円になる（110/1.1 が 99.999… になる）。整数のまま割る。
 */
export function taxFromGross(gross: number, rate: 0.1 | 0.08): number {
  return rate === 0.1
    ? Math.floor((gross * 10) / 110)
    : Math.floor((gross * 8) / 108);
}

/**
 * 保存する直前に税区分を検査する。
 *
 * マスタに無いコードは null にして落とす。AIが作った造語や、
 * 古い呼び名（taxable_sales / taxable_purchase）をそのまま保存すると、
 * 集計側と一致せずに黙って集計から漏れる。
 * 推測で近い区分に寄せることはしない（納税額が変わるため）。
 */
export function sanitizeTaxCategory(code: string | null | undefined): TaxCategoryCode | null {
  if (!code) return null;
  const v = code.trim();
  return BY_CODE.has(v as TaxCategoryCode) ? (v as TaxCategoryCode) : null;
}
