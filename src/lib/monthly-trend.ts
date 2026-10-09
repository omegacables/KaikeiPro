/**
 * 月次推移表の比較計算（純粋関数）。
 *
 *   損益（PL）… 各月の発生額。当期累計と前期累計を比べる。構成比は売上高（収益合計）に対する割合
 *   残高（BS）… 各月末の残高。期末残高と前期末残高を比べる。構成比は総資産に対する割合
 * 金額はどれも科目の性質に応じた正の値（費用は借方、収益は貸方…）で受け取る。
 */

export type TrendMode = "pl" | "bs";

export type TrendSeries = {
  /** 当期の各月（PL=発生額 / BS=月末残高） */
  months: number[];
  /** 前期の同じ月 */
  prevMonths: number[];
};

/** 月のセルに出すもの */
export type MonthMetric = "amount" | "mom_diff" | "yoy_diff" | "yoy_ratio" | "composition";

export const MONTH_METRICS: { key: MonthMetric; label: string }[] = [
  { key: "amount", label: "金額" },
  { key: "mom_diff", label: "前月との差額" },
  { key: "yoy_diff", label: "前年同月との差額" },
  { key: "yoy_ratio", label: "前年同月比" },
  { key: "composition", label: "構成比" },
];

/** 割合の指標か（表示を % にする） */
export const isRatioMetric = (m: MonthMetric) => m === "yoy_ratio" || m === "composition";

/** 当期の合計（PL=累計 / BS=期末残高） */
export function currentTotal(s: TrendSeries, mode: TrendMode): number {
  return mode === "pl" ? s.months.reduce((a, b) => a + b, 0) : s.months[s.months.length - 1] ?? 0;
}

/** 前期の合計（PL=前期累計 / BS=前期末残高） */
export function prevTotal(s: TrendSeries, mode: TrendMode): number {
  return mode === "pl" ? s.prevMonths.reduce((a, b) => a + b, 0) : s.prevMonths[s.prevMonths.length - 1] ?? 0;
}

/** 割合（%）。分母が0なら出さない */
export function ratio(n: number, d: number): number | null {
  return d === 0 ? null : (n / d) * 100;
}

/**
 * 月のセルの値。金額系は円、割合系は %。出せないときは null。
 * @param base 構成比の分母（PL=収益合計の系列、BS=資産合計の系列）
 */
export function monthValue(s: TrendSeries, idx: number, metric: MonthMetric, base: TrendSeries): number | null {
  const v = s.months[idx] ?? 0;
  switch (metric) {
    case "amount":
      return v;
    case "mom_diff":
      return idx === 0 ? null : v - (s.months[idx - 1] ?? 0);
    case "yoy_diff":
      return v - (s.prevMonths[idx] ?? 0);
    case "yoy_ratio":
      return ratio(v, s.prevMonths[idx] ?? 0);
    case "composition":
      return ratio(v, base.months[idx] ?? 0);
  }
}

export type SummaryColumns = {
  current: number;
  prev: number;
  /** 当期 − 前期 */
  diff: number;
  /** 当期 ÷ 前期（%） */
  prevRatio: number | null;
  /** 構成比（%） */
  composition: number | null;
};

/** 右側の比較列（当期・前期・差額・前期比・構成比） */
export function summaryColumns(s: TrendSeries, mode: TrendMode, base: TrendSeries): SummaryColumns {
  const current = currentTotal(s, mode);
  const prev = prevTotal(s, mode);
  return {
    current,
    prev,
    diff: current - prev,
    prevRatio: ratio(current, prev),
    composition: ratio(current, currentTotal(base, mode)),
  };
}

/** 複数の系列を足し合わせる（区分の小計・差引損益に使う） */
export function sumSeries(rows: TrendSeries[], length = 12): TrendSeries {
  const add = (key: "months" | "prevMonths") =>
    Array.from({ length }, (_, i) => rows.reduce((sum, r) => sum + (r[key][i] ?? 0), 0));
  return { months: add("months"), prevMonths: add("prevMonths") };
}

/** a − b の系列（差引損益 = 収益 − 費用） */
export function subtractSeries(a: TrendSeries, b: TrendSeries): TrendSeries {
  return {
    months: a.months.map((v, i) => v - (b.months[i] ?? 0)),
    prevMonths: a.prevMonths.map((v, i) => v - (b.prevMonths[i] ?? 0)),
  };
}

/** 当期・前期とも動きの無い系列か */
export const isEmptySeries = (s: TrendSeries) =>
  s.months.every((v) => v === 0) && s.prevMonths.every((v) => v === 0);
