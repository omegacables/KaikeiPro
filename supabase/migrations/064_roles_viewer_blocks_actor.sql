-- 権限: 閲覧専用アカウント、社長による担当者のログイン停止、操作者の記録
--
-- 1. 役割
--    事務所側 firm_members.role に viewer（閲覧専用）を加える
--    顧問先側 client_users に role を加える: owner=社長 / member=社員 / viewer=閲覧専用
--    既存の顧問先ユーザーは、これまでどおり何でもできる owner にする
-- 2. 社長が、税理士・スタッフを指定して自社の帳簿へのアクセスを止める（client_access_blocks）
--    止められた人は、その顧問先のデータを見ることも書くこともできない
-- 3. 書き込みは「閲覧専用でない人」だけに限る
--    - 利用者のトークンで書くもの … 書き込みの規則（RLS）を get_user_writable_client_ids() に置き換える（後半）
--    - サーバー（サービスロール）で書くもの … 操作者IDをヘッダーで受け取り、トリガーで閲覧専用を止める
-- 4. 操作記録（監査ログ・仕訳の変更履歴）に、サーバー経由の書き込みでも操作者を残す

-- 1. 役割 -------------------------------------------------------------------
do $$
declare c record;
begin
    for c in select conname from pg_constraint
             where conrelid = 'firm_members'::regclass and contype = 'c'
               and pg_get_constraintdef(oid) like '%role%'
    loop
        execute format('alter table firm_members drop constraint %I', c.conname);
    end loop;
end $$;
alter table firm_members add constraint firm_members_role_check
    check (role in ('admin', 'staff', 'viewer'));

alter table client_users add column if not exists role text not null default 'owner';
alter table client_users drop constraint if exists client_users_role_check;
alter table client_users add constraint client_users_role_check
    check (role in ('owner', 'member', 'viewer'));
comment on column client_users.role is '顧問先ユーザーの役割: owner=社長 / member=社員 / viewer=閲覧専用';

-- 2. 社長による担当者のアクセス停止 -----------------------------------------
create table if not exists client_access_blocks (
    id          uuid primary key default gen_random_uuid(),
    client_id   uuid not null references clients(id) on delete cascade,
    user_id     uuid not null,          -- 止めた税理士・スタッフ（auth.users の id）
    blocked_by  uuid,
    reason      text,
    blocked_at  timestamptz not null default now(),
    unique (client_id, user_id)
);
comment on table client_access_blocks is
    '顧問先の社長が、税理士・スタッフの自社データへのアクセスを止めた記録（交代したときなど）';
alter table client_access_blocks enable row level security;

-- 3. 顧問先の一覧（読み取り）と、書き込める顧問先 -----------------------------
-- 止められた税理士・スタッフには、その顧問先を返さない
create or replace function get_user_client_ids()
returns setof uuid
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
    if is_super_admin() then
        return query select id from clients;
    else
        return query
            select c.id from clients c
            inner join firm_members fm on fm.firm_id = c.firm_id
            where fm.user_id = auth.uid() and fm.is_active = true
              and not exists (
                  select 1 from client_access_blocks b
                  where b.client_id = c.id and b.user_id = auth.uid()
              )
            union
            select cu.client_id from client_users cu
            where cu.user_id = auth.uid() and cu.is_active = true;
    end if;
end;
$$;

-- 指定した利用者が書き込める顧問先（閲覧専用と、止められた担当者を除く）
create or replace function writable_client_ids_for(p_user uuid)
returns setof uuid
language sql stable security definer
set search_path = public, pg_temp
as $$
    select c.id from clients c
    where exists (select 1 from super_admins sa where sa.user_id = p_user and sa.is_active = true)
    union
    select c.id from clients c
    inner join firm_members fm on fm.firm_id = c.firm_id
    where fm.user_id = p_user and fm.is_active = true and fm.role <> 'viewer'
      and not exists (
          select 1 from client_access_blocks b where b.client_id = c.id and b.user_id = p_user
      )
    union
    select cu.client_id from client_users cu
    where cu.user_id = p_user and cu.is_active = true and cu.role <> 'viewer';
$$;

create or replace function get_user_writable_client_ids()
returns setof uuid
language sql stable security definer
set search_path = public, pg_temp
as $$
    select writable_client_ids_for(auth.uid());
$$;

