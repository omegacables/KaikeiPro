"use server";

import { createAdminSupabaseClient } from "@/lib/supabase";

type DbRow = Record<string, unknown>;

export type CheckSeverity = "high" | "warning" | "info";
export type CheckRuleKey =
  | "officer_loan"
  | "entertainment"
  | "supplies"
  | "tax_category";

export interface CheckFinding {
  key: string; // 一意キー（entryId + rule + suffix）
  ruleKey: CheckRuleKey;
  ruleLabel: string;
  severity: CheckSeverity;
  entryId: string | null; // 集計系の指摘は null
  date: string | null;
  description: string;
  accountName: string;
  amount: number;
  message: string;
}

export interface CheckResult {
  findings: CheckFinding[];
  counts: { high: number; warning: number; info: number; total: number };
  scanned: number; // 走査した仕訳数
  periodStart: string;
  periodEnd: string;
}

// しきい値
const ENTERTAINMENT_HIGH = 50_000; // 交際費 1件高額
const ENTERTAINMENT_ANNUAL_CAP = 8_000_000; // 中小法人の交際費 損金算入限度
const SUPPLIES_ASSET = 100_000; // 消耗品費 資産計上の検討
const SUPPLIES_STRONG = 300_000; // 少額減価償却資産特例(30万円未満)も超過

// 本来 不課税/非課税 が妥当な費用科目のキーワード
const NON_TAXABLE_EXPENSE_KW = [
  "給料",
  "給与",
  "役員報酬",
  "賞与",
  "退職",
  "法定福利",
  "租税公課",
  "法人税",
  "住民税",
  "事業税",
  "支払利息",
  "保険料",
  "減価償却",
];
// 通常 課税仕入 が付くべき費用科目のキーワード
const TAXABLE_EXPENSE_KW = [
  "消耗品費",
  "旅費交通費",
  "接待交際費",
  "交際費",
  "通信費",
  "水道光熱費",
  "会議費",
  "広告宣伝費",
  "外注費",
  "仕入",
  "修繕費",
  "新聞図書費",
];

const ruleLabels: Record<CheckRuleKey, string> = {
  officer_loan: "役員貸付金",
  entertainment: "交際費",
  supplies: "消耗品費",
  tax_category: "税区分",
};

function includesAny(name: string, kws: string[]): boolean {
  return kws.some((k) => name.includes(k));
}

interface LineLite {
  name: string;
  category: string; // assets|liabilities|equity|revenue|expenses
  debit: number;
  credit: number;
  taxCategory: string | null;
}

interface EntryLite {
  id: string;
  date: string;
  description: string;
  lines: LineLite[];
}

/**
 * 作成済み仕訳を走査して、税区分ミス・役員貸付金・交際費・消耗品費の
 * 異常値や注意点を検出する（ルールベースの異常検知）。
 */
