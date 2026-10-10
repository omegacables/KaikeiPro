"use server";

/**
 * 勘定科目内訳明細書を e-Tax 用の CSV（国税庁の標準フォームの形式、Shift_JIS）で出力する。
 * 列の並びは src/lib/etax-breakdown-csv.ts（テストあり）、文字の変換は src/lib/sjis.ts。
 */

import { assertClientAccess } from "@/lib/authz";
import { getBreakdownForm, type BreakdownFormData } from "@/actions/breakdown";
import { buildSheetSection, findItemFormSpec } from "@/lib/breakdown-items";
import {
  notesReceivable,
  receivables,
  advancesAndLoans,
  securities,
  notesPayable,
  payables,
  deposits,
  borrowings,
  personnel,
  rents,
  miscGainsLosses,
  toCsvText,
  ETAX_FILES,
  type EtaxItem,
  type EtaxLoanRow,
  type EtaxFile,
} from "@/lib/etax-breakdown-csv";
import { encodeSjis } from "@/lib/sjis";

export type EtaxDownload = {
  fileName: string;
  /** Shift_JIS の CSV を base64 にしたもの */
  base64: string;
  rows: number;
  /** Shift_JIS（JIS第1・第2水準）で表せず「〓」にした文字 */
  unsupported: string[];
};

/** 内訳書の明細（入力したもの）を、用紙に記入する行（「その他」の一括行を含む）にして e-Tax の行に */
function itemRows(form: BreakdownFormData | null, section = "main"): EtaxItem[] {
  if (!form || form.kind !== "items") return [];
  const spec = findItemFormSpec(form.def.key)?.sections.find((s) => s.key === section);
  if (!spec) return [];
  const accountName = (id: string | null) => form.balances.find((b) => b.id === id)?.name ?? "";
  return buildSheetSection(spec, form.items, accountName).rows.map((r) =>
    r.kind === "item"
      ? {
          account: accountName(r.item.accountId),
          name: r.item.name,
          address: r.item.address,
          regNo: r.item.registrationNumber,
          relationship: r.item.relationship,
          amount: r.item.amount,
          note: r.item.note,
          d: r.item.details,
        }
      : {
          account: r.accountId ? accountName(r.accountId) : r.label,
          name: "その他",
          address: "",
          regNo: "",
          relationship: "",
          amount: r.amount,
          note: `${r.count}件`,
          d: {},
        }
  );
}

function loanRows(form: BreakdownFormData | null): EtaxLoanRow[] {
  if (!form || form.kind !== "loan") return [];
  return form.rows.map((r) => ({
    name: r.lender_name,
    address: r.address ?? "",
    regNo: r.registration_number ?? "",
    relationship: r.relationship ?? "",
    balance: r.closing_balance,
    interest: r.interest_paid,
    rate: r.interest_rate,
    collateral: r.collateral ?? "",
  }));
}

/** 内訳書が準備中・未対応なら空として扱う */
async function form(clientId: string, periodKey: string, key: string): Promise<BreakdownFormData | null> {
  try {
    return await getBreakdownForm(clientId, periodKey, key);
  } catch {
    return null;
  }
}

async function build(clientId: string, periodKey: string, id: string): Promise<EtaxFile> {
  const f = (key: string) => form(clientId, periodKey, key);
  switch (id) {
    case "HOI020_4.0":
      return notesReceivable(itemRows(await f("2")));
    case "HOI030_4.0":
      return receivables(itemRows(await f("3")));
    case "HOI040_4.0": {
      const [a, l] = await Promise.all([f("4-1"), f("4-2")]);
      return advancesAndLoans(itemRows(a), loanRows(l));
    }
    case "HOI060_4.0":
      return securities(itemRows(await f("6")));
    case "HOI080_4.0":
      return notesPayable(itemRows(await f("8")));
    case "HOI090_5.0": {
      const p = await f("9");
      return payables(itemRows(p, "main"), itemRows(p, "dividend"), itemRows(p, "officer_bonus"));
    }
    case "HOI100_6.0":
      return deposits(itemRows(await f("10-1")));
    case "HOI110_3.0": {
      const l = await f("11");
      return borrowings(loanRows(l));
    }
    case "HOI141_5.0": {
      const p = await f("14-3");
      const b = p && p.kind === "personnel" ? p.breakdown : null;
      const f14 = personnel({ officer: b?.officer.total ?? 0, salary: b?.salary.total ?? 0, wage: b?.wage.total ?? 0 });
      // 人件費が無ければ記入する内容が無い（提出不要）
      return b && b.total !== 0 ? f14 : { ...f14, rows: [] };
    }
    case "HOI150_4.0": {
      const [r, k] = await Promise.all([f("15-1"), f("15-2")]);
      return rents(itemRows(r, "main"), itemRows(r, "key_money"), itemRows(k, "main"));
    }
    case "HOI160_4.0": {
      const m = await f("16");
      if (!m || m.kind !== "misc") return miscGainsLosses([], []);
      const conv = (rows: typeof m.gains.listed) =>
        rows.map((r) => ({
          account: r.accountName,
          description: r.description,
          name: r.counterparty ?? "",
          address: r.address ?? "",
          regNo: r.registrationNumber ?? "",
          amount: r.amount,
        }));
      return miscGainsLosses(conv(m.gains.listed), conv(m.losses.listed));
    }
    default:
      throw new Error("出力できないファイルです");
  }
}

export async function getEtaxBreakdownCsv(clientId: string, periodKey: string, id: string): Promise<EtaxDownload> {
  await assertClientAccess(clientId);
  if (!ETAX_FILES.some((x) => x.id === id)) throw new Error("出力できないファイルです");
  const file = await build(clientId, periodKey, id);
  const { bytes, unsupported } = encodeSjis(toCsvText(file));
  return { fileName: file.fileName, base64: Buffer.from(bytes).toString("base64"), rows: file.rows.length, unsupported };
}
