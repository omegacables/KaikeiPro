-- Add 'closing' to journal_entries source constraint
ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS journal_entries_source_check;
ALTER TABLE journal_entries ADD CONSTRAINT journal_entries_source_check
    CHECK (source IN ('manual', 'ai', 'import', 'raqto', 'bank', 'closing'));
