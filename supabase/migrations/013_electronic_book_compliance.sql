-- ==========================================================================
-- 013: 電子帳簿保存法コンプライアンス対応
-- 監査証跡・編集履歴・データ改ざん防止・会計年度ロックDB強制
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1. audit_logs テーブル（監査証跡 - INSERT ONLY）
-- --------------------------------------------------------------------------

CREATE TABLE audit_logs (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id     uuid NOT NULL,
    table_name    text NOT NULL,
    record_id     uuid NOT NULL,
    action        text NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
    old_data      jsonb,
    new_data      jsonb,
    performed_by  uuid,
    performed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_client_table ON audit_logs(client_id, table_name);
CREATE INDEX idx_audit_logs_record ON audit_logs(table_name, record_id);
CREATE INDEX idx_audit_logs_performed_at ON audit_logs(performed_at);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- SELECT only - no modification allowed via RLS
CREATE POLICY "audit_logs_select" ON audit_logs FOR SELECT
    USING (client_id IN (SELECT get_user_client_ids()));

-- --------------------------------------------------------------------------
-- 2. audit trigger 関数 (SECURITY DEFINER)
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_audit_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_client_id uuid;
    v_record_id uuid;
    v_old jsonb := NULL;
    v_new jsonb := NULL;
    v_user_id uuid;
BEGIN
    -- Resolve client_id based on table
    IF TG_TABLE_NAME = 'journal_entries' THEN
        v_client_id := COALESCE(NEW.client_id, OLD.client_id);
        v_record_id := COALESCE(NEW.id, OLD.id);
    ELSIF TG_TABLE_NAME = 'receipts' THEN
        v_client_id := COALESCE(NEW.client_id, OLD.client_id);
        v_record_id := COALESCE(NEW.id, OLD.id);
    ELSIF TG_TABLE_NAME = 'journal_entry_lines' THEN
        v_record_id := COALESCE(NEW.id, OLD.id);
        -- Resolve client_id through parent journal_entries
        SELECT client_id INTO v_client_id
        FROM journal_entries
        WHERE id = COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);
    ELSE
        RETURN COALESCE(NEW, OLD);
    END IF;

    -- Get current user (NULL for service role operations)
    v_user_id := auth.uid();

    IF TG_OP = 'INSERT' THEN
        v_new := to_jsonb(NEW);
    ELSIF TG_OP = 'UPDATE' THEN
        v_old := to_jsonb(OLD);
        v_new := to_jsonb(NEW);
    ELSIF TG_OP = 'DELETE' THEN
        v_old := to_jsonb(OLD);
    END IF;

    INSERT INTO audit_logs (client_id, table_name, record_id, action, old_data, new_data, performed_by)
    VALUES (v_client_id, TG_TABLE_NAME, v_record_id, TG_OP, v_old, v_new, v_user_id);

    RETURN COALESCE(NEW, OLD);
END;
$$;

-- --------------------------------------------------------------------------
-- 3. audit triggers を各テーブルに設定
-- --------------------------------------------------------------------------

CREATE TRIGGER trg_audit_journal_entries
    AFTER INSERT OR UPDATE OR DELETE ON journal_entries
    FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

CREATE TRIGGER trg_audit_journal_entry_lines
    AFTER INSERT OR UPDATE OR DELETE ON journal_entry_lines
    FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

CREATE TRIGGER trg_audit_receipts
    AFTER INSERT OR UPDATE OR DELETE ON receipts
    FOR EACH ROW EXECUTE FUNCTION fn_audit_log();

-- --------------------------------------------------------------------------
-- 4. journal_entries_history テーブル（仕訳変更履歴）
-- --------------------------------------------------------------------------

CREATE TABLE journal_entries_history (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    journal_entry_id  uuid NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    version           int NOT NULL,
    entry_date        date,
    description       text,
    status            text,
    source            text,
    receipt_id        uuid,
    metadata          jsonb,
    lines_snapshot    jsonb NOT NULL,
    changed_by        uuid,
    changed_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (journal_entry_id, version)
);

CREATE INDEX idx_journal_entries_history_entry ON journal_entries_history(journal_entry_id);

