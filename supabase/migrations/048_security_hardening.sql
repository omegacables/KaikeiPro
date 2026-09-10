-- Supabase のセキュリティ診断で出た指摘への対応。
--
-- 1) SECURITY DEFINER 関数の search_path を固定する
--
-- SECURITY DEFINER は「関数を作った人の権限で動く」指定で、テナントの
-- 切り分け（get_user_client_ids）はこれに依存している。search_path が
-- 固定されていないと、呼び出し側が別スキーマの同名テーブルを先に見せることで
-- 関数の中身をすり替えられる余地が残る。
-- 本番では authenticated / anon に public への CREATE 権限が無いため
-- 現時点で悪用はできないが、権限設定が一つ変われば成立してしまう。
-- 本体には触れず設定だけを足す ALTER で固定する。
alter function public.get_user_client_ids() set search_path = public, pg_temp;
alter function public.get_user_firm_ids() set search_path = public, pg_temp;
alter function public.is_super_admin() set search_path = public, pg_temp;
alter function public.update_updated_at_column() set search_path = public, pg_temp;

-- 2) setup_self_service_account を未ログインから呼べないようにする
--
-- この関数は clients と client_users に行を作る。SECURITY DEFINER のうえ
-- anon にも EXECUTE があったため、**ログインせずに** REST 経由で
--   /rest/v1/rpc/setup_self_service_account
-- を叩けば、誰でも顧問先を作れてしまう状態だった。
-- さらに p_user_id を引数で受け取りながら本人確認をしていないため、
-- 他人の user_id を指定して、その人の初期設定を先回りして潰すこともできた。
-- アプリからは常にログイン済みの本人の id を渡しているため、
-- 本人確認を足しても既存の導線は変わらない。
create or replace function public.setup_self_service_account(
    p_user_id uuid,
    p_name text,
    p_email text,
    p_company_name text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
    v_client_id uuid;
BEGIN
    -- 本人以外の user_id では実行させない（未ログインは auth.uid() が NULL）
    IF auth.uid() IS NULL OR p_user_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION '権限がありません';
    END IF;

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
$function$;

revoke execute on function public.setup_self_service_account(uuid, text, text, text) from anon;
