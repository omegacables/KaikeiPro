/**
 * 設備投資の税額控除（法人税額の特別控除）。純粋関数。
 *
 *   中小企業投資促進税制（措法42条の6第2項）… 特定中小企業者等（資本金3,000万円以下）だけ。
 *       基準取得価額（船舶は取得価額×75%）× 7%。別表六(十五)
 *   中小企業経営強化税制（措法42条の12の4第2項）… 中小企業者（資本金1億円以下）。
 *       取得価額 × 10%（資本金3,000万円以下）／7%（3,000万円超）。別表六(二十三)
 *
 * どちらも控除できるのは調整前法人税額（別表一「2」）の20%まで。
 * 2つを合わせて20%で、投資促進税制 → 経営強化税制 の順に当てる（措法42条の12の4第2項）。
 * 控除しきれない分（繰越税額控除限度超過額）は翌期に1年だけ繰り越せる（各第3項）。
 * 前期からの繰越分の控除は、まだ入力を受け付けていない（0として計算）。
 * 同じ資産で特別償却と税額控除の両方は使えない（どちらか一方。措法53条）。
 * 1円未満は切り捨て。
 */

import { specialMeasure } from "@/lib/special-measures";

export type CreditAsset = {
  name: string;
  /** 区分番号（special_measure_code） */
  code: string;
  acquisitionCost: number;
  /** e-Tax の別表六の明細に使う（無くても計算はできる） */
  accountName?: string;
  acquisitionDate?: string;
  serviceStartDate?: string;
};

export type CreditLine = {
  /** 適用額明細書の区分番号（税額控除） */
  code: string;
  /** 合計の取得価額（基準取得価額） */
  base: number;
  /** 税額控除限度額（base × 率） */
  limit: number;
  /** 当期税額控除額（上限まで） */
  credit: number;
};

export type InvestmentCredit = {
  /** 中小企業投資促進税制（別表六(十五)） */
  promotion: { rate: number; assets: CreditAsset[]; base: number; limit: number; cap: number; credit: number; carryover: number } | null;
  /** 中小企業経営強化税制（別表六(二十三)）。類型（区分番号）ごとの内訳つき */
  strengthen: {
    rate: number;
    assets: CreditAsset[];
    base: number;
    limit: number;
    cap: number;
    credit: number;
    carryover: number;
    lines: CreditLine[];
  } | null;
  /** 調整前法人税額（別表一「2」）と、その20% */
  adjustedTax: number;
  cap20: number;
  /** 法人税額の特別控除額（別表一「3」・別表六(六)「5」） */
  total: number;
  warnings: string[];
};

const PROMOTION_CODES = new Set(["00031", "00690", "00034", "00037", "00040"]);
const SHIP = "00040";

export function computeInvestmentCredit(p: { assets: CreditAsset[]; capital: number | null; adjustedTax: number }): InvestmentCredit {
  const warnings: string[] = [];
  const adjustedTax = Math.max(0, p.adjustedTax);
  const cap20 = Math.floor(adjustedTax * 0.2);
  const capital = p.capital;
  if (capital === null && p.assets.length > 0)
    warnings.push("資本金が登録されていないため、資本金3,000万円以下として税額控除を計算しています。");
  const smallCap = capital === null || capital <= 30_000_000;
  const sme = capital === null || capital <= 100_000_000;

  // ---- 中小企業投資促進税制 ----
  const promoAssets = p.assets.filter((a) => PROMOTION_CODES.has(a.code));
  let promotion: InvestmentCredit["promotion"] = null;
  if (promoAssets.length > 0) {
    if (!smallCap) {
      warnings.push("中小企業投資促進税制の税額控除は資本金3,000万円以下の会社だけが使えます（この会社は特別償却を選んでください）。税額控除は0にしています。");
    } else {
      const base = promoAssets.reduce((s, a) => s + (a.code === SHIP ? Math.floor(a.acquisitionCost * 0.75) : a.acquisitionCost), 0);
      const limit = Math.floor(base * 0.07);
      const credit = Math.min(limit, cap20);
      promotion = { rate: 0.07, assets: promoAssets, base, limit, cap: cap20, credit, carryover: limit - credit };
    }
  }

  // ---- 中小企業経営強化税制 ----
  const strAssets = p.assets.filter((a) => specialMeasure(a.code)?.credit && !PROMOTION_CODES.has(a.code));
  let strengthen: InvestmentCredit["strengthen"] = null;
  if (strAssets.length > 0) {
    if (!sme) {
      warnings.push("中小企業経営強化税制の税額控除は資本金1億円以下の会社だけが使えます。税額控除は0にしています。");
    } else {
      const rate = smallCap ? 0.1 : 0.07;
      const base = strAssets.reduce((s, a) => s + a.acquisitionCost, 0);
      const limit = Math.floor(base * rate);
      // 投資促進税制で使った分を引いた残りが上限
      const cap = Math.max(0, cap20 - (promotion?.credit ?? 0));
      const credit = Math.min(limit, cap);
      // 類型ごとの適用額: 当期税額控除額を、類型ごとの税額控除限度額の割合で分ける（端数は最後の類型に）
      const byCode = new Map<string, number>();
      for (const a of strAssets) byCode.set(a.code, (byCode.get(a.code) ?? 0) + a.acquisitionCost);
      const codes = [...byCode.keys()];
      let rest = credit;
      const lines: CreditLine[] = codes.map((code, k) => {
        const lineBase = byCode.get(code)!;
        const lineLimit = Math.floor(lineBase * rate);
        const share = k === codes.length - 1 ? rest : limit > 0 ? Math.floor((credit * lineLimit) / limit) : 0;
        rest -= share;
        return { code: specialMeasure(code)!.credit!.code, base: lineBase, limit: lineLimit, credit: share };
      });
      strengthen = { rate, assets: strAssets, base, limit, cap, credit, carryover: limit - credit, lines };
    }
  }

  const total = (promotion?.credit ?? 0) + (strengthen?.credit ?? 0);
  if ((promotion?.carryover ?? 0) + (strengthen?.carryover ?? 0) > 0)
    warnings.push("税額控除が法人税額の20%を超えたため、控除しきれない分（繰越税額控除限度超過額）は翌期に1年だけ繰り越せます。前期からの繰越分を控除する入力はまだ無いので、翌期に使うときは申告書に手で書き足してください。");
  return { promotion, strengthen, adjustedTax, cap20, total, warnings };
}
