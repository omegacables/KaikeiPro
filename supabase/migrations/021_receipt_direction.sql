-- ----------------------------------------------------------------------------
-- 021_receipt_direction
-- 領収書の発行/受領区分。自社が発行したもの(issued)と取引先から受領したもの(received)を区別。
-- 既存データは「受領」とみなす。
-- ----------------------------------------------------------------------------

ALTER TABLE receipts
  ADD COLUMN IF NOT EXISTS direction text NOT NULL DEFAULT 'received'
  CHECK (direction IN ('issued', 'received'));
