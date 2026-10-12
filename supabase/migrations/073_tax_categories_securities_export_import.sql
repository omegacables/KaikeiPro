-- 税区分を5つ追加（消費税の集計表・課税売上割合・付表2-3 のため）
--   非課税売上（有価証券の譲渡等）… 課税売上割合の分母には対価の5%だけを入れる（消費税法施行令48条5項）
--   非課税資産の輸出等 … 課税売上割合の分子・分母に入れる（付表2-3 ③）
--   輸入仕入（国税7.8%分・6.24%分）… 税関に納めた消費税額（国税分）。付表2-3 ⑮「課税貨物に係る消費税額」
--   地方消費税貨物割 … 税関に納めた地方消費税。集計表に出すだけ（国税の控除には入らない）
insert into tax_categories (code, name, rate, is_purchase, transition_rate)
values
  ('sales_exempt_securities', '非課税売上（有価証券の譲渡等）', 0.00, false, null),
  ('sales_exempt_export',     '非課税資産の輸出等',             0.00, false, null),
  ('purchase_import_10',      '輸入仕入（消費税7.8%分）',       0.10, true,  null),
  ('purchase_import_08',      '輸入仕入（消費税6.24%分）',      0.08, true,  null),
  ('purchase_import_local',   '地方消費税貨物割（輸入）',       0.00, true,  null)
on conflict (code) do nothing;