export async function getJournalChecks(
  clientId: string,
  periodStart: string,
  periodEnd: string
): Promise<CheckResult> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("journal_entries")
    .select(
      `id, entry_date, description,
       journal_entry_lines (
         debit_amount, credit_amount, tax_category,
         accounts:account_id ( name, account_categories!inner ( type ) )
       )`
    )
    .eq("client_id", clientId)
    .gte("entry_date", periodStart)
    .lte("entry_date", periodEnd)
    .order("entry_date", { ascending: false });
  if (error) throw new Error(error.message);

  const entries: EntryLite[] = (data ?? []).map((e) => {
    const row = e as DbRow;
    const lines = ((row.journal_entry_lines ?? []) as DbRow[]).map((l) => {
      const acct = l.accounts as DbRow | null;
      const cat =
        (acct?.account_categories as { type: string } | null)?.type ?? "";
      return {
        name: (acct?.name as string) ?? "",
        category: cat,
        debit: (l.debit_amount as number) ?? 0,
        credit: (l.credit_amount as number) ?? 0,
        taxCategory: (l.tax_category as string) ?? null,
      };
    });
    return {
      id: row.id as string,
      date: row.entry_date as string,
      description: (row.description as string) ?? "",
      lines,
    };
  });

  const findings: CheckFinding[] = [];
  let entertainmentTotal = 0;

  for (const entry of entries) {
    for (let i = 0; i < entry.lines.length; i++) {
      const line = entry.lines[i];
      const amt = Math.max(line.debit, line.credit);
      const name = line.name;

      // --- 役員貸付金 ---
      if (line.debit > 0 && name.includes("貸付金")) {
        const isOfficer =
          name.includes("役員") || entry.description.includes("役員");
        findings.push({
          key: `${entry.id}:officer_loan:${i}`,
          ruleKey: "officer_loan",
          ruleLabel: ruleLabels.officer_loan,
          severity: isOfficer ? "high" : "warning",
          entryId: entry.id,
          date: entry.date,
          description: entry.description,
          accountName: name,
          amount: line.debit,
          message: isOfficer
            ? "役員貸付金が計上されています。認定利息（受取利息）の計上漏れ・貸付契約書の有無を確認してください。"
            : "貸付金が計上されています。役員・関係会社向けの場合は認定利息に注意してください。",
        });
      }

      // --- 交際費 ---
      if (line.debit > 0 && (name.includes("接待交際費") || name.includes("交際費"))) {
        entertainmentTotal += line.debit;
        if (line.debit >= ENTERTAINMENT_HIGH) {
          findings.push({
            key: `${entry.id}:entertainment:${i}`,
            ruleKey: "entertainment",
            ruleLabel: ruleLabels.entertainment,
            severity: "info",
            entryId: entry.id,
            date: entry.date,
            description: entry.description,
            accountName: name,
            amount: line.debit,
            message:
              "高額な交際費です。1人5,000円以下の飲食は会議費に区分できます。参加者・目的の記録を確認してください。",
          });
        }
      }

      // --- 消耗品費 ---
      if (line.debit > 0 && name.includes("消耗品費")) {
        if (line.debit >= SUPPLIES_STRONG) {
          findings.push({
            key: `${entry.id}:supplies:${i}`,
            ruleKey: "supplies",
            ruleLabel: ruleLabels.supplies,
            severity: "high",
            entryId: entry.id,
            date: entry.date,
            description: entry.description,
            accountName: name,
            amount: line.debit,
            message:
              "30万円以上の消耗品費です。原則として固定資産に計上し減価償却の対象です（少額減価償却資産特例[30万円未満]の範囲外）。",
          });
        } else if (line.debit >= SUPPLIES_ASSET) {
          findings.push({
            key: `${entry.id}:supplies:${i}`,
            ruleKey: "supplies",
            ruleLabel: ruleLabels.supplies,
            severity: "warning",
            entryId: entry.id,
            date: entry.date,
            description: entry.description,
            accountName: name,
            amount: line.debit,
            message:
              "10万円以上の消耗品費です。固定資産計上、または少額減価償却資産特例（30万円未満）の適用を検討してください。",
          });
        }
      }

      // --- 税区分ミス ---
      const tc = line.taxCategory ?? "";
      // 費用科目の判定
      if (line.category === "expenses" && line.debit > 0) {
        if (includesAny(name, NON_TAXABLE_EXPENSE_KW) && tc.startsWith("purchase_")) {
          findings.push({
            key: `${entry.id}:tax_category:${i}`,
            ruleKey: "tax_category",
            ruleLabel: ruleLabels.tax_category,
            severity: "warning",
            entryId: entry.id,
            date: entry.date,
            description: entry.description,
            accountName: name,
            amount: amt,
            message:
              "本来は不課税/非課税が妥当な科目に「課税仕入」区分が設定されています。税区分を確認してください。",
          });
        } else if (
          includesAny(name, TAXABLE_EXPENSE_KW) &&
          !includesAny(name, NON_TAXABLE_EXPENSE_KW) &&
          (tc === "" || tc === "sales_non")
        ) {
          findings.push({
            key: `${entry.id}:tax_category:${i}`,
            ruleKey: "tax_category",
            ruleLabel: ruleLabels.tax_category,
            severity: "info",
            entryId: entry.id,
            date: entry.date,
            description: entry.description,
            accountName: name,
            amount: amt,
            message:
              "課税仕入が想定される科目に税区分が未設定（または不課税）です。仕入税額控除の付け忘れに注意してください。",
          });
        } else if (tc.startsWith("sales_") && tc !== "sales_non") {
          findings.push({
            key: `${entry.id}:tax_category:${i}`,
            ruleKey: "tax_category",
            ruleLabel: ruleLabels.tax_category,
            severity: "warning",
            entryId: entry.id,
            date: entry.date,
            description: entry.description,
            accountName: name,
            amount: amt,
            message: "費用科目に「課税売上」区分が設定されています。区分の取り違えの可能性があります。",
          });
        }
      }
      // 収益科目に課税仕入が付いている
      if (line.category === "revenue" && line.credit > 0 && tc.startsWith("purchase_")) {
        findings.push({
          key: `${entry.id}:tax_category:${i}`,
          ruleKey: "tax_category",
          ruleLabel: ruleLabels.tax_category,
          severity: "warning",
          entryId: entry.id,
          date: entry.date,
          description: entry.description,
          accountName: name,
          amount: amt,
          message: "収益科目に「課税仕入」区分が設定されています。区分の取り違えの可能性があります。",
        });
      }
    }
  }

  // --- 交際費 年間損金算入限度（集計系） ---
  if (entertainmentTotal > ENTERTAINMENT_ANNUAL_CAP) {
    findings.push({
      key: "aggregate:entertainment_cap",
      ruleKey: "entertainment",
      ruleLabel: ruleLabels.entertainment,
      severity: "warning",
      entryId: null,
      date: null,
      description: "期間内の交際費合計",
      accountName: "接待交際費",
      amount: entertainmentTotal,
      message: `交際費の合計が中小法人の損金算入限度（800万円/年）を超えています。限度超過額は損金不算入となる可能性があります。`,
    });
  }

  // 重大度順 → 日付順に並べ替え
  const sevRank: Record<CheckSeverity, number> = { high: 0, warning: 1, info: 2 };
  findings.sort((a, b) => {
    if (sevRank[a.severity] !== sevRank[b.severity])
      return sevRank[a.severity] - sevRank[b.severity];
    return (b.date ?? "").localeCompare(a.date ?? "");
  });

  const counts = {
    high: findings.filter((f) => f.severity === "high").length,
    warning: findings.filter((f) => f.severity === "warning").length,
    info: findings.filter((f) => f.severity === "info").length,
    total: findings.length,
  };

  return {
    findings,
    counts,
    scanned: entries.length,
    periodStart,
    periodEnd,
  };
}
