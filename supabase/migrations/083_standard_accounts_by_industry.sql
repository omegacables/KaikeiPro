-- 業種ごとの経理でよく使う共有の基本科目を足す
--   これまでの共有科目は約70で、外注費・支払手数料・広告宣伝費・支払報酬・仮払金・前受金などが無く、
--   AIが科目を選べずに雑な科目へ寄せたり、「科目が見つかりません」で仕訳を作れなかったりしていた。
--   同じ名前の共有科目が既にあれば足さない（顧問先ごとの科目には触らない）。
--
--   費用   … 外注費（建設・IT・製造）、荷造運賃（小売・EC）、広告宣伝費、販売促進費（小売・美容・教室）、支払手数料、
--            支払報酬（士業・デザイナーへの報酬。源泉徴収の対象）、保険料、修繕費、車両費（運送・営業）、
--            リース料、諸会費、研修費、雑費
--   収益   … 受取手数料、受取家賃（不動産賃貸）、完成工事高（建設）、社会保険診療収入・自由診療収入（医療）、介護保険収入（介護）
--   資産   … 未成工事支出金（建設）、仮払金、立替金、前払金
--   負債   … 前受金、未成工事受入金（建設）、仮受金、預り敷金（不動産）
--   社会保険診療・介護保険の税区分（非課税売上）は src/lib/tax-classify.ts の決まりで付ける

insert into accounts (client_id, category_id, code, name, is_active, is_default)
select null, c.id, v.code, v.name, true, true
from (values
    ('5110', '外注費', 'expenses'),
    ('5340', '荷造運賃', 'expenses'),
    ('5350', '広告宣伝費', 'expenses'),
    ('5360', '販売促進費', 'expenses'),
    ('5370', '支払手数料', 'expenses'),
    ('5380', '支払報酬', 'expenses'),
    ('5410', 'リース料', 'expenses'),
    ('5420', '保険料', 'expenses'),
    ('5430', '修繕費', 'expenses'),
    ('5440', '車両費', 'expenses'),
    ('5450', '諸会費', 'expenses'),
    ('5460', '研修費', 'expenses'),
    ('5990', '雑費', 'expenses'),
    ('4150', '受取手数料', 'revenue'),
    ('4160', '受取家賃', 'revenue'),
    ('4170', '完成工事高', 'revenue'),
    ('4180', '社会保険診療収入', 'revenue'),
    ('4185', '自由診療収入', 'revenue'),
    ('4190', '介護保険収入', 'revenue'),
    ('1310', '未成工事支出金', 'assets'),
    ('1420', '前払金', 'assets'),
    ('1430', '仮払金', 'assets'),
    ('1440', '立替金', 'assets'),
    ('2330', '前受金', 'liabilities'),
    ('2340', '未成工事受入金', 'liabilities'),
    ('2350', '仮受金', 'liabilities'),
    ('2360', '預り敷金', 'liabilities')
) as v(code, name, type)
join account_categories c on c.type = v.type
where not exists (
    select 1 from accounts a where a.client_id is null and a.name = v.name
);
