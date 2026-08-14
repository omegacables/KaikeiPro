-- ----------------------------------------------------------------------------
-- 039_journal_source_payment
-- 入金消込で自動計上する仕訳（普通預金/現金 ← 売掛金）を識別するため
-- journal_entries.source に 'payment' を追加する。
-- ----------------------------------------------------------------------------

ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS journal_entries_source_check;
ALTER TABLE journal_entries ADD CONSTRAINT journal_entries_source_check
    CHECK (source IN ('manual', 'ai', 'import', 'raqto', 'bank', 'closing', 'card', 'payment'));
