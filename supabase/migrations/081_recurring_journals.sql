-- ----------------------------------------------------------------------------
-- 081_recurring_journals
-- 定期仕訳（家賃・リース料・顧問料・保険料・役員報酬・ローン返済・サブスク・家賃収入など、
-- 毎月同じ形で起きる取引）を一度登録しておき、まだ作っていない月の仕訳をまとめて作る。
--
-- 1. recurring_journals … 定期仕訳の登録。明細は lines（jsonb の配列）に持つ。
--      [{account_id, sub_account_id, debit_amount, credit_amount, tax_category,
--        purchase_use?, business_type?}]
--      purchase_use（個別対応方式の用途区分）・business_type（簡易課税の事業区分）は任意。
--      既存の仕訳から作ったときに、元の行の値を引き継ぐために持つ
--    計上日は day_of_month（1〜31、0＝末日）。その月に無い日（2月の31日など）は月末にそろえる
--    interval_months は 1＝毎月、3＝四半期、12＝毎年。start_month から数えて何か月ごとか
-- 2. journal_entries.recurring_journal_id / recurring_month … 作った仕訳と、元の定期仕訳・対象月のつながり。
--    (recurring_journal_id, recurring_month) で一意にし、同じ月を二重に作らないようにする（NULL は対象外）
-- 3. journal_entries.source に 'recurring' を足す（078 までの値はすべて残す）
-- ----------------------------------------------------------------------------

