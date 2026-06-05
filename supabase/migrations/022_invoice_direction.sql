-- ----------------------------------------------------------------------------
-- 022_invoice_direction
-- 請求書の発行/受領区分。自社が発行した売上請求書(sales)と、取引先から受領した
-- 仕入請求書(purchase)を区別する。既存データは「売上(発行)」とみなす。
-- ----------------------------------------------------------------------------

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS direction text NOT NULL DEFAULT 'sales'
  CHECK (direction IN ('sales', 'purchase'));
