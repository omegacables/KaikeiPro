-- 法人税申告書の入力: 前期分の事業税等で当期に納税充当金から納付した額（別表四「13」）、接待飲食費（別表十五）
alter table corporate_tax_returns
    add column if not exists prior_enterprise_tax_paid numeric not null default 0 check (prior_enterprise_tax_paid >= 0),
    add column if not exists entertainment_dining numeric check (entertainment_dining is null or entertainment_dining >= 0);
