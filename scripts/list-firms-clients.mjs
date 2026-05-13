/**
 * 全事務所・全クライアントの一覧と件数を表示
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

try {
  const envContent = readFileSync(".env.local", "utf-8");
  for (const line of envContent.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
} catch {}

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const { data: firms } = await admin.from("firms").select("id, name").order("name");
console.log(`\n=== 事務所一覧 (${firms?.length ?? 0}件) ===\n`);
for (const f of firms ?? []) {
  const { count } = await admin
    .from("clients")
    .select("*", { count: "exact", head: true })
    .eq("firm_id", f.id);
  console.log(`  - ${f.name} (clients: ${count ?? 0})`);
}

const { data: clients } = await admin
  .from("clients")
  .select("id, name, firm_id")
  .order("name");
console.log(`\n=== 全クライアント (${clients?.length ?? 0}件) ===\n`);
for (const c of clients ?? []) {
  const { count: jec } = await admin
    .from("journal_entries")
    .select("*", { count: "exact", head: true })
    .eq("client_id", c.id);
  const { count: pc } = await admin
    .from("payments")
    .select("*", { count: "exact", head: true })
    .eq("client_id", c.id);
  const { count: ic } = await admin
    .from("invoices")
    .select("*", { count: "exact", head: true })
    .eq("client_id", c.id);
  const { count: rc } = await admin
    .from("receipts")
    .select("*", { count: "exact", head: true })
    .eq("client_id", c.id);
  console.log(`  - ${c.name} | firm: ${c.firm_id ? c.firm_id.slice(0, 8) : "なし"} | je:${jec ?? 0} pay:${pc ?? 0} inv:${ic ?? 0} rcpt:${rc ?? 0}`);
}
