-- ----------------------------------------------------------------------------
-- 018_account_readings
-- 勘定科目の読み仮名（よみがな）辞書。設定画面でカスタム科目の読みを登録でき、
-- 科目検索（ひらがな/ローマ字の頭文字）に反映するためのマスタ。
-- 科目名→読みのグローバルなマッピング（事務所共通）。
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS account_readings (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name       text NOT NULL UNIQUE,   -- 勘定科目名
    reading    text NOT NULL,          -- 読み仮名（ひらがな）
    created_at timestamptz NOT NULL DEFAULT now()
);

-- アクセスはサーバーアクション（service role）経由のみ。直接の匿名アクセスは不可。
ALTER TABLE account_readings ENABLE ROW LEVEL SECURITY;
