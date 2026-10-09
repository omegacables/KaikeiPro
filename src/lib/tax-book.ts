/**
 * 消費税の集計（消費税計算の画面と、帳簿閲覧の「税区分別」で共通に使う）。
 *
 *   - 税区分が意味を持つのは収益・費用の行だけ
 *   - 収益は貸方−借方、費用は借方−貸方（戻しの仕訳は差し引きで消える）
 *   - 要確認の仕訳は決算書と同じく集計に入れない
 *
 * 仕訳の付け方は2通りあり、消費税の出し方が違う。
 *   税込経理 … 売上・仕入の金額に消費税を含める（11,000円）→ 金額から取り出す（1,000円）
 *   税抜経理 … 売上・仕入は税抜（10,000円）で、消費税は仮受消費税・仮払消費税の行に別に立てる
 *              → 金額×税率（1,000円）
 * 以前は全部を税込とみなしていたため、税抜経理の仕訳では消費税が約9%少なく出ていた。
 * どちらかは、その仕訳に仮受消費税（売上側）・仮払消費税（仕入側）の行があるかで判断する。
 */

import {
  normalizeTaxCategory,
  taxCategoryInfo,
  taxFromGross,
  TAX_CATEGORY_LIST,
  type AccountType,
  type TaxCategoryCode,
} from "@/lib/tax-category";

/** 税抜経理の仕訳で消費税を立てる科目 */
export const OUTPUT_TAX_ACCOUNT = /仮受消費税/;
export const INPUT_TAX_ACCOUNT = /仮払消費税/;

export type TaxBookLine = {
  accountType: string;
  taxCategory: string | null;
  taxRate: number | null;
  debit: number;
  credit: number;
  needsReview: boolean;
  /** 税抜経理の仕訳か（同じ仕訳に仮受消費税・仮払消費税の行がある） */
  exclusive: boolean;
  /**
   * 税抜経理で、仕訳に記録された消費税額（仮受消費税・仮払消費税の行の額）。
   * 売上・仕入の行がその仕訳に1行だけのときに入る。レシートや請求書に書かれた額なので、
   * 税抜金額×税率で計算し直した額より正確（端数の扱いが発行者ごとに違うため）
   */
  recordedTax?: number;
};

export type TaxAmounts = { net: number; tax: number; gross: number };

/**
 * 計上額から、税抜金額・消費税額・税込金額を出す（1円未満は切り捨て）。
 * 返品などのマイナスは、プラスと同じ額を符号だけ逆にして出す。
 */
export function taxAmounts(
  amount: number,
  rate: number,
  exclusive: boolean,
  recordedTax?: number
): TaxAmounts {
  const sign = amount < 0 ? -1 : 1;
  const abs = Math.abs(amount);
  if (rate !== 0.1 && rate !== 0.08) return { net: amount, tax: 0, gross: amount };
  if (exclusive && recordedTax != null) {
    return { net: amount, tax: recordedTax, gross: amount + recordedTax };
  }
  if (exclusive) {
    const tax = Math.floor((abs * (rate === 0.1 ? 10 : 8)) / 100);
    return { net: amount, tax: sign * tax, gross: sign * (abs + tax) };
  }
  const tax = taxFromGross(abs, rate);
  return { net: sign * (abs - tax), tax: sign * tax, gross: amount };
}

/** 行の税区分（読み替え後）。収益・費用以外は対象外（undefined） */
export function taxCodeOfLine(l: Pick<TaxBookLine, "accountType" | "taxCategory" | "taxRate">):
  | TaxCategoryCode
  | "none"
  | undefined {
  if (l.accountType !== "revenue" && l.accountType !== "expenses") return undefined;
  return normalizeTaxCategory(l.taxCategory, l.accountType as AccountType, l.taxRate) ?? "none";
}

/** 行の計上額（収益は貸方−借方、費用は借方−貸方） */
export function taxBookAmount(l: Pick<TaxBookLine, "accountType" | "debit" | "credit">): number {
  return l.accountType === "revenue" ? l.credit - l.debit : l.debit - l.credit;
}

/** 行の税抜・消費税・税込 */
export function lineTaxAmounts(l: TaxBookLine): TaxAmounts {
  const code = taxCodeOfLine(l);
  const info = code && code !== "none" ? taxCategoryInfo(code) : null;
  return taxAmounts(taxBookAmount(l), info?.rate ?? 0, l.exclusive, l.recordedTax);
}

export type TaxBookRow = TaxAmounts & {
  /** 税区分。未設定の行は "none" */
  code: TaxCategoryCode | "none";
  name: string;
  side: "sales" | "purchase";
  count: number;
};

