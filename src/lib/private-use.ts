/**
 * 私的利用分の按分（純粋関数）。
 *
 *   個人事業主 … 家事按分。私用分を「事業主貸」へ振り替える
 *   法人       … 役員の私的利用分。社宅・車両・携帯電話など、役員が私的にも使う費用の私用分を
 *                「役員貸付金」（役員が会社に返す）などへ振り替える
 *
 * 期末に、科目ごとの期中の合計 × 私用の割合 を経費から減らす。
 * 経費を減らす行には元の仕訳と同じ税区分を付ける（私用分は仕入税額控除の対象にならないため）。
 * 税抜経理の仕訳から来た分は、私用分の消費税も仮払消費税から減らす（振替先へは税込の額を振り替える）。
 */

/** 期中の経費の行（同じ科目・税区分・経理方式ごとに足し上げる前） */
export type PrivateUseSourceLine = {
  accountId: string;
  /** 税区分（読み替え後）。消費税がかからない・未設定なら null */
  taxCategory: string | null;
  /** その税区分の税率（0.1 / 0.08 / 0） */
  taxRate: number;
  /** 税抜経理の仕訳か（同じ仕訳に仮払消費税の行がある） */
  exclusive: boolean;
  /** 借方 − 貸方 */
  amount: number;
};

export type PrivateUseGroup = {
  accountId: string;
  taxCategory: string | null;
  exclusive: boolean;
  /** 事業（業務）に使った割合（%） */
  ratio: number;
  total: number;
  business: number;
  /** 経費から減らす額（税抜経理なら税抜） */
  private: number;
  /** 税抜経理の仕訳から来た分の、私用分の消費税（仮払消費税から減らす） */
  privateTax: number;
};

export type PrivateUseAdjustment = {
  groups: PrivateUseGroup[];
  /** 振替先へ振り替える額（私用分＋私用分の消費税） */
  transfer: number;
  /** 仮払消費税から減らす額 */
  inputTax: number;
};

/**
 * 科目ごとの事業割合（ratios: 科目ID → %）から、期末の振替の内容を作る。
 * 事業分は四捨五入、私用分は差額（合計が必ず一致する）。消費税は1円未満切り捨て。
 */
export function buildPrivateUseAdjustment(
  lines: PrivateUseSourceLine[],
  ratios: Record<string, number>
): PrivateUseAdjustment {
  const byKey = new Map<string, { accountId: string; taxCategory: string | null; taxRate: number; exclusive: boolean; total: number }>();
  for (const l of lines) {
    if (ratios[l.accountId] === undefined) continue;
    const exclusive = l.exclusive && l.taxRate > 0;
    const key = `${l.accountId}|${l.taxCategory ?? ""}|${exclusive}`;
    const g = byKey.get(key) ?? { accountId: l.accountId, taxCategory: l.taxCategory, taxRate: l.taxRate, exclusive, total: 0 };
    g.total += l.amount;
    byKey.set(key, g);
  }

  const groups: PrivateUseGroup[] = [];
  for (const g of byKey.values()) {
    const ratio = Math.max(0, Math.min(100, ratios[g.accountId]));
    if (g.total <= 0) continue;
    const business = Math.round((g.total * ratio) / 100);
    const priv = g.total - business;
    if (priv <= 0) continue;
    const privateTax = g.exclusive ? Math.floor(priv * Math.round(g.taxRate * 100) / 100) : 0;
    groups.push({
      accountId: g.accountId,
      taxCategory: g.taxCategory,
      exclusive: g.exclusive,
      ratio,
      total: g.total,
      business,
      private: priv,
      privateTax,
    });
  }
  const inputTax = groups.reduce((s, g) => s + g.privateTax, 0);
  return { groups, transfer: groups.reduce((s, g) => s + g.private, 0) + inputTax, inputTax };
}