ALTER TABLE journal_entries_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "journal_entries_history_select" ON journal_entries_history FOR SELECT
    USING (
        journal_entry_id IN (
            SELECT id FROM journal_entries
            WHERE client_id IN (SELECT get_user_client_ids())
        )
    );

-- --------------------------------------------------------------------------
-- 5. 仕訳変更履歴 trigger 関数
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_journal_entry_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_version int;
    v_lines jsonb;
BEGIN
    -- Calculate next version
    SELECT COALESCE(MAX(version), 0) + 1 INTO v_version
    FROM journal_entries_history
    WHERE journal_entry_id = OLD.id;

    -- Snapshot current lines
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id', jel.id,
            'account_id', jel.account_id,
            'debit_amount', jel.debit_amount,
            'credit_amount', jel.credit_amount,
            'tax_category', jel.tax_category,
            'tax_rate', jel.tax_rate,
            'sort_order', jel.sort_order
        )
    ), '[]'::jsonb) INTO v_lines
    FROM journal_entry_lines jel
    WHERE jel.journal_entry_id = OLD.id;

    INSERT INTO journal_entries_history (
        journal_entry_id, version, entry_date, description, status,
        source, receipt_id, metadata, lines_snapshot, changed_by
    ) VALUES (
        OLD.id, v_version, OLD.entry_date, OLD.description, OLD.status,
        OLD.source, OLD.receipt_id, OLD.metadata, v_lines, auth.uid()
    );

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_journal_entry_history
    BEFORE UPDATE ON journal_entries
    FOR EACH ROW EXECUTE FUNCTION fn_journal_entry_history();

-- --------------------------------------------------------------------------
-- 6. receipts テーブルにハッシュカラム追加
-- --------------------------------------------------------------------------

ALTER TABLE receipts ADD COLUMN file_hash text;
ALTER TABLE receipts ADD COLUMN hash_algorithm text DEFAULT 'SHA-256';
ALTER TABLE receipts ADD COLUMN hash_verified_at timestamptz;

-- --------------------------------------------------------------------------
-- 7. 会計年度ロックのDB強制
-- --------------------------------------------------------------------------

-- Helper: 指定日が locked 会計年度に含まれるか判定
CREATE OR REPLACE FUNCTION is_fiscal_year_locked(p_client_id uuid, p_entry_date date)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM fiscal_years
        WHERE client_id = p_client_id
          AND status = 'locked'
          AND p_entry_date BETWEEN start_date AND end_date
    );
$$;

-- journal_entries: UPDATE ポリシーにロックチェック追加
DROP POLICY IF EXISTS "journal_entries_update" ON journal_entries;
CREATE POLICY "journal_entries_update" ON journal_entries FOR UPDATE
    USING (
        client_id IN (SELECT get_user_client_ids())
        AND NOT is_fiscal_year_locked(client_id, entry_date)
    );

-- journal_entries: DELETE ポリシーにロックチェック追加
DROP POLICY IF EXISTS "journal_entries_delete" ON journal_entries;
CREATE POLICY "journal_entries_delete" ON journal_entries FOR DELETE
    USING (
        client_id IN (SELECT get_user_client_ids())
        AND NOT is_fiscal_year_locked(client_id, entry_date)
    );

-- journal_entry_lines: UPDATE ポリシーにロックチェック追加
DROP POLICY IF EXISTS "journal_entry_lines_update" ON journal_entry_lines;
CREATE POLICY "journal_entry_lines_update" ON journal_entry_lines FOR UPDATE
    USING (
        journal_entry_id IN (
            SELECT id FROM journal_entries
            WHERE client_id IN (SELECT get_user_client_ids())
              AND NOT is_fiscal_year_locked(client_id, entry_date)
        )
    );

-- journal_entry_lines: DELETE ポリシーにロックチェック追加
DROP POLICY IF EXISTS "journal_entry_lines_delete" ON journal_entry_lines;
CREATE POLICY "journal_entry_lines_delete" ON journal_entry_lines FOR DELETE
    USING (
        journal_entry_id IN (
            SELECT id FROM journal_entries
            WHERE client_id IN (SELECT get_user_client_ids())
              AND NOT is_fiscal_year_locked(client_id, entry_date)
        )
    );
