/**
 * 指定事務所の仕訳・領収書・AI学習データを削除
 *
 * 使い方:
 *   node scripts/cleanup-firm-data.mjs <事務所名キーワード> [--execute]
 *
 * 例:
 *   node scripts/cleanup-firm-data.mjs 梅田          # ドライラン（件数表示のみ）
 *   node scripts/cleanup-firm-data.mjs 梅田 --execute # 実削除
 *
 * 削除対象:
 *   - journal_entry_lines (FK制約のため最初)
 *   - journal_entries
 *   - ai_feedback_logs
 *   - ai_journal_patterns
 *   - receipts (Storage上のファイルも削除)
 *
 * 保護:
 *   - bank_transactions / invoices / payments の journal_entry_id は SET NULL
 *   - クライアントマスタ・事務所マスタは削除しない
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

// .env.local 読込
try {
  const envContent = readFileSync(".env.local", "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (!process.env[key]) process.env[key] = value;
  }
} catch {
  /* ignore */
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("ERROR: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
  process.exit(1);
}

const args = process.argv.slice(2);
const keyword = args.find((a) => !a.startsWith("--"));
const execute = args.includes("--execute");

if (!keyword) {
  console.error("Usage: node scripts/cleanup-firm-data.mjs <事務所名キーワード> [--execute]");
  process.exit(1);
}

const admin = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function countFor(table, ids, column = "client_id") {
  if (ids.length === 0) return 0;
  const { count } = await admin
    .from(table)
    .select("*", { count: "exact", head: true })
    .in(column, ids);
  return count ?? 0;
}

