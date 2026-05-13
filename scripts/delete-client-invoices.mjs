/**
 * 指定クライアントのinvoices全件削除
 * Usage:
 *   node scripts/delete-client-invoices.mjs <clientId>           # dry-run
 *   node scripts/delete-client-invoices.mjs <clientId> --execute
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

const args = process.argv.slice(2);
const clientId = args.find((a) => !a.startsWith("--"));
const execute = args.includes("--execute");

if (!clientId) {
  console.error("Usage: node scripts/delete-client-invoices.mjs <clientId> [--execute]");
  process.exit(1);
}

const { data: client } = await admin.from("clients").select("name").eq("id", clientId).single();
console.log(`\nクライアント: ${client?.name ?? "(not found)"}\n`);

const { data: invoices } = await admin
  .from("invoices")
  .select("id, invoice_number, total_amount, journal_entry_id, pdf_storage_path")
  .eq("client_id", clientId);

console.log(`削除対象 invoices: ${invoices?.length ?? 0}件`);
for (const inv of invoices ?? []) {
  console.log(`  - ${inv.invoice_number} ¥${inv.total_amount}`);
}

if (!invoices || invoices.length === 0) {
  console.log("削除対象なし。");
  process.exit(0);
}

const invoiceIds = invoices.map((i) => i.id);

const { count: itemsCount } = await admin
  .from("invoice_items")
  .select("*", { count: "exact", head: true })
  .in("invoice_id", invoiceIds);
const { count: allocCount } = await admin
  .from("payment_allocations")
  .select("*", { count: "exact", head: true })
  .in("invoice_id", invoiceIds);

console.log(`\n連動削除:`);
console.log(`  invoice_items:       ${itemsCount ?? 0}`);
console.log(`  payment_allocations: ${allocCount ?? 0}`);

if (!execute) {
  console.log(`\n--- ドライラン ---`);
  console.log(`実削除: node scripts/delete-client-invoices.mjs ${clientId} --execute`);
  process.exit(0);
}

console.log(`\n=== 削除実行 ===\n`);

if ((itemsCount ?? 0) > 0) {
  const { error, count } = await admin
    .from("invoice_items")
    .delete({ count: "exact" })
    .in("invoice_id", invoiceIds);
  if (error) console.error(`  invoice_items: ${error.message}`);
  else console.log(`  invoice_items: ${count}件削除`);
}

if ((allocCount ?? 0) > 0) {
  const { error, count } = await admin
    .from("payment_allocations")
    .delete({ count: "exact" })
    .in("invoice_id", invoiceIds);
  if (error) console.error(`  payment_allocations: ${error.message}`);
  else console.log(`  payment_allocations: ${count}件削除`);
}

// PDF storage files
const storagePaths = invoices.map((i) => i.pdf_storage_path).filter((p) => !!p);
if (storagePaths.length > 0) {
  const { data, error } = await admin.storage.from("invoices").remove(storagePaths);
  if (error) console.error(`  Storage: ${error.message}`);
  else console.log(`  Storage PDF: ${data?.length ?? 0}件削除`);
}

const { error, count } = await admin
  .from("invoices")
  .delete({ count: "exact" })
  .in("id", invoiceIds);
if (error) console.error(`  invoices: ${error.message}`);
else console.log(`  invoices: ${count}件削除`);

console.log(`\n=== 完了 ===\n`);
