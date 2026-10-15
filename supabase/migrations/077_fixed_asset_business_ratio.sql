-- ----------------------------------------------------------------------------
-- 077_fixed_asset_business_ratio
-- 個人事業主の固定資産の事業専用割合（%）。家事と共用の資産（車・パソコンなど）は、
-- 減価償却費のうちこの割合だけを必要経費にし、残りは事業主貸にする。
-- 既存の資産は 100（全部を事業に使う）として扱う。
-- ----------------------------------------------------------------------------

ALTER TABLE fixed_assets
  ADD COLUMN IF NOT EXISTS business_ratio numeric(5,2) NOT NULL DEFAULT 100
    CHECK (business_ratio > 0 AND business_ratio <= 100);
