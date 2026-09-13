-- 013（電子帳簿保存法コンプライアンス）のうち、本番に入っていなかった部分を適用する。
--
-- 013 はリポジトリにあるが、本番データベースには**一部しか適用されていなかった**。
--   適用済み: receipts のハッシュ列（file_hash / hash_algorithm / hash_verified_at）
--   未適用  : audit_logs、journal_entries_history、監査・履歴トリガー、
--             会計年度ロックのRLS
-- 「訂正・削除の事実と内容を確認できること」は電帳法の真実性確保の中心要件
-- （規則5条5項1号イ）で、これが無いと優良な電子帳簿の要件を満たせない。
--
-- 013 をそのまま流すと既存の列追加でこける。ここでは**不足分だけ**を、
-- 何度流しても同じ結果になる形で入れる。

-- --------------------------------------------------------------------------
-- 1. 監査証跡（追記のみ。RLSでは SELECT しか許さない）
-- --------------------------------------------------------------------------
create table if not exists audit_logs (
    id            uuid primary key default gen_random_uuid(),
    client_id     uuid not null,
    table_name    text not null,
    record_id     uuid not null,
    action        text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
    old_data      jsonb,
    new_data      jsonb,
    performed_by  uuid,
    performed_at  timestamptz not null default now()
);

create index if not exists idx_audit_logs_client_table on audit_logs(client_id, table_name);
create index if not exists idx_audit_logs_record on audit_logs(table_name, record_id);
create index if not exists idx_audit_logs_performed_at on audit_logs(performed_at);

alter table audit_logs enable row level security;

drop policy if exists "audit_logs_select" on audit_logs;
create policy "audit_logs_select" on audit_logs for select
    using (client_id in (select get_user_client_ids()));

-- --------------------------------------------------------------------------
-- 2. 監査証跡を書くトリガー関数
-- --------------------------------------------------------------------------
create or replace function fn_audit_log()
returns trigger
language plpgsql
security definer
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

    -- 親が先に消えている場合（カスケード削除）は記録先の顧問先が分からない。
    -- 親側の DELETE が記録されるので、ここでは落とさず素通りさせる
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
    values (v_client_id, TG_TABLE_NAME, v_record_id, TG_OP, v_old, v_new, auth.uid());

    return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists trg_audit_journal_entries on journal_entries;
create trigger trg_audit_journal_entries
    after insert or update or delete on journal_entries
    for each row execute function fn_audit_log();

drop trigger if exists trg_audit_journal_entry_lines on journal_entry_lines;
create trigger trg_audit_journal_entry_lines
    after insert or update or delete on journal_entry_lines
    for each row execute function fn_audit_log();

drop trigger if exists trg_audit_receipts on receipts;
create trigger trg_audit_receipts
    after insert or update or delete on receipts
    for each row execute function fn_audit_log();

-- --------------------------------------------------------------------------
-- 3. 仕訳の変更履歴（訂正前の姿を明細ごと残す）
-- --------------------------------------------------------------------------
create table if not exists journal_entries_history (
    id                uuid primary key default gen_random_uuid(),
    journal_entry_id  uuid not null references journal_entries(id) on delete cascade,
    version           int not null,
    entry_date        date,
    description       text,
    status            text,
    source            text,
    receipt_id        uuid,
    metadata          jsonb,
    lines_snapshot    jsonb not null,
    changed_by        uuid,
    changed_at        timestamptz not null default now(),
    unique (journal_entry_id, version)
);

create index if not exists idx_journal_entries_history_entry
    on journal_entries_history(journal_entry_id);

alter table journal_entries_history enable row level security;

drop policy if exists "journal_entries_history_select" on journal_entries_history;
create policy "journal_entries_history_select" on journal_entries_history for select
    using (
        journal_entry_id in (
            select id from journal_entries where client_id in (select get_user_client_ids())
        )
    );

create or replace function fn_journal_entry_history()
returns trigger
language plpgsql
security definer
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
        OLD.source, OLD.receipt_id, OLD.metadata, v_lines, auth.uid()
    );

    return NEW;
end;
$$;

drop trigger if exists trg_journal_entry_history on journal_entries;
create trigger trg_journal_entry_history
    before update on journal_entries
    for each row execute function fn_journal_entry_history();