/** 税区分ごとの件数・税抜金額・消費税額・税込金額（経過措置の控除制限は反映しない） */
export function summarizeByTaxCategory(lines: TaxBookLine[]): TaxBookRow[] {
  const map = new Map<string, TaxBookRow>();
  for (const l of lines) {
    if (l.needsReview) continue;
    const code = taxCodeOfLine(l);
    if (code === undefined) continue;
    const side = l.accountType === "revenue" ? "sales" : "purchase";
    const key = `${side}:${code}`;
    let r = map.get(key);
    if (!r) {
      const info = code === "none" ? null : taxCategoryInfo(code);
      r = { code, name: info?.name ?? "税区分未設定", side, count: 0, net: 0, tax: 0, gross: 0 };
      map.set(key, r);
    }
    const a = lineTaxAmounts(l);
    r.count++;
    r.net += a.net;
    r.tax += a.tax;
    r.gross += a.gross;
  }
  // 税区分マスタの並び（売上→仕入）、未設定は各側の最後
  const order = new Map(TAX_CATEGORY_LIST.map((c, i) => [c.code as string, i]));
  return [...map.values()].sort((a, b) => {
    if (a.side !== b.side) return a.side === "sales" ? -1 : 1;
    return (order.get(a.code) ?? 999) - (order.get(b.code) ?? 999);
  });
}

export type TaxSummary = {
  /** 税率ごとの課税売上（税抜）と消費税額 */
  sales10: number;
  sales10Tax: number;
  sales8: number;
  sales8Tax: number;
  /** 税率ごとの課税仕入（税抜）と控除できる消費税額 */
  purchase10: number;
  purchase10Tax: number;
  purchase8: number;
  purchase8Tax: number;
  salesExempt: number;
  salesTaxFree: number;
  salesOutOfScope: number;
  /** 経過措置で控除できない金額（免税事業者からの仕入れの控除対象外部分） */
  transitionNotDeductible: number;
  /** 貸倒れに係る消費税額（売上の消費税から控除する） */
  badDebtTax: number;
  /** 税区分が付いていない費用・収益の行数。多いほど集計の精度が落ちる */
  uncategorizedLines: number;
};

/** 消費税計算の画面の集計 */
export function computeTaxSummary(lines: TaxBookLine[]): TaxSummary {
  const r: TaxSummary = {
    sales10: 0,
    sales10Tax: 0,
    sales8: 0,
    sales8Tax: 0,
    purchase10: 0,
    purchase10Tax: 0,
    purchase8: 0,
    purchase8Tax: 0,
    salesExempt: 0,
    salesTaxFree: 0,
    salesOutOfScope: 0,
    transitionNotDeductible: 0,
    badDebtTax: 0,
    uncategorizedLines: 0,
  };
  for (const l of lines) {
    if (l.needsReview) continue;
    const code = taxCodeOfLine(l);
    if (code === undefined) continue;
    if (code === "none") {
      r.uncategorizedLines++;
      continue;
    }
    const info = taxCategoryInfo(code)!;
    const a = lineTaxAmounts(l);
    if (a.net === 0 && a.tax === 0) continue;

    // 貸倒れ: 売上の消費税から控除する額
    if (info.badDebt) {
      r.badDebtTax += a.tax;
      continue;
    }

    if (info.side === "sales") {
      if (info.rate === 0.1) {
        r.sales10 += a.net;
        r.sales10Tax += a.tax;
      } else if (info.rate === 0.08) {
        r.sales8 += a.net;
        r.sales8Tax += a.tax;
      } else if (code === "sales_exempt") r.salesExempt += a.net;
      else if (code === "sales_tax_free") r.salesTaxFree += a.net;
      else r.salesOutOfScope += a.net;
      continue;
    }

    // 仕入側。非課税・不課税は仕入税額控除の対象にならない
    if (info.rate === 0) continue;
    // 経過措置の対象なら、控除できるのはその割合分だけ
    const deductible = info.transitionRate ? Math.floor(a.tax * info.transitionRate) : a.tax;
    r.transitionNotDeductible += a.tax - deductible;
    if (info.rate === 0.1) {
      r.purchase10 += a.net;
      r.purchase10Tax += deductible;
    } else {
      r.purchase8 += a.net;
      r.purchase8Tax += deductible;
    }
  }
  return r;
}

export type RatePortion = { rate: 0.1 | 0.08 | null; net: number; tax: number };