-- 1. 定期仕訳 -----------------------------------------------------------------
create table if not exists recurring_journals (
    id                   uuid primary key default gen_random_uuid(),
    client_id            uuid not null references clients(id) on delete cascade,
    name                 text not null,
    -- 作る仕訳の摘要（空なら名前を使う）
    description          text,
    lines                jsonb not null default '[]'::jsonb,
    -- 計上日（1〜31、0＝末日）
    day_of_month         integer not null default 0,
    -- 最初の月（YYYY-MM）
    start_month          text not null,
    -- 最後の月（YYYY-MM）。null は終わりなし
    end_month            text,
    -- 何か月ごとか（1＝毎月、3＝四半期、12＝毎年）
    interval_months      integer not null default 1,
    is_active            boolean not null default true,
    -- 最後に作った月（YYYY-MM）
    last_generated_month text,
    created_by           uuid,
    created_at           timestamptz not null default now(),
    updated_at           timestamptz not null default now(),
    constraint recurring_journals_name_check check (length(btrim(name)) > 0),
    constraint recurring_journals_lines_check check (jsonb_typeof(lines) = 'array'),
    constraint recurring_journals_day_check check (day_of_month between 0 and 31),
    constraint recurring_journals_interval_check check (interval_months between 1 and 12),
    constraint recurring_journals_start_month_check check (start_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
    constraint recurring_journals_end_month_check check (
        end_month is null or (end_month ~ '^\d{4}-(0[1-9]|1[0-2])$' and end_month >= start_month)
    ),
    constraint recurring_journals_last_month_check check (
        last_generated_month is null or last_generated_month ~ '^\d{4}-(0[1-9]|1[0-2])$'
    )
);
comment on table recurring_journals is
    '定期仕訳（毎月くり返す仕訳）。まだ作っていない月の仕訳を下書きでまとめて作る';

create index if not exists idx_recurring_journals_client on recurring_journals(client_id);

-- 明細の科目・補助科目が同じ顧問先のものか、貸借が合っているか
-- （明細を変えないとき＝停止・再開・最後に作った月の更新では見直さない。あとで科目が消されても停止はできるように）
create or replace function check_recurring_journal()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
    l jsonb;
    v_debit numeric := 0;
    v_credit numeric := 0;
    v_check boolean;
begin
    if TG_OP = 'INSERT' then
        v_check := true;
    else
        v_check := NEW.lines is distinct from OLD.lines or NEW.client_id is distinct from OLD.client_id;
    end if;
    if v_check then
        if jsonb_array_length(NEW.lines) < 2 then
            raise exception '定期仕訳の明細は借方・貸方あわせて2行以上必要です';
        end if;
        for l in select value from jsonb_array_elements(NEW.lines) loop
            if not exists (
                select 1 from accounts a
                where a.id = (l ->> 'account_id')::uuid
                  and (a.client_id = NEW.client_id or a.client_id is null)
            ) then
                raise exception '勘定科目がこの顧問先のものではありません';
            end if;
            if nullif(l ->> 'sub_account_id', '') is not null and not exists (
                select 1 from sub_accounts s
                where s.id = (l ->> 'sub_account_id')::uuid
                  and s.client_id = NEW.client_id
                  and s.account_id = (l ->> 'account_id')::uuid
            ) then
                raise exception '補助科目がこの顧問先・勘定科目のものではありません';
            end if;
            v_debit := v_debit + coalesce((l ->> 'debit_amount')::numeric, 0);
            v_credit := v_credit + coalesce((l ->> 'credit_amount')::numeric, 0);
        end loop;
        if v_debit <= 0 or v_debit <> v_credit then
            raise exception '定期仕訳の貸借が一致していません（借方 % / 貸方 %）', v_debit, v_credit;
        end if;
    end if;
    NEW.updated_at := now();
    return NEW;
end;
$$;

drop trigger if exists trg_check_recurring_journal on recurring_journals;
create trigger trg_check_recurring_journal
    before insert or update on recurring_journals
    for each row execute function check_recurring_journal();

alter table recurring_journals enable row level security;

drop policy if exists "recurring_journals_select" on recurring_journals;
create policy "recurring_journals_select" on recurring_journals for select
    using (client_id in (select get_user_client_ids()));
drop policy if exists "recurring_journals_insert" on recurring_journals;
create policy "recurring_journals_insert" on recurring_journals for insert
    with check (client_id in (select get_user_writable_client_ids()));
drop policy if exists "recurring_journals_update" on recurring_journals;
create policy "recurring_journals_update" on recurring_journals for update
    using (client_id in (select get_user_writable_client_ids()))
    with check (client_id in (select get_user_writable_client_ids()));
drop policy if exists "recurring_journals_delete" on recurring_journals;
create policy "recurring_journals_delete" on recurring_journals for delete
    using (client_id in (select get_user_writable_client_ids()));

-- 閲覧専用・アクセス停止のアカウントはサーバー経由でも書き込めない（064 と同じ）
drop trigger if exists trg_block_readonly_writes on recurring_journals;
create trigger trg_block_readonly_writes before insert or update or delete on recurring_journals
    for each row execute function fn_block_readonly_writes();

-- 2. 作った仕訳と定期仕訳・対象月のつながり ---------------------------------------
alter table journal_entries
    add column if not exists recurring_journal_id uuid references recurring_journals(id) on delete set null,
    add column if not exists recurring_month text;
comment on column journal_entries.recurring_journal_id is
    'この仕訳を作った定期仕訳。定期仕訳を消すと null になる（仕訳は残る）';
comment on column journal_entries.recurring_month is
    '定期仕訳の対象月（YYYY-MM）。同じ定期仕訳で同じ月の仕訳は1件だけ';

alter table journal_entries drop constraint if exists journal_entries_recurring_month_check;
alter table journal_entries add constraint journal_entries_recurring_month_check
    check (recurring_month is null or recurring_month ~ '^\d{4}-(0[1-9]|1[0-2])$');
-- 定期仕訳から作った仕訳には必ず対象月を付ける（定期仕訳を消した後は月だけが残ってよい）
alter table journal_entries drop constraint if exists journal_entries_recurring_pair_check;
alter table journal_entries add constraint journal_entries_recurring_pair_check
    check (recurring_journal_id is null or recurring_month is not null);

create unique index if not exists uq_journal_entries_recurring_month
    on journal_entries(recurring_journal_id, recurring_month)
    where recurring_journal_id is not null;

-- 3. 仕訳の出どころに 'recurring' を足す（078 と同じ形で拡張する）-----------------
alter table journal_entries drop constraint if exists journal_entries_source_check;
alter table journal_entries add constraint journal_entries_source_check
    check (source in ('manual', 'ai', 'import', 'raqto', 'bank', 'closing', 'card', 'payment', 'loan', 'api', 'recurring'));
