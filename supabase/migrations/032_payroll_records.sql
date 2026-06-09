-- ============================================================================
-- KaikeiPro 給与台帳（給与・役員報酬）
-- 従業員/役員ごとに月次の支給・控除データを保持し、給与仕訳を生成する。
--   給与仕訳（記帳）の標準形:
--     借方 給与手当（従業員）/ 役員報酬（役員） … 総支給額
--     貸方 預り金 … 控除合計（源泉所得税・住民税・社会保険料本人負担・その他）
--     貸方 普通預金/現金/未払金 … 差引支給額
--   生成仕訳は source='manual'、payroll_records.journal_entry_id でリンク
--   （社会保険料の会社負担=法定福利費 や 預り金の納付仕訳は別途手動入力）
-- ============================================================================

CREATE TABLE IF NOT EXISTS payroll_records (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id              uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    -- 給与計算対象月（YYYY-MM-01 に正規化）
    pay_month              date NOT NULL,
    -- 実支給日（仕訳の計上日に使用）
    pay_date               date,
    employee_name          text NOT NULL,
    employee_type          text NOT NULL DEFAULT 'employee'
                               CHECK (employee_type IN ('employee', 'officer')),
    -- 総支給額
    gross_salary           integer NOT NULL DEFAULT 0,
    -- 控除（本人負担分）
    income_tax             integer NOT NULL DEFAULT 0,  -- 源泉所得税
    resident_tax           integer NOT NULL DEFAULT 0,  -- 住民税
    health_insurance       integer NOT NULL DEFAULT 0,  -- 健康保険
    pension_insurance      integer NOT NULL DEFAULT 0,  -- 厚生年金
    employment_insurance   integer NOT NULL DEFAULT 0,  -- 雇用保険
    other_deduction        integer NOT NULL DEFAULT 0,  -- その他控除
    -- 差引支給額（= gross - 控除合計）
    net_pay                integer NOT NULL DEFAULT 0,
    -- 仕訳科目（未設定なら仕訳化時に名称から自動解決）
    salary_account_id      uuid REFERENCES accounts(id) ON DELETE SET NULL,
    withholding_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
    payment_account_id     uuid REFERENCES accounts(id) ON DELETE SET NULL,
    journal_entry_id       uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
    status                 text NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'journalized')),
    memo                   text,
    created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payroll_records_client  ON payroll_records(client_id);
CREATE INDEX IF NOT EXISTS idx_payroll_records_month   ON payroll_records(pay_month);
CREATE INDEX IF NOT EXISTS idx_payroll_records_status  ON payroll_records(status);
CREATE INDEX IF NOT EXISTS idx_payroll_records_journal ON payroll_records(journal_entry_id);

-- ============================================================================
-- ROW LEVEL SECURITY（client_id ベース。statement_lines と同パターン）
-- ============================================================================
ALTER TABLE payroll_records ENABLE ROW LEVEL SECURITY;

-- 再実行可能にするため既存ポリシーを削除してから作成（CREATE POLICY は IF NOT EXISTS 非対応）
DROP POLICY IF EXISTS "payroll_records_select" ON payroll_records;
DROP POLICY IF EXISTS "payroll_records_insert" ON payroll_records;
DROP POLICY IF EXISTS "payroll_records_update" ON payroll_records;
DROP POLICY IF EXISTS "payroll_records_delete" ON payroll_records;

CREATE POLICY "payroll_records_select" ON payroll_records FOR SELECT
    USING (client_id IN (SELECT get_user_client_ids()));
CREATE POLICY "payroll_records_insert" ON payroll_records FOR INSERT
    WITH CHECK (client_id IN (SELECT get_user_client_ids()));
CREATE POLICY "payroll_records_update" ON payroll_records FOR UPDATE
    USING (client_id IN (SELECT get_user_client_ids()));
CREATE POLICY "payroll_records_delete" ON payroll_records FOR DELETE
    USING (client_id IN (SELECT get_user_client_ids()));
