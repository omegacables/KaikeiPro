-- ============================================================================
-- KaikeiPro Seed Data
-- テスト用サンプルデータ
-- ============================================================================
--
-- 使い方:
-- 1. Supabase ダッシュボード → SQL Editor で実行
-- 2. 事前に 001_initial_schema.sql が実行済みであること
-- 3. テスト用ユーザーは Supabase Auth で作成した後、
--    下記の user_id を実際のUUIDに置き換えてください
--
-- テスト用アカウント（Supabase Auth で作成してください）:
--   スタッフ: staff@example.com / password123
--   顧問先:   client@example.com / password123
-- ============================================================================

-- ----------------------------------------------------------------------------
-- テスト用 firm (税理士事務所)
-- ----------------------------------------------------------------------------
INSERT INTO firms (id, name, postal_code, address, telephone, email, invoice_registration_number) VALUES
  ('00000000-0000-0000-0000-000000000001',
   '田中税理士事務所',
   '100-0005',
   '東京都千代田区丸の内1-1-1',
   '03-1234-5678',
   'info@tanaka-tax.jp',
   'T1000000000001');

-- ----------------------------------------------------------------------------
-- テスト用 firm_member (事務所スタッフ)
-- ※ user_id は Supabase Auth で作成したユーザーのUUIDに置き換えてください
-- ----------------------------------------------------------------------------
-- 下記はプレースホルダーUUIDです。実際のauth.users.idに置き換えてください。
INSERT INTO firm_members (id, firm_id, user_id, name, email, role) VALUES
  ('00000000-0000-0000-0000-000000000011',
   '00000000-0000-0000-0000-000000000001',
   '00000000-0000-0000-0000-aaaaaaaaaaaa',  -- ← staff@example.com の auth.uid() に置き換え
   '田中 健二',
   'staff@example.com',
   'admin');

-- ----------------------------------------------------------------------------
-- テスト用 clients (顧問先)
-- ----------------------------------------------------------------------------
INSERT INTO clients (id, firm_id, name, business_type, postal_code, address, telephone, email, fiscal_year_start_month, tax_method, invoice_registration_number) VALUES
  ('00000000-0000-0000-0000-000000000101',
   '00000000-0000-0000-0000-000000000001',
   '松田工業株式会社',
   '製造業',
   '100-0001',
   '東京都千代田区千代田1-1-1',
   '03-1111-2222',
   'info@matsuda-kogyo.co.jp',
   4,
   'standard',
   'T1234567890123'),

  ('00000000-0000-0000-0000-000000000102',
   '00000000-0000-0000-0000-000000000001',
   'ヤマトテックソリューションズ',
   'IT・通信',
   '150-0002',
   '東京都渋谷区渋谷2-3-4',
   '03-3333-4444',
   'info@yamato-tech.co.jp',
   1,
   'standard',
   'T2345678901234'),

  ('00000000-0000-0000-0000-000000000103',
   '00000000-0000-0000-0000-000000000001',
   '佐藤居酒屋グループ',
   '飲食業',
   '160-0023',
   '東京都新宿区西新宿5-6-7',
   '03-5555-6666',
   'info@sato-izakaya.co.jp',
   10,
   'simplified',
   NULL),

  ('00000000-0000-0000-0000-000000000104',
   '00000000-0000-0000-0000-000000000001',
   '東京ネットワーク株式会社',
   'IT・通信',
   '108-0075',
   '東京都港区港南3-4-5',
   '03-7777-8888',
   'info@tokyo-network.co.jp',
   4,
   'standard',
   'T4567890123456'),

  ('00000000-0000-0000-0000-000000000105',
   '00000000-0000-0000-0000-000000000001',
   '関西商事株式会社',
   '卸売業',
   '541-0046',
   '大阪府大阪市中央区平野町1-2-3',
   '06-1111-2222',
   'info@kansai-shoji.co.jp',
   7,
   'standard',
   'T5678901234567'),

  ('00000000-0000-0000-0000-000000000106',
   '00000000-0000-0000-0000-000000000001',
   '北海道フーズ株式会社',
   '食品製造',
   '060-0001',
   '北海道札幌市中央区北1条西1-1-1',
   '011-222-3333',
   'info@hokkaido-foods.co.jp',
   4,
   'simplified',
   'T6789012345678');

-- ----------------------------------------------------------------------------
-- テスト用 client_user (顧問先ポータルユーザー)
-- ※ user_id は Supabase Auth で作成したユーザーのUUIDに置き換えてください
-- ----------------------------------------------------------------------------
INSERT INTO client_users (id, client_id, user_id, name, email) VALUES
  ('00000000-0000-0000-0000-000000000021',
   '00000000-0000-0000-0000-000000000101',
   '00000000-0000-0000-0000-bbbbbbbbbbbb',  -- ← client@example.com の auth.uid() に置き換え
   '松田 太郎',
   'client@example.com');

-- ----------------------------------------------------------------------------
-- 標準勘定科目セット (デフォルト科目)
-- account_categories は 001_initial_schema.sql で投入済み
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  cat_assets uuid;
  cat_liabilities uuid;
  cat_equity uuid;
  cat_revenue uuid;
  cat_expenses uuid;
