-- 補助科目を顧問先ごとに持てるようにする。
--
-- 売掛金・普通預金などの基本科目は全顧問先で共有している（accounts.client_id が null）。
-- 補助科目は科目（account_id）にしかひも付いていなかったため、共有科目に補助科目を作ると
-- 他の顧問先にも見えてしまう（RLS上も共有科目には作れなかった）。そこで顧問先の列を足す。
-- 適用時点で補助科目は0件。
--
-- あわせて、売掛金・買掛金などの補助科目を取引先マスタとひも付けられるようにする（partner_id）。

alter table sub_accounts
    add column if not exists client_id  uuid references clients(id) on delete cascade,
    add column if not exists partner_id uuid references business_partners(id) on delete set null,
    add column if not exists created_at timestamptz not null default now();

-- 既存行があれば科目の顧問先から補う（適用時点では0件）
update sub_accounts s
   set client_id = a.client_id
  from accounts a
 where a.id = s.account_id and s.client_id is null;
delete from sub_accounts where client_id is null;

alter table sub_accounts alter column client_id set not null;

-- 同じ顧問先・同じ科目に同じ名前の補助科目は作らない
create unique index if not exists uq_sub_accounts_client_account_name
    on sub_accounts(client_id, account_id, name);
create index if not exists idx_sub_accounts_client on sub_accounts(client_id, account_id);

comment on column sub_accounts.client_id is '補助科目を使う顧問先（共有の基本科目にも顧問先ごとに補助科目を作るため）';
comment on column sub_accounts.partner_id is '取引先マスタとのひも付け（売掛金・買掛金などの相手先別管理）';

-- RLS を顧問先単位に作り直す
drop policy if exists "sub_accounts_select" on sub_accounts;
drop policy if exists "sub_accounts_insert" on sub_accounts;
drop policy if exists "sub_accounts_update" on sub_accounts;
drop policy if exists "sub_accounts_delete" on sub_accounts;

create policy "sub_accounts_select" on sub_accounts for select
    using (client_id in (select get_user_client_ids()));
create policy "sub_accounts_insert" on sub_accounts for insert
    with check (client_id in (select get_user_client_ids()));
create policy "sub_accounts_update" on sub_accounts for update
    using (client_id in (select get_user_client_ids()))
    with check (client_id in (select get_user_client_ids()));
create policy "sub_accounts_delete" on sub_accounts for delete
    using (client_id in (select get_user_client_ids()));

-- 仕訳の行に付ける補助科目は、その行の科目・その仕訳の顧問先のものに限る
create or replace function check_line_sub_account() returns trigger
language plpgsql as $$
declare
    s record;
    entry_client uuid;
begin
    if new.sub_account_id is null then
        return new;
    end if;
    select account_id, client_id into s from sub_accounts where id = new.sub_account_id;
    select client_id into entry_client from journal_entries where id = new.journal_entry_id;
    if s.account_id is distinct from new.account_id then
        raise exception '補助科目が仕訳の勘定科目と一致しません';
    end if;
    if s.client_id is distinct from entry_client then
        raise exception '他の顧問先の補助科目は使えません';
    end if;
    return new;
end;
$$;

drop trigger if exists trg_check_line_sub_account on journal_entry_lines;
create trigger trg_check_line_sub_account
    before insert or update of sub_account_id, account_id on journal_entry_lines
    for each row execute function check_line_sub_account();

-- 関数の検索パスを固定する（Supabase のセキュリティ推奨）
alter function check_line_sub_account() set search_path = public;
