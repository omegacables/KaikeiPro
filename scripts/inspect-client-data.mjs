/**
 * 指定クライアントの入金消込関連データを詳細表示
 * Usage: node scripts/inspect-client-data.mjs <clientId>
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

const clientId = process.argv[2];
if (!clientId) {
  console.error("Usage: node scripts/inspect-client-data.mjs <clientId>");
  process.exit(1);
}

const { data: client } = await admin.from("clients").select("*").eq("id", clientId).single();
console.log(`\n=== クライアント: ${client?.name ?? "(not found)"} ===\n`);

const tables = [
  "invoices",
  "invoice_items",
  "payments",
  "payment_allocations",
  "business_partners",
  "bank_accounts",
  "bank_transactions",
  "card_accounts",
  "card_transactions",
];

for (const t of tables) {
  const { count } = await admin
    .from(t)
    .select("*", { count: "exact", head: true })
    .eq("client_id", clientId);
  console.log(`  ${t.padEnd(25)} ${count ?? 0}`);
}

console.log(`\n=== invoices詳細 ===\n`);
const { data: invoices } = await admin
  .from("invoices")
  .select("id, invoice_number, issued_date, total_amount, status, business_partner_id")
  .eq("client_id", clientId)
  .limit(10);
for (const inv of invoices ?? []) {
  console.log(`  ${inv.invoice_number} | ${inv.issued_date} | ¥${inv.total_amount} | ${inv.status} | partner: ${inv.business_partner_id?.slice(0, 8) ?? "なし"}`);
}

console.log(`\n=== payments詳細 ===\n`);
const { data: payments } = await admin
  .from("payments")
  .select("id, payment_date, amount, payment_method, memo")
  .eq("client_id", clientId)
  .limit(10);
for (const p of payments ?? []) {
  console.log(`  ${p.payment_date} | ¥${p.amount} | ${p.payment_method} | ${p.memo ?? ""}`);
}

console.log(`\n=== business_partners詳細 ===\n`);
const { data: partners } = await admin
  .from("business_partners")
  .select("id, name, partner_type, is_active")
  .eq("client_id", clientId)
  .limit(20);
for (const p of partners ?? []) {
  console.log(`  ${p.name} | ${p.partner_type} | active:${p.is_active}`);
}
