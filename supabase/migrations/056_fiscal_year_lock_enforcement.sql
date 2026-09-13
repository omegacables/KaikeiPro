-- 締めた会計年度の仕訳を、どの経路からも変更・削除できないようにする。
--
-- これまでの状態:
--   - アプリ側の確認 assertNotInLockedFiscalYear は仕訳画面の2箇所からしか
--     呼ばれておらず、借入金台帳・証憑の削除経路からは呼ばれていなかった
--   - 013 で用意されていたRLSのロック判定は本番に適用されていなかった
--
-- RLSを入れるだけでは足りない。アプリの多くの経路は
-- サービスロール（RLSを迂回する強い接続）で仕訳を書き換えている。
-- トリガーなら**接続の種類に関わらず**必ず通るため、こちらで塞ぐ。

create or replace function is_fiscal_year_locked(p_client_id uuid, p_entry_date date)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select exists (
        select 1 from fiscal_years
        where client_id = p_client_id
          and status = 'locked'
          and p_entry_date between start_date and end_date
    );
$$;

-- 締めた年度に属する仕訳の変更・削除を止める。
-- 日付を締めた年度の中へ動かすこと、外へ動かすことの両方を見る。
create or replace function fn_block_locked_fiscal_year()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_client_id uuid;
    v_date date;
begin
    if TG_TABLE_NAME = 'journal_entries' then
        -- 変更後だけでなく変更前も見る。締めた年度から動かして
        -- 中身を書き換える抜け道を塞ぐため
        if TG_OP in ('UPDATE', 'DELETE') and is_fiscal_year_locked(OLD.client_id, OLD.entry_date) then
            raise exception '締めた会計年度（% 時点）の仕訳は変更・削除できません', OLD.entry_date
                using errcode = 'check_violation';
        end if;
        if TG_OP in ('INSERT', 'UPDATE') and is_fiscal_year_locked(NEW.client_id, NEW.entry_date) then
            raise exception '締めた会計年度（% 時点）には仕訳を作れません', NEW.entry_date
                using errcode = 'check_violation';
        end if;
        return coalesce(NEW, OLD);
    end if;

    -- 明細は親の仕訳の日付で判定する
    select j.client_id, j.entry_date into v_client_id, v_date
    from journal_entries j
    where j.id = coalesce(NEW.journal_entry_id, OLD.journal_entry_id);

    -- 親が既に消えている場合（カスケード削除）は親側で判定済み
    if v_client_id is null then
        return coalesce(NEW, OLD);
    end if;

    if is_fiscal_year_locked(v_client_id, v_date) then
        raise exception '締めた会計年度（% 時点）の仕訳明細は変更・削除できません', v_date
            using errcode = 'check_violation';
    end if;
    return coalesce(NEW, OLD);
end;
$$;

drop trigger if exists trg_block_locked_journal_entries on journal_entries;
create trigger trg_block_locked_journal_entries
    before insert or update or delete on journal_entries
    for each row execute function fn_block_locked_fiscal_year();

drop trigger if exists trg_block_locked_journal_entry_lines on journal_entry_lines;
create trigger trg_block_locked_journal_entry_lines
    before insert or update or delete on journal_entry_lines
    for each row execute function fn_block_locked_fiscal_year();
