-- AIの取込箱（仕訳入力の「1つの箱」）の要確認ボックスとチャット
--   取り込んだ証憑・明細でAIが判断に迷ったもの、読み取りにくいものを1件ずつ残し、
--   AIの質問と利用者の答え（チャット）を messages に記録する。答えに応じてAIが仕訳を直す。
--   kind:   receipt（領収書・請求書など） / statement（通帳・カード明細） / table（CSV・Excel） / consult（相談） / other
--   reason: unreadable（読み取れない） / unclear（読み取りにくい） / low_confidence（科目に迷った） / entertainment（交際費の人数・相手）
--           / duplicate（重複の可能性） / withholding（源泉徴収） / unknown_document（仕訳にしない書類） / consult / other
--   status: open（答え待ち） / resolved（解決） / dismissed（このままでよい）

create table if not exists ai_inbox_items (
    id               uuid primary key default gen_random_uuid(),
    client_id        uuid not null references clients(id) on delete cascade,
    kind             text not null default 'receipt',
    reason           text not null default 'other',
    status           text not null default 'open',
    title            text,
    question         text not null,
    -- すぐ答えられる選択肢（チャットの下に並べる短い答え）
    options          jsonb not null default '[]'::jsonb,
    -- [{ "role": "ai" | "user", "text": "...", "at": "ISO日時" }]
    messages         jsonb not null default '[]'::jsonb,
    receipt_id       uuid references receipts(id) on delete set null,
    journal_entry_id uuid references journal_entries(id) on delete set null,
    file_name        text,
    created_by       uuid references auth.users(id) on delete set null,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    resolved_at      timestamptz
);

alter table ai_inbox_items drop constraint if exists ai_inbox_items_kind_check;
alter table ai_inbox_items add constraint ai_inbox_items_kind_check
    check (kind in ('receipt', 'statement', 'table', 'consult', 'other'));
alter table ai_inbox_items drop constraint if exists ai_inbox_items_reason_check;
alter table ai_inbox_items add constraint ai_inbox_items_reason_check
    check (reason in ('unreadable', 'unclear', 'low_confidence', 'entertainment', 'duplicate', 'withholding', 'unknown_document', 'consult', 'other'));
alter table ai_inbox_items drop constraint if exists ai_inbox_items_status_check;
alter table ai_inbox_items add constraint ai_inbox_items_status_check
    check (status in ('open', 'resolved', 'dismissed'));

create index if not exists idx_ai_inbox_items_client on ai_inbox_items(client_id, status, created_at desc);
create index if not exists idx_ai_inbox_items_receipt on ai_inbox_items(receipt_id);
create index if not exists idx_ai_inbox_items_entry on ai_inbox_items(journal_entry_id);

-- 証憑・仕訳が同じ顧問先のものか
create or replace function check_ai_inbox_item()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
    if NEW.receipt_id is not null
       and not exists (select 1 from receipts where id = NEW.receipt_id and client_id = NEW.client_id) then
        raise exception '証憑がこの顧問先のものではありません';
    end if;
    if NEW.journal_entry_id is not null
       and not exists (select 1 from journal_entries where id = NEW.journal_entry_id and client_id = NEW.client_id) then
        raise exception '仕訳がこの顧問先のものではありません';
    end if;
    NEW.updated_at := now();
    return NEW;
end;
$$;

drop trigger if exists trg_check_ai_inbox_item on ai_inbox_items;
create trigger trg_check_ai_inbox_item
    before insert or update on ai_inbox_items
    for each row execute function check_ai_inbox_item();

alter table ai_inbox_items enable row level security;

drop policy if exists "ai_inbox_items_select" on ai_inbox_items;
create policy "ai_inbox_items_select" on ai_inbox_items for select
    using (client_id in (select get_user_client_ids()));
drop policy if exists "ai_inbox_items_insert" on ai_inbox_items;
create policy "ai_inbox_items_insert" on ai_inbox_items for insert
    with check (client_id in (select get_user_writable_client_ids()));
drop policy if exists "ai_inbox_items_update" on ai_inbox_items;
create policy "ai_inbox_items_update" on ai_inbox_items for update
    using (client_id in (select get_user_writable_client_ids()))
    with check (client_id in (select get_user_writable_client_ids()));
drop policy if exists "ai_inbox_items_delete" on ai_inbox_items;
create policy "ai_inbox_items_delete" on ai_inbox_items for delete
    using (client_id in (select get_user_writable_client_ids()));

-- 閲覧専用・アクセス停止のアカウントはサーバー経由でも書き込めない（064 と同じ）
drop trigger if exists trg_block_readonly_writes on ai_inbox_items;
create trigger trg_block_readonly_writes before insert or update or delete on ai_inbox_items
    for each row execute function fn_block_readonly_writes();
