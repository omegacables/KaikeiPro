"use server";

import { createAdminSupabaseClient } from "@/lib/supabase";
import { getDepreciationSummary } from "@/actions/closing";

type DbRow = Record<string, unknown>;

export type ChecklistStatus = "ok" | "warning" | "todo" | "info";

export interface ChecklistItem {
  key: string;
  label: string;
  status: ChecklistStatus;
  detail: string;
  amount: number | null;
}

export interface ClosingChecklist {
  items: ChecklistItem[];
  periodStart: string;
  periodEnd: string;
}

const INVENTORY_KW = ["商品", "製品", "仕掛品", "原材料", "貯蔵品", "半製品"];

interface LineLite {
  date: string;
  description: string;
  source: string;
  name: string;
  debit: number;
  credit: number;
}

/**
 * 決算前チェックリストを自動生成する。
 * 未払費用・減価償却・棚卸・役員借入金・期首残高の計上状況を自動判定する。
 */
export async function getClosingChecklist(
  clientId: string,
  periodStart: string,
  periodEnd: string
): Promise<ClosingChecklist> {
  const admin = createAdminSupabaseClient();

  // 当期の仕訳明細をまとめて取得
  const { data, error } = await admin
    .from("journal_entries")
    .select(
      `entry_date, description, source,
       journal_entry_lines ( debit_amount, credit_amount, accounts:account_id ( name ) )`
    )
    .eq("client_id", clientId)
    .gte("entry_date", periodStart)
    .lte("entry_date", periodEnd);
  if (error) throw new Error(error.message);

  const lines: LineLite[] = [];
  for (const e of data ?? []) {
    const row = e as DbRow;
    for (const l of (row.journal_entry_lines ?? []) as DbRow[]) {
      const acct = l.accounts as DbRow | null;
      lines.push({
        date: row.entry_date as string,
        description: (row.description as string) ?? "",
        source: (row.source as string) ?? "manual",
        name: (acct?.name as string) ?? "",
        debit: (l.debit_amount as number) ?? 0,
        credit: (l.credit_amount as number) ?? 0,
      });
    }
  }

  const items: ChecklistItem[] = [];

  // --- 1. 未払費用 ---
  const accrued = lines.filter((l) => l.name.includes("未払費用") && l.credit > 0);
  const accruedTotal = accrued.reduce((s, l) => s + l.credit, 0);
  items.push(
    accrued.length > 0
      ? {
          key: "accrued",
          label: "未払費用の計上",
          status: "ok",
          detail: `未払費用 ${accrued.length} 件・計 ${accruedTotal.toLocaleString()} 円が計上されています。`,
          amount: accruedTotal,
        }
      : {
          key: "accrued",
          label: "未払費用の計上",
          status: "todo",
          detail: "未払費用の計上が見当たりません。当期分の費用で未払のもの（給与・社会保険料・利息等）を確認してください。",
          amount: null,
        }
  );

  // --- 2. 減価償却 ---
  const dep = await getDepreciationSummary(clientId, periodEnd);
  const depPosted = lines
    .filter((l) => l.name.includes("減価償却費") && l.debit > 0)
    .reduce((s, l) => s + l.debit, 0);
  if (dep.totalAssets === 0) {
    items.push({
      key: "depreciation",
      label: "減価償却",
      status: "info",
      detail: "固定資産の登録がありません。該当資産がある場合は固定資産台帳に登録してください。",
      amount: null,
    });
  } else if (depPosted === 0) {
    items.push({
      key: "depreciation",
      label: "減価償却",
      status: "todo",
      detail: `減価償却費が未計上です（固定資産 ${dep.totalAssets} 件・概算償却費 ${dep.totalDepreciation.toLocaleString()} 円）。`,
      amount: dep.totalDepreciation,
    });
  } else {
    // 概算との乖離が10%超なら注意
    const diff = Math.abs(depPosted - dep.totalDepreciation);
    const ratio = dep.totalDepreciation > 0 ? diff / dep.totalDepreciation : 0;
    items.push(
      ratio > 0.1
        ? {
            key: "depreciation",
            label: "減価償却",
            status: "warning",
            detail: `計上額 ${depPosted.toLocaleString()} 円が概算償却費 ${dep.totalDepreciation.toLocaleString()} 円と乖離しています。計算根拠を確認してください。`,
            amount: depPosted,
          }
        : {
            key: "depreciation",
            label: "減価償却",
            status: "ok",
            detail: `減価償却費 ${depPosted.toLocaleString()} 円が計上されています（概算 ${dep.totalDepreciation.toLocaleString()} 円）。`,
            amount: depPosted,
          }
    );
  }

  // --- 3. 棚卸 ---
  const inventoryLines = lines.filter((l) => INVENTORY_KW.some((k) => l.name.includes(k)));
  const inventoryClosing = inventoryLines.filter(
    (l) => l.description.includes("棚卸") || l.date === periodEnd
  );
  if (inventoryLines.length === 0) {
    items.push({
      key: "inventory",
      label: "期末棚卸",
      status: "info",
      detail: "棚卸資産（商品・製品等）の動きがありません。該当する場合は期末棚卸高を計上してください。",
      amount: null,
    });
  } else if (inventoryClosing.length === 0) {
    items.push({
      key: "inventory",
      label: "期末棚卸",
      status: "todo",
      detail: "棚卸資産はありますが、期末棚卸高の計上（決算整理）が見当たりません。実地棚卸の結果を計上してください。",
      amount: null,
    });
  } else {
    items.push({
      key: "inventory",
      label: "期末棚卸",
      status: "ok",
      detail: `期末棚卸に関する仕訳が ${inventoryClosing.length} 件あります。実地棚卸との一致を確認してください。`,
      amount: null,
    });
  }

  // --- 4. 役員借入金 ---
  const { data: officerLoans } = await admin
    .from("loans")
    .select("current_balance, status")
    .eq("client_id", clientId)
    .eq("loan_type", "officer");
  const officerActive = (officerLoans ?? []).filter(
    (l) => (l as DbRow).status === "active"
  );
  const officerBalance = officerActive.reduce(
    (s, l) => s + (((l as DbRow).current_balance as number) ?? 0),
    0
  );
  // 仕訳側の役員借入金残高（貸方 - 借方）
  const officerJournalBalance = lines
    .filter((l) => l.name.includes("役員借入金") || l.name.includes("役員からの借入"))
    .reduce((s, l) => s + l.credit - l.debit, 0);

  if (officerActive.length > 0) {
    items.push({
      key: "officer_loan",
      label: "役員借入金",
      status: "info",
      detail: `役員借入金 ${officerActive.length} 件・残高 ${officerBalance.toLocaleString()} 円。期末残高の確認、債務免除益の有無、利息の要否を確認してください。`,
      amount: officerBalance,
    });
  } else if (officerJournalBalance > 0) {
    items.push({
      key: "officer_loan",
      label: "役員借入金",
      status: "warning",
      detail: `仕訳上の役員借入金残高が ${officerJournalBalance.toLocaleString()} 円あります。借入金台帳での管理を検討してください。`,
      amount: officerJournalBalance,
    });
  } else {
    items.push({
      key: "officer_loan",
      label: "役員借入金",
      status: "ok",
      detail: "役員借入金はありません。",
      amount: null,
    });
  }

  // --- 5. 期首残高（前期繰越） ---
  const openingExists = (data ?? []).some((e) => {
    const row = e as DbRow;
    return (
      row.source === "closing" &&
      (row.entry_date as string) === periodStart &&
      ((row.description as string) ?? "").includes("期首残高")
    );
  });
  // 当期に仕訳があるのに期首残高が無い場合のみ注意（初年度・期中開始は除外しきれないため info）
  items.push(
    openingExists
      ? {
          key: "opening",
          label: "期首残高（前期繰越）",
          status: "ok",
          detail: "期首残高（前期繰越）が登録されています。",
          amount: null,
        }
      : {
          key: "opening",
          label: "期首残高（前期繰越）",
          status: "info",
          detail: "期首残高（前期繰越）の登録が見当たりません。前期からの繰越がある場合は「期首残高設定」で登録してください。",
          amount: null,
        }
  );

  return { items, periodStart, periodEnd };
}
