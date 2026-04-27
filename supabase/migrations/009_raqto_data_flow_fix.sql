-- 009: Raqto data flow fix
-- Add raqto_source_id to receipts for tracking Raqto receipt documents
-- Add raqto_order_status to invoices for displaying order status

ALTER TABLE receipts ADD COLUMN IF NOT EXISTS raqto_source_id text;
CREATE INDEX IF NOT EXISTS idx_receipts_raqto_source_id
  ON receipts (raqto_source_id) WHERE raqto_source_id IS NOT NULL;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS raqto_order_status text;
