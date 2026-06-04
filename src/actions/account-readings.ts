"use server";

import { createAdminSupabaseClient } from "@/lib/supabase";

export interface AccountReading {
  id: string;
  name: string;
  reading: string;
  created_at: string;
}

// 科目名→読み のマップ（検索用）。テーブル未作成でも落とさず空を返す。
export async function getAccountReadings(): Promise<Record<string, string>> {
  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase.from("account_readings").select("name, reading");
  if (error) return {};
  const map: Record<string, string> = {};
  for (const r of data ?? []) map[r.name] = r.reading;
  return map;
}

// 設定画面用の一覧
export async function listAccountReadings(): Promise<AccountReading[]> {
  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from("account_readings")
    .select("*")
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as AccountReading[];
}

// 追加・更新（科目名で一意。同名があれば読みを更新）
export async function upsertAccountReading(name: string, reading: string): Promise<AccountReading> {
  const trimmedName = name.trim();
  const trimmedReading = reading.trim();
  if (!trimmedName) throw new Error("科目名を入力してください");
  if (!trimmedReading) throw new Error("読み仮名を入力してください");

  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from("account_readings")
    .upsert({ name: trimmedName, reading: trimmedReading }, { onConflict: "name" })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as AccountReading;
}

export async function deleteAccountReading(id: string): Promise<void> {
  const supabase = createAdminSupabaseClient();
  const { error } = await supabase.from("account_readings").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
