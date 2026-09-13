-- 仕入側の「非課税」「不課税」の税区分を追加する。
--
-- 売上側には sales_exempt / sales_out_of_scope があるのに、仕入側には
-- 対応する区分が無かった。租税公課（収入印紙・登録免許税など）や
-- 給与・保険料のように、課税仕入れにならない支出を表せない。
-- 区分が無いために「non_taxable」「purchase_non_taxable」といった
-- 自由記述が生まれていた。
--
-- どちらも仕入税額控除の対象外なので納税額は変わらないが、
-- 内訳の表示と、税区分を決まった値に閉じるために必要。
insert into tax_categories (code, name, rate, is_purchase, transition_rate)
values
  ('purchase_exempt',       '非課税仕入',                 0.00, true, null),
  ('purchase_out_of_scope', '不課税仕入（租税公課など）', 0.00, true, null)
on conflict (code) do nothing;
