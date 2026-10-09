/**
 * AIに渡す情報の設定（顧問先ごと。clients.ai_share_company_info / ai_share_personal_info）。
 *
 *   会社情報 … 自社名、取引先マスタの名前、業種など、AIへの指示に添えている会社の情報
 *   個人情報 … 役員・従業員の氏名、役員報酬の額など、個人を特定できる情報
 *
 * 証憑の画像や銀行明細そのものは、読み取りのためにAIへ送る（止めると読み取りができない）。
 * この設定で止めるのは、精度を上げるためにAIへの指示に「追加で」添えている情報。
 * サーバー処理からだけ呼ぶ。
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type AiSharing = { company: boolean; personal: boolean };

/** AIに渡さなかったことを、AIへの指示の中で示す文言 */
export const NOT_SHARED = "（顧問先の設定により、AIには渡していません）";

export async function loadAiSharing(db: SupabaseClient, clientId: string): Promise<AiSharing> {
  const { data } = await db
    .from("clients")
    .select("ai_share_company_info, ai_share_personal_info")
    .eq("id", clientId)
    .maybeSingle();
  const row = data as { ai_share_company_info?: boolean; ai_share_personal_info?: boolean } | null;
  // 読めなかったときは安全側（渡さない）に倒さず、これまでどおり渡す。
  // 設定の列が無い古い環境でも動くようにするため
  return {
    company: row?.ai_share_company_info ?? true,
    personal: row?.ai_share_personal_info ?? true,
  };
}
