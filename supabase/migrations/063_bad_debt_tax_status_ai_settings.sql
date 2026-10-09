-- 1. 貸倒れ・貸倒引当金の勘定科目と税区分
--    貸倒損失・貸倒引当金・貸倒引当金繰入額・貸倒引当金戻入益 は標準の科目に無かった。
--    貸倒引当金は資産の控除項目（貸方残高。貸借対照表では △ で表示する）。
--    課税売上の売掛金が貸し倒れたときは、貸倒れに係る消費税額を売上の消費税から控除する
--    （消費税法39条）ため、貸倒損失の行に付ける税区分を加える。
-- 2. 顧問先の消費税の納税義務（課税事業者・免税事業者）
-- 3. AIに会社情報・個人情報を渡すか（顧問先ごとの設定。既定は渡す＝これまでどおり）

-- 1. 勘定科目 ---------------------------------------------------------------
insert into accounts (client_id, category_id, code, name, is_active, is_default)
select null, c.id, v.code, v.name, true, true
from (values
    ('1190', '貸倒引当金', 'assets'),
    ('5900', '貸倒損失', 'expenses'),
    ('5910', '貸倒引当金繰入額', 'expenses'),
    ('4500', '貸倒引当金戻入益', 'revenue')
) as v(code, name, type)
join account_categories c on c.type = v.type
where not exists (
    select 1 from accounts a where a.client_id is null and a.name = v.name
);

-- 税区分（貸倒れ）
insert into tax_categories (code, name, rate, is_purchase, transition_rate)
select v.code, v.name, v.rate, false, null
from (values
    ('bad_debt_10', '貸倒れ（課税売上10%）', 0.10::numeric),
    ('bad_debt_08', '貸倒れ（課税売上8%）', 0.08::numeric)
) as v(code, name, rate)
where not exists (select 1 from tax_categories t where t.code = v.code);

-- 2. 消費税の納税義務 -------------------------------------------------------
alter table clients
    add column if not exists consumption_tax_status text not null default 'taxable';
alter table clients drop constraint if exists clients_consumption_tax_status_check;
alter table clients add constraint clients_consumption_tax_status_check
    check (consumption_tax_status in ('taxable', 'exempt'));
comment on column clients.consumption_tax_status is
    '消費税の納税義務: taxable=課税事業者 / exempt=免税事業者（基準期間の課税売上高1,000万円以下など）';

-- 3. AIに渡す情報 ------------------------------------------------------------
alter table clients
    add column if not exists ai_share_company_info boolean not null default true,
    add column if not exists ai_share_personal_info boolean not null default true;
comment on column clients.ai_share_company_info is
    'AIの読み取り・仕訳提案に会社情報（会社名・取引先名など）を渡すか';
comment on column clients.ai_share_personal_info is
    'AIに個人情報（役員・従業員の氏名・給与など）を渡すか';
