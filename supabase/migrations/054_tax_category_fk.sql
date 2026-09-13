-- 税区分を決められた値だけに閉じる。
--
-- journal_entry_lines.tax_category は自由記述で、参照制約が無かった。
-- そのためAIが毎回それらしい名前を書き、同じ意味に13通りの表記が生まれ、
-- 集計側の名前と一つも一致していなかった（仕入れが1件も計上されない状態）。
--
-- アプリ側でも保存前に検査する（sanitizeTaxCategory）が、
-- 経路が増えたときに書き忘れる。データベース側でも塞ぐ。
--
-- NULL は許す（税区分を持たない行＝現金・預金・未払金など）。
-- 税区分マスタの行を消してもデータは壊さず、参照だけ外す。
-- 参照先に一意性が必要
create unique index if not exists tax_categories_code_key on tax_categories(code);

alter table journal_entry_lines
  add constraint journal_entry_lines_tax_category_fkey
  foreign key (tax_category) references tax_categories(code)
  on update cascade on delete set null;
