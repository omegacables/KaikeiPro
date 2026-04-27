-- 005_raqto_email_linking.sql
-- Raqto受発注 メールアドレス連携
-- raqto_company_id を NULL許可にし、raqto_email 列と updated_at を追加

ALTER TABLE raqto_integrations ALTER COLUMN raqto_company_id DROP NOT NULL;

ALTER TABLE raqto_integrations ADD COLUMN raqto_email text;

ALTER TABLE raqto_integrations ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

CREATE TRIGGER trg_raqto_integrations_updated_at
    BEFORE UPDATE ON raqto_integrations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
