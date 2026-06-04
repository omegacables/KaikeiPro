-- ----------------------------------------------------------------------------
-- 020_client_entity_type
-- 顧問先の事業者区分（個人事業主 / 法人）。家事按分の出し分けに使用。
-- ----------------------------------------------------------------------------

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS entity_type text
  CHECK (entity_type IS NULL OR entity_type IN ('individual', 'corporation'));
