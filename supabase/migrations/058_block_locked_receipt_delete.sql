-- 締めた会計年度に属する証憑を消せないようにする。
--
-- 056 で仕訳は塞いだが、証憑の削除経路（deleteReceipts）は
-- サービスロールで receipts を直接消しており、何の確認も通らない。
-- 証憑が消えると、その仕訳の裏付けが失われる。
--
-- 判定は「紐づく仕訳の日付」で行う。証憑自体には取引日を持たないため。
create or replace function fn_block_locked_receipt_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_date date;
begin
    select j.entry_date into v_date
    from journal_entries j
    where j.receipt_id = OLD.id
      and is_fiscal_year_locked(j.client_id, j.entry_date)
    limit 1;

    if v_date is not null then
        raise exception '締めた会計年度（% 時点）の仕訳に使われている証憑は削除できません', v_date
            using errcode = 'check_violation';
    end if;
    return OLD;
end;
$$;

drop trigger if exists trg_block_locked_receipt_delete on receipts;
create trigger trg_block_locked_receipt_delete
    before delete on receipts
    for each row execute function fn_block_locked_receipt_delete();
