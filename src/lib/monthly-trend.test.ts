import { describe, it, expect } from "vitest";
import {
  monthValue,
  summaryColumns,
  sumSeries,
  subtractSeries,
  isEmptySeries,
  type TrendSeries,
} from "@/lib/monthly-trend";

const s = (months: number[], prevMonths: number[]): TrendSeries => ({ months, prevMonths });
const pad = (xs: number[]) => [...xs, ...new Array(12 - xs.length).fill(0)];

describe("月のセル", () => {
  const row = s(pad([100, 150, 120]), pad([80, 150, 0]));
  const base = s(pad([1000, 1500, 0]), pad([]));

  it("金額・前月との差額・前年同月との差額", () => {
    expect(monthValue(row, 1, "amount", base)).toBe(150);
    expect(monthValue(row, 0, "mom_diff", base)).toBeNull();
    expect(monthValue(row, 2, "mom_diff", base)).toBe(-30);
    expect(monthValue(row, 0, "yoy_diff", base)).toBe(20);
  });

  it("前年同月比と構成比は %。分母が0なら出さない", () => {
    expect(monthValue(row, 0, "yoy_ratio", base)).toBe(125);
    expect(monthValue(row, 2, "yoy_ratio", base)).toBeNull();
    expect(monthValue(row, 1, "composition", base)).toBe(10);
    expect(monthValue(row, 2, "composition", base)).toBeNull();
  });
});

describe("比較列（当期・前期・差額・前期比・構成比）", () => {
  it("損益は累計どうしを比べ、構成比は売上高に対する割合", () => {
    const row = s(pad([100, 200]), pad([150, 50]));
    const sales = s(pad([1000, 1000]), pad([]));
    expect(summaryColumns(row, "pl", sales)).toEqual({ current: 300, prev: 200, diff: 100, prevRatio: 150, composition: 15 });
  });

  it("残高は期末残高と前期末残高を比べ、構成比は総資産に対する割合", () => {
    const row = s(pad(new Array(12).fill(0)).map((_, i) => (i === 11 ? 400 : 100)), pad(new Array(12).fill(500)));
    const assets = s(new Array(12).fill(2000), new Array(12).fill(0));
    expect(summaryColumns(row, "bs", assets)).toEqual({ current: 400, prev: 500, diff: -100, prevRatio: 80, composition: 20 });
  });

  it("前期が0なら前期比は出さない", () => {
    expect(summaryColumns(s(pad([10]), pad([])), "pl", s(pad([10]), pad([]))).prevRatio).toBeNull();
  });
});

describe("系列の集計", () => {
  it("小計と差引損益", () => {
    const rev = sumSeries([s(pad([100]), pad([90])), s(pad([50]), pad([10]))]);
    expect(rev.months[0]).toBe(150);
    const profit = subtractSeries(rev, s(pad([120]), pad([200])));
    expect([profit.months[0], profit.prevMonths[0]]).toEqual([30, -100]);
  });
  it("当期・前期とも動きが無いか", () => {
    expect(isEmptySeries(s(pad([]), pad([])))).toBe(true);
    expect(isEmptySeries(s(pad([]), pad([1])))).toBe(false);
  });
});
