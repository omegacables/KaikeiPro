-- ============================================================================
-- KaikeiPro 明細書（銀行/クレカ明細）の行データ
-- 明細書 1枚(receipts.document_type='statement') から抽出した個別取引を保持し、
-- 行ごとに仕訳化・確認状態を管理する。
--   - bank_transactions は使わない（bank_account 紐付けが必須でクレカ明細に不向き）
--   - 生成仕訳は source='bank' で receipt_id を付けず、ここの journal_entry_id でリンク
--     （journal_entries.receipt_id 経由の削除カスケードを避ける）
-- ============================================================================

CREATE TABLE IF NOT EXISTS statement_lines (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_id           uuid NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
    client_id            uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    line_date            date,
    description          text NOT NULL DEFAULT '',
    -- 符号付き金額（+入金/-出金）。direction と整合させる。
    amount               integer NOT NULL DEFAULT 0,
    direction            text NOT NULL DEFAULT 'withdrawal'
                             CHECK (direction IN ('deposit', 'withdrawal')),
    balance_after        integer,
    counterparty         text,
    journal_entry_id     uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
    status               text NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'journalized', 'ignored')),
    suggested_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
    sort_order           integer NOT NULL DEFAULT 0,
    raw_data             jsonb,
    created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_statement_lines_receipt ON statement_lines(receipt_id);
CREATE INDEX IF NOT EXISTS idx_statement_lines_client  ON statement_lines(client_id);
CREATE INDEX IF NOT EXISTS idx_statement_lines_status  ON statement_lines(status);
CREATE INDEX IF NOT EXISTS idx_statement_lines_journal ON statement_lines(journal_entry_id);

-- ============================================================================
-- ROW LEVEL SECURITY（client_id ベース。receipt_folders と同パターン）
-- ============================================================================
ALTER TABLE statement_lines ENABLE ROW LEVEL SECURITY;

-- 再実行可能にするため既存ポリシーを削除してから作成（CREATE POLICY は IF NOT EXISTS 非対応）
DROP POLICY IF EXISTS "statement_lines_select" ON statement_lines;
DROP POLICY IF EXISTS "statement_lines_insert" ON statement_lines;
DROP POLICY IF EXISTS "statement_lines_update" ON statement_lines;
DROP POLICY IF EXISTS "statement_lines_delete" ON statement_lines;

CREATE POLICY "statement_lines_select" ON statement_lines FOR SELECT
    USING (client_id IN (SELECT get_user_client_ids()));
CREATE POLICY "statement_lines_insert" ON statement_lines FOR INSERT
    WITH CHECK (client_id IN (SELECT get_user_client_ids()));
CREATE POLICY "statement_lines_update" ON statement_lines FOR UPDATE
    USING (client_id IN (SELECT get_user_client_ids()));
CREATE POLICY "statement_lines_delete" ON statement_lines FOR DELETE
    USING (client_id IN (SELECT get_user_client_ids()));
