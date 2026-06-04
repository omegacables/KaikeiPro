"use server";

import { createServerSupabaseClient } from "@/lib/supabase";
import { createJournalEntry } from "./journals";

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

// 支払い元になりうる科目（資産科目：現金・預金など）を取得
export async function getPaymentAccounts(clientId: string): Promise<AllocatableAccount[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("accounts")
    .select("id, code, name, account_categories!inner ( type )")
    .or(`client_id.eq.${clientId},client_id.is.null`)
    .eq("is_active", true)
    .eq("account_categories.type", "assets")
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

export interface AllocationJournalInput {
  date: string;
  expenseAccountId: string;
  paymentAccountId: string;
  totalAmount: number;
  businessRatio: number; // 0〜100
  memo?: string;
}

// 家事按分仕訳を作成（私用分を事業主貸へ振替）
// 按分後の金額: 事業分は四捨五入、私用分は差額で必ず合計一致
export async function createAllocationJournal(
  clientId: string,
  input: AllocationJournalInput
): Promise<void> {
  if (!input.expenseAccountId) throw new Error("費用科目を選択してください");
  if (!input.paymentAccountId) throw new Error("支払元の科目を選択してください");
  if (!(input.totalAmount > 0)) throw new Error("取引金額を入力してください");
  if (input.businessRatio < 0 || input.businessRatio > 100) {
    throw new Error("按分率は0〜100で入力してください");
  }

  const supabase = await createServerSupabaseClient();

  // 事業主貸の科目を取得
  const { data: drawing, error: dErr } = await supabase
    .from("accounts")
    .select("id")
    .or(`client_id.eq.${clientId},client_id.is.null`)
    .eq("is_active", true)
    .eq("name", "事業主貸")
    .limit(1)
    .maybeSingle();
  if (dErr) throw new Error(dErr.message);
  if (!drawing) throw new Error("「事業主貸」科目が見つかりません。勘定科目管理で追加してください。");

  const business = Math.round((input.totalAmount * input.businessRatio) / 100);
  const priv = input.totalAmount - business;

  const lines: { account_id: string; debit_amount: number; credit_amount: number }[] = [];
  if (business > 0) lines.push({ account_id: input.expenseAccountId, debit_amount: business, credit_amount: 0 });
  if (priv > 0) lines.push({ account_id: drawing.id, debit_amount: priv, credit_amount: 0 });
  lines.push({ account_id: input.paymentAccountId, debit_amount: 0, credit_amount: input.totalAmount });

  const description = (input.memo && input.memo.trim())
    ? input.memo.trim()
    : `家事按分（事業割合${input.businessRatio}%）`;

  await createJournalEntry(
    {
      client_id: clientId,
      entry_date: input.date,
      description,
      status: "draft",
      source: "manual",
      created_by: clientId,
    },
    lines
  );
}
