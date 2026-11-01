-- ----------------------------------------------------------------------------
-- 082_fixed_asset_disposal
-- 固定資産の売却・除却の仕訳と、中古資産の耐用年数（簡便法）。
--   計算は src/lib/asset-disposal.ts・src/lib/depreciation.ts、保存は src/actions/assets.ts
--
-- 1. fixed_assets に売却・除却の記録
--      disposal_type             … 'sale'（売却）/ 'retire'（除却・廃棄）。disposed_at は既存の列（手放した日）
--      sale_price                … 売却代金（税込）
--      sale_account_id           … 売却代金の入金先の科目
--      sale_tax_category         … 売却代金の税区分（課税売上10% など）
--      disposal_journal_entry_id … 売却・除却の仕訳。null なら日付だけの記録（一括償却資産の除却など）
--    手放した期の減価償却費（期首から手放した月まで）は、この仕訳に入れて
--    fixed_asset_depreciations にも journal_entry_id = この仕訳 で残す（期末の減価償却の仕訳で二重に計上しないため）
-- 2. fixed_assets に中古資産の情報
--      is_used / used_statutory_life（法定耐用年数）/ used_elapsed_months（経過月数）
-- 3. 売却・除却の仕訳が消されたら、資産を手放す前の状態に戻す（どの画面から消しても台帳と帳簿が食い違わないよう）
-- 4. 共有の基本科目: 固定資産売却益・固定資産売却損・固定資産除却損（特別利益・特別損失）
-- ----------------------------------------------------------------------------

-- 1・2. 列 -------------------------------------------------------------------
alter table fixed_assets
    add column if not exists disposal_type text,
    add column if not exists sale_price numeric,
    add column if not exists sale_account_id uuid references accounts(id) on delete set null,
    add column if not exists sale_tax_category text references tax_categories(code) on update cascade on delete set null,
    add column if not exists disposal_journal_entry_id uuid references journal_entries(id) on delete set null,
    add column if not exists is_used boolean not null default false,
    add column if not exists used_statutory_life int,
    add column if not exists used_elapsed_months int;

alter table fixed_assets drop constraint if exists fixed_assets_disposal_type_check;
alter table fixed_assets add constraint fixed_assets_disposal_type_check
    check (disposal_type is null or disposal_type in ('sale', 'retire'));
alter table fixed_assets drop constraint if exists fixed_assets_sale_price_check;
alter table fixed_assets add constraint fixed_assets_sale_price_check
    check (sale_price is null or sale_price >= 0);
alter table fixed_assets drop constraint if exists fixed_assets_used_check;
alter table fixed_assets add constraint fixed_assets_used_check
    check (
        (used_statutory_life is null or used_statutory_life between 1 and 100)
        and (used_elapsed_months is null or used_elapsed_months >= 0)
    );

create index if not exists idx_fixed_assets_disposal_entry on fixed_assets(disposal_journal_entry_id)
    where disposal_journal_entry_id is not null;

-- 仕訳・入金先の科目が同じ顧問先のものか（fixed_asset_depreciations の 065 と同じ考え方）
create or replace function check_fixed_asset_disposal()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
    if NEW.disposal_journal_entry_id is not null
       and not exists (select 1 from journal_entries where id = NEW.disposal_journal_entry_id and client_id = NEW.client_id) then
        raise exception '売却・除却の仕訳がこの顧問先のものではありません';
    end if;
    if NEW.sale_account_id is not null
       and not exists (select 1 from accounts where id = NEW.sale_account_id and (client_id = NEW.client_id or client_id is null)) then
        raise exception '入金先の科目がこの顧問先のものではありません';
    end if;
    return NEW;
end;
$$;

drop trigger if exists trg_check_fixed_asset_disposal on fixed_assets;
create trigger trg_check_fixed_asset_disposal
    before insert or update of disposal_journal_entry_id, sale_account_id on fixed_assets
    for each row execute function check_fixed_asset_disposal();

-- 3. 売却・除却の仕訳が消されたら、手放す前に戻す ---------------------------------
-- 仕訳の削除は帳簿の画面などからもできる。資産だけ「手放した」ままだと、台帳から消えた資産の
-- 帳簿価額が帳簿に残る。外部キーの on delete set null より先に動くよう before delete で行う。
-- 手放した期の償却費の行（fixed_asset_depreciations）は、任意償却で決めた額でなければ消す
-- （任意償却の行は外部キーで仕訳との結びつきだけが外れ、額は残る）。
-- 操作した人が書き込めない行でも黙って残らないよう security definer（この仕訳に結びついた行だけを触る）
create or replace function fn_reset_fixed_asset_disposal()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    delete from fixed_asset_depreciations
     where journal_entry_id = OLD.id
       and not is_manual
       and asset_id in (select id from fixed_assets where disposal_journal_entry_id = OLD.id);
    update fixed_assets
       set disposed_at = null,
           disposal_type = null,
           sale_price = null,
           sale_account_id = null,
           sale_tax_category = null,
           disposal_journal_entry_id = null
     where disposal_journal_entry_id = OLD.id;
    return OLD;
end;
$$;

drop trigger if exists trg_reset_fixed_asset_disposal on journal_entries;
create trigger trg_reset_fixed_asset_disposal
    before delete on journal_entries
    for each row execute function fn_reset_fixed_asset_disposal();

-- 4. 共有の基本科目 -------------------------------------------------------------
-- 損益計算書では特別利益・特別損失に出す。科目の区分の列（016 の pl_classification）が無いDB
-- （本番は 016 が未適用）でも通るよう、列があるときだけ区分を入れる。列が無ければ名前から推定する（src/actions/statements.ts）
insert into accounts (client_id, category_id, code, name, is_active, is_default)
select null, c.id, v.code, v.name, true, true
from (values
    ('4600', '固定資産売却益', 'revenue'),
    ('5920', '固定資産売却損', 'expenses'),
    ('5930', '固定資産除却損', 'expenses')
) as v(code, name, type)
join account_categories c on c.type = v.type
where not exists (
    select 1 from accounts a where a.client_id is null and a.name = v.name
);

do $$
begin
    if exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'accounts' and column_name = 'pl_classification'
    ) then
        execute $q$update accounts set pl_classification = 'extraordinary_gain'
                   where client_id is null and name = '固定資産売却益' and pl_classification is null$q$;
        execute $q$update accounts set pl_classification = 'extraordinary_loss'
                   where client_id is null and name in ('固定資産売却損', '固定資産除却損') and pl_classification is null$q$;
    end if;
end;
$$;
