/**
 * 同族会社の判定（法人税法2条10号・別表二）。純粋関数。
 *
 *   - 株主を「判定基準となる株主とその同族関係者」のグループ（株主グループ）にまとめる
 *   - 持株数の多いグループから順位を付け、上位3グループの持株数の合計が
 *     発行済株式の総数（自己株式を除く）の50%を超えれば同族会社
 *   - 特定同族会社（上位1グループで50%超）は、資本金1億円以下の中小法人には当たらない（法人税法67条1項）
 */

export type Shareholder = {
  groupNo: number;
  name: string;
  address: string | null;
  relationship: string | null;
  isCorporation: boolean;
  shares: number;
};

export type ShareholderGroup = { groupNo: number; rank: number; shares: number; members: Shareholder[] };

export type FamilyCompanyResult = {
  /** 期末現在の発行済株式の総数（自己株式を除く） */
  outstanding: number;
  groups: ShareholderGroup[];
  /** 上位3グループの持株数の合計と割合（%、小数第1位まで切り捨て） */
  top3Shares: number;
  top3Ratio: number;
  /** 上位1グループの割合（特定同族会社の判定） */
  top1Ratio: number;
  /** 1 同族会社 / 3 非同族会社 / 4 特定同族会社（別表一「同非区分」のコード） */
  kind: 1 | 3 | 4;
  warnings: string[];
};

const pct = (part: number, whole: number) => (whole > 0 ? Math.floor((part * 1000) / whole) / 10 : 0);

export function judgeFamilyCompany(p: {
  shareholders: Shareholder[];
  issuedShares: number | null;
  treasuryShares: number | null;
  capital: number | null;
}): FamilyCompanyResult {
  const warnings: string[] = [];
  const total = p.shareholders.reduce((s, x) => s + x.shares, 0);
  const issued = p.issuedShares ?? total + (p.treasuryShares ?? 0);
  if (p.issuedShares == null) warnings.push("発行済株式の総数が入っていないため、株主名簿の合計を使っています。");
  const outstanding = Math.max(0, issued - (p.treasuryShares ?? 0));
  if (p.issuedShares != null && total !== outstanding)
    warnings.push(`株主名簿の株式数の合計（${total.toLocaleString()}株）が、発行済株式の総数から自己株式を除いた数（${outstanding.toLocaleString()}株）と合いません。`);

  const byGroup = new Map<number, Shareholder[]>();
  for (const s of p.shareholders) byGroup.set(s.groupNo, [...(byGroup.get(s.groupNo) ?? []), s]);
  const groups = [...byGroup.entries()]
    .map(([groupNo, members]) => ({
      groupNo,
      shares: members.reduce((s, x) => s + x.shares, 0),
      // 判定基準となる株主（「本人」、無ければ持株数のいちばん多い人）を先頭に
      members: [...members].sort((a, b) => Number(b.relationship === "本人") - Number(a.relationship === "本人") || b.shares - a.shares),
    }))
    .sort((a, b) => b.shares - a.shares || a.groupNo - b.groupNo)
    .map((g, k) => ({ ...g, rank: k + 1 }));

  const top3Shares = groups.slice(0, 3).reduce((s, g) => s + g.shares, 0);
  const top3Ratio = pct(top3Shares, outstanding);
  const top1Ratio = pct(groups[0]?.shares ?? 0, outstanding);
  const isFamily = outstanding > 0 && top3Shares * 2 > outstanding;
  // 資本金が分からないときは、法人税の計算と同じく中小法人として扱う
  const sme = p.capital === null || p.capital <= 100_000_000;
  if (p.capital === null) warnings.push("資本金が登録されていないため、中小法人として判定しています（特定同族会社には当たらない）。");
  const isSpecific = isFamily && !sme && (groups[0]?.shares ?? 0) * 2 > outstanding;
  return { outstanding, groups, top3Shares, top3Ratio, top1Ratio, kind: isSpecific ? 4 : isFamily ? 1 : 3, warnings };
}
