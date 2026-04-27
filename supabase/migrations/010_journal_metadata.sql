-- 010: Add metadata JSONB column to journal_entries
-- Used to store line-item details for purchase orders (PO) from Raqto

ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS metadata jsonb;
