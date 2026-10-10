-- 法人税申告書: 顧問先の資本金と、期ごとの申告の入力
alter table clients add column if not exists capital_amount numeric check (capital_amount is null or capital_amount >= 0);

create table if not exists corporate_tax_returns (
    id                          uuid primary key default gen_random_uuid(),
    client_id                   uuid not null references clients(id) on delete cascade,
    period_start                date not null,
    period_end                  date not null,
    -- 期末の資本金等の額・従業者数（住民税の均等割と中小法人の判定に使う）。null なら顧問先の設定
    capital_amount              numeric check (capital_amount is null or capital_amount >= 0),
    employees                   int check (employees is null or employees >= 0),
    -- 中間申告で納めた税額（申告額）
    interim_corporate_tax       numeric not null default 0 check (interim_corporate_tax >= 0),
    interim_local_corporate_tax numeric not null default 0 check (interim_local_corporate_tax >= 0),
    interim_prefectural         numeric not null default 0 check (interim_prefectural >= 0),
    interim_municipal           numeric not null default 0 check (interim_municipal >= 0),
    interim_enterprise          numeric not null default 0 check (interim_enterprise >= 0),
    -- 法人税額から控除する所得税額（受取利息・配当の源泉所得税）
    withholding_income_tax      numeric not null default 0 check (withholding_income_tax >= 0),
    -- 繰越欠損金: [{ "periodEnd": "2024-03-31", "amount": 1000000 }]
    loss_carryforwards          jsonb not null default '[]'::jsonb,
    -- 別表五(一) の期首の利益積立金（前期の申告から）: [{ "name": "繰越損益金", "amount": 0 }]
    opening_retained            jsonb not null default '[]'::jsonb,
    -- 手入力の加算・減算: [{ "kind": "add"|"deduct", "name": "...", "amount": 0, "treatment": "retained"|"outflow" }]
    adjustments                 jsonb not null default '[]'::jsonb,
    -- 地方税の税率（標準税率と違う自治体のとき）: { "prefectural": 0.01, "municipal": 0.06, ... }
    local_tax_rates             jsonb not null default '{}'::jsonb,
    note                        text,
    created_at                  timestamptz not null default now(),
    updated_at                  timestamptz not null default now(),
    unique (client_id, period_start)
);

alter table corporate_tax_returns enable row level security;

drop policy if exists "corporate_tax_returns_select" on corporate_tax_returns;
create policy "corporate_tax_returns_select" on corporate_tax_returns for select
    using (client_id in (select get_user_client_ids()));
drop policy if exists "corporate_tax_returns_insert" on corporate_tax_returns;
create policy "corporate_tax_returns_insert" on corporate_tax_returns for insert
    with check (client_id in (select get_user_writable_client_ids()));
drop policy if exists "corporate_tax_returns_update" on corporate_tax_returns;
create policy "corporate_tax_returns_update" on corporate_tax_returns for update
    using (client_id in (select get_user_writable_client_ids()))
    with check (client_id in (select get_user_writable_client_ids()));
drop policy if exists "corporate_tax_returns_delete" on corporate_tax_returns;
create policy "corporate_tax_returns_delete" on corporate_tax_returns for delete
    using (client_id in (select get_user_writable_client_ids()));

drop trigger if exists trg_block_readonly_writes on corporate_tax_returns;
create trigger trg_block_readonly_writes before insert or update or delete on corporate_tax_returns
    for each row execute function fn_block_readonly_writes();
