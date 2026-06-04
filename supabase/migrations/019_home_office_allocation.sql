-- ----------------------------------------------------------------------------
-- 019_home_office_allocation
-- 家事按分（F1）: 按分率設定テーブル ＋ 事業主貸/事業主借の既定科目追加
-- ----------------------------------------------------------------------------

-- 事業主貸・事業主借（個人事業主の資本科目）を既定科目に追加（無ければ）
DO $$
DECLARE
  cat_equity uuid;
BEGIN
  SELECT id INTO cat_equity FROM account_categories WHERE type = 'equity';

  IF NOT EXISTS (SELECT 1 FROM accounts WHERE is_default = true AND code = '3320') THEN
    INSERT INTO accounts (client_id, category_id, code, name, is_default)
    VALUES (NULL, cat_equity, '3320', '事業主貸', true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM accounts WHERE is_default = true AND code = '3330') THEN
    INSERT INTO accounts (client_id, category_id, code, name, is_default)
    VALUES (NULL, cat_equity, '3330', '事業主借', true);
  END IF;
END $$;

-- 科目ごとの按分率設定（顧問先 × 会計年度 × 勘定科目）
CREATE TABLE IF NOT EXISTS allocation_rate_settings (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id      uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    fiscal_year    int  NOT NULL,                 -- 会計年度（開始年。4月始まり）
    account_id     uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    business_ratio numeric(5,2) NOT NULL DEFAULT 0 CHECK (business_ratio >= 0 AND business_ratio <= 100),
    basis_note     text,                          -- 按分根拠メモ
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (client_id, fiscal_year, account_id)
);

CREATE INDEX IF NOT EXISTS idx_allocation_rate_client_year
    ON allocation_rate_settings(client_id, fiscal_year);

ALTER TABLE allocation_rate_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allocation_rate_select" ON allocation_rate_settings FOR SELECT
    USING (client_id IN (SELECT get_user_client_ids()));
CREATE POLICY "allocation_rate_insert" ON allocation_rate_settings FOR INSERT
    WITH CHECK (client_id IN (SELECT get_user_client_ids()));
CREATE POLICY "allocation_rate_update" ON allocation_rate_settings FOR UPDATE
    USING (client_id IN (SELECT get_user_client_ids()));
CREATE POLICY "allocation_rate_delete" ON allocation_rate_settings FOR DELETE
    USING (client_id IN (SELECT get_user_client_ids()));
