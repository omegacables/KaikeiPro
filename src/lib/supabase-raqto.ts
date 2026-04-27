import { createClient } from "@supabase/supabase-js";

// Raqto受発注 Supabase client (service-role, bypasses RLS)
export function createRaqtoSupabaseClient() {
  const url = process.env.RAQTO_SUPABASE_URL;
  const serviceKey = process.env.RAQTO_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("RAQTO_SUPABASE_URL / RAQTO_SUPABASE_SERVICE_ROLE_KEY が設定されていません");
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
