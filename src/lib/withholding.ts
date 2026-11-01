/**
 * 報酬・料金の源泉徴収税額（所得税法204条1項1号・2号、復興特別所得税を含む）。
 * 士業・デザイナー・講師・原稿料など、個人に払う報酬が対象（法人への支払いは対象外）。
 *   1回の支払額が100万円以下 … 支払額 × 10.21%
 *   100万円を超える部分       … (支払額 − 100万円) × 20.42% ＋ 102,100円
 * 1円未満は切り捨て。請求書で消費税の額がはっきり分かれていれば、税抜の額で計算してよい。
 * 小数の誤差で1円ずれないよう、整数で計算する。
 */
export function withholdingOnFee(amount: number): number {
  const a = Math.floor(Number(amount) || 0);
  if (a <= 0) return 0;
  if (a <= 1_000_000) return Math.floor((a * 1021) / 10000);
  return 102_100 + Math.floor(((a - 1_000_000) * 2042) / 10000);
}

/** 源泉徴収の対象になりやすい報酬の科目 */
export const FEE_ACCOUNT = /支払報酬|報酬|外注費|講師|原稿料|デザイン料|謝礼/;
/** 源泉徴収税を預かる科目。「預り金（源泉所得税）」があればそれを、無ければ「預り金」を使う */
export function pickWithholdingAccount<T extends { name: string }>(accounts: T[]): T | undefined {
  return accounts.find((a) => /^預り金[（(]源泉/.test(a.name)) ?? accounts.find((a) => a.name === "預り金");
}