async function main() {
  console.log(`\n=== 事務所検索: "${keyword}" を含む事務所 ===\n`);

  const { data: firms, error: firmErr } = await admin
    .from("firms")
    .select("id, name")
    .ilike("name", `%${keyword}%`);

  if (firmErr) {
    console.error("ERROR:", firmErr.message);
    process.exit(1);
  }
  if (!firms || firms.length === 0) {
    console.log("該当する事務所が見つかりません。");
    process.exit(0);
  }

  for (const f of firms) {
    console.log(`  - ${f.name} (${f.id})`);
  }

  if (firms.length > 1) {
    console.log(`\n複数の事務所が一致しました（${firms.length}件）。すべてが対象になります。`);
  }

  const firmIds = firms.map((f) => f.id);

  // クライアント一覧取得
  const { data: clients } = await admin
    .from("clients")
    .select("id, name")
    .in("firm_id", firmIds);

  const clientIds = (clients ?? []).map((c) => c.id);

  console.log(`\n=== 配下クライアント (${clientIds.length}件) ===\n`);
  for (const c of clients ?? []) {
    console.log(`  - ${c.name} (${c.id})`);
  }

  if (clientIds.length === 0) {
    console.log("\nクライアントなし。削除対象データもありません。");
    process.exit(0);
  }

  // 仕訳ID一覧
  const { data: jentries } = await admin
    .from("journal_entries")
    .select("id, receipt_id")
    .in("client_id", clientIds);

  const journalEntryIds = (jentries ?? []).map((j) => j.id);
  const linkedReceiptIds = (jentries ?? [])
    .map((j) => j.receipt_id)
    .filter((x) => !!x);

  // カウント
  const journalLinesCount = journalEntryIds.length === 0
    ? 0
    : (await admin
        .from("journal_entry_lines")
        .select("*", { count: "exact", head: true })
        .in("journal_entry_id", journalEntryIds)
      ).count ?? 0;

  const receiptsCount = await countFor("receipts", clientIds);
  const aiFeedbackCount = await countFor("ai_feedback_logs", clientIds);
  const aiPatternsCount = await countFor("ai_journal_patterns", clientIds);

  // 影響を受ける関連テーブル（journal_entry_id を NULL にする対象）
  let invoicesAffected = 0;
  let bankTxnsAffected = 0;
  if (journalEntryIds.length > 0) {
    const { count: ic } = await admin
      .from("invoices")
      .select("*", { count: "exact", head: true })
      .in("journal_entry_id", journalEntryIds);
    invoicesAffected = ic ?? 0;
    const { count: bc } = await admin
      .from("bank_transactions")
      .select("*", { count: "exact", head: true })
      .in("journal_entry_id", journalEntryIds);
    bankTxnsAffected = bc ?? 0;
  }

  // Storage上のファイル
  const { data: receiptRows } = await admin
    .from("receipts")
    .select("image_path")
    .in("client_id", clientIds);
  const storagePaths = (receiptRows ?? [])
    .map((r) => r.image_path)
    .filter((p) => p && !p.startsWith("raqto://") && !p.startsWith("receipts/"));

  console.log(`\n=== 削除対象サマリ ===\n`);
  console.log(`  journal_entries:        ${journalEntryIds.length}`);
  console.log(`  journal_entry_lines:    ${journalLinesCount}`);
  console.log(`  receipts:               ${receiptsCount}`);
  console.log(`  ai_feedback_logs:       ${aiFeedbackCount}`);
  console.log(`  ai_journal_patterns:    ${aiPatternsCount}`);
  console.log(`  Storage files:          ${storagePaths.length}`);
  console.log(`\n=== 影響を受ける関連レコード（NULL化のみ、削除しない） ===\n`);
  console.log(`  invoices.journal_entry_id:           ${invoicesAffected}`);
  console.log(`  bank_transactions.journal_entry_id:  ${bankTxnsAffected}`);

  if (!execute) {
    console.log(`\n--- ドライラン（実削除なし） ---`);
    console.log(`実削除するには --execute を付けて再実行してください:`);
    console.log(`  node scripts/cleanup-firm-data.mjs ${keyword} --execute`);
    process.exit(0);
  }

  console.log(`\n=== 削除実行開始 ===\n`);

  // 1. invoices.journal_entry_id を NULL に
  if (journalEntryIds.length > 0 && invoicesAffected > 0) {
    const { error } = await admin
      .from("invoices")
      .update({ journal_entry_id: null })
      .in("journal_entry_id", journalEntryIds);
    if (error) console.error(`  invoices NULL化エラー: ${error.message}`);
    else console.log(`  invoices.journal_entry_id NULL化完了`);
  }
  if (journalEntryIds.length > 0 && bankTxnsAffected > 0) {
    const { error } = await admin
      .from("bank_transactions")
      .update({ journal_entry_id: null })
      .in("journal_entry_id", journalEntryIds);
    if (error) console.error(`  bank_transactions NULL化エラー: ${error.message}`);
    else console.log(`  bank_transactions.journal_entry_id NULL化完了`);
  }

  // 2. journal_entry_lines 削除
  if (journalEntryIds.length > 0) {
    const { error, count } = await admin
      .from("journal_entry_lines")
      .delete({ count: "exact" })
      .in("journal_entry_id", journalEntryIds);
    if (error) console.error(`  journal_entry_lines: ${error.message}`);
    else console.log(`  journal_entry_lines: ${count} 件削除`);
  }

  // 3. journal_entries 削除
  if (clientIds.length > 0) {
    const { error, count } = await admin
      .from("journal_entries")
      .delete({ count: "exact" })
      .in("client_id", clientIds);
    if (error) console.error(`  journal_entries: ${error.message}`);
    else console.log(`  journal_entries: ${count} 件削除`);
  }

  // 4. ai_feedback_logs
  if (clientIds.length > 0) {
    const { error, count } = await admin
      .from("ai_feedback_logs")
      .delete({ count: "exact" })
      .in("client_id", clientIds);
    if (error) console.error(`  ai_feedback_logs: ${error.message}`);
    else console.log(`  ai_feedback_logs: ${count} 件削除`);
  }

  // 5. ai_journal_patterns
  if (clientIds.length > 0) {
    const { error, count } = await admin
      .from("ai_journal_patterns")
      .delete({ count: "exact" })
      .in("client_id", clientIds);
    if (error) console.error(`  ai_journal_patterns: ${error.message}`);
    else console.log(`  ai_journal_patterns: ${count} 件削除`);
  }

  // 6. receipts
  if (clientIds.length > 0) {
    const { error, count } = await admin
      .from("receipts")
      .delete({ count: "exact" })
      .in("client_id", clientIds);
    if (error) console.error(`  receipts: ${error.message}`);
    else console.log(`  receipts: ${count} 件削除`);
  }

  // 7. Storage上のファイル削除
  if (storagePaths.length > 0) {
    // バッチで100件ずつ削除（Supabase API制限考慮）
    const batchSize = 100;
    let totalDeleted = 0;
    for (let i = 0; i < storagePaths.length; i += batchSize) {
      const batch = storagePaths.slice(i, i + batchSize);
      const { data, error } = await admin.storage.from("receipts").remove(batch);
      if (error) {
        console.error(`  Storage batch ${i / batchSize + 1} エラー: ${error.message}`);
      } else {
        totalDeleted += data?.length ?? 0;
      }
    }
    console.log(`  Storage files: ${totalDeleted} 件削除`);
  }

  console.log(`\n=== 完了 ===\n`);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
