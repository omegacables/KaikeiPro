-- ============================================================================
-- KaikeiPro Bank Integration Migration
-- 銀行API連携テーブル
-- ============================================================================

-- ----------------------------------------------------------------------------
-- bank_accounts - 銀行口座
-- ----------------------------------------------------------------------------
CREATE TABLE bank_accounts (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id           uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    bank_name           text NOT NULL,
    branch_name         text,
    account_type        text NOT NULL DEFAULT 'ordinary'
                            CHECK (account_type IN ('ordinary', 'checking', 'savings')),
    account_number      text NOT NULL,
    account_holder      text,
    account_id          uuid REFERENCES accounts(id) ON DELETE SET NULL,
    provider            text NOT NULL DEFAULT 'manual'
                            CHECK (provider IN ('manual', 'moneytree', 'moneyforward', 'zaim')),
    provider_account_id text,
    is_active           boolean NOT NULL DEFAULT true,
    last_synced_at      timestamptz,
    sync_status         text NOT NULL DEFAULT 'idle'
                            CHECK (sync_status IN ('idle', 'syncing', 'error', 'success')),
    settings            jsonb,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_bank_accounts_client_id ON bank_accounts(client_id);
CREATE INDEX idx_bank_accounts_active    ON bank_accounts(client_id, is_active);

CREATE TRIGGER trg_bank_accounts_updated_at
    BEFORE UPDATE ON bank_accounts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ----------------------------------------------------------------------------
-- bank_transactions - 口座取引
-- ----------------------------------------------------------------------------
CREATE TABLE bank_transactions (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bank_account_id      uuid NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
    transaction_date     date NOT NULL,
    description          text NOT NULL,
    amount               integer NOT NULL,
    balance_after        integer,
    transaction_type     text NOT NULL
                             CHECK (transaction_type IN ('deposit', 'withdrawal')),
    counterparty         text,
    reference_number     text,
    journal_entry_id     uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
    match_status         text NOT NULL DEFAULT 'unmatched'
                             CHECK (match_status IN ('unmatched', 'matched', 'ignored')),
    match_confidence     numeric(3,2),
    suggested_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
    raw_data             jsonb,
    created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_bank_transactions_account_id ON bank_transactions(bank_account_id);
CREATE INDEX idx_bank_transactions_date       ON bank_transactions(bank_account_id, transaction_date);
CREATE INDEX idx_bank_transactions_status     ON bank_transactions(match_status);
CREATE INDEX idx_bank_transactions_journal    ON bank_transactions(journal_entry_id);

-- ----------------------------------------------------------------------------
-- journal_entries.source に 'bank' を追加
-- ----------------------------------------------------------------------------
ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS journal_entries_source_check;
ALTER TABLE journal_entries ADD CONSTRAINT journal_entries_source_check
    CHECK (source IN ('manual', 'ai', 'import', 'raqto', 'bank'));

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE bank_accounts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY;

-- RLS POLICIES: bank_accounts (client_id ベース)
CREATE POLICY "bank_accounts_select" ON bank_accounts FOR SELECT
    USING (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "bank_accounts_insert" ON bank_accounts FOR INSERT
    WITH CHECK (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "bank_accounts_update" ON bank_accounts FOR UPDATE
    USING (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "bank_accounts_delete" ON bank_accounts FOR DELETE
    USING (client_id IN (SELECT get_user_client_ids()));

-- RLS POLICIES: bank_transactions (bank_accounts 経由の間接チェック)
CREATE POLICY "bank_transactions_select" ON bank_transactions FOR SELECT
    USING (bank_account_id IN (
        SELECT id FROM bank_accounts WHERE client_id IN (SELECT get_user_client_ids())
    ));

CREATE POLICY "bank_transactions_insert" ON bank_transactions FOR INSERT
    WITH CHECK (bank_account_id IN (
        SELECT id FROM bank_accounts WHERE client_id IN (SELECT get_user_client_ids())
    ));

CREATE POLICY "bank_transactions_update" ON bank_transactions FOR UPDATE
    USING (bank_account_id IN (
        SELECT id FROM bank_accounts WHERE client_id IN (SELECT get_user_client_ids())
    ));

CREATE POLICY "bank_transactions_delete" ON bank_transactions FOR DELETE
    USING (bank_account_id IN (
        SELECT id FROM bank_accounts WHERE client_id IN (SELECT get_user_client_ids())
    ));

-- ============================================================================
-- SEED DATA: テスト用銀行口座・取引データ (松田工業)
-- ============================================================================
DO $$
DECLARE
    acc_deposit uuid;
    acc_checking uuid;
    bank1_id uuid;
    bank2_id uuid;
BEGIN
    -- 勘定科目の取得
    SELECT id INTO acc_deposit FROM accounts WHERE code = '1120' AND client_id IS NULL LIMIT 1;
    SELECT id INTO acc_checking FROM accounts WHERE code = '1130' AND client_id IS NULL LIMIT 1;

    -- 三菱UFJ銀行 普通口座
    INSERT INTO bank_accounts (id, client_id, bank_name, branch_name, account_type, account_number, account_holder, account_id, provider, sync_status, last_synced_at)
    VALUES (
        '00000000-0000-0000-0000-000000000601',
        '00000000-0000-0000-0000-000000000101',
        '三菱UFJ銀行', '丸の内支店', 'ordinary', '1234567',
        '松田工業株式会社', acc_deposit, 'manual', 'success', now() - interval '2 hours'
    ) RETURNING id INTO bank1_id;

    -- みずほ銀行 当座口座
    INSERT INTO bank_accounts (id, client_id, bank_name, branch_name, account_type, account_number, account_holder, account_id, provider, sync_status, last_synced_at)
    VALUES (
        '00000000-0000-0000-0000-000000000602',
        '00000000-0000-0000-0000-000000000101',
        'みずほ銀行', '新宿支店', 'checking', '7654321',
        '松田工業株式会社', acc_checking, 'manual', 'success', now() - interval '1 day'
    ) RETURNING id INTO bank2_id;

    -- 三菱UFJ銀行の取引データ (10件)
    INSERT INTO bank_transactions (bank_account_id, transaction_date, description, amount, balance_after, transaction_type, counterparty, reference_number, match_status, match_confidence, suggested_account_id) VALUES
        (bank1_id, '2026-02-20', '株式会社山田商事 売掛金入金', 1320000, 5820000, 'deposit', '株式会社山田商事', 'TR-20260220-001', 'matched', 0.95, NULL),
        (bank1_id, '2026-02-18', 'NTTコミュニケーションズ 通信費2月分', -8640, 4500000, 'withdrawal', 'NTTコミュニケーションズ', 'TR-20260218-001', 'matched', 0.92, NULL),
        (bank1_id, '2026-02-15', '事務所家賃 2月分 振込', -180000, 4508640, 'withdrawal', '丸の内不動産', 'TR-20260215-001', 'unmatched', 0.88, (SELECT id FROM accounts WHERE code = '5400' AND client_id IS NULL LIMIT 1)),
        (bank1_id, '2026-02-14', 'アスクル 事務用品', -15400, 4688640, 'withdrawal', 'アスクル', 'TR-20260214-001', 'unmatched', 0.85, (SELECT id FROM accounts WHERE code = '5320' AND client_id IS NULL LIMIT 1)),
        (bank1_id, '2026-02-10', '東京電子工業 売掛金入金', 935000, 4704040, 'deposit', '東京電子工業株式会社', 'TR-20260210-001', 'unmatched', 0.90, (SELECT id FROM accounts WHERE code = '1150' AND client_id IS NULL LIMIT 1)),
        (bank1_id, '2026-02-05', '東京電力 電気代1月分', -32400, 3769040, 'withdrawal', '東京電力EP', 'TR-20260205-001', 'unmatched', 0.80, (SELECT id FROM accounts WHERE code = '5330' AND client_id IS NULL LIMIT 1)),
        (bank1_id, '2026-02-03', 'ATM 現金引出', -100000, 3801440, 'withdrawal', NULL, 'TR-20260203-001', 'ignored', NULL, NULL),
        (bank1_id, '2026-02-01', '給与振込 佐藤', -280000, 3901440, 'withdrawal', '佐藤太郎', 'TR-20260201-001', 'unmatched', 0.75, (SELECT id FROM accounts WHERE code = '5200' AND client_id IS NULL LIMIT 1)),
        (bank1_id, '2026-01-31', '利息', 120, 4181440, 'deposit', '三菱UFJ銀行', 'TR-20260131-001', 'unmatched', 0.70, (SELECT id FROM accounts WHERE code = '4200' AND client_id IS NULL LIMIT 1)),
        (bank1_id, '2026-01-28', '社会保険料 1月分', -156000, 4181320, 'withdrawal', '日本年金機構', 'TR-20260128-001', 'unmatched', 0.82, (SELECT id FROM accounts WHERE code = '5210' AND client_id IS NULL LIMIT 1));

    -- みずほ銀行の取引データ (5件)
    INSERT INTO bank_transactions (bank_account_id, transaction_date, description, amount, balance_after, transaction_type, counterparty, reference_number, match_status, match_confidence, suggested_account_id) VALUES
        (bank2_id, '2026-02-19', '大阪部品 仕入代金', -450000, 1550000, 'withdrawal', '大阪部品株式会社', 'TR-20260219-001', 'unmatched', 0.88, (SELECT id FROM accounts WHERE code = '5100' AND client_id IS NULL LIMIT 1)),
        (bank2_id, '2026-02-15', '名古屋金属工業 仕入代金', -320000, 2000000, 'withdrawal', '名古屋金属工業株式会社', 'TR-20260215-002', 'unmatched', 0.85, (SELECT id FROM accounts WHERE code = '5100' AND client_id IS NULL LIMIT 1)),
        (bank2_id, '2026-02-10', '九州運輸 運送代', -85000, 2320000, 'withdrawal', '九州運輸株式会社', 'TR-20260210-002', 'unmatched', 0.78, (SELECT id FROM accounts WHERE code = '5300' AND client_id IS NULL LIMIT 1)),
        (bank2_id, '2026-02-05', '株式会社山田商事 売上入金', 880000, 2405000, 'deposit', '株式会社山田商事', 'TR-20260205-002', 'matched', 0.93, NULL),
        (bank2_id, '2026-02-01', '手形決済 東京電子工業', 550000, 1525000, 'deposit', '東京電子工業株式会社', 'TR-20260201-002', 'unmatched', 0.72, (SELECT id FROM accounts WHERE code = '1200' AND client_id IS NULL LIMIT 1));
END $$;
