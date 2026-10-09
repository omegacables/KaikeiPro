"use server";

/**
 * 補助科目（勘定科目の内訳。売掛金なら得意先、普通預金なら口座、水道光熱費なら電気・ガスなど）。
 *
 * 基本科目は全顧問先で共有しているため、補助科目は顧問先ごとに持つ（sub_accounts.client_id）。
 * 売掛金・買掛金などは取引先マスタとひも付けて（partner_id）、相手先ごとの残高を出せるようにする。
 */

import { createServerSupabaseClient } from "@/lib/supabase";
import { assertClientAccess, resolveClientIdForRecord } from "@/lib/authz";

export type SubAccount = {
  id: string;
  accountId: string;
  name: string;
  partnerId: string | null;
  isActive: boolean;
};

type Row = { id: string; account_id: string; name: string; partner_id: string | null; is_active: boolean };
const toSub = (r: Row): SubAccount => ({
  id: r.id,
  accountId: r.account_id,
  name: r.name,
  partnerId: r.partner_id,
  isActive: r.is_active,
});

/** 科目がこの顧問先で使えるもの（顧問先の科目か共有の基本科目）か確かめる */
async function assertAccountUsable(clientId: string, accountId: string) {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.from("accounts").select("id, client_id").eq("id", accountId).maybeSingle();
  if (!data || (data.client_id != null && data.client_id !== clientId)) {
    throw new Error("この顧問先の勘定科目ではありません");
  }
}

/** 顧問先の補助科目（科目を指定すればその科目の分だけ） */
export async function getSubAccounts(
  clientId: string,
  opts: { accountId?: string; includeInactive?: boolean } = {}
): Promise<SubAccount[]> {
  await assertClientAccess(clientId);
  const supabase = await createServerSupabaseClient();
  let q = supabase
    .from("sub_accounts")
    .select("id, account_id, name, partner_id, is_active")
    .eq("client_id", clientId);
  if (opts.accountId) q = q.eq("account_id", opts.accountId);
  if (!opts.includeInactive) q = q.eq("is_active", true);
  const { data, error } = await q.order("name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => toSub(r as Row));
}

/**
 * 補助科目を作る。同じ科目に同じ名前があれば、それを返す（無効なら有効に戻す）。
 * 仕訳入力で新しい名前を打ったときにも使う。
 */
export async function createSubAccount(
  clientId: string,
  accountId: string,
  name: string,
  partnerId: string | null = null
): Promise<SubAccount> {
  await assertClientAccess(clientId);
  await assertAccountUsable(clientId, accountId);
  const trimmed = name.trim();
  if (!trimmed) throw new Error("補助科目の名前を入力してください");
  const supabase = await createServerSupabaseClient();

  const { data: existing } = await supabase
    .from("sub_accounts")
    .select("id, account_id, name, partner_id, is_active")
    .eq("client_id", clientId)
    .eq("account_id", accountId)
    .eq("name", trimmed)
    .maybeSingle();
  if (existing) {
    const r = existing as Row;
    if (!r.is_active || (partnerId && !r.partner_id)) {
      const { data, error } = await supabase
        .from("sub_accounts")
        .update({ is_active: true, partner_id: r.partner_id ?? partnerId })
        .eq("id", r.id)
        .select("id, account_id, name, partner_id, is_active")
        .single();
      if (error) throw new Error(error.message);
      return toSub(data as Row);
    }
    return toSub(r);
  }

  if (partnerId) await assertPartnerOfClient(clientId, partnerId);
  const { data, error } = await supabase
    .from("sub_accounts")
    .insert({ client_id: clientId, account_id: accountId, name: trimmed, partner_id: partnerId })
    .select("id, account_id, name, partner_id, is_active")
    .single();
  if (error) throw new Error(error.message);
  return toSub(data as Row);
}

async function assertPartnerOfClient(clientId: string, partnerId: string) {
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase
    .from("business_partners")
    .select("id")
    .eq("id", partnerId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (!data) throw new Error("この顧問先の取引先ではありません");
}

/** 名前の変更・有効/無効の切り替え・取引先とのひも付け */
export async function updateSubAccount(
  id: string,
  input: { name?: string; isActive?: boolean; partnerId?: string | null }
): Promise<SubAccount> {
  const clientId = await resolveClientIdForRecord("sub_accounts", id);
  const supabase = await createServerSupabaseClient();
  const patch: { name?: string; is_active?: boolean; partner_id?: string | null } = {};
  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    if (!trimmed) throw new Error("補助科目の名前を入力してください");
    patch.name = trimmed;
  }
  if (input.isActive !== undefined) patch.is_active = input.isActive;
  if (input.partnerId !== undefined) {
    if (input.partnerId) await assertPartnerOfClient(clientId, input.partnerId);
    patch.partner_id = input.partnerId;
  }
  const { data, error } = await supabase
    .from("sub_accounts")
    .update(patch)
    .eq("id", id)
    .select("id, account_id, name, partner_id, is_active")
    .single();
  if (error) {
    if (error.code === "23505") throw new Error("同じ名前の補助科目がすでにあります");
    throw new Error(error.message);
  }
  return toSub(data as Row);
}

/**
 * 取引先マスタの全取引先を、指定した科目の補助科目として作る（売掛金・買掛金など）。
 * すでにある名前は作らない。作った件数を返す。
 */
export async function createSubAccountsFromPartners(
  clientId: string,
  accountId: string
): Promise<{ created: number; total: number }> {
  await assertClientAccess(clientId);
  await assertAccountUsable(clientId, accountId);
  const supabase = await createServerSupabaseClient();
  const [{ data: partners, error: pErr }, { data: subs }] = await Promise.all([
    supabase.from("business_partners").select("id, name").eq("client_id", clientId),
    supabase.from("sub_accounts").select("name, partner_id").eq("client_id", clientId).eq("account_id", accountId),
  ]);
  if (pErr) throw new Error(pErr.message);
  const names = new Set((subs ?? []).map((s) => s.name));
  const linked = new Set((subs ?? []).map((s) => s.partner_id).filter(Boolean));
  const rows: { client_id: string; account_id: string; name: string; partner_id: string }[] = [];
  for (const p of partners ?? []) {
    const name = p.name?.trim();
    if (!name || names.has(name) || linked.has(p.id)) continue;
    names.add(name); // 取引先マスタに同名が2件あっても1つだけ作る
    rows.push({ client_id: clientId, account_id: accountId, name, partner_id: p.id });
  }
  if (rows.length) {
    const { error } = await supabase.from("sub_accounts").insert(rows);
    if (error) throw new Error(error.message);
  }
  return { created: rows.length, total: (partners ?? []).length };
}

/**
 * 仕訳を保存する前に、行に手入力された補助科目名を補助科目IDにする。
 * 無い名前はその科目の補助科目として作る（手入力した名前が次から候補に出る）。
 * 戻り値は渡した順と同じ並びのID（名前が空なら null）。
 */
export async function ensureSubAccounts(
  clientId: string,
  items: { accountId: string; name: string }[]
): Promise<(string | null)[]> {
  await assertClientAccess(clientId);
  const cache = new Map<string, string>();
  const ids: (string | null)[] = [];
  for (const it of items) {
    const name = it.name.trim();
    if (!name || !it.accountId) {
      ids.push(null);
      continue;
    }
    const key = `${it.accountId}\u0000${name}`;
    let id = cache.get(key);
    if (!id) {
      id = (await createSubAccount(clientId, it.accountId, name)).id;
      cache.set(key, id);
    }
    ids.push(id);
  }
  return ids;
}
