-- 006_three_tier_hierarchy.sql
-- 3階層権限システム: super_admin → 税理士(管理者) → 顧問先(利用者)
-- 顧問先は税理士なしでも存在可能にする (firm_id nullable)

-- ============================================================================
-- 1. super_admins テーブル
-- ============================================================================
CREATE TABLE super_admins (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL UNIQUE,
    name       text NOT NULL,
    email      text NOT NULL,
    is_active  boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE super_admins ENABLE ROW LEVEL SECURITY;

-- super_admins RLS: 自分自身のレコードのみ参照可能
CREATE POLICY "super_admins_select" ON super_admins FOR SELECT
    USING (user_id = auth.uid());

-- ============================================================================
-- 2. clients.firm_id を nullable に変更
-- ============================================================================
ALTER TABLE clients ALTER COLUMN firm_id DROP NOT NULL;

-- ============================================================================
-- 3. is_super_admin() ヘルパー関数
-- ============================================================================
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS boolean AS $$
    SELECT EXISTS (
        SELECT 1 FROM super_admins
        WHERE user_id = auth.uid() AND is_active = true
    );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================================
-- 4. get_user_firm_ids() 更新 — super_adminは全firm返却
-- ============================================================================
CREATE OR REPLACE FUNCTION get_user_firm_ids()
RETURNS SETOF uuid AS $$
BEGIN
    IF is_super_admin() THEN
        RETURN QUERY SELECT id FROM firms;
    ELSE
        RETURN QUERY SELECT firm_id FROM firm_members
            WHERE user_id = auth.uid() AND is_active = true;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ============================================================================
-- 5. get_user_client_ids() 更新 — super_adminは全client返却
-- ============================================================================
CREATE OR REPLACE FUNCTION get_user_client_ids()
RETURNS SETOF uuid AS $$
BEGIN
    IF is_super_admin() THEN
        RETURN QUERY SELECT id FROM clients;
    ELSE
        RETURN QUERY
            SELECT c.id FROM clients c
            INNER JOIN firm_members fm ON fm.firm_id = c.firm_id
            WHERE fm.user_id = auth.uid() AND fm.is_active = true
            UNION
            SELECT cu.client_id FROM client_users cu
            WHERE cu.user_id = auth.uid() AND cu.is_active = true;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ============================================================================
-- 6. RLSポリシー更新: firms
-- super_adminは全操作可能
-- ============================================================================
DROP POLICY IF EXISTS "firms_select" ON firms;
DROP POLICY IF EXISTS "firms_insert" ON firms;
DROP POLICY IF EXISTS "firms_update" ON firms;
DROP POLICY IF EXISTS "firms_delete" ON firms;

CREATE POLICY "firms_select" ON firms FOR SELECT
    USING (is_super_admin() OR id IN (SELECT get_user_firm_ids()));

CREATE POLICY "firms_insert" ON firms FOR INSERT
    WITH CHECK (true);

CREATE POLICY "firms_update" ON firms FOR UPDATE
    USING (is_super_admin() OR id IN (
        SELECT firm_id FROM firm_members
        WHERE user_id = auth.uid() AND role = 'admin' AND is_active = true
    ));

CREATE POLICY "firms_delete" ON firms FOR DELETE
    USING (is_super_admin() OR id IN (
        SELECT firm_id FROM firm_members
        WHERE user_id = auth.uid() AND role = 'admin' AND is_active = true
    ));

-- ============================================================================
-- 7. RLSポリシー更新: firm_members
-- ============================================================================
DROP POLICY IF EXISTS "firm_members_select" ON firm_members;
DROP POLICY IF EXISTS "firm_members_insert" ON firm_members;
DROP POLICY IF EXISTS "firm_members_update" ON firm_members;
DROP POLICY IF EXISTS "firm_members_delete" ON firm_members;

CREATE POLICY "firm_members_select" ON firm_members FOR SELECT
    USING (is_super_admin() OR firm_id IN (SELECT get_user_firm_ids()));

CREATE POLICY "firm_members_insert" ON firm_members FOR INSERT
    WITH CHECK (is_super_admin() OR firm_id IN (
        SELECT firm_id FROM firm_members
        WHERE user_id = auth.uid() AND role = 'admin' AND is_active = true
    ));

CREATE POLICY "firm_members_update" ON firm_members FOR UPDATE
    USING (is_super_admin() OR firm_id IN (
        SELECT firm_id FROM firm_members
        WHERE user_id = auth.uid() AND role = 'admin' AND is_active = true
    ));

CREATE POLICY "firm_members_delete" ON firm_members FOR DELETE
    USING (is_super_admin() OR firm_id IN (
        SELECT firm_id FROM firm_members
        WHERE user_id = auth.uid() AND role = 'admin' AND is_active = true
    ));

-- ============================================================================
-- 8. RLSポリシー更新: clients
-- ============================================================================
DROP POLICY IF EXISTS "clients_select" ON clients;
DROP POLICY IF EXISTS "clients_insert" ON clients;
DROP POLICY IF EXISTS "clients_update" ON clients;
DROP POLICY IF EXISTS "clients_delete" ON clients;

CREATE POLICY "clients_select" ON clients FOR SELECT
    USING (is_super_admin() OR id IN (SELECT get_user_client_ids()));

CREATE POLICY "clients_insert" ON clients FOR INSERT
    WITH CHECK (is_super_admin() OR firm_id IN (SELECT get_user_firm_ids()));

CREATE POLICY "clients_update" ON clients FOR UPDATE
    USING (is_super_admin() OR firm_id IN (SELECT get_user_firm_ids()));

CREATE POLICY "clients_delete" ON clients FOR DELETE
    USING (is_super_admin() OR firm_id IN (
        SELECT firm_id FROM firm_members
        WHERE user_id = auth.uid() AND role = 'admin' AND is_active = true
    ));

-- ============================================================================
-- 9. RLSポリシー更新: client_users
-- ============================================================================
DROP POLICY IF EXISTS "client_users_select" ON client_users;
DROP POLICY IF EXISTS "client_users_insert" ON client_users;
DROP POLICY IF EXISTS "client_users_update" ON client_users;
DROP POLICY IF EXISTS "client_users_delete" ON client_users;

CREATE POLICY "client_users_select" ON client_users FOR SELECT
    USING (is_super_admin() OR client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "client_users_insert" ON client_users FOR INSERT
    WITH CHECK (is_super_admin() OR client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "client_users_update" ON client_users FOR UPDATE
    USING (is_super_admin() OR client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "client_users_delete" ON client_users FOR DELETE
    USING (is_super_admin() OR client_id IN (SELECT get_user_client_ids()));

-- ============================================================================
-- 10. setup_self_service_account 更新
-- firm作成せず、client(firm_id=NULL) + client_users を作成
-- ============================================================================
CREATE OR REPLACE FUNCTION setup_self_service_account(
    p_user_id uuid,
    p_name text,
    p_email text,
    p_company_name text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_client_id uuid;
BEGIN
    -- 重複チェック: 既にclient_usersに登録されていないか
    IF EXISTS (SELECT 1 FROM client_users WHERE user_id = p_user_id) THEN
        RAISE EXCEPTION '既にアカウントが設定済みです';
    END IF;

    -- firm_id=NULL のクライアントを作成（税理士なしの独立顧問先）
    INSERT INTO clients (firm_id, name)
    VALUES (NULL, p_company_name)
    RETURNING id INTO v_client_id;

    -- client_usersにユーザーを登録
    INSERT INTO client_users (client_id, user_id, name, email, is_active)
    VALUES (v_client_id, p_user_id, p_name, p_email, true);

    RETURN v_client_id;
END;
$$;
