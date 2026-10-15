-- ----------------------------------------------------------------------------
-- 075_fixed_asset_special_measure
-- 固定資産ごとに、使う租税特別措置（特別償却・税額控除の制度）を記録する。
--   special_measure_code … 適用額明細書の区分番号（例: 00031 = 中小企業投資促進税制の機械装置）。
--                          制度の一覧（条項・率）はアプリ側 src/lib/special-measures.ts
--   special_treatment    … 特別償却か税額控除か（どちらか一方しか選べない制度が多い）
-- 既存の special_depreciation_rate / special_depreciation_note はそのまま使う。
-- ----------------------------------------------------------------------------

ALTER TABLE fixed_assets
  ADD COLUMN IF NOT EXISTS special_measure_code text,
  ADD COLUMN IF NOT EXISTS special_treatment text
    CHECK (special_treatment IN ('depreciation', 'tax_credit'));
