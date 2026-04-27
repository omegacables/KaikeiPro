-- ============================================================================
-- KaikeiPro Credit Card Integration Migration
-- クレジットカード連携テーブル
-- ============================================================================

-- ----------------------------------------------------------------------------
-- card_accounts - クレジットカード
-- ----------------------------------------------------------------------------
CREATE TABLE card_accounts (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id               uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    card_company            text NOT NULL
                                CHECK (card_company IN ('VISA', 'Master', 'JCB', 'AMEX', 'Diners', 'UnionPay', 'other')),
    card_name               text NOT NULL,
    card_number_masked      text NOT NULL,
    card_holder             text,
    closing_day             smallint NOT NULL CHECK (closing_day BETWEEN 1 AND 31),
    payment_day             smallint NOT NULL CHECK (payment_day BETWEEN 1 AND 31),
    linked_bank_account_id  uuid REFERENCES bank_accounts(id) ON DELETE SET NULL,
    payable_account_id      uuid REFERENCES accounts(id) ON DELETE SET NULL,
    provider                text NOT NULL DEFAULT 'manual'
                                CHECK (provider IN ('manual', 'moneytree', 'moneyforward', 'zaim')),
    provider_account_id     text,
    is_active               boolean NOT NULL DEFAULT true,
    last_synced_at          timestamptz,
    sync_status             text NOT NULL DEFAULT 'idle'
                                CHECK (sync_status IN ('idle', 'syncing', 'error', 'success')),
    settings                jsonb,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_card_accounts_client_id ON card_accounts(client_id);
CREATE INDEX idx_card_accounts_active    ON card_accounts(client_id, is_active);

CREATE TRIGGER trg_card_accounts_updated_at
    BEFORE UPDATE ON card_accounts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ----------------------------------------------------------------------------
-- card_transactions - カード利用明細
-- ----------------------------------------------------------------------------
CREATE TABLE card_transactions (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    card_account_id      uuid NOT NULL REFERENCES card_accounts(id) ON DELETE CASCADE,
    transaction_date     date NOT NULL,
    posted_date          date,
    description          text NOT NULL,
    amount               integer NOT NULL,
    transaction_type     text NOT NULL DEFAULT 'charge'
                             CHECK (transaction_type IN ('charge', 'refund', 'payment', 'fee', 'interest')),
    counterparty         text,
    installment_type     text DEFAULT 'lump'
                             CHECK (installment_type IN ('lump', 'installment', 'revolving', 'bonus')),
    installment_count    smallint,
    foreign_currency     text,
    foreign_amount       numeric,
    statement_month      date,
    journal_entry_id     uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
    match_status         text NOT NULL DEFAULT 'unmatched'
                             CHECK (match_status IN ('unmatched', 'matched', 'ignored')),
    match_confidence     numeric(3,2),
    suggested_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
    reference_number     text,
    raw_data             jsonb,
    created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_card_transactions_account_id      ON card_transactions(card_account_id);
CREATE INDEX idx_card_transactions_date            ON card_transactions(card_account_id, transaction_date);
CREATE INDEX idx_card_transactions_status          ON card_transactions(match_status);
CREATE INDEX idx_card_transactions_journal         ON card_transactions(journal_entry_id);
CREATE INDEX idx_card_transactions_statement_month ON card_transactions(card_account_id, statement_month);

-- ----------------------------------------------------------------------------
-- card_payments - カード月次引き落とし
-- ----------------------------------------------------------------------------
CREATE TABLE card_payments (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    card_account_id      uuid NOT NULL REFERENCES card_accounts(id) ON DELETE CASCADE,
    statement_month      date NOT NULL,
    payment_date         date NOT NULL,
    total_amount         integer NOT NULL,
    journal_entry_id     uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
    bank_transaction_id  uuid REFERENCES bank_transactions(id) ON DELETE SET NULL,
    status               text NOT NULL DEFAULT 'scheduled'
                             CHECK (status IN ('scheduled', 'paid', 'cancelled')),
    created_at           timestamptz NOT NULL DEFAULT now(),
    UNIQUE (card_account_id, statement_month)
);

CREATE INDEX idx_card_payments_account_id ON card_payments(card_account_id);
CREATE INDEX idx_card_payments_status     ON card_payments(status);

-- ----------------------------------------------------------------------------
-- journal_entries.source に 'card' を追加
-- ----------------------------------------------------------------------------
ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS journal_entries_source_check;
ALTER TABLE journal_entries ADD CONSTRAINT journal_entries_source_check
    CHECK (source IN ('manual', 'ai', 'import', 'raqto', 'bank', 'closing', 'card'));

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE card_accounts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE card_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE card_payments     ENABLE ROW LEVEL SECURITY;

-- RLS POLICIES: card_accounts
CREATE POLICY "card_accounts_select" ON card_accounts FOR SELECT
    USING (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "card_accounts_insert" ON card_accounts FOR INSERT
    WITH CHECK (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "card_accounts_update" ON card_accounts FOR UPDATE
    USING (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "card_accounts_delete" ON card_accounts FOR DELETE
    USING (client_id IN (SELECT get_user_client_ids()));

-- RLS POLICIES: card_transactions (card_accounts 経由)
CREATE POLICY "card_transactions_select" ON card_transactions FOR SELECT
    USING (card_account_id IN (
        SELECT id FROM card_accounts WHERE client_id IN (SELECT get_user_client_ids())
    ));

CREATE POLICY "card_transactions_insert" ON card_transactions FOR INSERT
    WITH CHECK (card_account_id IN (
        SELECT id FROM card_accounts WHERE client_id IN (SELECT get_user_client_ids())
    ));

CREATE POLICY "card_transactions_update" ON card_transactions FOR UPDATE
    USING (card_account_id IN (
        SELECT id FROM card_accounts WHERE client_id IN (SELECT get_user_client_ids())
    ));

CREATE POLICY "card_transactions_delete" ON card_transactions FOR DELETE
    USING (card_account_id IN (
        SELECT id FROM card_accounts WHERE client_id IN (SELECT get_user_client_ids())
    ));

-- RLS POLICIES: card_payments (card_accounts 経由)
CREATE POLICY "card_payments_select" ON card_payments FOR SELECT
    USING (card_account_id IN (
        SELECT id FROM card_accounts WHERE client_id IN (SELECT get_user_client_ids())
    ));

CREATE POLICY "card_payments_insert" ON card_payments FOR INSERT
    WITH CHECK (card_account_id IN (
        SELECT id FROM card_accounts WHERE client_id IN (SELECT get_user_client_ids())
    ));

CREATE POLICY "card_payments_update" ON card_payments FOR UPDATE
    USING (card_account_id IN (
        SELECT id FROM card_accounts WHERE client_id IN (SELECT get_user_client_ids())
    ));

CREATE POLICY "card_payments_delete" ON card_payments FOR DELETE
    USING (card_account_id IN (
        SELECT id FROM card_accounts WHERE client_id IN (SELECT get_user_client_ids())
    ));
