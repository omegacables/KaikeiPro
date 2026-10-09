/**
 * 売掛金・買掛金の仕訳の行に、相手先（取引先マスタ）の補助科目を付ける。
 *
 * 売掛帳・買掛帳を相手先ごとに見るには、売上・仕入の計上（発生）と入金・支払（回収）の
 * 両方の行に同じ補助科目が付いている必要がある。仕訳の相手先は次の順で判断する。
 *   1. その仕訳から作った請求書の取引先（invoices.journal_entry_id）
 *   2. 仕訳に記録された取引先名（metadata.partner_name。Raqto連携の発注など）
 *   3. 入金消込で作った仕訳の摘要「入金消込: 取引先名」
 * 判断できない行は触らない（推測で別の相手先に付けると残高が狂うため）。
 * 締めた会計年度の仕訳は変更できないので飛ばす。
 *
 * サーバー処理からだけ呼ぶ（呼び出し側で顧問先へのアクセス権を確かめておくこと）。
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** 相手先ごとに管理する科目 */
export const PARTNER_SUB_ACCOUNT_NAMES = ["売掛金", "買掛金"];

const PAYMENT_PREFIX = /^入金消込[:：]\s*/;

export type PartnerRef = { id: string; name: string };

/** 取引先の名前・別名から取引先を引く（全角半角・前後の空白の違いは無視） */
export function partnerByNameIndex(partners: { id: string; name: string; aliases?: string[] | null }[]) {
  const norm = (v: string) => v.normalize("NFKC").replace(/\s+/g, "");
  const map = new Map<string, PartnerRef>();
  for (const p of partners) {
    for (const n of [p.name, ...(p.aliases ?? [])]) {
      if (n?.trim() && !map.has(norm(n))) map.set(norm(n), { id: p.id, name: p.name });
    }
  }
  return (name: string | null | undefined) => (name?.trim() ? map.get(norm(name)) ?? null : null);
}

/** 入金消込の仕訳の摘要から取引先名を取り出す */
export function partnerNameFromPaymentDescription(description: string | null | undefined): string | null {
  if (!description || !PAYMENT_PREFIX.test(description)) return null;
  return description.replace(PAYMENT_PREFIX, "").trim() || null;
}

/**
 * 科目×取引先の補助科目を返す。無ければ作る。
 * 取引先にひも付いたもの → 同じ名前のもの（取引先にひも付ける）→ 新規作成 の順。
 */
export async function partnerSubAccountId(
  db: SupabaseClient,
  clientId: string,
  accountId: string,
  partner: PartnerRef
): Promise<string | null> {
  const { data: linked } = await db
    .from("sub_accounts")
    .select("id")
    .eq("client_id", clientId)
    .eq("account_id", accountId)
    .eq("partner_id", partner.id)
    .limit(1);
  if (linked?.length) return linked[0].id as string;

  const { data: named } = await db
    .from("sub_accounts")
    .select("id, partner_id")
    .eq("client_id", clientId)
    .eq("account_id", accountId)
    .eq("name", partner.name)
    .limit(1);
  if (named?.length) {
    if (!named[0].partner_id) {
      await db.from("sub_accounts").update({ partner_id: partner.id, is_active: true }).eq("id", named[0].id);
    }
    return named[0].id as string;
  }

  const { data: created, error } = await db
    .from("sub_accounts")
    .insert({ client_id: clientId, account_id: accountId, name: partner.name, partner_id: partner.id })
    .select("id")
    .single();
  if (error) return null;
  return created.id as string;
}

export type AssignResult = { assigned: number; skippedLocked: number; unknown: number };

/**
 * 売掛金・買掛金の行で補助科目が空のものに、相手先の補助科目を付ける。
 * entryIds を渡せばその仕訳だけ、省けば顧問先の全仕訳が対象。
 * dryRun なら書き込まずに件数だけ数える。
 */
