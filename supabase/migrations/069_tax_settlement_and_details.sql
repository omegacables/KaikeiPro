-- 残りの機能のための追加（ユーザー了承済み）
--   共有科目: 法人税、住民税及び事業税 / 未払法人税等 / 仮払法人税等 / 未払消費税等
--   固定資産: 一括償却資産（3年均等）・少額減価償却資産（取得時に全額）
--   仕訳の行: 仕入の用途区分（個別対応方式）・売上の事業区分（簡易課税）
--   法人税の入力: 事務所ごとの従業者数（地方税の按分）・欠損金の繰戻し

insert into accounts (client_id, category_id, code, name, is_active, is_default)
select null, c.id, v.code, v.name, true, true
from (values
    ('5950', '法人税、住民税及び事業税', 'expenses'),
    ('2320', '未払法人税等', 'liabilities'),
    ('1410', '仮払法人税等', 'assets'),
    ('2510', '未払消費税等', 'liabilities')
) as v(code, name, type)
join account_categories c on c.type = v.type
where not exists (select 1 from accounts a where a.client_id is null and a.name = v.name);

alter table fixed_assets drop constraint if exists fixed_assets_depreciation_method_check;
alter table fixed_assets add constraint fixed_assets_depreciation_method_check
    check (depreciation_method in ('straight_line', 'declining_balance', 'lump_sum', 'small_immediate'));

alter table journal_entry_lines
    add column if not exists purchase_use text check (purchase_use in ('taxable', 'non_taxable', 'common')),
    add column if not exists business_type int check (business_type between 1 and 6);

alter table corporate_tax_returns
    add column if not exists offices jsonb not null default '[]'::jsonb,
    add column if not exists carryback jsonb;