/**
 * 請求書の売上（仕入）を税率ごとに分ける。仕訳の売上高・仕入高の行を税率ごとに立て、
 * それぞれに税区分を付けるために使う。
 *
 * 合計は請求書の小計・消費税額に必ず合わせる（明細の端数で仕訳の貸借がずれないよう、
 * 差は金額のいちばん大きい税率に寄せる）。明細が無ければ、小計と消費税額の比から税率を判断し、
 * 判断できなければ税率なし（null。税区分を付けず、人が確かめる）とする。
 */
export function splitInvoiceByRate(
  items: { taxRate: number | null; subtotal: number; taxAmount: number | null }[],
  subtotal: number,
  taxAmount: number
): RatePortion[] {
  const rateOf = (v: number | null): 0.1 | 0.08 | null =>
    v === 10 || v === 0.1 ? 0.1 : v === 8 || v === 0.08 ? 0.08 : null;

  const groups = new Map<0.1 | 0.08 | null, RatePortion>();
  for (const it of items) {
    const rate = rateOf(it.taxRate);
    const g = groups.get(rate) ?? { rate, net: 0, tax: 0 };
    g.net += Number(it.subtotal) || 0;
    // 明細に消費税額が無ければ、小計×税率（整数で計算して小数の誤差を避ける）
    const sub = Number(it.subtotal) || 0;
    g.tax += it.taxAmount != null ? Number(it.taxAmount) || 0 : rate ? Math.floor((sub * (rate === 0.1 ? 10 : 8)) / 100) : 0;
    groups.set(rate, g);
  }

  let portions = [...groups.values()].filter((g) => g.net !== 0 || g.tax !== 0);
  if (portions.length === 0) {
    const ratio = subtotal ? taxAmount / subtotal : 0;
    const rate = taxAmount > 0 ? (Math.abs(ratio - 0.08) < 0.005 ? 0.08 : Math.abs(ratio - 0.1) < 0.005 ? 0.1 : null) : null;
    return [{ rate, net: subtotal, tax: taxAmount }];
  }

  // 請求書の小計・消費税額に合わせる
  portions.sort((a, b) => b.net - a.net);
  const netDiff = subtotal - portions.reduce((s, p) => s + p.net, 0);
  const taxDiff = taxAmount - portions.reduce((s, p) => s + p.tax, 0);
  portions = portions.map((p, i) => (i === 0 ? { ...p, net: p.net + netDiff, tax: p.tax + taxDiff } : p));
  return portions;
}

export type AccountTaxLine = {
  side: "sales" | "purchase";
  accountCode: string;
  accountName: string;
  code: string;
  codeName: string;
  net: number;
  tax: number;
  gross: number;
  needsReview: boolean;
};

export type AccountTaxRow = {
  side: "sales" | "purchase";
  accountCode: string;
  accountName: string;
  /** 税区分ごとの内訳（税区分マスタの並び、未設定は最後） */
  categories: { code: string; codeName: string; count: number; net: number; tax: number; gross: number }[];
  net: number;
  tax: number;
  gross: number;
};

/**
 * 科目別税区分表。科目ごとに税区分別の件数・税抜・消費税・税込をまとめる。
 * 消費税申告の前に、科目と税区分の組み合わせに誤りがないかを確かめるために使う。
 * 要確認の仕訳は消費税の集計と同じく含めない。
 */
export function summarizeByAccountAndCategory(lines: AccountTaxLine[]): AccountTaxRow[] {
  const order = new Map(TAX_CATEGORY_LIST.map((c, i) => [c.code as string, i]));
  const rows = new Map<string, AccountTaxRow>();
  for (const l of lines) {
    if (l.needsReview) continue;
    const key = `${l.side}:${l.accountCode}:${l.accountName}`;
    let r = rows.get(key);
    if (!r) {
      r = { side: l.side, accountCode: l.accountCode, accountName: l.accountName, categories: [], net: 0, tax: 0, gross: 0 };
      rows.set(key, r);
    }
    let c = r.categories.find((x) => x.code === l.code);
    if (!c) {
      c = { code: l.code, codeName: l.codeName, count: 0, net: 0, tax: 0, gross: 0 };
      r.categories.push(c);
    }
    c.count++;
    c.net += l.net;
    c.tax += l.tax;
    c.gross += l.gross;
    r.net += l.net;
    r.tax += l.tax;
    r.gross += l.gross;
  }
  for (const r of rows.values()) {
    r.categories.sort((a, b) => (order.get(a.code) ?? 999) - (order.get(b.code) ?? 999));
  }
  return [...rows.values()].sort((a, b) => {
    if (a.side !== b.side) return a.side === "sales" ? -1 : 1;
    return a.accountCode.localeCompare(b.accountCode);
  });
}
