-- 決算月の変更を顧問先ユーザーも行えるようにし、変更の記録と根拠書類を残す。
--
-- 1. 会社書類の種類に「議事録」「株主名簿」「台帳」を追加する
--    決算月（事業年度）の変更は定款変更＝株主総会の特別決議が必要で、
--    税務署等へ異動届出書を出す。その議事録・名簿を会社書類として保管できるようにする。
-- 2. 決算月の変更履歴 fiscal_month_changes を作る
--    いつ・誰が・何月から何月へ変えたか、決議日、変則期間になった年度、
--    根拠書類（company_documents）を残す。
--    書き込みはサーバー側（assertClientAccess で確認後にサービスロール）だけで行う。

-- 1. 会社書類の種類 --------------------------------------------------------
alter table company_documents drop constraint if exists company_documents_doc_type_check;
alter table company_documents add constraint company_documents_doc_type_check
    check (doc_type in (
        'articles',             -- 定款
        'registry',             -- 登記簿謄本
        'minutes',              -- 議事録（株主総会・取締役会）
        'shareholder_register', -- 株主名簿
        'ledger',               -- 台帳（その他の法定台帳・名簿）
        'tax_filing',           -- 税務署等への届出控え
        'license',              -- 許認可
        'other'                 -- その他
    ));

-- 2. 決算月の変更履歴 -------------------------------------------------------
create table if not exists fiscal_month_changes (
    id                     uuid primary key default gen_random_uuid(),
    client_id              uuid not null references clients(id) on delete cascade,
    old_start_month        int  not null check (old_start_month between 1 and 12),
    new_start_month        int  not null check (new_start_month between 1 and 12),
    resolution_date        date,          -- 株主総会等で決議した日（任意）
    -- 変更時に期末日を付け替えた会計年度（締めていない当期）。無ければ null
    fiscal_year_id         uuid references fiscal_years(id) on delete set null,
    old_period_end         date,
    new_period_end         date,
    document_ids           uuid[] not null default '{}',  -- 根拠書類（company_documents.id）
    memo                   text,
    changed_by             uuid,
    changed_by_name        text,
    created_at             timestamptz not null default now()
);

create index if not exists idx_fiscal_month_changes_client
    on fiscal_month_changes(client_id, created_at desc);

alter table fiscal_month_changes enable row level security;

drop policy if exists "fiscal_month_changes_select" on fiscal_month_changes;
create policy "fiscal_month_changes_select" on fiscal_month_changes for select
    using (client_id in (select get_user_client_ids()));

-- 書き込みはサービスロールのみ（利用者のトークンからは読み取りだけ）
revoke insert, update, delete on fiscal_month_changes from anon, authenticated;