BEGIN
  SELECT id INTO cat_assets FROM account_categories WHERE type = 'assets';
  SELECT id INTO cat_liabilities FROM account_categories WHERE type = 'liabilities';
  SELECT id INTO cat_equity FROM account_categories WHERE type = 'equity';
  SELECT id INTO cat_revenue FROM account_categories WHERE type = 'revenue';
  SELECT id INTO cat_expenses FROM account_categories WHERE type = 'expenses';

  -- 資産
  INSERT INTO accounts (client_id, category_id, code, name, is_default) VALUES
    (NULL, cat_assets, '1100', '現金', true),
    (NULL, cat_assets, '1120', '普通預金', true),
    (NULL, cat_assets, '1130', '当座預金', true),
    (NULL, cat_assets, '1150', '売掛金', true),
    (NULL, cat_assets, '1200', '受取手形', true),
    (NULL, cat_assets, '1300', '棚卸資産', true),
    (NULL, cat_assets, '1400', '前払費用', true),
    (NULL, cat_assets, '1500', '建物', true),
    (NULL, cat_assets, '1510', '車両運搬具', true),
    (NULL, cat_assets, '1520', '器具備品', true),
    (NULL, cat_assets, '1600', 'ソフトウェア', true),
    (NULL, cat_assets, '1700', '仮払消費税', true);

  -- 負債
  INSERT INTO accounts (client_id, category_id, code, name, is_default) VALUES
    (NULL, cat_liabilities, '2100', '買掛金', true),
    (NULL, cat_liabilities, '2110', '支払手形', true),
    (NULL, cat_liabilities, '2200', '短期借入金', true),
    (NULL, cat_liabilities, '2300', '未払金', true),
    (NULL, cat_liabilities, '2310', '未払費用', true),
    (NULL, cat_liabilities, '2400', '預り金', true),
    (NULL, cat_liabilities, '2500', '仮受消費税', true),
    (NULL, cat_liabilities, '2600', '長期借入金', true);

  -- 純資産
  INSERT INTO accounts (client_id, category_id, code, name, is_default) VALUES
    (NULL, cat_equity, '3100', '資本金', true),
    (NULL, cat_equity, '3200', '資本剰余金', true),
    (NULL, cat_equity, '3300', '利益剰余金', true),
    (NULL, cat_equity, '3310', '繰越利益剰余金', true);

  -- 収益
  INSERT INTO accounts (client_id, category_id, code, name, is_default) VALUES
    (NULL, cat_revenue, '4100', '売上高', true),
    (NULL, cat_revenue, '4200', '受取利息', true),
    (NULL, cat_revenue, '4300', '受取配当金', true),
    (NULL, cat_revenue, '4400', '雑収入', true);

  -- 費用
  INSERT INTO accounts (client_id, category_id, code, name, is_default) VALUES
    (NULL, cat_expenses, '5100', '仕入高', true),
    (NULL, cat_expenses, '5200', '給料手当', true),
    (NULL, cat_expenses, '5210', '法定福利費', true),
    (NULL, cat_expenses, '5220', '福利厚生費', true),
    (NULL, cat_expenses, '5300', '旅費交通費', true),
    (NULL, cat_expenses, '5310', '通信費', true),
    (NULL, cat_expenses, '5320', '消耗品費', true),
    (NULL, cat_expenses, '5330', '水道光熱費', true),
    (NULL, cat_expenses, '5400', '地代家賃', true),
    (NULL, cat_expenses, '5500', '減価償却費', true),
    (NULL, cat_expenses, '5600', '支払利息', true),
    (NULL, cat_expenses, '5700', '租税公課', true),
    (NULL, cat_expenses, '5800', '接待交際費', true),
    (NULL, cat_expenses, '5810', '会議費', true),
    (NULL, cat_expenses, '5820', '新聞図書費', true);
END $$;

-- ----------------------------------------------------------------------------
-- 会計年度
-- ----------------------------------------------------------------------------
INSERT INTO fiscal_years (id, client_id, start_date, end_date, status) VALUES
  ('00000000-0000-0000-0000-000000000201',
   '00000000-0000-0000-0000-000000000101',
   '2025-04-01', '2026-03-31', 'open'),
  ('00000000-0000-0000-0000-000000000202',
   '00000000-0000-0000-0000-000000000102',
   '2025-01-01', '2025-12-31', 'open'),
  ('00000000-0000-0000-0000-000000000203',
   '00000000-0000-0000-0000-000000000103',
   '2025-10-01', '2026-09-30', 'open');

-- ----------------------------------------------------------------------------
-- 取引先
-- ----------------------------------------------------------------------------
INSERT INTO business_partners (id, client_id, name, type, telephone, email, invoice_registration_number, is_invoice_registered) VALUES
  ('00000000-0000-0000-0000-000000000301',
   '00000000-0000-0000-0000-000000000101',
   '株式会社山田商事', 'customer', '03-1234-5678', 'contact@yamada-shoji.co.jp', 'T1234567890123', true),
  ('00000000-0000-0000-0000-000000000302',
   '00000000-0000-0000-0000-000000000101',
   '東京電子工業株式会社', 'customer', '03-2345-6789', 'info@tokyo-denshi.co.jp', 'T2345678901234', true),
  ('00000000-0000-0000-0000-000000000303',
   '00000000-0000-0000-0000-000000000101',
   '大阪部品株式会社', 'vendor', '06-3456-7890', 'order@osaka-buhin.co.jp', 'T3456789012345', true),
  ('00000000-0000-0000-0000-000000000304',
   '00000000-0000-0000-0000-000000000101',
   '名古屋金属工業株式会社', 'vendor', '052-4567-8901', 'sales@nagoya-kinzoku.co.jp', 'T4567890123456', true),
  ('00000000-0000-0000-0000-000000000305',
   '00000000-0000-0000-0000-000000000101',
   '九州運輸株式会社', 'both', '092-5678-9012', 'info@kyushu-unyu.co.jp', 'T5678901234567', true);

-- ----------------------------------------------------------------------------
-- 提出スケジュール & 期間
-- ----------------------------------------------------------------------------
INSERT INTO submission_schedules (client_id, frequency, due_day, reminder_days, notification_methods) VALUES
  ('00000000-0000-0000-0000-000000000101', 'monthly', 10, '[3, 1, 0]', '["app"]'),
  ('00000000-0000-0000-0000-000000000102', 'monthly', 15, '[5, 3, 1, 0]', '["app", "email"]'),
  ('00000000-0000-0000-0000-000000000103', 'monthly', 10, '[3, 1, 0]', '["app"]');

INSERT INTO submission_periods (client_id, period_start, period_end, due_date, status, receipt_count) VALUES
  ('00000000-0000-0000-0000-000000000101', '2026-01-01', '2026-01-31', '2026-02-10', 'completed', 12),
  ('00000000-0000-0000-0000-000000000101', '2026-02-01', '2026-02-28', '2026-03-10', 'pending', 5),
  ('00000000-0000-0000-0000-000000000102', '2026-01-01', '2026-01-31', '2026-02-15', 'submitted', 8),
  ('00000000-0000-0000-0000-000000000102', '2026-02-01', '2026-02-28', '2026-03-15', 'pending', 2),
  ('00000000-0000-0000-0000-000000000103', '2026-01-01', '2026-01-31', '2026-02-10', 'overdue', 0);

