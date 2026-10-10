/**
 * 決算で計上する税金の仕訳（純粋関数）。
 *
 * ■ 法人税等（法人税・地方法人税・防衛特別法人税・住民税・事業税・特別法人事業税）
 *   (借)法人税、住民税及び事業税 / (貸)未払法人税等（確定分＝当期の税額 − 中間納付）
 *   中間納付を「仮払法人税等」で記帳していれば、それも取り崩す: (貸)仮払法人税等
 *
 * ■ 消費税（年間の税額＝中間納付を差し引く前の額で計上する）
 *   税抜経理: (借)仮受消費税 / (貸)仮払消費税・未払消費税等。端数の差額は 雑収入（益）か 租税公課（損）
 *   税込経理: (借)租税公課 / (貸)未払消費税等
 *   中間納付は「(借)未払消費税等 / (貸)預金」で記帳している前提。年間の税額を未払消費税等に計上すると、
 *   期末の残高がちょうど確定申告で納める額になる
 *
 * 還付になる場合は、未収の科目の選び方が会社ごとに違うため、ここでは作らない（手で作る）。
 */

export type SettlementLine = { account: string; debit: number; credit: number };
export type SettlementEntry = { lines: SettlementLine[] } | { error: string };

export const ACCOUNTS = {
  corporateTaxExpense: "法人税、住民税及び事業税",
  corporateTaxPayable: "未払法人税等",
  corporateTaxPrepaid: "仮払法人税等",
  consumptionTaxPayable: "未払消費税等",
  outputTax: "仮受消費税",
  inputTax: "仮払消費税",
  miscIncome: "雑収入",
  taxesAndDues: "租税公課",
} as const;

/**
 * 法人税等の計上。
 * @param totalTax 当期の税額の合計（中間分を含む）
 * @param interim 中間申告で納めた額の合計
 * @param prepaidBalance 期末の仮払法人税等の残高（中間納付・源泉所得税を仮払で記帳していた分）
 */
export function corporateTaxEntry(totalTax: number, interim: number, prepaidBalance: number): SettlementEntry {
  const payable = totalTax - interim;
  if (payable < 0) return { error: "中間納付の方が多く、還付になります。還付の仕訳（未収還付法人税等など）は手で作ってください" };
  const prepaid = Math.max(0, prepaidBalance);
  const expense = payable + prepaid;
  if (expense === 0) return { error: "計上する法人税等がありません" };
  const lines: SettlementLine[] = [{ account: ACCOUNTS.corporateTaxExpense, debit: expense, credit: 0 }];
  if (prepaid > 0) lines.push({ account: ACCOUNTS.corporateTaxPrepaid, debit: 0, credit: prepaid });
  if (payable > 0) lines.push({ account: ACCOUNTS.corporateTaxPayable, debit: 0, credit: payable });
  return { lines };
}

/**
 * 消費税の計上。
 * @param payable 年間の消費税額（国＋地方、中間納付を差し引く前。還付ならマイナス）
 * @param outputBalance 期末の仮受消費税の残高（貸方をプラス）
 * @param inputBalance 期末の仮払消費税の残高（借方をプラス）
 */
export function consumptionTaxEntry(payable: number, outputBalance: number, inputBalance: number): SettlementEntry {
  if (payable < 0) return { error: "還付になります。還付の仕訳（未収消費税等など）は手で作ってください" };
  const exclusive = outputBalance !== 0 || inputBalance !== 0;
  if (!exclusive) {
    if (payable === 0) return { error: "納める消費税がありません" };
    return {
      lines: [
        { account: ACCOUNTS.taxesAndDues, debit: payable, credit: 0 },
        { account: ACCOUNTS.consumptionTaxPayable, debit: 0, credit: payable },
      ],
    };
  }
  const lines: SettlementLine[] = [];
  if (outputBalance > 0) lines.push({ account: ACCOUNTS.outputTax, debit: outputBalance, credit: 0 });
  if (inputBalance > 0) lines.push({ account: ACCOUNTS.inputTax, debit: 0, credit: inputBalance });
  if (payable > 0) lines.push({ account: ACCOUNTS.consumptionTaxPayable, debit: 0, credit: payable });
  // 端数などの差額: 貸方が足りなければ雑収入、借方が足りなければ租税公課
  const diff = outputBalance - inputBalance - payable;
  if (diff > 0) lines.push({ account: ACCOUNTS.miscIncome, debit: 0, credit: diff });
  if (diff < 0) lines.push({ account: ACCOUNTS.taxesAndDues, debit: -diff, credit: 0 });
  return { lines };
}
