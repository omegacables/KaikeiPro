-- ============================================================================
-- KaikeiPro 借入金台帳（借入金・役員借入金）
-- 借入ごとに残高を管理し、返済記録から「元金返済＋支払利息」の仕訳を生成する。
--   返済仕訳（記帳）の標準形:
--     借方 借入金 / 役員借入金 … 元金返済額
--     借方 支払利息            … 利息額
--     貸方 普通預金 / 現金     … 返済合計（元金＋利息）
--   生成仕訳は source='manual'、loan_repayments.journal_entry_id でリンク
-- ============================================================================

CREATE TABLE IF NOT EXISTS loans (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id            uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    lender_name          text NOT NULL,
    -- borrowing=金融機関等からの借入 / officer=役員借入金
    loan_type            text NOT NULL DEFAULT 'borrowing'
                             CHECK (loan_type IN ('borrowing', 'officer')),
    principal            integer NOT NULL DEFAULT 0,  -- 当初借入額
    current_balance      integer NOT NULL DEFAULT 0,  -- 現在残高
    interest_rate        numeric(6,3),                -- 年利(%)
    borrowed_date        date,
    -- 借入金科目（未設定なら仕訳化時に名称から自動解決）
    liability_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
    status               text NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active', 'completed')),
    memo                 text,
    created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS loan_repayments (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    loan_id            uuid NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
    client_id          uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    repayment_date     date NOT NULL,
    principal_amount   integer NOT NULL DEFAULT 0,  -- 元金返済額
    interest_amount    integer NOT NULL DEFAULT 0,  -- 利息額
    payment_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,  -- 普通預金/現金
    interest_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL, -- 支払利息
    journal_entry_id   uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
    status             text NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'journalized')),
    memo               text,
    created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_loans_client            ON loans(client_id);
CREATE INDEX IF NOT EXISTS idx_loans_status            ON loans(status);
CREATE INDEX IF NOT EXISTS idx_loan_repayments_loan    ON loan_repayments(loan_id);
CREATE INDEX IF NOT EXISTS idx_loan_repayments_client  ON loan_repayments(client_id);
CREATE INDEX IF NOT EXISTS idx_loan_repayments_journal ON loan_repayments(journal_entry_id);

-- ============================================================================
-- ROW LEVEL SECURITY（client_id ベース）
-- ============================================================================
ALTER TABLE loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE loan_repayments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "loans_select" ON loans;
DROP POLICY IF EXISTS "loans_insert" ON loans;
DROP POLICY IF EXISTS "loans_update" ON loans;
DROP POLICY IF EXISTS "loans_delete" ON loans;
CREATE POLICY "loans_select" ON loans FOR SELECT
    USING (client_id IN (SELECT get_user_client_ids()));
CREATE POLICY "loans_insert" ON loans FOR INSERT
    WITH CHECK (client_id IN (SELECT get_user_client_ids()));
CREATE POLICY "loans_update" ON loans FOR UPDATE
    USING (client_id IN (SELECT get_user_client_ids()));
CREATE POLICY "loans_delete" ON loans FOR DELETE
    USING (client_id IN (SELECT get_user_client_ids()));

DROP POLICY IF EXISTS "loan_repayments_select" ON loan_repayments;
DROP POLICY IF EXISTS "loan_repayments_insert" ON loan_repayments;
DROP POLICY IF EXISTS "loan_repayments_update" ON loan_repayments;
DROP POLICY IF EXISTS "loan_repayments_delete" ON loan_repayments;
CREATE POLICY "loan_repayments_select" ON loan_repayments FOR SELECT
    USING (client_id IN (SELECT get_user_client_ids()));
CREATE POLICY "loan_repayments_insert" ON loan_repayments FOR INSERT
    WITH CHECK (client_id IN (SELECT get_user_client_ids()));
CREATE POLICY "loan_repayments_update" ON loan_repayments FOR UPDATE
    USING (client_id IN (SELECT get_user_client_ids()));
CREATE POLICY "loan_repayments_delete" ON loan_repayments FOR DELETE
    USING (client_id IN (SELECT get_user_client_ids()));
