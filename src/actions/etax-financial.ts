"use server";

/**
 * 財務諸表（貸借対照表・損益計算書・株主資本等変動計算書・個別注記表）を e-Tax 用の CSV（HOT010 Ver.3.0・Shift_JIS）で出力する。
 * 中身は決算書（getSettlementReport）と同じ。列の作り方は src/lib/etax-financial-csv.ts（テストあり）。
 */

import { assertClientAccess } from "@/lib/authz";
import { getSettlementReport } from "@/actions/settlement-report";
import {
  balanceSheetCsv,
  incomeStatementCsv,
  changesInEquityCsv,
  notesCsv,
  type EtaxFinancialKind,
} from "@/lib/etax-financial-csv";
import { encodeSjis } from "@/lib/sjis";

export type EtaxFinancialDownload = { fileName: string; base64: string; unsupported: string[] };

/** periodKey は決算書と同じ（"2025" か "2025-04-01"） */
export async function getEtaxFinancialCsv(
  clientId: string,
  periodKey: string,
  kind: EtaxFinancialKind
): Promise<EtaxFinancialDownload> {
  await assertClientAccess(clientId);
  const r = await getSettlementReport(clientId, periodKey);
  const base = { companyName: r.company.name, period: r.period };
  const f =
    kind === "BS"
      ? balanceSheetCsv({ ...base, bs: r.bs, pl: r.pl })
      : kind === "PL"
        ? incomeStatementCsv({ ...base, bs: r.bs, pl: r.pl })
        : kind === "SS"
          ? changesInEquityCsv({ ...base, ce: r.changesInEquity })
          : notesCsv({ ...base, notes: r.notes });
  const text = f.rows.map((row) => row.join(",")).join("\r\n") + "\r\n";
  const { bytes, unsupported } = encodeSjis(text);
  return { fileName: f.fileName, base64: Buffer.from(bytes).toString("base64"), unsupported };
}