create or replace function can_write_client(p_client_id uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
    select p_client_id in (select get_user_writable_client_ids());
$$;

-- 4. 操作者 -----------------------------------------------------------------
-- 利用者のトークンなら auth.uid()。サーバー（サービスロール）からの書き込みは
-- アプリが付けるヘッダー x-actor-id を使う。サービスロール以外のヘッダーは信用しない
create or replace function app_actor_id()
returns uuid
language plpgsql stable
set search_path = public, pg_temp
as $$
declare
    v_role text;
    v_header text;
begin
    if auth.uid() is not null then
        return auth.uid();
    end if;
    v_role := coalesce(current_setting('request.jwt.claims', true)::json ->> 'role', '');
    if v_role <> 'service_role' then
        return null;
    end if;
    v_header := coalesce(current_setting('request.headers', true)::json ->> 'x-actor-id', '');
    if v_header ~ '^[0-9a-fA-F-]{36}$' then
        return v_header::uuid;
    end if;
    return null;
end;
$$;

-- サーバー経由の書き込みでも、閲覧専用・止められた担当者なら止める
-- （利用者のトークンでの書き込みは RLS が止める。操作者が分からないシステム処理は通す）
create or replace function fn_block_readonly_writes()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
    v_actor uuid;
    v_client uuid;
    r record;
begin
    if auth.uid() is not null then
        return coalesce(NEW, OLD);
    end if;
    v_actor := app_actor_id();
    if v_actor is null then
        return coalesce(NEW, OLD);
    end if;
    r := coalesce(NEW, OLD);
    case TG_TABLE_NAME
        when 'clients' then v_client := r.id;
        when 'journal_entry_lines' then
            select client_id into v_client from journal_entries where id = (to_jsonb(r) ->> 'journal_entry_id')::uuid;
        when 'invoice_items' then
            select client_id into v_client from invoices where id = (to_jsonb(r) ->> 'invoice_id')::uuid;
        when 'payment_allocations' then
            select client_id into v_client from payments where id = (to_jsonb(r) ->> 'payment_id')::uuid;
        when 'bank_transactions' then
            select client_id into v_client from bank_accounts where id = (to_jsonb(r) ->> 'bank_account_id')::uuid;
        when 'card_transactions', 'card_payments' then
            select client_id into v_client from card_accounts where id = (to_jsonb(r) ->> 'card_account_id')::uuid;
        when 'closing_balances' then
            select client_id into v_client from fiscal_years where id = (to_jsonb(r) ->> 'fiscal_year_id')::uuid;
        else
            v_client := (to_jsonb(r) ->> 'client_id')::uuid;
    end case;
    if v_client is null then
        return coalesce(NEW, OLD);
    end if;
    if not exists (select 1 from writable_client_ids_for(v_actor) w where w = v_client) then
        raise exception '閲覧専用のアカウント、またはアクセスを止められたアカウントのため、変更できません'
            using errcode = 'insufficient_privilege';
    end if;
    return coalesce(NEW, OLD);
end;
$$;

do $$
declare t text;
begin
    foreach t in array array[
        'clients', 'accounts', 'ai_journal_patterns', 'allocation_rate_settings', 'bank_accounts',
        'breakdown_items', 'business_partners', 'card_accounts', 'company_documents', 'departments',
        'fiscal_years', 'fixed_assets', 'inventory_counts', 'invoices', 'journal_entries',
        'journal_templates', 'loan_entries', 'loan_entry_receipts', 'loan_repayment_schedules',
        'loan_repayments', 'loans', 'moneytree_connections', 'payments', 'payroll_records',
        'raqto_integrations', 'receipt_folders', 'receipts', 'statement_lines', 'sub_accounts',
        'submission_periods', 'submission_schedules',
        'journal_entry_lines', 'invoice_items', 'payment_allocations', 'bank_transactions',
        'card_transactions', 'card_payments', 'closing_balances'
    ]
    loop
        if to_regclass('public.' || t) is not null then
            execute format('drop trigger if exists trg_block_readonly_writes on %I', t);
            execute format(
                'create trigger trg_block_readonly_writes before insert or update or delete on %I
                 for each row execute function fn_block_readonly_writes()', t);
        end if;
    end loop;
end $$;

-- 操作記録に操作者を残す（サーバー経由の書き込みでも）
create or replace function fn_audit_log()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
    v_client_id uuid;
    v_record_id uuid;
    v_old jsonb := null;
    v_new jsonb := null;
begin
    if TG_TABLE_NAME in ('journal_entries', 'receipts') then
        v_client_id := coalesce(NEW.client_id, OLD.client_id);
        v_record_id := coalesce(NEW.id, OLD.id);
    elsif TG_TABLE_NAME = 'journal_entry_lines' then
        v_record_id := coalesce(NEW.id, OLD.id);
        select client_id into v_client_id from journal_entries
        where id = coalesce(NEW.journal_entry_id, OLD.journal_entry_id);
    else
        return coalesce(NEW, OLD);
    end if;

    if v_client_id is null then
        return coalesce(NEW, OLD);
    end if;

    if TG_OP = 'INSERT' then
        v_new := to_jsonb(NEW);
    elsif TG_OP = 'UPDATE' then
        v_old := to_jsonb(OLD);
        v_new := to_jsonb(NEW);
    elsif TG_OP = 'DELETE' then
        v_old := to_jsonb(OLD);
    end if;

    insert into audit_logs (client_id, table_name, record_id, action, old_data, new_data, performed_by)
    values (v_client_id, TG_TABLE_NAME, v_record_id, TG_OP, v_old, v_new, app_actor_id());

    return coalesce(NEW, OLD);
end;
$$;

create or replace function fn_journal_entry_history()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
    v_version int;
    v_lines jsonb;
begin
    select coalesce(max(version), 0) + 1 into v_version
    from journal_entries_history where journal_entry_id = OLD.id;

    select coalesce(jsonb_agg(jsonb_build_object(
        'id', jel.id,
        'account_id', jel.account_id,
        'sub_account_id', jel.sub_account_id,
        'debit_amount', jel.debit_amount,
        'credit_amount', jel.credit_amount,
        'tax_category', jel.tax_category,
        'tax_rate', jel.tax_rate,
        'sort_order', jel.sort_order
    )), '[]'::jsonb) into v_lines
    from journal_entry_lines jel where jel.journal_entry_id = OLD.id;

    insert into journal_entries_history (
        journal_entry_id, version, entry_date, description, status,
        source, receipt_id, metadata, lines_snapshot, changed_by
    ) values (
        OLD.id, v_version, OLD.entry_date, OLD.description, OLD.status,
        OLD.source, OLD.receipt_id, OLD.metadata, v_lines, app_actor_id()
    );

    return NEW;
end;
$$;

-- 5. 書き込みの規則（RLS）を「閲覧専用でない人」に置き換える ------------------
-- 読み取り（SELECT）の規則はそのまま。INSERT/UPDATE/DELETE だけ置き換える
do $$
declare
    r record;
    q text;
    w text;
begin
    for r in
        select schemaname, tablename, policyname, cmd, qual, with_check
        from pg_policies
        where schemaname = 'public'
          and cmd in ('INSERT', 'UPDATE', 'DELETE')
          and (coalesce(qual, '') || coalesce(with_check, '')) like '%get_user_client_ids()%'
    loop
        q := replace(r.qual, 'get_user_client_ids()', 'get_user_writable_client_ids()');
        w := replace(r.with_check, 'get_user_client_ids()', 'get_user_writable_client_ids()');
        if r.cmd = 'INSERT' then
            execute format('alter policy %I on %I.%I with check (%s)', r.policyname, r.schemaname, r.tablename, w);
        elsif r.cmd = 'DELETE' then
            execute format('alter policy %I on %I.%I using (%s)', r.policyname, r.schemaname, r.tablename, q);
        else
            execute format('alter policy %I on %I.%I using (%s)%s', r.policyname, r.schemaname, r.tablename, q,
                case when w is not null then format(' with check (%s)', w) else '' end);
        end if;
    end loop;
end $$;

-- 共有の標準科目（client_id が null）は、全顧問先に効くため運営（super_admin）だけが書き換えられる
do $$
declare r record;
begin
    for r in select policyname, cmd from pg_policies
             where schemaname = 'public' and tablename = 'accounts' and cmd in ('INSERT', 'UPDATE', 'DELETE')
    loop
        if r.cmd = 'INSERT' then
            execute format('alter policy %I on accounts with check (is_super_admin() or client_id in (select get_user_writable_client_ids()))', r.policyname);
        elsif r.cmd = 'DELETE' then
            execute format('alter policy %I on accounts using (is_super_admin() or client_id in (select get_user_writable_client_ids()))', r.policyname);
        else
            execute format('alter policy %I on accounts using (is_super_admin() or client_id in (select get_user_writable_client_ids())) with check (is_super_admin() or client_id in (select get_user_writable_client_ids()))', r.policyname);
        end if;
    end loop;
end $$;

-- 顧問先ユーザーの追加・役割変更・停止はサーバーだけで行う（社長かどうかを確かめてから）。
-- 利用者のトークンで直接書けると、社員が自分を社長に変えられてしまう
do $$
declare r record;
begin
    for r in select policyname from pg_policies
             where schemaname = 'public' and tablename = 'client_users' and cmd in ('INSERT', 'UPDATE', 'DELETE')
    loop
        execute format('drop policy %I on client_users', r.policyname);
    end loop;
end $$;
create policy "client_users_write_super_admin" on client_users for all
    using (is_super_admin()) with check (is_super_admin());

-- 停止の記録: 見られるのは、その顧問先にアクセスできる人。書き込みはサーバーだけ
drop policy if exists "client_access_blocks_select" on client_access_blocks;
create policy "client_access_blocks_select" on client_access_blocks for select
    using (client_id in (select get_user_client_ids()) or user_id = auth.uid());
revoke insert, update, delete on client_access_blocks from anon, authenticated;
