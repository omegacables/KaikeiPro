"use server";

/**
 * 相手先（補助科目）が付いていない売掛金・買掛金の行を一覧にし、人が確かめた取引先をまとめて付ける。
 *
 * 請求書・入金消込・Raqto連携から作った仕訳は自動で付く（src/lib/partner-sub-accounts.ts）。
 * それ以外（手入力・取込の仕訳など）は相手先を決める記録が無いので、摘要に書かれた取引先名を
 * 候補として出し、画面で確かめてから付ける。締めた（locked）年度の仕訳は変えない。
 */

import { createServerSupabaseClient } from "@/lib/supabase";
import { assertClientAccess } from "@/lib/authz";
import {
  PARTNER_SUB_ACCOUNT_NAMES,
  partnerSubAccountId,
  suggestPartnerFromDescription,
} from "@/lib/partner-sub-accounts";

export type UnassignedPartnerLine = {
  id: string;
  entryId: string;
  date: string;
  description: string;
  debit: number;
  credit: number;
  /** 締めた年度の仕訳（変えられない） */
  locked: boolean;
  suggestedPartnerId: string | null;
};

export type UnassignedPartnerLines = {
  lines: UnassignedPartnerLine[];
  partners: { id: string; name: string }[];
};

async function partnerAccountId(db: Awaited<ReturnType<typeof createServerSupabaseClient>>, clientId: string, accountName: string) {
  if (!PARTNER_SUB_ACCOUNT_NAMES.includes(accountName)) throw new Error("対象の科目ではありません");
  const { data } = await db
    .from("accounts")
    .select("id, client_id")
    .or(`client_id.eq.${clientId},client_id.is.null`)
    .eq("name", accountName);
  // 顧問先の科目を優先
  const rows = (data ?? []) as { id: string; client_id: string | null }[];
  return (rows.find((r) => r.client_id === clientId) ?? rows[0])?.id ?? null;
}

export async function getUnassignedPartnerLines(clientId: string, accountName: string): Promise<UnassignedPartnerLines> {
  await assertClientAccess(clientId);
  const db = await createServerSupabaseClient();
  const accountId = await partnerAccountId(db, clientId, accountName);
  if (!accountId) return { lines: [], partners: [] };

  type Row = {
    id: string;
    journal_entry_id: string;
    debit_amount: number;
    credit_amount: number;
    journal_entries: { entry_date: string; description: string | null };
  };
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("journal_entry_lines")
      .select("id, journal_entry_id, debit_amount, credit_amount, journal_entries!inner ( client_id, entry_date, description )")
      .eq("journal_entries.client_id", clientId)
      .eq("account_id", accountId)
      .is("sub_account_id", null)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as unknown as Row[]));
    if (!data || data.length < 1000) break;
  }

  const [{ data: partners }, { data: lockedYears }] = await Promise.all([
    db.from("business_partners").select("id, name, aliases").eq("client_id", clientId).order("name"),
    db.from("fiscal_years").select("start_date, end_date").eq("client_id", clientId).eq("status", "locked"),
  ]);
  const plist = (partners ?? []) as { id: string; name: string; aliases: string[] | null }[];
  const isLocked = (d: string) => (lockedYears ?? []).some((y) => d >= y.start_date && d <= y.end_date);

  const lines = rows
    .map((r) => ({
      id: r.id,
      entryId: r.journal_entry_id,
      date: r.journal_entries.entry_date,
      description: r.journal_entries.description ?? "",
      debit: Number(r.debit_amount),
      credit: Number(r.credit_amount),
      locked: isLocked(r.journal_entries.entry_date),
      suggestedPartnerId: suggestPartnerFromDescription(r.journal_entries.description, plist)?.id ?? null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.description.localeCompare(b.description));
  return { lines, partners: plist.map((p) => ({ id: p.id, name: p.name })) };
}

/** 選んだ行に取引先の補助科目を付ける（無ければ作る）。付けた行数を返す */
export async function assignPartnerToLines(
  clientId: string,
  accountName: string,
  assignments: { lineId: string; partnerId: string }[]
): Promise<{ assigned: number; skipped: number }> {
  await assertClientAccess(clientId);
  const db = await createServerSupabaseClient();
  const accountId = await partnerAccountId(db, clientId, accountName);
  if (!accountId || assignments.length === 0) return { assigned: 0, skipped: assignments.length };

  // 行がこの顧問先・この科目の、まだ補助科目の無い行かを確かめる
  const lineIds = [...new Set(assignments.map((a) => a.lineId))];
  const valid = new Map<string, string>(); // lineId → entry_date
  for (let i = 0; i < lineIds.length; i += 100) {
    const { data, error } = await db
      .from("journal_entry_lines")
      .select("id, journal_entries!inner ( client_id, entry_date )")
      .eq("journal_entries.client_id", clientId)
      .eq("account_id", accountId)
      .is("sub_account_id", null)
      .in("id", lineIds.slice(i, i + 100));
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as unknown as { id: string; journal_entries: { entry_date: string } }[])
      valid.set(r.id, r.journal_entries.entry_date);
  }
  const { data: lockedYears } = await db
    .from("fiscal_years")
    .select("start_date, end_date")
    .eq("client_id", clientId)
    .eq("status", "locked");
  const isLocked = (d: string) => (lockedYears ?? []).some((y) => d >= y.start_date && d <= y.end_date);

  const partnerIds = [...new Set(assignments.map((a) => a.partnerId))];
  const { data: partners } = await db
    .from("business_partners")
    .select("id, name")
    .eq("client_id", clientId)
    .in("id", partnerIds);
  const partnerById = new Map(((partners ?? []) as { id: string; name: string }[]).map((p) => [p.id, p]));

  // 取引先ごとにまとめて更新する
  const groups = new Map<string, string[]>();
  let skipped = 0;
  for (const a of assignments) {
    const date = valid.get(a.lineId);
    if (!date || isLocked(date) || !partnerById.has(a.partnerId)) {
      skipped++;
      continue;
    }
    groups.set(a.partnerId, [...(groups.get(a.partnerId) ?? []), a.lineId]);
  }
  let assigned = 0;
  for (const [partnerId, ids] of groups) {
    const subId = await partnerSubAccountId(db, clientId, accountId, partnerById.get(partnerId)!);
    if (!subId) {
      skipped += ids.length;
      continue;
    }
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const { error } = await db.from("journal_entry_lines").update({ sub_account_id: subId }).in("id", chunk);
      if (error) throw new Error(error.message);
      assigned += chunk.length;
    }
  }
  return { assigned, skipped };
}
