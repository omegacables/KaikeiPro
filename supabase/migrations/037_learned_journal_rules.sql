-- ============================================================================
-- 037: 仕訳の学習機能
-- 既存の ai_journal_patterns テーブル（migration 001 で定義済み・未使用）を活用する。
-- 「取引先名/キーワード（＋入出金の方向）→ 勘定科目」を学習し、AI仕訳提案を補強する。
--
-- 既存列: id, client_id, vendor_name, keyword, account_id, sub_account_id,
--         tax_category, confidence, usage_count, last_used_at
-- 追加列:
--   direction         … 'received' | 'issued' | 'in' | 'out'（同一取引先でも借貸が逆になるため）
--   counter_account_id… 相手科目（判明している場合の貸借ペア。任意）
--   tax_rate          … 税率（任意。適用時に再計算する想定のソフトデフォルト）
-- RLS は既存（client_id スコープの select/insert/update/delete）をそのまま利用する。
-- ============================================================================

ALTER TABLE ai_journal_patterns
  ADD COLUMN IF NOT EXISTS direction text,
  ADD COLUMN IF NOT EXISTS counter_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tax_rate numeric;

-- 取引先名での検索を高速化（キーワード索引は 001 で作成済み）
CREATE INDEX IF NOT EXISTS idx_ai_journal_patterns_vendor
  ON ai_journal_patterns (client_id, vendor_name);
