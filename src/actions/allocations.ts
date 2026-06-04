"use server";

import { createServerSupabaseClient } from "@/lib/supabase";

export interface AllocatableAccount {
  id: string;
  code: string;
  name: string;
}

export interface AllocationRate {
  account_id: string;
  business_ratio: number; // 0〜100 (%)
  basis_note: string | null;
}

// 按分対象になりうる科目（費用科目）を取得
export async function getAllocatableAccounts(clientId: string): Promise<AllocatableAccount[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("accounts")
    .select("id, code, name, account_categories!inner ( type )")
    .or(`client_id.eq.${clientId},client_id.is.null`)
    .eq("is_active", true)
    .eq("account_categories.type", "expenses")
    .order("code");
  if (error) throw new Error(error.message);
  return (data ?? []).map((a) => ({ id: a.id, code: a.code, name: a.name }));
}

// 指定年度の按分率設定を account_id をキーに取得
export async function getAllocationRates(
  clientId: string,
  fiscalYear: number
): Promise<Record<string, AllocationRate>> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("allocation_rate_settings")
    .select("account_id, business_ratio, basis_note")
    .eq("client_id", clientId)
    .eq("fiscal_year", fiscalYear);
  if (error) {
    // テーブル未適用でも落とさない
    return {};
  }
  const map: Record<string, AllocationRate> = {};
  for (const r of data ?? []) {
    map[r.account_id] = {
      account_id: r.account_id,
      business_ratio: Number(r.business_ratio),
      basis_note: r.basis_note,
    };
  }
  return map;
}

// 按分率の登録・更新（UNIQUE制約に依存しない検索→更新/挿入方式）
export async function upsertAllocationRate(
  clientId: string,
  fiscalYear: number,
  accountId: string,
  businessRatio: number,
  basisNote: string | null
): Promise<void> {
  if (businessRatio < 0 || businessRatio > 100) {
    throw new Error("按分率は0〜100の範囲で入力してください");
  }
  const supabase = await createServerSupabaseClient();

  const { data: existing, error: selErr } = await supabase
    .from("allocation_rate_settings")
    .select("id")
    .eq("client_id", clientId)
    .eq("fiscal_year", fiscalYear)
    .eq("account_id", accountId)
    .limit(1)
    .maybeSingle();
  if (selErr) throw new Error(selErr.message);

  if (existing) {
    const { error } = await supabase
      .from("allocation_rate_settings")
      .update({ business_ratio: businessRatio, basis_note: basisNote, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await supabase.from("allocation_rate_settings").insert({
    client_id: clientId,
    fiscal_year: fiscalYear,
    account_id: accountId,
    business_ratio: businessRatio,
    basis_note: basisNote,
  });
  if (error) throw new Error(error.message);
}
