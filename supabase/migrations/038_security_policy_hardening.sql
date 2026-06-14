-- ============================================================================
-- 038: セキュリティポリシー是正
-- ① firms_insert: 誰でも（WITH CHECK(true)）事務所を作成できたのを super_admin のみに。
--    アプリ側 createFirm() も assertSuperAdmin() でガード済み（多層防御）。
--    ※ セルフサービス登録（006版 setup_self_service_account）は firm を作らず
--      client_users を作るため影響なし。
-- ② moneytree_connections: access_token / refresh_token を含む行を、認証ユーザー
--    （client_user・firm_member）に SELECT 露出させない。アプリはサービスロール
--    クライアント＋所有権チェック経由で読むため、認証ユーザー向け SELECT は不要。
-- ============================================================================

-- ① 事務所作成は super_admin のみ
DROP POLICY IF EXISTS "firms_insert" ON firms;
CREATE POLICY "firms_insert" ON firms FOR INSERT
    WITH CHECK (is_super_admin());

-- ② Moneytree トークンの露出を停止（SELECT ポリシーを廃止＝サービスロール専用に）
DROP POLICY IF EXISTS "moneytree_connections_select" ON moneytree_connections;
