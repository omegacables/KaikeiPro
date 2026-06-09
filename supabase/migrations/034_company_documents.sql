-- ============================================================================
-- KaikeiPro 会社書類管理（定款・登記簿・届出控え等）
-- 取引に紐づかない「会社の参照書類」を顧問先単位で保管する。
--   doc_type: articles=定款 / registry=登記簿謄本 / tax_filing=税務署等への届出控え
--             / license=許認可 / other=その他
-- ファイル本体は Storage バケット "company-docs" に保存し、file_path で参照する。
-- 電子帳簿保存法の真実性確保のため SHA-256 ハッシュを保持する。
-- ============================================================================

CREATE TABLE IF NOT EXISTS company_documents (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id         uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    doc_type          text NOT NULL DEFAULT 'other'
                          CHECK (doc_type IN ('articles', 'registry', 'tax_filing', 'license', 'other')),
    title             text NOT NULL,
    file_path         text NOT NULL,
    original_filename text,
    file_size         integer,
    mime_type         text,
    file_hash         text,
    hash_algorithm    text DEFAULT 'SHA-256',
    issued_date       date,            -- 作成日・取得日（任意）
    memo              text,
    uploaded_by       uuid,
    created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_documents_client ON company_documents(client_id);
CREATE INDEX IF NOT EXISTS idx_company_documents_type   ON company_documents(doc_type);

-- ============================================================================
-- ROW LEVEL SECURITY（client_id ベース）
-- ============================================================================
ALTER TABLE company_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company_documents_select" ON company_documents;
DROP POLICY IF EXISTS "company_documents_insert" ON company_documents;
DROP POLICY IF EXISTS "company_documents_update" ON company_documents;
DROP POLICY IF EXISTS "company_documents_delete" ON company_documents;
CREATE POLICY "company_documents_select" ON company_documents FOR SELECT
    USING (client_id IN (SELECT get_user_client_ids()));
CREATE POLICY "company_documents_insert" ON company_documents FOR INSERT
    WITH CHECK (client_id IN (SELECT get_user_client_ids()));
CREATE POLICY "company_documents_update" ON company_documents FOR UPDATE
    USING (client_id IN (SELECT get_user_client_ids()));
CREATE POLICY "company_documents_delete" ON company_documents FOR DELETE
    USING (client_id IN (SELECT get_user_client_ids()));