export async function assignPartnerSubAccounts(
  db: SupabaseClient,
  clientId: string,
  opts: { entryIds?: string[]; dryRun?: boolean } = {}
): Promise<AssignResult> {
  const result: AssignResult = { assigned: 0, skippedLocked: 0, unknown: 0 };
  const { data: accounts } = await db
    .from("accounts")
    .select("id, name")
    .or(`client_id.eq.${clientId},client_id.is.null`)
    .in("name", PARTNER_SUB_ACCOUNT_NAMES);
  const accountIds = (accounts ?? []).map((a) => a.id as string);
  if (!accountIds.length) return result;

  type Line = {
    id: string;
    account_id: string;
    journal_entry_id: string;
    journal_entries: {
      entry_date: string;
      description: string | null;
      metadata: { partner_name?: string } | null;
    };
  };
  const lines: Line[] = [];
  for (let from = 0; ; from += 1000) {
    let q = db
      .from("journal_entry_lines")
      .select("id, account_id, journal_entry_id, journal_entries!inner ( client_id, entry_date, description, metadata )")
      .eq("journal_entries.client_id", clientId)
      .in("account_id", accountIds)
      .is("sub_account_id", null);
    if (opts.entryIds) q = q.in("journal_entry_id", opts.entryIds.length ? opts.entryIds : ["00000000-0000-0000-0000-000000000000"]);
    const { data, error } = await q.range(from, from + 999);
    if (error) throw new Error(error.message);
    lines.push(...((data ?? []) as unknown as Line[]));
    if (!data || data.length < 1000) break;
  }
  if (!lines.length) return result;

  // 相手先の手がかり
  const entryIds = [...new Set(lines.map((l) => l.journal_entry_id))];
  const invoicePartner = new Map<string, string>();
  for (let i = 0; i < entryIds.length; i += 100) {
    const { data } = await db
      .from("invoices")
      .select("journal_entry_id, business_partner_id")
      .eq("client_id", clientId)
      .in("journal_entry_id", entryIds.slice(i, i + 100));
    for (const r of data ?? []) {
      if (r.business_partner_id) invoicePartner.set(r.journal_entry_id as string, r.business_partner_id as string);
    }
  }
  const { data: partners } = await db.from("business_partners").select("id, name, aliases").eq("client_id", clientId);
  const partnerById = new Map((partners ?? []).map((p) => [p.id as string, { id: p.id as string, name: p.name as string }]));
  const byName = partnerByNameIndex((partners ?? []) as { id: string; name: string; aliases: string[] | null }[]);

  const { data: lockedYears } = await db
    .from("fiscal_years")
    .select("start_date, end_date")
    .eq("client_id", clientId)
    .eq("status", "locked");
  const isLocked = (d: string) => (lockedYears ?? []).some((y) => d >= y.start_date && d <= y.end_date);

  // 科目×取引先ごとに行をまとめて、補助科目ごとに一度で更新する
  const groups = new Map<string, { accountId: string; partner: PartnerRef; lineIds: string[] }>();
  for (const l of lines) {
    const fromInvoice = invoicePartner.get(l.journal_entry_id);
    const partner =
      (fromInvoice ? partnerById.get(fromInvoice) ?? null : null) ??
      byName(l.journal_entries.metadata?.partner_name) ??
      byName(partnerNameFromPaymentDescription(l.journal_entries.description));
    if (!partner) {
      result.unknown++;
      continue;
    }
    if (isLocked(l.journal_entries.entry_date)) {
      result.skippedLocked++;
      continue;
    }
    const key = `${l.account_id}\u0000${partner.id}`;
    const g = groups.get(key) ?? { accountId: l.account_id, partner, lineIds: [] };
    g.lineIds.push(l.id);
    groups.set(key, g);
  }

  for (const g of groups.values()) {
    if (opts.dryRun) {
      result.assigned += g.lineIds.length;
      continue;
    }
    const subId = await partnerSubAccountId(db, clientId, g.accountId, g.partner);
    if (!subId) continue;
    for (let i = 0; i < g.lineIds.length; i += 100) {
      const ids = g.lineIds.slice(i, i + 100);
      const { error } = await db.from("journal_entry_lines").update({ sub_account_id: subId }).in("id", ids);
      if (!error) result.assigned += ids.length;
    }
  }
  return result;
}
