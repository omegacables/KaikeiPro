-- ----------------------------------------------------------------------------
-- 078_api_keys_and_external_ids
-- 外部（社内の自動仕訳など）から「仕訳と証憑」を受け取る口（/api/v1）のための準備。
--
-- 1. api_keys … 顧問先ごとのAPIキー。キーそのものは保存せず、SHA-256 の指紋だけを持つ。
--    書き込みはサーバー（サービスロール）だけ。利用者には指紋以外の列だけを見せる。
-- 2. journal_entries.external_id … 送り手が付ける外部ID。(client_id, external_id) で一意にし、
--    同じ仕訳を二重に登録しないようにする（NULL は対象外）。
-- 3. journal_entries.source に 'api' を足す（どこから来た仕訳かを残す）。
-- 4. api_key_hit() … キーごとの呼び出し回数の上限（1分あたり）と最終利用日時をまとめて更新する。
-- ----------------------------------------------------------------------------

-- 1. APIキー -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_keys (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id         uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    -- 誰として書き込むか（その顧問先に書き込める利用者。auth.users の id）
    user_id           uuid NOT NULL,
    name              text NOT NULL,
    -- 画面に出す先頭（rk_ を含む8文字）
    key_prefix        text NOT NULL,
    -- キーの SHA-256（16進）。キーそのものは保存しない
    key_hash          text NOT NULL UNIQUE,
    scopes            text[] NOT NULL DEFAULT ARRAY['journals:write', 'receipts:write'],
    last_used_at      timestamptz,
    revoked_at        timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    created_by        uuid,
    -- 呼び出し回数の上限のための数え（api_key_hit が更新する）
    rate_window_start timestamptz,
    rate_count        integer NOT NULL DEFAULT 0
);
COMMENT ON TABLE api_keys IS
    '外部連携のAPIキー（顧問先ごと）。キーは SHA-256 の指紋だけを保存する';

CREATE INDEX IF NOT EXISTS idx_api_keys_client ON api_keys(client_id);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

-- 読み取り: 自分がアクセスできる顧問先のキーだけ。書き込みの規則は作らない（サービスロールだけが書く）
DROP POLICY IF EXISTS "api_keys_select" ON api_keys;
CREATE POLICY "api_keys_select" ON api_keys FOR SELECT
    USING (client_id IN (SELECT get_user_client_ids()));

-- 指紋（key_hash）と回数の数えは、利用者のトークンからは読めないようにする（列ごとの権限）
REVOKE ALL ON api_keys FROM anon, authenticated;
GRANT SELECT (id, client_id, user_id, name, key_prefix, scopes, last_used_at, revoked_at, created_at, created_by)
    ON api_keys TO authenticated;

-- 2. 外部ID -------------------------------------------------------------------
ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS external_id text;
COMMENT ON COLUMN journal_entries.external_id IS
    '外部連携で送り手が付けたID。同じ顧問先で同じIDの仕訳は1件だけ（二重登録の防止）';
CREATE UNIQUE INDEX IF NOT EXISTS uq_journal_entries_client_external_id
    ON journal_entries(client_id, external_id)
    WHERE external_id IS NOT NULL;

-- 3. 仕訳の出どころに 'api' を足す（040_loan_ledger と同じ形で拡張する）--------
ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS journal_entries_source_check;
ALTER TABLE journal_entries ADD CONSTRAINT journal_entries_source_check
    CHECK (source IN ('manual', 'ai', 'import', 'raqto', 'bank', 'closing', 'card', 'payment', 'loan', 'api'));

-- 4. 呼び出し回数の上限 ----------------------------------------------------------
-- 1分ごとの窓で数える。上限以内なら true。最終利用日時もここで更新する。
-- 1行の UPDATE なので、同時に呼ばれても数えがずれない
CREATE OR REPLACE FUNCTION api_key_hit(p_key_id uuid, p_limit integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_window timestamptz := date_trunc('minute', now());
    v_count integer;
BEGIN
    UPDATE api_keys
       SET rate_count = CASE WHEN rate_window_start = v_window THEN rate_count + 1 ELSE 1 END,
           rate_window_start = v_window,
           last_used_at = now()
     WHERE id = p_key_id
    RETURNING rate_count INTO v_count;
    RETURN coalesce(v_count, 0) BETWEEN 1 AND p_limit;
END;
$$;

REVOKE ALL ON FUNCTION api_key_hit(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api_key_hit(uuid, integer) TO service_role;
