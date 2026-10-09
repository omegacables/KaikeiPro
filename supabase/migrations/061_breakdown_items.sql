-- 勘定科目内訳明細書の「相手先ごとの明細」を保存する。
--
-- 仕訳には相手先の記録がほとんど無く、売掛金・買掛金などの相手先別の期末残高を
-- 帳簿から出せない。そこで内訳書の明細は人が入力し、試算表の科目残高と照合する。
-- 様式ごとに欄が違うため、共通の欄（相手先・金額・摘要など）は列で持ち、
-- 様式に固有の欄（手形の振出日・支払期日、有価証券の銘柄、賃借物件の所在地など）は details に持つ。
--
-- 期は開始日（period_start）で特定する。決算月を変えると同じ年に始まる期が2つでき、
-- 年では区別できないため。

create table if not exists breakdown_items (
    id                  uuid primary key default gen_random_uuid(),
    client_id           uuid not null references clients(id) on delete cascade,
    period_start        date not null,           -- 事業年度の開始日
    form_key            text not null,           -- 国税庁の様式区分（"3" = 売掛金、"9" = 買掛金 など）
    section             text not null default 'main', -- 様式内の表（未払配当金・権利金等の下段など）
    account_id          uuid references accounts(id) on delete set null, -- 「科目」欄
    partner_id          uuid references business_partners(id) on delete set null,
    name                text not null default '',  -- 名称（氏名）
    address             text not null default '',  -- 所在地（住所）
    registration_number text not null default '',  -- 登録番号（法人番号）
    relationship        text not null default '',  -- 法人・代表者との関係（役員・株主・関係会社）
    amount              numeric not null default 0, -- 期末現在高・金額・支払賃借料など
    note                text not null default '',  -- 摘要・取引の内容
    details             jsonb not null default '{}'::jsonb,
    sort_order          int not null default 0,
    created_by          uuid,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),
    constraint breakdown_items_form_key_check
        check (form_key in ('2', '3', '4-1', '6', '8', '9', '10-1', '15-1', '15-2'))
);

create index if not exists idx_breakdown_items_period
    on breakdown_items(client_id, period_start, form_key, sort_order);

comment on table breakdown_items is
    '勘定科目内訳明細書の相手先ごとの明細（人が入力し、試算表の科目残高と照合する）';
comment on column breakdown_items.details is
    '様式固有の欄。例: 手形の issue_date/due_date/bank/branch/discount_bank、有価証券の class/kind/brand/quantity、地代家賃の kind/usage/location/period_from/period_to';

alter table breakdown_items enable row level security;

drop policy if exists "breakdown_items_select" on breakdown_items;
create policy "breakdown_items_select" on breakdown_items for select
    using (client_id in (select get_user_client_ids()));

drop policy if exists "breakdown_items_insert" on breakdown_items;
create policy "breakdown_items_insert" on breakdown_items for insert
    with check (client_id in (select get_user_client_ids()));

drop policy if exists "breakdown_items_update" on breakdown_items;
create policy "breakdown_items_update" on breakdown_items for update
    using (client_id in (select get_user_client_ids()))
    with check (client_id in (select get_user_client_ids()));

drop policy if exists "breakdown_items_delete" on breakdown_items;
create policy "breakdown_items_delete" on breakdown_items for delete
    using (client_id in (select get_user_client_ids()));
