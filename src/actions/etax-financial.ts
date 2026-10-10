"use server";

/**
 * 財務諸表（貸借対照表・損益計算書）を e-Tax 用の CSV（HOT010 Ver.3.0・Shift_JIS）で出力する。
 * 中身は決算書（getSettlementReport）と同じ。列の作り方は src/lib/etax-financial-csv.ts（テストあり）。
 */

import { assertClientAccess } from "@/lib/authz";
import { getSettlementReport } from "@/actions/settlement-report";
import { balanceSheetCsv, incomeStatementCsv } from "@/lib/etax-financial-csv";
import { encodeSjis } from "@/lib/sjis";

export type EtaxFinancialDownload = { fileName: string; base64: string; unsupported: string[] };

export async function getEtaxFinancialCsv(clientId: string, fiscalStartYear: number, kind: "BS" | "PL"): Promise<EtaxFinancialDownload> {
  await assertClientAccess(clientId);
  const r = await getSettlementReport(clientId, fiscalStartYear);
  const input = { companyName: r.company.name, period: r.period, bs: r.bs, pl: r.pl };
  const f = kind === "BS" ? balanceSheetCsv(input) : incomeStatementCsv(input);
  const text = f.rows.map((row) => row.join(",")).join("\r\n") + "\r\n";
  const { bytes, unsupported } = encodeSjis(text);
  return { fileName: f.fileName, base64: Buffer.from(bytes).toString("base64"), unsupported };
}
