/**
 * 給料関連の勘定科目追加スクリプト
 *
 * 使い方:
 *   npx tsx --env-file=.env.local scripts/add-salary-accounts.ts
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

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
} catch {}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  console.log("=== 給料関連 勘定科目追加 ===\n");

  // カテゴリID取得
  const { data: categories } = await admin
    .from("account_categories")
    .select("id, type");

  const catLiabilities = categories?.find((c) => c.type === "liabilities")?.id;
  const catExpenses = categories?.find((c) => c.type === "expenses")?.id;

  if (!catLiabilities || !catExpenses) {
    console.error("カテゴリが見つかりません");
    process.exit(1);
  }

  const newAccounts = [
    { category_id: catLiabilities, code: "2410", name: "預り金（源泉所得税）" },
    { category_id: catLiabilities, code: "2420", name: "預り金（住民税）" },
    { category_id: catLiabilities, code: "2430", name: "預り金（社会保険料）" },
    { category_id: catLiabilities, code: "2440", name: "預り金（雇用保険料）" },
    { category_id: catExpenses, code: "5230", name: "賞与" },
  ];

  for (const acc of newAccounts) {
    // 既存チェック
    const { data: existing } = await admin
      .from("accounts")
      .select("id")
      .eq("code", acc.code)
      .is("client_id", null)
      .limit(1);

    if (existing && existing.length > 0) {
      console.log(`  [SKIP] ${acc.code} ${acc.name} (既に存在)`);
      continue;
    }

    const { error } = await admin.from("accounts").insert({
      client_id: null,
      category_id: acc.category_id,
      code: acc.code,
      name: acc.name,
      is_active: true,
      is_default: true,
    });

    if (error) {
      console.error(`  [ERROR] ${acc.code} ${acc.name}: ${error.message}`);
    } else {
      console.log(`  [OK] ${acc.code} ${acc.name}`);
    }
  }

  console.log("\n=== 完了 ===");
}

main().catch(console.error);
