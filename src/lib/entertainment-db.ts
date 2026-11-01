/**
 * 顧問先の交際費の設定を読み、AIへの指示に添える文を作る。
 * AIの仕訳（サービスロールで動く処理）からも使うので、権限の確認は呼び出し側で済ませておくこと。
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  entertainmentRulesForPrompt,
  guessIndustry,
  isIndustryCode,
  parseEntertainmentSettings,
  type EntertainmentSettings,
  type IndustryCode,
} from "@/lib/entertainment";

export type EntertainmentContext = { industry: IndustryCode; settings: EntertainmentSettings; prompt: string };

export async function loadEntertainmentContext(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any, any, any>,
  clientId: string,
  date: string
): Promise<EntertainmentContext> {
  const { data } = await db.from("clients").select("business_type, industry, entertainment_settings").eq("id", clientId).maybeSingle();
  const row = (data ?? {}) as { business_type?: string | null; industry?: string | null; entertainment_settings?: unknown };
  const industry = isIndustryCode(row.industry) ? row.industry : guessIndustry(row.business_type);
  const settings = parseEntertainmentSettings(row.entertainment_settings);
  return { industry, settings, prompt: entertainmentRulesForPrompt(industry, settings, date) };
}
