-- ============================================================================
-- KaikeiPro 税理士レビュー特化：仕訳ごとのレビューステータス
-- 既存の status(draft/confirmed/locked) や needs_review(bool) とは別に、
-- 税理士が仕訳を査閲した結果を 4 値で管理する。
--   unreviewed = 未確認（初期値）
--   confirmed  = 確認済み
--   needs_fix  = 要修正
--   question   = 質問中
-- 査閲者・査閲日時は既存の reviewed_by / reviewed_at を再利用する。
-- ============================================================================

ALTER TABLE journal_entries
    ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'unreviewed'
        CHECK (review_status IN ('unreviewed', 'confirmed', 'needs_fix', 'question'));

ALTER TABLE journal_entries
    ADD COLUMN IF NOT EXISTS review_note text;

CREATE INDEX IF NOT EXISTS idx_journal_entries_review_status
    ON journal_entries(client_id, review_status);
