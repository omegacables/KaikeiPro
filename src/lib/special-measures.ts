/**
 * 固定資産に使う租税特別措置（特別償却・税額控除）の一覧。
 * 区分番号・条項は国税庁「適用額明細書の記載の手引（令和8年）」と「租税特別措置法の条項等と区分番号一覧」による。
 *
 *   code   … 特別償却の区分番号（適用額明細書）。fixed_assets.special_measure_code に入れる
 *   jo/eda/ko/go … 条項（第42条の6第1項第1号 → "42" / "の6" / "1" / "1"）
 *   rate   … 特別償却率（取得価額に掛ける割合。即時償却は 1）。null は率を手で入れる制度
 *   credit … 同じ資産で税額控除を選んだときの区分番号と条項（②で使う）
 *
 * 経営強化税制（42条の12の4）の4つの類型は、条項が同じで区分番号だけが違う。
 */

export type MeasureClause = { jo: string; eda: string | null; ko: string; go: string | null };

export type SpecialMeasure = {
  code: string;
  label: string;
  group: string;
  clause: MeasureClause;
  rate: number | null;
  credit: { code: string; clause: MeasureClause } | null;
};

const PROMOTION = "中小企業投資促進税制（措法42条の6）";
const STRENGTHEN = "中小企業経営強化税制（措法42条の12の4）";
const OTHER = "その他の特別償却";

const promotion = (code: string, label: string, go: string): SpecialMeasure => ({
  code,
  label,
  group: PROMOTION,
  clause: { jo: "42", eda: "の6", ko: "1", go },
  rate: 0.3,
  credit: { code: "00043", clause: { jo: "42", eda: "の6", ko: "2", go: null } },
});
const strengthen = (code: string, label: string, creditCode: string): SpecialMeasure => ({
  code,
  label,
  group: STRENGTHEN,
  clause: { jo: "42", eda: "の12の4", ko: "1", go: null },
  // 即時償却（取得価額から普通償却限度額を引いた残り全部）
  rate: 1,
  credit: { code: creditCode, clause: { jo: "42", eda: "の12の4", ko: "2", go: null } },
});
const other = (code: string, label: string, clause: MeasureClause): SpecialMeasure => ({
  code,
  label,
  group: OTHER,
  clause,
  rate: null,
  credit: null,
});

export const SPECIAL_MEASURES: SpecialMeasure[] = [
  promotion("00031", "機械及び装置", "1"),
  promotion("00690", "工具", "2"),
  promotion("00034", "ソフトウエア", "3"),
  promotion("00037", "車両及び運搬具", "4"),
  promotion("00040", "船舶", "5"),
  strengthen("00712", "生産性向上設備（A類型）", "00720"),
  strengthen("00714", "収益力強化設備（B類型）", "00721"),
  strengthen("00716", "経営資源集約化設備（D類型）", "00722"),
  strengthen("00718", "経営規模拡大設備（E類型）", "00723"),
  other("00597", "地域経済牽引事業の特定事業用機械等", { jo: "42", eda: "の11の2", ko: "1", go: null }),
  other("00568", "地方活力向上地域等の特定建物等", { jo: "42", eda: "の12", ko: "1", go: null }),
  other("00665", "生産工程効率化等設備", { jo: "42", eda: "の12の6", ko: "1", go: null }),
  other("00728", "特定生産性向上設備等", { jo: "42", eda: "の12の7", ko: "1", go: null }),
  other("00646", "特定事業継続力強化設備等（中小企業防災・減災投資促進税制）", { jo: "44", eda: "の2", ko: "1", go: null }),
];

export const specialMeasure = (code: string | null | undefined) => SPECIAL_MEASURES.find((m) => m.code === code) ?? null;

/** 条項を「第42条の6第1項第1号」の形にする */
export function clauseText(c: MeasureClause): string {
  return `第${c.jo}条${c.eda ?? ""}第${c.ko}項${c.go ? `第${c.go}号` : ""}`;
}