-- ============================================================================
-- 試算表・財務諸表用 仕訳データ (松田工業)
-- 会計期間: 2025-04-01 〜 2026-03-31
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 期首残高仕訳 (2025-04-01)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  cid constant text := '00000000-0000-0000-0000-000000000101';
  uid constant text := '00000000-0000-0000-0000-aaaaaaaaaaaa';
  -- 資産
  acc_cash uuid;
  acc_deposit uuid;
  acc_receivable uuid;
  acc_building uuid;
  acc_vehicle uuid;
  acc_equipment uuid;
  -- 負債
  acc_payable uuid;
  acc_longterm_loan uuid;
  -- 純資産
  acc_capital uuid;
  acc_retained uuid;
  -- 収益
  acc_sales uuid;
  -- 費用
  acc_purchases uuid;
  acc_salary uuid;
  acc_welfare uuid;
  acc_travel uuid;
  acc_comm uuid;
  acc_supplies uuid;
  acc_utilities uuid;
  acc_rent uuid;
  acc_depreciation uuid;
  acc_interest uuid;
  acc_tax_expense uuid;
  acc_entertainment uuid;
  acc_meeting uuid;
  -- 税金
  acc_tax_pay uuid;   -- 仮払消費税
  acc_tax_recv uuid;  -- 仮受消費税
  -- 仕訳ID
  je_id uuid;
