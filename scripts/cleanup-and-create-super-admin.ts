/**
 * データクリーンアップ + Super Admin作成スクリプト
 *
 * 使い方:
 *   npx tsx --env-file=.env.local scripts/cleanup-and-create-super-admin.ts
 *
 * 環境変数:
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (.env.local から読み込み)
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

// Parse .env.local manually to avoid dotenv dependency
try {
  const envContent = readFileSync(".env.local", "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
} catch {
  // .env.local not found, rely on existing env vars
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function deleteAll(table: string) {
  // neq trick: delete all rows (Supabase requires a filter)
  const { error, count } = await admin
    .from(table)
    .delete({ count: "exact" })
    .neq("id", "00000000-0000-0000-0000-000000000000");

  if (error) {
    console.error(`  [ERROR] ${table}: ${error.message}`);
  } else {
    console.log(`  ${table}: ${count ?? 0} rows deleted`);
  }
}

async function main() {
  console.log("=== データクリーンアップ開始 ===\n");

  // FK制約順で削除（子テーブル → 親テーブル）
  const tablesToDelete = [
    "bank_transactions",
    "bank_accounts",
    "payment_allocations",
    "payments",
    "fixed_assets",
    "closing_balances",
    "invoice_items",
    "invoices",
    "journal_entry_lines",
    "journal_entries",
    "ai_feedback_logs",
    "receipts",
    "submission_periods",
    "submission_schedules",
    "reminder_logs",
    "business_partners",
    "fiscal_years",
    "departments",
    "journal_templates",
    "raqto_integrations",
    "notifications",
    "comments",
    "comment_notifications",
    "ai_journal_patterns",
    "sub_accounts",
    // accounts with client_id (keep defaults where client_id IS NULL)
    // client_users, clients, firm_members, firms, super_admins
    "client_users",
    "clients",
    "firm_members",
    "firms",
    "super_admins",
  ];

  for (const table of tablesToDelete) {
    await deleteAll(table);
  }

  // accounts: client_id が NULL でないもの（クライアント固有の勘定科目）を削除
  console.log("\n  Deleting client-specific accounts (client_id IS NOT NULL)...");
  const { error: accErr, count: accCount } = await admin
    .from("accounts")
    .delete({ count: "exact" })
    .not("client_id", "is", null);

  if (accErr) {
    console.error(`  [ERROR] accounts: ${accErr.message}`);
  } else {
    console.log(`  accounts (client-specific): ${accCount ?? 0} rows deleted`);
  }

  // 保持確認: account_categories, tax_categories, accounts(client_id=NULL)
  const { count: catCount } = await admin
    .from("account_categories")
    .select("*", { count: "exact", head: true });
  console.log(`\n  [KEPT] account_categories: ${catCount} rows`);

  const { count: taxCount } = await admin
    .from("tax_categories")
    .select("*", { count: "exact", head: true });
  console.log(`  [KEPT] tax_categories: ${taxCount} rows`);

  const { count: defaultAccCount } = await admin
    .from("accounts")
    .select("*", { count: "exact", head: true })
    .is("client_id", null);
  console.log(`  [KEPT] accounts (defaults): ${defaultAccCount} rows`);

  // auth.usersの削除
  console.log("\n=== auth.users 削除 ===\n");
  const { data: authUsers } = await admin.auth.admin.listUsers();
  if (authUsers?.users) {
    for (const u of authUsers.users) {
      const { error } = await admin.auth.admin.deleteUser(u.id);
      if (error) {
        console.error(`  [ERROR] auth user ${u.email}: ${error.message}`);
      } else {
        console.log(`  Deleted auth user: ${u.email}`);
      }
    }
  }

  // Super Admin作成
  console.log("\n=== Super Admin 作成 ===\n");

  const superAdminEmail = "info@renaxis.jp";
  const superAdminPassword = "renren123";
  const superAdminName = "Renaxis Admin";

  const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
    email: superAdminEmail,
    password: superAdminPassword,
    email_confirm: true,
    user_metadata: { name: superAdminName, role: "super_admin" },
  });

  if (createErr) {
    console.error(`  [ERROR] Failed to create auth user: ${createErr.message}`);
    process.exit(1);
  }

  console.log(`  Auth user created: ${newUser.user.email} (${newUser.user.id})`);

  // super_adminsテーブルに登録
  const { error: insertErr } = await admin.from("super_admins").insert({
    user_id: newUser.user.id,
    name: superAdminName,
    email: superAdminEmail,
  });

  if (insertErr) {
    console.error(`  [ERROR] Failed to insert super_admin: ${insertErr.message}`);
    process.exit(1);
  }

  console.log(`  super_admins record created`);

  console.log("\n=== 完了 ===");
  console.log(`\nSuper Admin ログイン情報:`);
  console.log(`  Email: ${superAdminEmail}`);
  console.log(`  Password: ${superAdminPassword}`);
}

main().catch(console.error);
