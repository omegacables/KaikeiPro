-- 減価償却の強化
--   固定資産: 科目・事業供用日・特別償却
--   顧問先: 端数処理・記帳方法（直接法 / 間接法）
--   年度ごとの償却額（任意償却で決めた額・仕訳を作った額）
--   共有の基本科目の追加

alter table fixed_assets
    add column if not exists account_id uuid references accounts(id) on delete set null,
    add column if not exists service_start_date date,
    add column if not exists special_depreciation_rate numeric,
    add column if not exists special_depreciation_note text,
    add column if not exists note text;

alter table fixed_assets drop constraint if exists fixed_assets_special_rate_check;
alter table fixed_assets add constraint fixed_assets_special_rate_check
    check (special_depreciation_rate is null or (special_depreciation_rate > 0 and special_depreciation_rate <= 1));

alter table clients
    add column if not exists depreciation_rounding text not null default 'floor',
    add column if not exists depreciation_entry_method text not null default 'direct';

alter table clients drop constraint if exists clients_depreciation_rounding_check;
alter table clients add constraint clients_depreciation_rounding_check
    check (depreciation_rounding in ('floor', 'ceil', 'round'));
alter table clients drop constraint if exists clients_depreciation_entry_method_check;
alter table clients add constraint clients_depreciation_entry_method_check
    check (depreciation_entry_method in ('direct', 'indirect'));

create table if not exists fixed_asset_depreciations (
    id               uuid primary key default gen_random_uuid(),
    client_id        uuid not null references clients(id) on delete cascade,
    asset_id         uuid not null references fixed_assets(id) on delete cascade,
    period_start     date not null,
    period_end       date not null,
    -- 会計上の償却額（帳簿に計上する額）
    booked_amount    numeric not null check (booked_amount >= 0),
    -- 利用者が決めた額か（任意償却）。仕訳を作っただけの行は false
    is_manual        boolean not null default false,
    journal_entry_id uuid references journal_entries(id) on delete set null,
    note             text,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    unique (asset_id, period_start)
);

create index if not exists idx_fixed_asset_depreciations_client on fixed_asset_depreciations(client_id, period_start);
create index if not exists idx_fixed_asset_depreciations_entry on fixed_asset_depreciations(journal_entry_id);

-- 資産・仕訳が同じ顧問先のものか
create or replace function check_fixed_asset_depreciation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
    if not exists (select 1 from fixed_assets where id = NEW.asset_id and client_id = NEW.client_id) then
        raise exception '固定資産がこの顧問先のものではありません';
    end if;
    if NEW.journal_entry_id is not null
       and not exists (select 1 from journal_entries where id = NEW.journal_entry_id and client_id = NEW.client_id) then
        raise exception '仕訳がこの顧問先のものではありません';
    end if;
    NEW.updated_at := now();
    return NEW;
end;
$$;

drop trigger if exists trg_check_fixed_asset_depreciation on fixed_asset_depreciations;
create trigger trg_check_fixed_asset_depreciation
    before insert or update on fixed_asset_depreciations
    for each row execute function check_fixed_asset_depreciation();

alter table fixed_asset_depreciations enable row level security;

drop policy if exists "fixed_asset_depreciations_select" on fixed_asset_depreciations;
create policy "fixed_asset_depreciations_select" on fixed_asset_depreciations for select
    using (client_id in (select get_user_client_ids()));
drop policy if exists "fixed_asset_depreciations_insert" on fixed_asset_depreciations;
create policy "fixed_asset_depreciations_insert" on fixed_asset_depreciations for insert
    with check (client_id in (select get_user_writable_client_ids()));
drop policy if exists "fixed_asset_depreciations_update" on fixed_asset_depreciations;
create policy "fixed_asset_depreciations_update" on fixed_asset_depreciations for update
    using (client_id in (select get_user_writable_client_ids()))
    with check (client_id in (select get_user_writable_client_ids()));
drop policy if exists "fixed_asset_depreciations_delete" on fixed_asset_depreciations;
create policy "fixed_asset_depreciations_delete" on fixed_asset_depreciations for delete
    using (client_id in (select get_user_writable_client_ids()));

-- 閲覧専用・アクセス停止のアカウントはサーバー経由でも書き込めない（064 と同じ）
drop trigger if exists trg_block_readonly_writes on fixed_asset_depreciations;
create trigger trg_block_readonly_writes before insert or update or delete on fixed_asset_depreciations
    for each row execute function fn_block_readonly_writes();

-- 共有の基本科目
insert into accounts (client_id, category_id, code, name, is_active, is_default)
select null, c.id, v.code, v.name, true, true
from (values
    ('1505', '建物附属設備', 'assets'),
    ('1507', '構築物', 'assets'),
    ('1513', '機械装置', 'assets'),
    ('1525', '一括償却資産', 'assets'),
    ('1590', '減価償却累計額', 'assets')
) as v(code, name, type)
join account_categories c on c.type = v.type
where not exists (
    select 1 from accounts a where a.client_id is null and a.name = v.name
);
