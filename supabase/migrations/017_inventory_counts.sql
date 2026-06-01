-- ----------------------------------------------------------------------------
-- 017_inventory_counts
-- 実地棚卸表（品目別・手入力）: 棚卸日・商品名・数量・単価・金額
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS inventory_counts (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id    uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    count_date   date NOT NULL,                 -- 棚卸日
    product_name text NOT NULL,                 -- 商品名
    quantity     numeric NOT NULL DEFAULT 0,    -- 数量
    unit_price   numeric NOT NULL DEFAULT 0,    -- 単価
    amount       numeric GENERATED ALWAYS AS (quantity * unit_price) STORED, -- 金額
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_counts_client
    ON inventory_counts(client_id, count_date);

ALTER TABLE inventory_counts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inventory_counts_select" ON inventory_counts FOR SELECT
    USING (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "inventory_counts_insert" ON inventory_counts FOR INSERT
    WITH CHECK (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "inventory_counts_update" ON inventory_counts FOR UPDATE
    USING (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "inventory_counts_delete" ON inventory_counts FOR DELETE
    USING (client_id IN (SELECT get_user_client_ids()));
