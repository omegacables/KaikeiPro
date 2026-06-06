-- document_type を receipts テーブルに追加
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS document_type text;

-- receipt_folders テーブル
CREATE TABLE IF NOT EXISTS receipt_folders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    name text NOT NULL,
    parent_id uuid REFERENCES receipt_folders(id) ON DELETE CASCADE,
    sort_order int NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
ALTER TABLE receipt_folders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "receipt_folders_select" ON receipt_folders FOR SELECT USING (client_id IN (SELECT get_user_client_ids()));
CREATE POLICY "receipt_folders_insert" ON receipt_folders FOR INSERT WITH CHECK (client_id IN (SELECT get_user_client_ids()));
CREATE POLICY "receipt_folders_update" ON receipt_folders FOR UPDATE USING (client_id IN (SELECT get_user_client_ids()));
CREATE POLICY "receipt_folders_delete" ON receipt_folders FOR DELETE USING (client_id IN (SELECT get_user_client_ids()));

-- receipts に folder_id 追加
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS folder_id uuid REFERENCES receipt_folders(id) ON DELETE SET NULL;
