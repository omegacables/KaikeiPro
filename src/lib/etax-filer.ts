/**
 * e-Tax 用ファイルの提出者の情報を、顧問先の登録から読む（サーバー処理から呼ぶ。アクセス権は呼び出し側で確かめる）。
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Filer } from "@/lib/etax-xml";
import { taxOfficeName } from "@/lib/tax-offices";

export async function loadFiler(db: SupabaseClient, clientId: string): Promise<Filer & { businessDescription: string | null }> {
  const { data: c, error } = await db
    .from("clients")
    .select(
      "name, business_type, postal_code, address, telephone, tax_office_code, etax_user_id, corporate_number, name_kana, representative_name, representative_kana"
    )
    .eq("id", clientId)
    .single();
  if (error || !c) throw new Error(error?.message ?? "顧問先が見つかりません");
  return {
    taxOfficeCode: (c.tax_office_code as string | null) ?? "",
    taxOfficeName: taxOfficeName(c.tax_office_code as string | null),
    etaxUserId: (c.etax_user_id as string | null) ?? "",
    corporateNumber: (c.corporate_number as string | null) ?? null,
    name: (c.name as string) ?? "",
    nameKana: (c.name_kana as string | null) ?? null,
    postalCode: (c.postal_code as string | null) ?? null,
    address: (c.address as string | null) ?? "",
    telephone: (c.telephone as string | null) ?? null,
    representativeName: (c.representative_name as string | null) ?? null,
    representativeKana: (c.representative_kana as string | null) ?? null,
    businessDescription: (c.business_type as string | null) ?? null,
  };
}
