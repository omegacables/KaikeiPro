-- ============================================================================
-- 042_loan_repayment_schedule
-- 金融機関等からの借入に「返済予定表」を持たせる（要件3-7）。
--
-- 金融機関からの借入は、返済日ごとに元金と利息の内訳が決まっている。
-- 予定表を持っておくと次の3つができる。
--   1. 期日が来た予定を1クリックで増減明細に落とす（入力の手間を減らす）
--   2. 予定と実績の差（返済遅延・繰上返済）が見える
--   3. 内訳明細書に必要な「期中の支払利子額」を予定側からも把握できる
--
-- 役員借入金は返済条件を定めないのが通常なので、この表は使わない。
-- ============================================================================

CREATE TABLE IF NOT EXISTS loan_repayment_schedules (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    loan_id          uuid NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
    client_id        uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    -- 返済期日
    due_date         date NOT NULL,
    -- 予定額。元金と利息を分けて持つ（合計だけでは仕訳に落とせない）
    principal_amount integer NOT NULL DEFAULT 0 CHECK (principal_amount >= 0),
    interest_amount  integer NOT NULL DEFAULT 0 CHECK (interest_amount  >= 0),
    -- 実績として作られた増減明細。消し込むとここが埋まる
    principal_entry_id uuid REFERENCES loan_entries(id) ON DELETE SET NULL,
    interest_entry_id  uuid REFERENCES loan_entries(id) ON DELETE SET NULL,
    memo             text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    -- 同じ借入に同じ期日の予定を二重に作らない
    UNIQUE (loan_id, due_date)
);

CREATE INDEX IF NOT EXISTS idx_loan_schedules_loan   ON loan_repayment_schedules(loan_id, due_date);
CREATE INDEX IF NOT EXISTS idx_loan_schedules_client ON loan_repayment_schedules(client_id, due_date);

DROP TRIGGER IF EXISTS trg_loan_schedules_updated_at ON loan_repayment_schedules;
CREATE TRIGGER trg_loan_schedules_updated_at
    BEFORE UPDATE ON loan_repayment_schedules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ----------------------------------------------------------------------------
-- ROW LEVEL SECURITY（他テーブルと同形）
-- ----------------------------------------------------------------------------
ALTER TABLE loan_repayment_schedules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "loan_schedules_select" ON loan_repayment_schedules;
DROP POLICY IF EXISTS "loan_schedules_insert" ON loan_repayment_schedules;
DROP POLICY IF EXISTS "loan_schedules_update" ON loan_repayment_schedules;
DROP POLICY IF EXISTS "loan_schedules_delete" ON loan_repayment_schedules;
CREATE POLICY "loan_schedules_select" ON loan_repayment_schedules FOR SELECT
    USING (client_id IN (SELECT get_user_client_ids()));
CREATE POLICY "loan_schedules_insert" ON loan_repayment_schedules FOR INSERT
    WITH CHECK (client_id IN (SELECT get_user_client_ids()));
CREATE POLICY "loan_schedules_update" ON loan_repayment_schedules FOR UPDATE
    USING (client_id IN (SELECT get_user_client_ids()));
CREATE POLICY "loan_schedules_delete" ON loan_repayment_schedules FOR DELETE
    USING (client_id IN (SELECT get_user_client_ids()));
