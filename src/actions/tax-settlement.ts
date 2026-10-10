"use server";

/**
 * 決算の税金の仕訳（法人税等・消費税）の作成と取り消し。仕訳の内容は src/lib/tax-settlement.ts（テストあり）。
 * 期末日付の確定済みの仕訳を1本作る。同じ期に2本は作らない（摘要で見分ける）。
 */

import { createServerSupabaseClient } from "@/lib/supabase";
import { assertClientAccess } from "@/lib/authz";
import { corporateTaxEntry, consumptionTaxEntry, type SettlementEntry } from "@/lib/tax-settlement";
import { getTrialBalance } from "@/actions/statements";
import { getCorporateTaxReturn } from "@/actions/corporate-tax-return";
import { getConsumptionTaxReturn } from "@/actions/consumption-tax-return";
import { deleteJournalEntries } from "@/actions/journals";

type Db = Awaited<ReturnType<typeof createServerSupabaseClient>>;
export type SettlementKind = "corporate" | "consumption";

const DESCRIPTION: Record<SettlementKind, (p: { startDate: string; endDate: string }) => string> = {
  corporate: (p) => `法人税等の計上（${p.startDate}〜${p.endDate}）`,
  consumption: (p) => `消費税等の計上（${p.startDate}〜${p.endDate}）`,
};

export type SettlementStatus = {
  kind: SettlementKind;
  /** 作る予定の仕訳（作れないときは理由） */
  preview: SettlementEntry;
  /** 作成済みの仕訳 */
  posted: { entryId: string; date: string } | null;
};

async function findPosted(db: Db, clientId: string, kind: SettlementKind, p: { startDate: string; endDate: string }) {
  const { data } = await db
    .from("journal_entries")
    .select("id, entry_date")
    .eq("client_id", clientId)
    .eq("entry_date", p.endDate)
    .eq("description", DESCRIPTION[kind](p))
    .limit(1);
  const e = (data ?? [])[0];
  return e ? { entryId: e.id as string, date: e.entry_date as string } : null;
}

/** 期末の残高（借方をプラス）。その名前の科目が無ければ 0 */
async function balances(clientId: string, p: { startDate: string; endDate: string }) {
  const tb = await getTrialBalance(clientId, p.startDate, p.endDate);
  return (name: string) => tb.filter((r) => r.name === name).reduce((s, r) => s + r.currentBalance, 0);
}

async function build(clientId: string, kind: SettlementKind, periodKey?: string) {
  if (kind === "corporate") {
    const v = await getCorporateTaxReturn(clientId, periodKey);
    const bal = await balances(clientId, v.period);
    const interim = Object.values(v.inputs.interim).reduce((s, x) => s + x, 0);
    // 計上済みなら仮払法人税等はもう消えているので、作成前の状態でだけ意味がある
    return { period: v.period, entry: corporateTaxEntry(v.result.totalTaxForPeriod, interim, bal("仮払法人税等")) };
  }
  const v = await getConsumptionTaxReturn(clientId, periodKey);
  const bal = await balances(clientId, v.period);
  if (v.taxExempt) return { period: v.period, entry: { error: "免税事業者のため、消費税の計上はありません" } as SettlementEntry };
  return {
    period: v.period,
    entry: consumptionTaxEntry(v.result.annualTax, -bal("仮受消費税"), bal("仮払消費税")),
  };
}

export async function getSettlementStatus(clientId: string, kind: SettlementKind, periodKey?: string): Promise<SettlementStatus> {
  await assertClientAccess(clientId);
  const db = await createServerSupabaseClient();
  const { period, entry } = await build(clientId, kind, periodKey);
  const posted = await findPosted(db, clientId, kind, period);
  return { kind, preview: posted ? { error: "作成済みです" } : entry, posted };
}

export async function postSettlement(clientId: string, kind: SettlementKind, periodKey: string): Promise<void> {
  await assertClientAccess(clientId);
  const db = await createServerSupabaseClient();
  const { period, entry } = await build(clientId, kind, periodKey);
  if (await findPosted(db, clientId, kind, period)) throw new Error("この期の仕訳は作成済みです");
  if ("error" in entry) throw new Error(entry.error);

  const { data: locked } = await db
    .from("fiscal_years")
    .select("id")
    .eq("client_id", clientId)
    .eq("status", "locked")
    .lte("start_date", period.endDate)
    .gte("end_date", period.endDate)
    .limit(1);
  if (locked && locked.length) throw new Error("ロック済みの会計年度には仕訳を作れません");

  // 科目名 → ID（顧問先の科目を共有の基本科目より優先）
  const names = [...new Set(entry.lines.map((l) => l.account))];
  const { data: accts } = await db
    .from("accounts")
    .select("id, name, client_id, account_categories!inner ( type )")
    .or(`client_id.eq.${clientId},client_id.is.null`)
    .eq("is_active", true)
    .in("name", names);
  type A = { id: string; name: string; client_id: string | null; account_categories: { type: string } };
  const list = ((accts ?? []) as unknown as A[]).sort((a, b) => (a.client_id ? 0 : 1) - (b.client_id ? 0 : 1));
  const accountOf = (name: string) => list.find((a) => a.name === name);
  const missing = names.filter((n) => !accountOf(n));
  if (missing.length) throw new Error(`勘定科目（${missing.join("・")}）が見つかりません。勘定科目管理で有効にしてください`);

  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) throw new Error("ログインが必要です");
  const { data: je, error } = await db
    .from("journal_entries")
    .insert({
      client_id: clientId,
      entry_date: period.endDate,
      description: DESCRIPTION[kind](period),
      status: "confirmed",
      source: "manual",
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !je) throw new Error(error?.message ?? "仕訳の作成に失敗しました");
  const { error: lErr } = await db.from("journal_entry_lines").insert(
    entry.lines.map((l, i) => {
      const a = accountOf(l.account)!;
      const pl = a.account_categories.type === "expenses" || a.account_categories.type === "revenue";
      return {
        journal_entry_id: je.id,
        account_id: a.id,
        debit_amount: l.debit,
        credit_amount: l.credit,
        // 税金・端数の調整は消費税の対象外
        tax_category: pl ? (a.account_categories.type === "revenue" ? "sales_out_of_scope" : "purchase_out_of_scope") : null,
        sort_order: i,
      };
    })
  );
  if (lErr) {
    await db.from("journal_entries").delete().eq("id", je.id);
    throw new Error(lErr.message);
  }
}

export async function cancelSettlement(clientId: string, kind: SettlementKind, periodKey: string): Promise<void> {
  await assertClientAccess(clientId);
  const db = await createServerSupabaseClient();
  const { period } = await build(clientId, kind, periodKey);
  const posted = await findPosted(db, clientId, kind, period);
  if (posted) await deleteJournalEntries([posted.entryId]);
}
