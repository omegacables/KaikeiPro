/**
 * 減価償却の計算ロジック（純粋関数）。
 *
 * サーバーアクション（"use server"）からは非async関数をexportできずテストも
 * できないため、計算部分をここに切り出している。
 */

export type DepreciableAsset = {
  acquisition_date: string;
  acquisition_cost: number;
  salvage_value: number;
  useful_life: number;
  depreciation_method: string;
};

// 会計年度末日を基準に、当会計年度の減価償却費を月割りで計算する。
// - 会計年度は期末日から遡る12ヶ月（暦年ではなく決算期に対応）
// - 取得年度は取得月から期末までの月数で月割り
// - 償却累計が償却可能限度額（取得価額−残存価額）を超えないよう調整
export function calculateAnnualDepreciation(
  asset: DepreciableAsset,
  fiscalYearEnd: Date
): number {
  const acquisition = new Date(asset.acquisition_date);
  if (acquisition > fiscalYearEnd) return 0;

  // 月を通し番号にして扱う（取得月・期首月を含む月数で計算）
  const monthIndex = (d: Date) => d.getFullYear() * 12 + d.getMonth();
  const acqIdx = monthIndex(acquisition);
  const fyEndIdx = monthIndex(fiscalYearEnd);
  const fyStartIdx = Math.max(fyEndIdx - 11, acqIdx); // 当期の償却開始月
  const monthsThisYear = fyEndIdx - fyStartIdx + 1;   // 当期の償却月数（1〜12）
  const monthsBefore = fyStartIdx - acqIdx;           // 期首までの経過月数

  if (asset.depreciation_method === "straight_line") {
    const depreciableBase = Math.max(0, asset.acquisition_cost - asset.salvage_value);
    const annual = depreciableBase / asset.useful_life;
    const accumulated = Math.floor((annual * monthsBefore) / 12);
    const remaining = depreciableBase - accumulated;
    if (remaining <= 0) return 0;
    return Math.min(Math.floor((annual * monthsThisYear) / 12), remaining);
  }

  // 定率法: rate = 1 - (残存価額/取得価額)^(1/耐用年数)、残存価額0なら200%定率法
  const rate =
    asset.salvage_value > 0
      ? 1 - Math.pow(asset.salvage_value / asset.acquisition_cost, 1 / asset.useful_life)
      : 2 / asset.useful_life;
  const floorValue = Math.max(asset.salvage_value, 0);

  // 過年度分を会計年度単位（取得年度は月割り）で償却して期首帳簿価額を求める
  let bookValue = asset.acquisition_cost;
  const firstWindowStart =
    fyStartIdx - 12 * Math.ceil((fyStartIdx - acqIdx) / 12);
  for (let ws = firstWindowStart; ws < fyStartIdx; ws += 12) {
    const from = Math.max(acqIdx, ws);
    const months = ws + 12 - from;
    const dep = Math.min(
      Math.floor((bookValue * rate * months) / 12),
      bookValue - floorValue
    );
    bookValue -= Math.max(0, dep);
  }

  const dep = Math.min(
    Math.floor((bookValue * rate * monthsThisYear) / 12),
    bookValue - floorValue
  );
  return Math.max(0, dep);
}
