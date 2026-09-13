-- 「借入金及び支払利子の内訳書」の現行様式に合わせる。
--
-- 現行様式（令和6年3月1日以後終了事業年度用）の記載欄は
--   ①名称（氏名）②所在地（住所）③法人・代表者との関係
--   ④期末現在高 ⑤期中の支払利子額 ⑥利率 ⑦担保の内容
-- で、**「借入理由」欄は令和元年度の簡素化で削除されている**。
-- 実装は削除済みの借入理由を出し、③と⑦が欠けていた。
alter table loans
  add column if not exists relationship text,
  add column if not exists collateral text;

comment on column loans.relationship is
  '法人・代表者との関係（内訳書③）。役員・株主・関係会社などを記入する。役員借入金では記載対象の判定にも使う';
comment on column loans.collateral is
  '担保の内容（内訳書⑦）';
comment on column loans.purpose is
  '社内メモ。内訳書の「借入理由」欄は令和元年度の簡素化で削除されたため、様式には出力しない';

-- 役員からの借入は「役員」と分かる状態にしておく（未記入なら補う）
update loans
   set relationship = '役員'
 where counterparty_kind = 'officer'
   and (relationship is null or relationship = '');
