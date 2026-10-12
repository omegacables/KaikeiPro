"use server";

/**
 * 株主名簿（法人税申告書の別表二「同族会社等の判定に関する明細書」に使う）。
 * 判定の計算は src/lib/family-company.ts（テストあり）。
 */

import { createAdminSupabaseClient, createServerSupabaseClient } from "@/lib/supabase";
import { assertClientAccess } from "@/lib/authz";
import { judgeFamilyCompany, type FamilyCompanyResult, type Shareholder } from "@/lib/family-company";

export type ShareholderRow = Shareholder & { id?: string };

export type ShareholderRegister = {
  issuedShares: number | null;
  treasuryShares: number | null;
  shareholders: ShareholderRow[];
  judgement: FamilyCompanyResult | null;
};

export async function getShareholderRegister(clientId: string): Promise<ShareholderRegister> {
  await assertClientAccess(clientId);
  const db = await createServerSupabaseClient();
  const [{ data: client }, { data: rows, error }] = await Promise.all([
    db.from("clients").select("issued_shares, treasury_shares, capital_amount").eq("id", clientId).single(),
    db
      .from("shareholders")
      .select("id, group_no, name, address, relationship, is_corporation, shares")
      .eq("client_id", clientId)
      .order("sort_order"),
  ]);
  if (error) throw new Error(error.message);
  const shareholders: ShareholderRow[] = (rows ?? []).map((r) => ({
    id: r.id as string,
    groupNo: r.group_no as number,
    name: r.name as string,
    address: (r.address as string | null) ?? null,
    relationship: (r.relationship as string | null) ?? null,
    isCorporation: Boolean(r.is_corporation),
    shares: Number(r.shares),
  }));
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const issuedShares = num(client?.issued_shares);
  const treasuryShares = num(client?.treasury_shares);
  return {
    issuedShares,
    treasuryShares,
    shareholders,
    judgement: shareholders.length
      ? judgeFamilyCompany({ shareholders, issuedShares, treasuryShares, capital: num(client?.capital_amount) })
      : null,
  };
}

/** 株主名簿を丸ごと保存する（並び順は渡した順） */
export async function saveShareholderRegister(
  clientId: string,
  input: { issuedShares: number | null; treasuryShares: number | null; shareholders: ShareholderRow[] }
): Promise<void> {
  await assertClientAccess(clientId);
  for (const s of input.shareholders) {
    if (!s.name.trim()) throw new Error("株主の氏名又は名称を入れてください");
    if (!(s.shares >= 0) || !Number.isInteger(s.shares)) throw new Error("株式数を正しく入れてください");
    if (!(Number.isInteger(s.groupNo) && s.groupNo >= 1 && s.groupNo <= 99)) throw new Error("株主グループは1〜99の番号です");
  }
  for (const v of [input.issuedShares, input.treasuryShares])
    if (v !== null && !(Number.isInteger(v) && v >= 0)) throw new Error("株式の数を正しく入れてください");

  // 名簿は閲覧専用のアカウントでは書けない（RLS と書き込み禁止のトリガー）
  const db = await createServerSupabaseClient();
  const { error: delErr } = await db.from("shareholders").delete().eq("client_id", clientId);
  if (delErr) throw new Error(delErr.message);
  if (input.shareholders.length) {
    const { error } = await db.from("shareholders").insert(
      input.shareholders.map((s, i) => ({
        client_id: clientId,
        group_no: s.groupNo,
        name: s.name.trim(),
        address: s.address?.trim() || null,
        relationship: s.relationship?.trim() || null,
        is_corporation: s.isCorporation,
        shares: s.shares,
        sort_order: i,
      }))
    );
    if (error) throw new Error(error.message);
  }
  // 顧問先の表は顧問先ユーザーが RLS で更新できないため、名簿を書けた（＝書き込み権限がある）ことを確かめてから更新する
  const admin = createAdminSupabaseClient();
  const { error: cErr } = await admin
    .from("clients")
    .update({ issued_shares: input.issuedShares, treasury_shares: input.treasuryShares })
    .eq("id", clientId);
  if (cErr) throw new Error(cErr.message);
}