BEGIN
  -- 勘定科目ID取得
  SELECT id INTO acc_cash FROM accounts WHERE code = '1100' AND client_id IS NULL LIMIT 1;
  SELECT id INTO acc_deposit FROM accounts WHERE code = '1120' AND client_id IS NULL LIMIT 1;
  SELECT id INTO acc_receivable FROM accounts WHERE code = '1150' AND client_id IS NULL LIMIT 1;
  SELECT id INTO acc_building FROM accounts WHERE code = '1500' AND client_id IS NULL LIMIT 1;
  SELECT id INTO acc_vehicle FROM accounts WHERE code = '1510' AND client_id IS NULL LIMIT 1;
  SELECT id INTO acc_equipment FROM accounts WHERE code = '1520' AND client_id IS NULL LIMIT 1;
  SELECT id INTO acc_payable FROM accounts WHERE code = '2100' AND client_id IS NULL LIMIT 1;
  SELECT id INTO acc_longterm_loan FROM accounts WHERE code = '2600' AND client_id IS NULL LIMIT 1;
  SELECT id INTO acc_capital FROM accounts WHERE code = '3100' AND client_id IS NULL LIMIT 1;
  SELECT id INTO acc_retained FROM accounts WHERE code = '3310' AND client_id IS NULL LIMIT 1;
  SELECT id INTO acc_sales FROM accounts WHERE code = '4100' AND client_id IS NULL LIMIT 1;
  SELECT id INTO acc_purchases FROM accounts WHERE code = '5100' AND client_id IS NULL LIMIT 1;
  SELECT id INTO acc_salary FROM accounts WHERE code = '5200' AND client_id IS NULL LIMIT 1;
  SELECT id INTO acc_welfare FROM accounts WHERE code = '5210' AND client_id IS NULL LIMIT 1;
  SELECT id INTO acc_travel FROM accounts WHERE code = '5300' AND client_id IS NULL LIMIT 1;
  SELECT id INTO acc_comm FROM accounts WHERE code = '5310' AND client_id IS NULL LIMIT 1;
  SELECT id INTO acc_supplies FROM accounts WHERE code = '5320' AND client_id IS NULL LIMIT 1;
  SELECT id INTO acc_utilities FROM accounts WHERE code = '5330' AND client_id IS NULL LIMIT 1;
  SELECT id INTO acc_rent FROM accounts WHERE code = '5400' AND client_id IS NULL LIMIT 1;
  SELECT id INTO acc_depreciation FROM accounts WHERE code = '5500' AND client_id IS NULL LIMIT 1;
  SELECT id INTO acc_interest FROM accounts WHERE code = '5600' AND client_id IS NULL LIMIT 1;
  SELECT id INTO acc_tax_expense FROM accounts WHERE code = '5700' AND client_id IS NULL LIMIT 1;
  SELECT id INTO acc_entertainment FROM accounts WHERE code = '5800' AND client_id IS NULL LIMIT 1;
  SELECT id INTO acc_meeting FROM accounts WHERE code = '5810' AND client_id IS NULL LIMIT 1;
  SELECT id INTO acc_tax_pay FROM accounts WHERE code = '1700' AND client_id IS NULL LIMIT 1;
  SELECT id INTO acc_tax_recv FROM accounts WHERE code = '2500' AND client_id IS NULL LIMIT 1;

  -- ========================================================================
  -- 期首残高 (2025-04-01)
  -- 借方: 現金500,000 + 預金8,000,000 + 売掛金2,500,000 + 建物8,000,000
  --       + 車両3,500,000 + 器具備品1,200,000 = 23,700,000
  -- 貸方: 買掛金900,000 + 長期借入金5,000,000 + 資本金10,000,000
  --       + 繰越利益剰余金7,800,000 = 23,700,000
  -- ========================================================================
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-04-01', '期首残高', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_cash,          500000, 0, 0),
    (je_id, acc_deposit,      8000000, 0, 1),
    (je_id, acc_receivable,   2500000, 0, 2),
    (je_id, acc_building,     8000000, 0, 3),
    (je_id, acc_vehicle,      3500000, 0, 4),
    (je_id, acc_equipment,    1200000, 0, 5),
    (je_id, acc_payable,            0, 900000, 6),
    (je_id, acc_longterm_loan,      0, 5000000, 7),
    (je_id, acc_capital,            0, 10000000, 8),
    (je_id, acc_retained,           0, 7800000, 9);

  -- ========================================================================
  -- 2025年4月
  -- ========================================================================
  -- 前月売掛金回収 (期首残高分)
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-04-30', '売掛金回収（3月売上分）', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_deposit, 2500000, 0, 0),
    (je_id, acc_receivable, 0, 2500000, 1);

  -- 前月買掛金支払 (期首残高分)
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-04-30', '買掛金支払（3月仕入分）', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_payable, 900000, 0, 0),
    (je_id, acc_deposit, 0, 900000, 1);

  -- 売上 2,500,000 + 消費税250,000
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-04-25', '株式会社山田商事 4月売上', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, tax_category, tax_rate, sort_order) VALUES
    (je_id, acc_receivable, 2750000, 0, NULL, NULL, 0),
    (je_id, acc_sales,      0, 2500000, 'sales_10', 0.10, 1),
    (je_id, acc_tax_recv,   0, 250000, NULL, NULL, 2);

  -- 仕入 1,000,000 + 消費税100,000
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-04-20', '大阪部品 4月仕入', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, tax_category, tax_rate, sort_order) VALUES
    (je_id, acc_purchases, 1000000, 0, 'purchase_10', 0.10, 0),
    (je_id, acc_tax_pay,    100000, 0, NULL, NULL, 1),
    (je_id, acc_payable,         0, 1100000, NULL, NULL, 2);

  -- 給料
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-04-25', '4月分 給料', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_salary, 1500000, 0, 0),
    (je_id, acc_deposit, 0, 1500000, 1);

  -- 法定福利費
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-04-25', '4月分 法定福利費', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_welfare, 225000, 0, 0),
    (je_id, acc_deposit, 0, 225000, 1);

  -- 家賃
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-04-10', '事務所家賃 4月分', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_rent, 180000, 0, 0),
    (je_id, acc_deposit, 0, 180000, 1);

  -- 通信費 30,000
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-04-15', 'NTT 通信費 4月分', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_comm, 30000, 0, 0),
    (je_id, acc_deposit, 0, 30000, 1);

  -- 水道光熱費 28,000
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-04-20', '電気・ガス・水道 4月分', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_utilities, 28000, 0, 0),
    (je_id, acc_deposit, 0, 28000, 1);

  -- 消耗品費 15,000
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-04-18', '事務用品購入', 'confirmed', 'ai', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_supplies, 15000, 0, 0),
    (je_id, acc_cash, 0, 15000, 1);

  -- 借入金返済 元本100,000 + 利息15,000
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-04-28', '長期借入金返済 4月分', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_longterm_loan, 100000, 0, 0),
    (je_id, acc_interest, 15000, 0, 1),
    (je_id, acc_deposit, 0, 115000, 2);

  -- ========================================================================
  -- 2025年5月
  -- ========================================================================
  -- 売掛金回収（4月売上分）
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-05-31', '売掛金回収（4月売上分）', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_deposit, 2750000, 0, 0),
    (je_id, acc_receivable, 0, 2750000, 1);

  -- 買掛金支払（4月仕入分）
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-05-31', '買掛金支払（4月仕入分）', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_payable, 1100000, 0, 0),
    (je_id, acc_deposit, 0, 1100000, 1);

  -- 売上 2,300,000 + 税230,000
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-05-25', '株式会社山田商事 5月売上', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, tax_category, tax_rate, sort_order) VALUES
    (je_id, acc_receivable, 2530000, 0, NULL, NULL, 0),
    (je_id, acc_sales, 0, 2300000, 'sales_10', 0.10, 1),
    (je_id, acc_tax_recv, 0, 230000, NULL, NULL, 2);

  -- 仕入 900,000 + 税90,000
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-05-20', '大阪部品 5月仕入', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, tax_category, tax_rate, sort_order) VALUES
    (je_id, acc_purchases, 900000, 0, 'purchase_10', 0.10, 0),
    (je_id, acc_tax_pay, 90000, 0, NULL, NULL, 1),
    (je_id, acc_payable, 0, 990000, NULL, NULL, 2);

  -- 給料・福利費
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-05-25', '5月分 給料', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_salary, 1500000, 0, 0), (je_id, acc_deposit, 0, 1500000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-05-25', '5月分 法定福利費', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_welfare, 225000, 0, 0), (je_id, acc_deposit, 0, 225000, 1);

  -- 家賃・通信費・光熱費・消耗品
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-05-10', '事務所家賃 5月分', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_rent, 180000, 0, 0), (je_id, acc_deposit, 0, 180000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-05-15', 'NTT 通信費 5月分', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_comm, 30000, 0, 0), (je_id, acc_deposit, 0, 30000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-05-20', '電気・ガス・水道 5月分', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_utilities, 26000, 0, 0), (je_id, acc_deposit, 0, 26000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-05-12', '事務用品購入', 'confirmed', 'ai', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_supplies, 12000, 0, 0), (je_id, acc_cash, 0, 12000, 1);

  -- 借入金返済
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-05-28', '長期借入金返済 5月分', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_longterm_loan, 100000, 0, 0), (je_id, acc_interest, 14500, 0, 1), (je_id, acc_deposit, 0, 114500, 2);

  -- ========================================================================
  -- 2025年6月 (四半期: 接待交際費あり)
  -- ========================================================================
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-06-30', '売掛金回収（5月売上分）', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_deposit, 2530000, 0, 0), (je_id, acc_receivable, 0, 2530000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-06-30', '買掛金支払（5月仕入分）', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_payable, 990000, 0, 0), (je_id, acc_deposit, 0, 990000, 1);

  -- 売上 2,800,000 + 税280,000
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-06-25', '東京電子工業 6月売上', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, tax_category, tax_rate, sort_order) VALUES
    (je_id, acc_receivable, 3080000, 0, NULL, NULL, 0),
    (je_id, acc_sales, 0, 2800000, 'sales_10', 0.10, 1),
    (je_id, acc_tax_recv, 0, 280000, NULL, NULL, 2);

  -- 仕入 1,100,000 + 税110,000
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-06-20', '名古屋金属工業 6月仕入', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, tax_category, tax_rate, sort_order) VALUES
    (je_id, acc_purchases, 1100000, 0, 'purchase_10', 0.10, 0),
    (je_id, acc_tax_pay, 110000, 0, NULL, NULL, 1),
    (je_id, acc_payable, 0, 1210000, NULL, NULL, 2);

  -- 給料・福利費・家賃・通信費・光熱費・消耗品
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-06-25', '6月分 給料', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_salary, 1500000, 0, 0), (je_id, acc_deposit, 0, 1500000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-06-25', '6月分 法定福利費', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_welfare, 225000, 0, 0), (je_id, acc_deposit, 0, 225000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-06-10', '事務所家賃 6月分', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_rent, 180000, 0, 0), (je_id, acc_deposit, 0, 180000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-06-15', 'NTT 通信費 6月分', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_comm, 30000, 0, 0), (je_id, acc_deposit, 0, 30000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-06-20', '電気・ガス・水道 6月分', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_utilities, 32000, 0, 0), (je_id, acc_deposit, 0, 32000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-06-08', '事務用品購入', 'confirmed', 'ai', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_supplies, 18000, 0, 0), (je_id, acc_cash, 0, 18000, 1);

  -- 借入金返済
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-06-28', '長期借入金返済 6月分', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_longterm_loan, 100000, 0, 0), (je_id, acc_interest, 14000, 0, 1), (je_id, acc_deposit, 0, 114000, 2);

  -- 接待交際費（Q1）
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-06-22', '得意先接待 割烹料理', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_entertainment, 55000, 0, 0), (je_id, acc_cash, 0, 55000, 1);

  -- ========================================================================
  -- 2025年7月
  -- ========================================================================
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-07-31', '売掛金回収（6月売上分）', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_deposit, 3080000, 0, 0), (je_id, acc_receivable, 0, 3080000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-07-31', '買掛金支払（6月仕入分）', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_payable, 1210000, 0, 0), (je_id, acc_deposit, 0, 1210000, 1);

  -- 売上 3,000,000 + 税300,000
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-07-25', '株式会社山田商事 7月売上', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, tax_category, tax_rate, sort_order) VALUES
    (je_id, acc_receivable, 3300000, 0, NULL, NULL, 0),
    (je_id, acc_sales, 0, 3000000, 'sales_10', 0.10, 1),
    (je_id, acc_tax_recv, 0, 300000, NULL, NULL, 2);

  -- 仕入 1,200,000 + 税120,000
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-07-20', '大阪部品 7月仕入', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, tax_category, tax_rate, sort_order) VALUES
    (je_id, acc_purchases, 1200000, 0, 'purchase_10', 0.10, 0),
    (je_id, acc_tax_pay, 120000, 0, NULL, NULL, 1),
    (je_id, acc_payable, 0, 1320000, NULL, NULL, 2);

  -- 固定費
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-07-25', '7月分 給料', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_salary, 1500000, 0, 0), (je_id, acc_deposit, 0, 1500000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-07-25', '7月分 法定福利費', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_welfare, 225000, 0, 0), (je_id, acc_deposit, 0, 225000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-07-10', '事務所家賃 7月分', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_rent, 180000, 0, 0), (je_id, acc_deposit, 0, 180000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-07-15', 'NTT 通信費 7月分', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_comm, 30000, 0, 0), (je_id, acc_deposit, 0, 30000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-07-20', '電気・ガス・水道 7月分', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_utilities, 42000, 0, 0), (je_id, acc_deposit, 0, 42000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-07-14', '事務用品購入', 'confirmed', 'ai', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_supplies, 20000, 0, 0), (je_id, acc_cash, 0, 20000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-07-28', '長期借入金返済 7月分', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_longterm_loan, 100000, 0, 0), (je_id, acc_interest, 13500, 0, 1), (je_id, acc_deposit, 0, 113500, 2);

  -- 租税公課（固定資産税 第1期）
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-07-05', '固定資産税 第1期', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_tax_expense, 180000, 0, 0), (je_id, acc_deposit, 0, 180000, 1);

  -- ========================================================================
  -- 2025年8月
  -- ========================================================================
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-08-29', '売掛金回収（7月売上分）', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_deposit, 3300000, 0, 0), (je_id, acc_receivable, 0, 3300000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-08-29', '買掛金支払（7月仕入分）', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_payable, 1320000, 0, 0), (je_id, acc_deposit, 0, 1320000, 1);

  -- 売上 2,200,000 + 税220,000（お盆で少ない）
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-08-25', '東京電子工業 8月売上', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, tax_category, tax_rate, sort_order) VALUES
    (je_id, acc_receivable, 2420000, 0, NULL, NULL, 0),
    (je_id, acc_sales, 0, 2200000, 'sales_10', 0.10, 1),
    (je_id, acc_tax_recv, 0, 220000, NULL, NULL, 2);

  -- 仕入 800,000 + 税80,000
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-08-20', '大阪部品 8月仕入', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, tax_category, tax_rate, sort_order) VALUES
    (je_id, acc_purchases, 800000, 0, 'purchase_10', 0.10, 0),
    (je_id, acc_tax_pay, 80000, 0, NULL, NULL, 1),
    (je_id, acc_payable, 0, 880000, NULL, NULL, 2);

  -- 固定費
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-08-25', '8月分 給料', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_salary, 1500000, 0, 0), (je_id, acc_deposit, 0, 1500000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-08-25', '8月分 法定福利費', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_welfare, 225000, 0, 0), (je_id, acc_deposit, 0, 225000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-08-10', '事務所家賃 8月分', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_rent, 180000, 0, 0), (je_id, acc_deposit, 0, 180000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-08-15', 'NTT 通信費 8月分', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_comm, 30000, 0, 0), (je_id, acc_deposit, 0, 30000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-08-20', '電気・ガス・水道 8月分', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_utilities, 45000, 0, 0), (je_id, acc_deposit, 0, 45000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-08-08', '事務用品購入', 'confirmed', 'ai', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_supplies, 10000, 0, 0), (je_id, acc_cash, 0, 10000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-08-28', '長期借入金返済 8月分', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_longterm_loan, 100000, 0, 0), (je_id, acc_interest, 13000, 0, 1), (je_id, acc_deposit, 0, 113000, 2);

  -- ========================================================================
  -- 2025年9月 (四半期: 接待交際費あり)
  -- ========================================================================
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-09-30', '売掛金回収（8月売上分）', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_deposit, 2420000, 0, 0), (je_id, acc_receivable, 0, 2420000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-09-30', '買掛金支払（8月仕入分）', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_payable, 880000, 0, 0), (je_id, acc_deposit, 0, 880000, 1);

  -- 売上 3,200,000 + 税320,000
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-09-25', '株式会社山田商事 9月売上', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, tax_category, tax_rate, sort_order) VALUES
    (je_id, acc_receivable, 3520000, 0, NULL, NULL, 0),
    (je_id, acc_sales, 0, 3200000, 'sales_10', 0.10, 1),
    (je_id, acc_tax_recv, 0, 320000, NULL, NULL, 2);

  -- 仕入 1,100,000 + 税110,000
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-09-20', '名古屋金属工業 9月仕入', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, tax_category, tax_rate, sort_order) VALUES
    (je_id, acc_purchases, 1100000, 0, 'purchase_10', 0.10, 0),
    (je_id, acc_tax_pay, 110000, 0, NULL, NULL, 1),
    (je_id, acc_payable, 0, 1210000, NULL, NULL, 2);

  -- 固定費
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-09-25', '9月分 給料', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_salary, 1500000, 0, 0), (je_id, acc_deposit, 0, 1500000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-09-25', '9月分 法定福利費', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_welfare, 225000, 0, 0), (je_id, acc_deposit, 0, 225000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-09-10', '事務所家賃 9月分', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_rent, 180000, 0, 0), (je_id, acc_deposit, 0, 180000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-09-15', 'NTT 通信費 9月分', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_comm, 30000, 0, 0), (je_id, acc_deposit, 0, 30000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-09-20', '電気・ガス・水道 9月分', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_utilities, 38000, 0, 0), (je_id, acc_deposit, 0, 38000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-09-10', '事務用品購入', 'confirmed', 'ai', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_supplies, 22000, 0, 0), (je_id, acc_cash, 0, 22000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-09-28', '長期借入金返済 9月分', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_longterm_loan, 100000, 0, 0), (je_id, acc_interest, 12500, 0, 1), (je_id, acc_deposit, 0, 112500, 2);

  -- 接待交際費（Q2）
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-09-18', '得意先接待 ゴルフ', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_entertainment, 65000, 0, 0), (je_id, acc_cash, 0, 65000, 1);

  -- 旅費交通費
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-09-12', '大阪出張 新幹線往復', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_travel, 28000, 0, 0), (je_id, acc_deposit, 0, 28000, 1);

  -- ========================================================================
  -- 2025年10月
  -- ========================================================================
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-10-31', '売掛金回収（9月売上分）', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_deposit, 3520000, 0, 0), (je_id, acc_receivable, 0, 3520000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-10-31', '買掛金支払（9月仕入分）', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_payable, 1210000, 0, 0), (je_id, acc_deposit, 0, 1210000, 1);

  -- 売上 3,000,000 + 税300,000
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-10-25', '東京電子工業 10月売上', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, tax_category, tax_rate, sort_order) VALUES
    (je_id, acc_receivable, 3300000, 0, NULL, NULL, 0),
    (je_id, acc_sales, 0, 3000000, 'sales_10', 0.10, 1),
    (je_id, acc_tax_recv, 0, 300000, NULL, NULL, 2);

  -- 仕入 1,000,000 + 税100,000
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-10-20', '大阪部品 10月仕入', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, tax_category, tax_rate, sort_order) VALUES
    (je_id, acc_purchases, 1000000, 0, 'purchase_10', 0.10, 0),
    (je_id, acc_tax_pay, 100000, 0, NULL, NULL, 1),
    (je_id, acc_payable, 0, 1100000, NULL, NULL, 2);

  -- 固定費
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-10-25', '10月分 給料', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_salary, 1500000, 0, 0), (je_id, acc_deposit, 0, 1500000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-10-25', '10月分 法定福利費', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_welfare, 225000, 0, 0), (je_id, acc_deposit, 0, 225000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-10-10', '事務所家賃 10月分', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_rent, 180000, 0, 0), (je_id, acc_deposit, 0, 180000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-10-15', 'NTT 通信費 10月分', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_comm, 30000, 0, 0), (je_id, acc_deposit, 0, 30000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-10-20', '電気・ガス・水道 10月分', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_utilities, 30000, 0, 0), (je_id, acc_deposit, 0, 30000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-10-09', '事務用品購入', 'confirmed', 'ai', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_supplies, 14000, 0, 0), (je_id, acc_cash, 0, 14000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-10-28', '長期借入金返済 10月分', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_longterm_loan, 100000, 0, 0), (je_id, acc_interest, 12000, 0, 1), (je_id, acc_deposit, 0, 112000, 2);

  -- ========================================================================
  -- 2025年11月
  -- ========================================================================
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-11-28', '売掛金回収（10月売上分）', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_deposit, 3300000, 0, 0), (je_id, acc_receivable, 0, 3300000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-11-28', '買掛金支払（10月仕入分）', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_payable, 1100000, 0, 0), (je_id, acc_deposit, 0, 1100000, 1);

  -- 売上 2,800,000 + 税280,000
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-11-25', '株式会社山田商事 11月売上', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, tax_category, tax_rate, sort_order) VALUES
    (je_id, acc_receivable, 3080000, 0, NULL, NULL, 0),
    (je_id, acc_sales, 0, 2800000, 'sales_10', 0.10, 1),
    (je_id, acc_tax_recv, 0, 280000, NULL, NULL, 2);

  -- 仕入 1,000,000 + 税100,000
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-11-20', '名古屋金属工業 11月仕入', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, tax_category, tax_rate, sort_order) VALUES
    (je_id, acc_purchases, 1000000, 0, 'purchase_10', 0.10, 0),
    (je_id, acc_tax_pay, 100000, 0, NULL, NULL, 1),
    (je_id, acc_payable, 0, 1100000, NULL, NULL, 2);

  -- 固定費
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-11-25', '11月分 給料', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_salary, 1500000, 0, 0), (je_id, acc_deposit, 0, 1500000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-11-25', '11月分 法定福利費', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_welfare, 225000, 0, 0), (je_id, acc_deposit, 0, 225000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-11-10', '事務所家賃 11月分', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_rent, 180000, 0, 0), (je_id, acc_deposit, 0, 180000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-11-15', 'NTT 通信費 11月分', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_comm, 30000, 0, 0), (je_id, acc_deposit, 0, 30000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-11-20', '電気・ガス・水道 11月分', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_utilities, 35000, 0, 0), (je_id, acc_deposit, 0, 35000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-11-12', '事務用品購入', 'confirmed', 'ai', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_supplies, 16000, 0, 0), (je_id, acc_cash, 0, 16000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-11-28', '長期借入金返済 11月分', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_longterm_loan, 100000, 0, 0), (je_id, acc_interest, 11500, 0, 1), (je_id, acc_deposit, 0, 111500, 2);

  -- ========================================================================
  -- 2025年12月 (四半期: 接待交際費あり, 年末賞与)
  -- ========================================================================
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-12-31', '売掛金回収（11月売上分）', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_deposit, 3080000, 0, 0), (je_id, acc_receivable, 0, 3080000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-12-31', '買掛金支払（11月仕入分）', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_payable, 1100000, 0, 0), (je_id, acc_deposit, 0, 1100000, 1);

  -- 売上 3,500,000 + 税350,000（年末繁忙期）
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-12-25', '株式会社山田商事 12月売上', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, tax_category, tax_rate, sort_order) VALUES
    (je_id, acc_receivable, 3850000, 0, NULL, NULL, 0),
    (je_id, acc_sales, 0, 3500000, 'sales_10', 0.10, 1),
    (je_id, acc_tax_recv, 0, 350000, NULL, NULL, 2);

  -- 仕入 1,200,000 + 税120,000
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-12-20', '大阪部品 12月仕入', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, tax_category, tax_rate, sort_order) VALUES
    (je_id, acc_purchases, 1200000, 0, 'purchase_10', 0.10, 0),
    (je_id, acc_tax_pay, 120000, 0, NULL, NULL, 1),
    (je_id, acc_payable, 0, 1320000, NULL, NULL, 2);

  -- 固定費
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-12-25', '12月分 給料', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_salary, 1500000, 0, 0), (je_id, acc_deposit, 0, 1500000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-12-25', '12月分 法定福利費', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_welfare, 225000, 0, 0), (je_id, acc_deposit, 0, 225000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-12-10', '事務所家賃 12月分', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_rent, 180000, 0, 0), (je_id, acc_deposit, 0, 180000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-12-15', 'NTT 通信費 12月分', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_comm, 30000, 0, 0), (je_id, acc_deposit, 0, 30000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-12-20', '電気・ガス・水道 12月分', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_utilities, 40000, 0, 0), (je_id, acc_deposit, 0, 40000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-12-08', '事務用品購入', 'confirmed', 'ai', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_supplies, 25000, 0, 0), (je_id, acc_cash, 0, 25000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-12-28', '長期借入金返済 12月分', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_longterm_loan, 100000, 0, 0), (je_id, acc_interest, 11000, 0, 1), (je_id, acc_deposit, 0, 111000, 2);

  -- 接待交際費（Q3）+ 会議費
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-12-18', '得意先忘年会', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_entertainment, 80000, 0, 0), (je_id, acc_cash, 0, 80000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-12-05', '社内会議 会議室利用', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_meeting, 15000, 0, 0), (je_id, acc_cash, 0, 15000, 1);

  -- 租税公課（固定資産税 第2期）
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2025-12-01', '固定資産税 第2期', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_tax_expense, 180000, 0, 0), (je_id, acc_deposit, 0, 180000, 1);

  -- ========================================================================
  -- 2026年1月
  -- ========================================================================
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2026-01-30', '売掛金回収（12月売上分）', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_deposit, 3850000, 0, 0), (je_id, acc_receivable, 0, 3850000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2026-01-30', '買掛金支払（12月仕入分）', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_payable, 1320000, 0, 0), (je_id, acc_deposit, 0, 1320000, 1);

  -- 売上 2,500,000 + 税250,000
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2026-01-25', '東京電子工業 1月売上', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, tax_category, tax_rate, sort_order) VALUES
    (je_id, acc_receivable, 2750000, 0, NULL, NULL, 0),
    (je_id, acc_sales, 0, 2500000, 'sales_10', 0.10, 1),
    (je_id, acc_tax_recv, 0, 250000, NULL, NULL, 2);

  -- 仕入 900,000 + 税90,000
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2026-01-20', '大阪部品 1月仕入', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, tax_category, tax_rate, sort_order) VALUES
    (je_id, acc_purchases, 900000, 0, 'purchase_10', 0.10, 0),
    (je_id, acc_tax_pay, 90000, 0, NULL, NULL, 1),
    (je_id, acc_payable, 0, 990000, NULL, NULL, 2);

  -- 固定費
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2026-01-25', '1月分 給料', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_salary, 1500000, 0, 0), (je_id, acc_deposit, 0, 1500000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2026-01-25', '1月分 法定福利費', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_welfare, 225000, 0, 0), (je_id, acc_deposit, 0, 225000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2026-01-10', '事務所家賃 1月分', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_rent, 180000, 0, 0), (je_id, acc_deposit, 0, 180000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2026-01-15', 'NTT 通信費 1月分', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_comm, 30000, 0, 0), (je_id, acc_deposit, 0, 30000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2026-01-20', '電気・ガス・水道 1月分', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_utilities, 42000, 0, 0), (je_id, acc_deposit, 0, 42000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2026-01-14', '事務用品購入', 'confirmed', 'ai', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_supplies, 12000, 0, 0), (je_id, acc_cash, 0, 12000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2026-01-28', '長期借入金返済 1月分', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_longterm_loan, 100000, 0, 0), (je_id, acc_interest, 10500, 0, 1), (je_id, acc_deposit, 0, 110500, 2);

  -- ========================================================================
  -- 2026年2月
  -- ========================================================================
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2026-02-27', '売掛金回収（1月売上分）', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_deposit, 2750000, 0, 0), (je_id, acc_receivable, 0, 2750000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2026-02-27', '買掛金支払（1月仕入分）', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_payable, 990000, 0, 0), (je_id, acc_deposit, 0, 990000, 1);

  -- 売上 2,300,000 + 税230,000
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2026-02-25', '株式会社山田商事 2月売上', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, tax_category, tax_rate, sort_order) VALUES
    (je_id, acc_receivable, 2530000, 0, NULL, NULL, 0),
    (je_id, acc_sales, 0, 2300000, 'sales_10', 0.10, 1),
    (je_id, acc_tax_recv, 0, 230000, NULL, NULL, 2);

  -- 仕入 850,000 + 税85,000
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2026-02-20', '名古屋金属工業 2月仕入', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, tax_category, tax_rate, sort_order) VALUES
    (je_id, acc_purchases, 850000, 0, 'purchase_10', 0.10, 0),
    (je_id, acc_tax_pay, 85000, 0, NULL, NULL, 1),
    (je_id, acc_payable, 0, 935000, NULL, NULL, 2);

  -- 固定費
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2026-02-25', '2月分 給料', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_salary, 1500000, 0, 0), (je_id, acc_deposit, 0, 1500000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2026-02-25', '2月分 法定福利費', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_welfare, 225000, 0, 0), (je_id, acc_deposit, 0, 225000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2026-02-10', '事務所家賃 2月分', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_rent, 180000, 0, 0), (je_id, acc_deposit, 0, 180000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2026-02-15', 'NTT 通信費 2月分', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_comm, 30000, 0, 0), (je_id, acc_deposit, 0, 30000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2026-02-20', '電気・ガス・水道 2月分', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_utilities, 38000, 0, 0), (je_id, acc_deposit, 0, 38000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2026-02-09', '事務用品購入', 'confirmed', 'ai', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_supplies, 10000, 0, 0), (je_id, acc_cash, 0, 10000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2026-02-28', '長期借入金返済 2月分', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_longterm_loan, 100000, 0, 0), (je_id, acc_interest, 10000, 0, 1), (je_id, acc_deposit, 0, 110000, 2);

  -- ========================================================================
  -- 2026年3月 (四半期: 接待交際費あり, 決算月)
  -- ========================================================================
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2026-03-31', '売掛金回収（2月売上分）', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_deposit, 2530000, 0, 0), (je_id, acc_receivable, 0, 2530000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2026-03-31', '買掛金支払（2月仕入分）', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_payable, 935000, 0, 0), (je_id, acc_deposit, 0, 935000, 1);

  -- 売上 3,200,000 + 税320,000（期末追い込み）
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2026-03-25', '株式会社山田商事 3月売上', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, tax_category, tax_rate, sort_order) VALUES
    (je_id, acc_receivable, 3520000, 0, NULL, NULL, 0),
    (je_id, acc_sales, 0, 3200000, 'sales_10', 0.10, 1),
    (je_id, acc_tax_recv, 0, 320000, NULL, NULL, 2);

  -- 仕入 1,100,000 + 税110,000
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2026-03-20', '大阪部品 3月仕入', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, tax_category, tax_rate, sort_order) VALUES
    (je_id, acc_purchases, 1100000, 0, 'purchase_10', 0.10, 0),
    (je_id, acc_tax_pay, 110000, 0, NULL, NULL, 1),
    (je_id, acc_payable, 0, 1210000, NULL, NULL, 2);

  -- 固定費
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2026-03-25', '3月分 給料', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_salary, 1500000, 0, 0), (je_id, acc_deposit, 0, 1500000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2026-03-25', '3月分 法定福利費', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_welfare, 225000, 0, 0), (je_id, acc_deposit, 0, 225000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2026-03-10', '事務所家賃 3月分', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_rent, 180000, 0, 0), (je_id, acc_deposit, 0, 180000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2026-03-15', 'NTT 通信費 3月分', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_comm, 30000, 0, 0), (je_id, acc_deposit, 0, 30000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2026-03-20', '電気・ガス・水道 3月分', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_utilities, 30000, 0, 0), (je_id, acc_deposit, 0, 30000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2026-03-12', '事務用品購入', 'confirmed', 'ai', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_supplies, 20000, 0, 0), (je_id, acc_cash, 0, 20000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2026-03-28', '長期借入金返済 3月分', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_longterm_loan, 100000, 0, 0), (je_id, acc_interest, 9500, 0, 1), (je_id, acc_deposit, 0, 109500, 2);

  -- 接待交際費（Q4）
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2026-03-15', '得意先接待 料亭', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_entertainment, 60000, 0, 0), (je_id, acc_cash, 0, 60000, 1);

  -- 決算整理: 減価償却費
  -- サーバー: 1,200,000 / 5年 = 240,000/年
  -- 車両: 定率法 → 簡易計算 350,000/年
  -- 建物: 8,000,000 / 15年 ≒ 533,333/年
  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2026-03-31', '決算整理 減価償却費（器具備品）', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_depreciation, 240000, 0, 0), (je_id, acc_equipment, 0, 240000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2026-03-31', '決算整理 減価償却費（車両運搬具）', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_depreciation, 350000, 0, 0), (je_id, acc_vehicle, 0, 350000, 1);

  INSERT INTO journal_entries (id, client_id, entry_date, description, status, source, created_by)
  VALUES (gen_random_uuid(), cid, '2026-03-31', '決算整理 減価償却費（建物）', 'confirmed', 'manual', uid)
  RETURNING id INTO je_id;
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit_amount, credit_amount, sort_order) VALUES
    (je_id, acc_depreciation, 533333, 0, 0), (je_id, acc_building, 0, 533333, 1);

