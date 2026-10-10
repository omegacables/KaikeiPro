-- 消費税: 課税売上割合が95%未満のときの控除の方法（一括比例配分方式 / 個別対応方式）
alter table consumption_tax_returns
    add column if not exists deduction_method text not null default 'proportional' check (deduction_method in ('proportional', 'individual'));
