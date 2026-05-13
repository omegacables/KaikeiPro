-- ============================================================================
-- Moneytree LINK Integration
-- ============================================================================

CREATE TABLE moneytree_connections (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id               uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    access_token            text NOT NULL,
    refresh_token           text,
    expires_at              timestamptz NOT NULL,
    scope                   text,
    moneytree_customer_id   text,
    is_active               boolean NOT NULL DEFAULT true,
    connected_at            timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    UNIQUE(client_id)
);

CREATE INDEX idx_moneytree_connections_client ON moneytree_connections(client_id);

CREATE TRIGGER trg_moneytree_connections_updated_at
    BEFORE UPDATE ON moneytree_connections
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS: service role only (tokens must never be exposed to client)
ALTER TABLE moneytree_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "moneytree_connections_select" ON moneytree_connections FOR SELECT
    USING (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "moneytree_connections_insert" ON moneytree_connections FOR INSERT
    WITH CHECK (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "moneytree_connections_update" ON moneytree_connections FOR UPDATE
    USING (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "moneytree_connections_delete" ON moneytree_connections FOR DELETE
    USING (client_id IN (SELECT get_user_client_ids()));
