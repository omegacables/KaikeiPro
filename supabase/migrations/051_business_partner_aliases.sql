-- 取引先にも「通帳での表記」（別名）を持たせる。
--
-- 046 で借入金台帳に aliases を入れたが、同じ突き合わせは入金明細の取り込みや
-- 証憑の読み取りでも必要になる。通帳には「振込 ｱﾝﾄﾞｳ ﾚﾝ」「カ)オオサカブヒン」の
-- ように、正式名称とは違う表記で載るためである。
-- 機能ごとに別名を登録し直させるのは二度手間なので、取引先マスタに持たせて
-- どの機能からも同じ結び付けが効くようにする。
alter table business_partners
  add column if not exists aliases text[] not null default '{}';

comment on column business_partners.aliases is
  '通帳・入金明細に載る表記。正式名称と結び付けるための照合キー（例: ｱﾝﾄﾞｳ ﾚﾝ / カ)オオサカブヒン）';

-- 別名からの逆引きに使う
create index if not exists business_partners_aliases_idx
  on business_partners using gin (aliases);
