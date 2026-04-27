/**
 * 試算表・財務諸表用ダミー仕訳データ投入スクリプト
 *
 * 使い方:
 *   npx tsx --env-file=.env.local scripts/seed-journal-data.ts
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

// Parse .env.local
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

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const CID = "1ae88fd8-59a2-4559-9a75-54567a34fe21"; // 株式会社MRコネクト
const UID = "f0dbe32c-b23d-479b-acb8-1f6e76e0a588"; // 税理士 太郎

// Account code → UUID mapping
const accounts: Record<string, string> = {};

async function loadAccounts() {
  const { data, error } = await admin
    .from("accounts")
    .select("id, code")
    .or(`client_id.eq.${CID},is_default.eq.true`)
    .eq("is_active", true);

  if (error) throw new Error(`Failed to load accounts: ${error.message}`);
  for (const a of data ?? []) {
    accounts[a.code] = a.id;
  }
  console.log(`  Loaded ${Object.keys(accounts).length} accounts`);
}

function acc(code: string): string {
  const id = accounts[code];
  if (!id) throw new Error(`Account not found: ${code}`);
  return id;
}

interface Line {
  account_code: string;
  debit: number;
  credit: number;
  tax_category?: string;
  tax_rate?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function createJE(date: string, description: string, lines: Line[], source = "manual", retries = 3): Promise<void> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const { data: je, error: jeErr } = await admin
      .from("journal_entries")
      .insert({
        client_id: CID,
        entry_date: date,
        description,
        status: "confirmed",
        source,
        created_by: UID,
      })
      .select("id")
      .single();

    if (jeErr) {
      if (attempt < retries - 1 && (jeErr.message.includes("502") || jeErr.message.includes("Bad gateway") || jeErr.message.includes("<!DOCTYPE"))) {
        console.log(`    [RETRY] ${description} (attempt ${attempt + 2})...`);
        await sleep(2000);
        continue;
      }
      throw new Error(`JE insert failed (${description}): ${jeErr.message}`);
    }

    const jelRows = lines.map((l, i) => ({
      journal_entry_id: je.id,
      account_id: acc(l.account_code),
      debit_amount: l.debit,
      credit_amount: l.credit,
      tax_category: l.tax_category ?? null,
      tax_rate: l.tax_rate ?? null,
      sort_order: i,
    }));

    const { error: jelErr } = await admin.from("journal_entry_lines").insert(jelRows);
    if (jelErr) {
      if (attempt < retries - 1 && (jelErr.message.includes("502") || jelErr.message.includes("Bad gateway") || jelErr.message.includes("<!DOCTYPE"))) {
        // Clean up the orphan JE
        await admin.from("journal_entries").delete().eq("id", je.id);
        console.log(`    [RETRY] ${description} lines (attempt ${attempt + 2})...`);
        await sleep(2000);
        continue;
      }
      throw new Error(`JEL insert failed (${description}): ${jelErr.message}`);
    }

    // Success - small delay to avoid rate limiting
    await sleep(100);
    return;
  }
}

async function deleteExistingJournals() {
  // Delete lines first (FK)
  const { data: entries } = await admin
    .from("journal_entries")
    .select("id")
    .eq("client_id", CID);

  if (entries && entries.length > 0) {
    const ids = entries.map((e) => e.id);
    // Delete in batches
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      await admin
        .from("journal_entry_lines")
        .delete()
        .in("journal_entry_id", batch);
    }
    await admin
      .from("journal_entries")
      .delete()
      .eq("client_id", CID);
  }
  console.log(`  Deleted ${entries?.length ?? 0} existing journal entries`);
}

// Monthly data definition
interface MonthData {
  month: string; // YYYY-MM
  sales: number;
  purchases: number;
  utilities: number;
  supplies: number;
  prevSalesWithTax: number; // 前月売上(税込) for 売掛金回収
  prevPurchasesWithTax: number; // 前月仕入(税込) for 買掛金支払
  interestRate: number; // 支払利息
  salesPartner: string;
  purchasePartner: string;
}

async function main() {
  console.log("=== 試算表用仕訳データ投入 ===\n");

  console.log("1. 勘定科目読込...");
  await loadAccounts();

  console.log("2. 既存仕訳データ削除...");
  await deleteExistingJournals();

  // 会計年度を作成（なければ）
  console.log("2.5. 会計年度確認/作成...");
  const { data: existingFY } = await admin
    .from("fiscal_years")
    .select("id")
    .eq("client_id", CID)
    .gte("start_date", "2025-04-01")
    .lte("end_date", "2026-03-31")
    .limit(1);

  if (!existingFY || existingFY.length === 0) {
    const { error: fyErr } = await admin.from("fiscal_years").insert({
      client_id: CID,
      start_date: "2025-04-01",
      end_date: "2026-03-31",
      status: "open",
    });
    if (fyErr) console.error(`  [WARN] fiscal_year insert: ${fyErr.message}`);
    else console.log("  会計年度 2025/4〜2026/3 作成");
  } else {
    console.log("  会計年度 既に存在");
  }

  console.log("3. 仕訳データ投入...\n");

  // ========================================
  // 期首残高 (2025-04-01)
  // ========================================
  console.log("  期首残高...");
  await createJE("2025-04-01", "期首残高", [
    { account_code: "1100", debit: 500000, credit: 0 },       // 現金
    { account_code: "1120", debit: 8000000, credit: 0 },      // 普通預金
    { account_code: "1150", debit: 2500000, credit: 0 },      // 売掛金
    { account_code: "1500", debit: 8000000, credit: 0 },      // 建物
    { account_code: "1510", debit: 3500000, credit: 0 },      // 車両運搬具
    { account_code: "1520", debit: 1200000, credit: 0 },      // 器具備品
    { account_code: "2100", debit: 0, credit: 900000 },       // 買掛金
    { account_code: "2600", debit: 0, credit: 5000000 },      // 長期借入金
    { account_code: "3100", debit: 0, credit: 10000000 },     // 資本金
    { account_code: "3310", debit: 0, credit: 7800000 },      // 繰越利益剰余金
  ]);

  // Monthly parameters
  const months: MonthData[] = [
    { month: "2025-04", sales: 2500000, purchases: 1000000, utilities: 28000, supplies: 15000, prevSalesWithTax: 2500000, prevPurchasesWithTax: 900000, interestRate: 15000, salesPartner: "株式会社山田商事", purchasePartner: "大阪部品" },
    { month: "2025-05", sales: 2300000, purchases: 900000, utilities: 26000, supplies: 12000, prevSalesWithTax: 2750000, prevPurchasesWithTax: 1100000, interestRate: 14500, salesPartner: "株式会社山田商事", purchasePartner: "大阪部品" },
    { month: "2025-06", sales: 2800000, purchases: 1100000, utilities: 32000, supplies: 18000, prevSalesWithTax: 2530000, prevPurchasesWithTax: 990000, interestRate: 14000, salesPartner: "東京電子工業", purchasePartner: "名古屋金属工業" },
    { month: "2025-07", sales: 3000000, purchases: 1200000, utilities: 42000, supplies: 20000, prevSalesWithTax: 3080000, prevPurchasesWithTax: 1210000, interestRate: 13500, salesPartner: "株式会社山田商事", purchasePartner: "大阪部品" },
    { month: "2025-08", sales: 2200000, purchases: 800000, utilities: 45000, supplies: 10000, prevSalesWithTax: 3300000, prevPurchasesWithTax: 1320000, interestRate: 13000, salesPartner: "東京電子工業", purchasePartner: "大阪部品" },
    { month: "2025-09", sales: 3200000, purchases: 1100000, utilities: 38000, supplies: 22000, prevSalesWithTax: 2420000, prevPurchasesWithTax: 880000, interestRate: 12500, salesPartner: "株式会社山田商事", purchasePartner: "名古屋金属工業" },
    { month: "2025-10", sales: 3000000, purchases: 1000000, utilities: 30000, supplies: 14000, prevSalesWithTax: 3520000, prevPurchasesWithTax: 1210000, interestRate: 12000, salesPartner: "東京電子工業", purchasePartner: "大阪部品" },
    { month: "2025-11", sales: 2800000, purchases: 1000000, utilities: 35000, supplies: 16000, prevSalesWithTax: 3300000, prevPurchasesWithTax: 1100000, interestRate: 11500, salesPartner: "株式会社山田商事", purchasePartner: "名古屋金属工業" },
    { month: "2025-12", sales: 3500000, purchases: 1200000, utilities: 40000, supplies: 25000, prevSalesWithTax: 3080000, prevPurchasesWithTax: 1100000, interestRate: 11000, salesPartner: "株式会社山田商事", purchasePartner: "大阪部品" },
    { month: "2026-01", sales: 2500000, purchases: 900000, utilities: 42000, supplies: 12000, prevSalesWithTax: 3850000, prevPurchasesWithTax: 1320000, interestRate: 10500, salesPartner: "東京電子工業", purchasePartner: "大阪部品" },
    { month: "2026-02", sales: 2300000, purchases: 850000, utilities: 38000, supplies: 10000, prevSalesWithTax: 2750000, prevPurchasesWithTax: 990000, interestRate: 10000, salesPartner: "株式会社山田商事", purchasePartner: "名古屋金属工業" },
    { month: "2026-03", sales: 3200000, purchases: 1100000, utilities: 30000, supplies: 20000, prevSalesWithTax: 2530000, prevPurchasesWithTax: 935000, interestRate: 9500, salesPartner: "株式会社山田商事", purchasePartner: "大阪部品" },
  ];

  for (const m of months) {
    const mm = m.month.split("-")[1];
    const lastDay = new Date(
      parseInt(m.month.split("-")[0]),
      parseInt(mm),
      0
    ).getDate();
    const lastDate = `${m.month}-${lastDay}`;
    const isJapaneseMonth = parseInt(mm);

    console.log(`  ${m.month} (${isJapaneseMonth}月)...`);

    // 前月売掛金回収
    await createJE(lastDate, `売掛金回収（前月売上分）`, [
      { account_code: "1120", debit: m.prevSalesWithTax, credit: 0 },
      { account_code: "1150", debit: 0, credit: m.prevSalesWithTax },
    ]);

    // 前月買掛金支払
    await createJE(lastDate, `買掛金支払（前月仕入分）`, [
      { account_code: "2100", debit: m.prevPurchasesWithTax, credit: 0 },
      { account_code: "1120", debit: 0, credit: m.prevPurchasesWithTax },
    ]);

    // 売上 + 消費税
    const salesTax = m.sales * 0.1;
    await createJE(`${m.month}-25`, `${m.salesPartner} ${isJapaneseMonth}月売上`, [
      { account_code: "1150", debit: m.sales + salesTax, credit: 0 },
      { account_code: "4100", debit: 0, credit: m.sales, tax_category: "sales_10", tax_rate: 0.1 },
      { account_code: "2500", debit: 0, credit: salesTax },
    ]);

    // 仕入 + 消費税
    const purchaseTax = m.purchases * 0.1;
    await createJE(`${m.month}-20`, `${m.purchasePartner} ${isJapaneseMonth}月仕入`, [
      { account_code: "5100", debit: m.purchases, credit: 0, tax_category: "purchase_10", tax_rate: 0.1 },
      { account_code: "1700", debit: purchaseTax, credit: 0 },
      { account_code: "2100", debit: 0, credit: m.purchases + purchaseTax },
    ]);

    // 給料
    await createJE(`${m.month}-25`, `${isJapaneseMonth}月分 給料`, [
      { account_code: "5200", debit: 1500000, credit: 0 },
      { account_code: "1120", debit: 0, credit: 1500000 },
    ]);

    // 法定福利費
    await createJE(`${m.month}-25`, `${isJapaneseMonth}月分 法定福利費`, [
      { account_code: "5210", debit: 225000, credit: 0 },
      { account_code: "1120", debit: 0, credit: 225000 },
    ]);

    // 家賃
    await createJE(`${m.month}-10`, `事務所家賃 ${isJapaneseMonth}月分`, [
      { account_code: "5400", debit: 180000, credit: 0 },
      { account_code: "1120", debit: 0, credit: 180000 },
    ]);

    // 通信費
    await createJE(`${m.month}-15`, `NTT 通信費 ${isJapaneseMonth}月分`, [
      { account_code: "5310", debit: 30000, credit: 0 },
      { account_code: "1120", debit: 0, credit: 30000 },
    ]);

    // 水道光熱費
    await createJE(`${m.month}-20`, `電気・ガス・水道 ${isJapaneseMonth}月分`, [
      { account_code: "5330", debit: m.utilities, credit: 0 },
      { account_code: "1120", debit: 0, credit: m.utilities },
    ]);

    // 消耗品費
    await createJE(`${m.month}-12`, `事務用品購入`, [
      { account_code: "5320", debit: m.supplies, credit: 0 },
      { account_code: "1100", debit: 0, credit: m.supplies },
    ], "ai");

    // 借入金返済
    await createJE(`${m.month}-28`, `長期借入金返済 ${isJapaneseMonth}月分`, [
      { account_code: "2600", debit: 100000, credit: 0 },
      { account_code: "5600", debit: m.interestRate, credit: 0 },
      { account_code: "1120", debit: 0, credit: 100000 + m.interestRate },
    ]);

    // 四半期: 接待交際費 (6月, 9月, 12月, 3月)
    if ([6, 9, 12, 3].includes(isJapaneseMonth)) {
      const entertainmentAmounts: Record<number, [number, string]> = {
        6: [55000, "得意先接待 割烹料理"],
        9: [65000, "得意先接待 ゴルフ"],
        12: [80000, "得意先忘年会"],
        3: [60000, "得意先接待 料亭"],
      };
      const [amount, desc] = entertainmentAmounts[isJapaneseMonth];
      await createJE(`${m.month}-18`, desc, [
        { account_code: "5800", debit: amount, credit: 0 },
        { account_code: "1100", debit: 0, credit: amount },
      ]);
    }

    // 9月: 旅費交通費
    if (isJapaneseMonth === 9) {
      await createJE("2025-09-12", "大阪出張 新幹線往復", [
        { account_code: "5300", debit: 28000, credit: 0 },
        { account_code: "1120", debit: 0, credit: 28000 },
      ]);
    }

    // 7月: 固定資産税 第1期
    if (isJapaneseMonth === 7) {
      await createJE("2025-07-05", "固定資産税 第1期", [
        { account_code: "5700", debit: 180000, credit: 0 },
        { account_code: "1120", debit: 0, credit: 180000 },
      ]);
    }

    // 12月: 固定資産税 第2期 + 会議費
    if (isJapaneseMonth === 12) {
      await createJE("2025-12-01", "固定資産税 第2期", [
        { account_code: "5700", debit: 180000, credit: 0 },
        { account_code: "1120", debit: 0, credit: 180000 },
      ]);
      await createJE("2025-12-05", "社内会議 会議室利用", [
        { account_code: "5810", debit: 15000, credit: 0 },
        { account_code: "1100", debit: 0, credit: 15000 },
      ]);
    }
  }

  // ========================================
  // 決算整理: 減価償却費
  // ========================================
  console.log("\n  決算整理 減価償却費...");

  // サーバー(器具備品): 1,200,000 / 5年 = 240,000
  await createJE("2026-03-31", "決算整理 減価償却費（器具備品）", [
    { account_code: "5500", debit: 240000, credit: 0 },
    { account_code: "1520", debit: 0, credit: 240000 },
  ]);

  // 車両: 定率法概算 350,000
  await createJE("2026-03-31", "決算整理 減価償却費（車両運搬具）", [
    { account_code: "5500", debit: 350000, credit: 0 },
    { account_code: "1510", debit: 0, credit: 350000 },
  ]);

  // 建物: 8,000,000 / 15年 ≒ 533,333
  await createJE("2026-03-31", "決算整理 減価償却費（建物）", [
    { account_code: "5500", debit: 533333, credit: 0 },
    { account_code: "1500", debit: 0, credit: 533333 },
  ]);

  // ========================================
  // 検証
  // ========================================
  console.log("\n=== 検証 ===\n");

  const { count } = await admin
    .from("journal_entries")
    .select("*", { count: "exact", head: true })
    .eq("client_id", CID);
  console.log(`  仕訳件数: ${count}`);

  const { data: lineCount } = await admin
    .from("journal_entry_lines")
    .select("journal_entry_id, journal_entries!inner(client_id)", { count: "exact", head: false })
    .eq("journal_entries.client_id", CID);
  console.log(`  仕訳明細件数: ${lineCount?.length ?? 0}`);

  // 借方・貸方合計チェック
  const { data: totals } = await admin
    .from("journal_entry_lines")
    .select("debit_amount, credit_amount, journal_entries!inner(client_id)")
    .eq("journal_entries.client_id", CID);

  let totalDebit = 0;
  let totalCredit = 0;
  for (const t of totals ?? []) {
    totalDebit += t.debit_amount;
    totalCredit += t.credit_amount;
  }
  console.log(`  借方合計: ${totalDebit.toLocaleString()}`);
  console.log(`  貸方合計: ${totalCredit.toLocaleString()}`);
  console.log(`  差額: ${(totalDebit - totalCredit).toLocaleString()}`);
  console.log(`  貸借一致: ${totalDebit === totalCredit ? "✅ OK" : "❌ NG"}`);

  console.log("\n=== 完了 ===");
}

main().catch((e) => {
  console.error("Error:", e);
  process.exit(1);
});
