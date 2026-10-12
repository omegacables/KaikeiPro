-- 株主名簿（法人税申告書の別表二「同族会社等の判定に関する明細書」に使う）
--   group_no: 株主グループ（判定基準となる株主とその同族関係者を同じ番号に）。順位は持株数の多いグループから
--   relationship: 判定基準となる株主との続柄（本人・妻・長男 など）
-- 顧問先に、期末現在の発行済株式の総数と自己株式の数

create table if not exists shareholders (
    id              uuid primary key default gen_random_uuid(),
    client_id       uuid not null references clients(id) on delete cascade,
    group_no        int not null default 1 check (group_no between 1 and 99),
    name            text not null,
    address         text,
    relationship    text,
    is_corporation  boolean not null default false,
    shares          bigint not null default 0 check (shares >= 0),
    voting_rights   bigint check (voting_rights is null or voting_rights >= 0),
    sort_order      int not null default 0,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);
create index if not exists idx_shareholders_client on shareholders(client_id);

alter table shareholders enable row level security;

drop policy if exists "shareholders_select" on shareholders;
create policy "shareholders_select" on shareholders for select
    using (client_id in (select get_user_client_ids()));
drop policy if exists "shareholders_insert" on shareholders;
create policy "shareholders_insert" on shareholders for insert
    with check (client_id in (select get_user_writable_client_ids()));
drop policy if exists "shareholders_update" on shareholders;
create policy "shareholders_update" on shareholders for update
    using (client_id in (select get_user_writable_client_ids()))
    with check (client_id in (select get_user_writable_client_ids()));
drop policy if exists "shareholders_delete" on shareholders;
create policy "shareholders_delete" on shareholders for delete
    using (client_id in (select get_user_writable_client_ids()));

-- 閲覧専用・アクセス停止のアカウントはサーバー経由でも書き込めない（064 と同じ）
drop trigger if exists trg_block_readonly_writes on shareholders;
create trigger trg_block_readonly_writes before insert or update or delete on shareholders
    for each row execute function fn_block_readonly_writes();

alter table clients
    add column if not exists issued_shares bigint check (issued_shares is null or issued_shares >= 0),
    add column if not exists treasury_shares bigint check (treasury_shares is null or treasury_shares >= 0);
