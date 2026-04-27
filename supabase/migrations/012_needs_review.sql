-- 確認待ち仕訳機能: journal_entries に needs_review フラグを追加
ALTER TABLE journal_entries
  ADD COLUMN IF NOT EXISTS needs_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

-- 確認待ち仕訳を効率的に検索するための部分インデックス
CREATE INDEX IF NOT EXISTS idx_journal_entries_needs_review
  ON journal_entries (client_id, needs_review)
  WHERE needs_review = true;
