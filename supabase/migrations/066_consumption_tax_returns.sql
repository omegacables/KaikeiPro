-- 消費税申告書: 期ごとの申告の設定（計算方法・仕入税額の計算・中間納付額）
create table if not exists consumption_tax_returns (
    id                       uuid primary key default gen_random_uuid(),
    client_id                uuid not null references clients(id) on delete cascade,
    period_start             date not null,
    period_end               date not null,
    -- 本則課税 / 簡易課税 / 2割特例。null なら顧問先の設定（clients.tax_method）
    calc_method              text check (calc_method in ('standard', 'simplified', 'special_20')),
    -- 仕入税額の計算: 積上げ（請求書等の税額の合計 × 78/100）/ 割戻し（支払対価 × 7.8/110）
    purchase_tax_calc        text not null default 'stacked' check (purchase_tax_calc in ('stacked', 'proportional')),
    -- 簡易課税の事業区分（第1種〜第6種）。null なら顧問先の設定
    simplified_business_type int check (simplified_business_type between 1 and 6),
    -- 中間納付税額（国の消費税）と中間納付譲渡割額（地方消費税）
    interim_national         numeric not null default 0 check (interim_national >= 0),
    interim_local            numeric not null default 0 check (interim_local >= 0),
    note                     text,
    created_at               timestamptz not null default now(),
    updated_at               timestamptz not null default now(),
    unique (client_id, period_start)
);

alter table consumption_tax_returns enable row level security;

drop policy if exists "consumption_tax_returns_select" on consumption_tax_returns;
create policy "consumption_tax_returns_select" on consumption_tax_returns for select
    using (client_id in (select get_user_client_ids()));
drop policy if exists "consumption_tax_returns_insert" on consumption_tax_returns;
create policy "consumption_tax_returns_insert" on consumption_tax_returns for insert
    with check (client_id in (select get_user_writable_client_ids()));
drop policy if exists "consumption_tax_returns_update" on consumption_tax_returns;
create policy "consumption_tax_returns_update" on consumption_tax_returns for update
    using (client_id in (select get_user_writable_client_ids()))
    with check (client_id in (select get_user_writable_client_ids()));
drop policy if exists "consumption_tax_returns_delete" on consumption_tax_returns;
create policy "consumption_tax_returns_delete" on consumption_tax_returns for delete
    using (client_id in (select get_user_writable_client_ids()));

-- 閲覧専用・アクセス停止のアカウントはサーバー経由でも書き込めない（064 と同じ）
drop trigger if exists trg_block_readonly_writes on consumption_tax_returns;
create trigger trg_block_readonly_writes before insert or update or delete on consumption_tax_returns
    for each row execute function fn_block_readonly_writes();
