-- 008_raqto_source_tracking.sql
-- Raqto受発注との同期で重複防止するためのソース追跡カラム

-- business_partners: Raqto partner ID
ALTER TABLE business_partners ADD COLUMN IF NOT EXISTS raqto_partner_id text;
CREATE INDEX IF NOT EXISTS idx_business_partners_raqto_partner_id
  ON business_partners (raqto_partner_id) WHERE raqto_partner_id IS NOT NULL;

-- invoices: Raqto source tracking
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS raqto_source_id text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS raqto_source_type text; -- 'order' | 'document'
CREATE INDEX IF NOT EXISTS idx_invoices_raqto_source_id
  ON invoices (raqto_source_id) WHERE raqto_source_id IS NOT NULL;

-- journal_entries: Raqto source tracking
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS raqto_source_id text;
CREATE INDEX IF NOT EXISTS idx_journal_entries_raqto_source_id
  ON journal_entries (raqto_source_id) WHERE raqto_source_id IS NOT NULL;

-- raqto_integrations: company name + last sync timestamp
ALTER TABLE raqto_integrations ADD COLUMN IF NOT EXISTS raqto_company_name text;
ALTER TABLE raqto_integrations ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;
