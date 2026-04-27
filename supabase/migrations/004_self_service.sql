-- 004_self_service.sql
-- セルフサービス登録: 顧問先が自分でアカウントを作り、後から税理士を招待できる機能

-- 1. firms テーブルに is_self_service 列追加
ALTER TABLE firms ADD COLUMN is_self_service boolean NOT NULL DEFAULT false;

-- 2. セルフサービスアカウント作成用 RPC関数 (SECURITY DEFINER でRLSをバイパス)
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
    v_firm_id uuid;
    v_client_id uuid;
BEGIN
    -- セルフサービス事務所を作成
    INSERT INTO firms (name, is_self_service)
    VALUES (p_company_name, true)
    RETURNING id INTO v_firm_id;

    -- ユーザーを事務所のadminとして登録
    INSERT INTO firm_members (firm_id, user_id, name, email, role, is_active)
    VALUES (v_firm_id, p_user_id, p_name, p_email, 'admin', true);

    -- 同名のクライアントを自動作成
    INSERT INTO clients (firm_id, name)
    VALUES (v_firm_id, p_company_name)
    RETURNING id INTO v_client_id;

    RETURN v_client_id;
END;
$$;