END $$;

-- ----------------------------------------------------------------------------
-- サンプル請求書データ (松田工業)
-- ----------------------------------------------------------------------------
INSERT INTO invoices (id, client_id, business_partner_id, invoice_number, issued_date, due_date, subtotal, tax_amount, total_amount, status) VALUES
  ('00000000-0000-0000-0000-000000000401',
   '00000000-0000-0000-0000-000000000101',
   '00000000-0000-0000-0000-000000000301',
   'INV-2026-0001', '2026-01-05', '2026-01-31', 1200000, 120000, 1320000, 'paid'),
  ('00000000-0000-0000-0000-000000000402',
   '00000000-0000-0000-0000-000000000101',
   '00000000-0000-0000-0000-000000000302',
   'INV-2026-0002', '2026-01-10', '2026-02-10', 850000, 85000, 935000, 'sent'),
  ('00000000-0000-0000-0000-000000000403',
   '00000000-0000-0000-0000-000000000101',
   '00000000-0000-0000-0000-000000000301',
   'INV-2026-0003', '2026-02-01', '2026-02-28', 500000, 50000, 550000, 'draft');

-- ----------------------------------------------------------------------------
-- サンプル入金データ
-- ----------------------------------------------------------------------------
INSERT INTO payments (id, client_id, business_partner_id, amount, payment_date, payment_method, bank_account) VALUES
  ('00000000-0000-0000-0000-000000000501',
   '00000000-0000-0000-0000-000000000101',
   '00000000-0000-0000-0000-000000000301',
   1320000, '2026-01-30', '銀行振込', '三菱UFJ銀行');

INSERT INTO payment_allocations (payment_id, invoice_id, allocated_amount) VALUES
  ('00000000-0000-0000-0000-000000000501',
   '00000000-0000-0000-0000-000000000401',
   1320000);

-- ----------------------------------------------------------------------------
-- サンプル固定資産データ
-- ----------------------------------------------------------------------------
INSERT INTO fixed_assets (client_id, name, category, acquisition_date, acquisition_cost, useful_life, depreciation_method, salvage_value) VALUES
  ('00000000-0000-0000-0000-000000000101', '業務用サーバー', '器具備品', '2024-04-01', 1200000, 5, 'straight_line', 1),
  ('00000000-0000-0000-0000-000000000101', '社用車 プリウス', '車両運搬具', '2023-07-15', 3500000, 6, 'declining_balance', 1),
  ('00000000-0000-0000-0000-000000000101', '本社ビル 内装工事', '建物', '2022-01-01', 8000000, 15, 'straight_line', 1);
