/**
 * 貸倒れの処理と貸倒引当金（純粋関数）。
 *
 * ■ 貸倒引当金（一括評価金銭債権）
 *   繰入限度額 ＝（期末の一括評価金銭債権 − 実質的に債権とみられない額）× 繰入率（円未満切捨て）
 *   繰入率は、中小法人等は「法定繰入率」と「貸倒実績率」のどちらかを選べる。
 *   法定繰入率（租税特別措置法施行令33条の7）:
 *     卸売業・小売業 10/1000、製造業 8/1000、金融業・保険業 3/1000、
 *     割賦販売小売業等 7/1000、その他 6/1000
 *   ※ 法人税で引当金を損金にできるのは中小法人等（資本金1億円以下など）に限られる。
 *
 *   計上の仕方:
 *     洗替法   … 前期末の残高を全額戻し入れ、当期の限度額を繰り入れる（2本の仕訳）
 *     差額補充法 … 当期の限度額と前期末の残高の差だけを繰り入れ（または戻し入れ）る
 *
 * ■ 貸倒れ（売掛金などが回収できなくなった）
 *   売掛金を減らし、貸倒損失とする。課税売上の売掛金なら、貸倒れに係る消費税額を
 *   売上の消費税から控除できる（消費税法39条）。そのため貸倒損失の行に「貸倒れ」の税区分を付ける。
 *   税抜経理なら、売掛金に含まれる消費税分を仮受消費税から減らす。
 */

import { taxFromGross } from "@/lib/tax-category";

export type IndustryRate = { key: string; label: string; perMille: number };

export const STATUTORY_RATES: IndustryRate[] = [
  { key: "wholesale_retail", label: "卸売業・小売業（飲食店業・料理店業を含む）", perMille: 10 },
  { key: "manufacturing", label: "製造業", perMille: 8 },
  { key: "finance", label: "金融業・保険業", perMille: 3 },
  { key: "installment", label: "割賦販売小売業・信用購入あっせん業", perMille: 7 },
  { key: "other", label: "その他の事業", perMille: 6 },
];

export type AllowanceInput = {
  /** 期末の一括評価金銭債権の合計（売掛金・受取手形・貸付金・未収入金など） */
  receivables: number;
  /** 実質的に債権とみられない額（同じ相手への買掛金など、相殺できる額） */
  deduction: number;
  /** 繰入率（法定繰入率 n/1000、または貸倒実績率）。小数で渡す（10/1000 なら 0.01） */
  rate: number;
  /** 前期末（今の）貸倒引当金の残高 */
  priorBalance: number;
  method: "reversal" | "difference";
};

export type AllowanceEntry =
  /** 戻し入れ: (借)貸倒引当金 /(貸)貸倒引当金戻入益 */
  | { kind: "reverse"; amount: number }
  /** 繰り入れ: (借)貸倒引当金繰入額 /(貸)貸倒引当金 */
  | { kind: "provide"; amount: number };

export type AllowanceResult = {
  base: number;
  limit: number;
  entries: AllowanceEntry[];
  /** 計上後の貸倒引当金の残高（＝限度額） */
  closingBalance: number;
};

/** 貸倒引当金の繰入限度額と、計上する仕訳 */
export function calcAllowance(i: AllowanceInput): AllowanceResult {
  const base = Math.max(0, i.receivables - i.deduction);
  // 小数の誤差を避けて円未満を切り捨てる（1/1000 単位の率を想定して整数で計算）
  const limit = Math.floor((base * Math.round(i.rate * 1_000_000)) / 1_000_000);
  const entries: AllowanceEntry[] = [];
  if (i.method === "reversal") {
    if (i.priorBalance > 0) entries.push({ kind: "reverse", amount: i.priorBalance });
    if (limit > 0) entries.push({ kind: "provide", amount: limit });
  } else {
    const diff = limit - i.priorBalance;
    if (diff > 0) entries.push({ kind: "provide", amount: diff });
    if (diff < 0) entries.push({ kind: "reverse", amount: -diff });
  }
  return { base, limit, entries, closingBalance: limit };
}

export type WriteOffInput = {
  /** 貸し倒れた額（売掛金などの残高のうち、回収できない額。税込） */
  amount: number;
  /** その売掛金の元の売上の税率。課税売上でなければ null（貸付金など） */
  rate: 0.1 | 0.08 | null;
  /** 税抜経理か（仮受消費税を立てている） */
  exclusive: boolean;
  /** 個別に引き当てていた貸倒引当金を取り崩す額（0なら全額を貸倒損失） */
  useAllowance: number;
};

export type WriteOffLine = {
  role: "loss" | "allowance" | "output_tax" | "receivable";
  debit: number;
  credit: number;
  /** 貸倒損失の行に付ける税区分（課税売上の貸倒れ） */
  taxCategory: "bad_debt_10" | "bad_debt_08" | null;
};

/**
 * 貸倒れの仕訳の行。
 *   税込経理: (借)貸倒損失 [貸倒れ10%] ／(貸)売掛金
 *   税抜経理: (借)貸倒損失 [貸倒れ10%]・(借)仮受消費税 ／(貸)売掛金
 *   引当金の取り崩しがあれば、その分は (借)貸倒引当金（消費税の控除は引当金分も対象）
 */
export function writeOffLines(i: WriteOffInput): WriteOffLine[] {
  if (i.amount <= 0) return [];
  const useAllowance = Math.min(Math.max(0, i.useAllowance), i.amount);
  const tax = i.rate ? taxFromGross(i.amount, i.rate) : 0;
  const code = i.rate === 0.1 ? "bad_debt_10" : i.rate === 0.08 ? "bad_debt_08" : null;
  const lines: WriteOffLine[] = [];

  if (i.exclusive && tax > 0) {
    // 税抜経理: 消費税分は仮受消費税を減らす。残りを引当金→貸倒損失の順に充てる
    const net = i.amount - tax;
    const fromAllowance = Math.min(useAllowance, net);
    if (fromAllowance > 0) lines.push({ role: "allowance", debit: fromAllowance, credit: 0, taxCategory: null });
    if (net - fromAllowance > 0) lines.push({ role: "loss", debit: net - fromAllowance, credit: 0, taxCategory: code });
    lines.push({ role: "output_tax", debit: tax, credit: 0, taxCategory: null });
  } else {
    if (useAllowance > 0) lines.push({ role: "allowance", debit: useAllowance, credit: 0, taxCategory: null });
    if (i.amount - useAllowance > 0) lines.push({ role: "loss", debit: i.amount - useAllowance, credit: 0, taxCategory: code });
  }
  lines.push({ role: "receivable", debit: 0, credit: i.amount, taxCategory: null });
  return lines;
}
