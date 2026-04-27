#!/usr/bin/env npx tsx
/**
 * CLI script to create a user account for Raqto会計
 *
 * Usage:
 *   npx tsx scripts/create-user.ts --email user@example.com --password secret123 --name "田中太郎" --role admin --firm-id <uuid>
 *
 * Options:
 *   --email       User email (required)
 *   --password    User password (required, min 6 chars)
 *   --name        Display name (required)
 *   --role        One of: admin, staff, client (required)
 *   --firm-id     Firm UUID (required for admin/staff)
 *   --client-id   Client UUID (required for client role)
 */

import { createClient } from "@supabase/supabase-js";

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const value = args[i + 1];
      if (value && !value.startsWith("--")) {
        result[key] = value;
        i++;
      }
    }
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const { email, password, name, role } = args;
  const firmId = args["firm-id"];
  const clientId = args["client-id"];

  if (!email || !password || !name || !role) {
    console.error("必須オプション: --email, --password, --name, --role");
    console.error(
      "使用例: npx tsx scripts/create-user.ts --email user@example.com --password secret123 --name '田中太郎' --role admin --firm-id <uuid>"
    );
    process.exit(1);
  }

  if (!["admin", "staff", "client"].includes(role)) {
    console.error("--role は admin, staff, client のいずれかを指定してください");
    process.exit(1);
  }

  if ((role === "admin" || role === "staff") && !firmId) {
    console.error("admin/staff ロールには --firm-id が必須です");
    process.exit(1);
  }

  if (role === "client" && !clientId) {
    console.error("client ロールには --client-id が必須です");
    process.exit(1);
  }

  if (password.length < 6) {
    console.error("パスワードは6文字以上にしてください");
    process.exit(1);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      "環境変数 NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を設定してください"
    );
    console.error(".env.local に以下を追加:");
    console.error("  SUPABASE_SERVICE_ROLE_KEY=your-service-role-key");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. Create auth user
  console.log(`ユーザー作成中: ${email} (${role})...`);

  const { data: authData, error: authError } =
    await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, role },
    });

  if (authError) {
    console.error("認証ユーザー作成エラー:", authError.message);
    process.exit(1);
  }

  const userId = authData.user.id;
  console.log(`認証ユーザー作成完了: ${userId}`);

  // 2. Create role-specific record
  if (role === "admin" || role === "staff") {
    const { error: memberError } = await supabase
      .from("firm_members")
      .insert({
        firm_id: firmId,
        user_id: userId,
        name,
        email,
        role: role as "admin" | "staff",
        is_active: true,
      });

    if (memberError) {
      console.error("firm_members 登録エラー:", memberError.message);
      process.exit(1);
    }

    console.log(`firm_members に ${role} として登録完了`);
  } else {
    // client role
    const { error: clientUserError } = await supabase
      .from("client_users")
      .insert({
        client_id: clientId,
        user_id: userId,
        name,
        email,
        is_active: true,
      });

    if (clientUserError) {
      console.error("client_users 登録エラー:", clientUserError.message);
      process.exit(1);
    }

    console.log(`client_users にクライアントユーザーとして登録完了`);
  }

  console.log("\n完了!");
  console.log(`  Email: ${email}`);
  console.log(`  Name:  ${name}`);
  console.log(`  Role:  ${role}`);
  console.log(`  ID:    ${userId}`);
}

main().catch((err) => {
  console.error("予期しないエラー:", err);
  process.exit(1);
});
