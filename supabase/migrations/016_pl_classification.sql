-- ----------------------------------------------------------------------------
-- 016_pl_classification
-- 損益計算書（報告式・5段階利益）のための勘定科目PL区分を追加
-- ----------------------------------------------------------------------------

-- accounts に PL区分カラムを追加（収益・費用科目を損益計算書の表示区分に細分類する）
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS pl_classification text
  CHECK (
    pl_classification IS NULL OR pl_classification IN (
      'sales',               -- 売上高
      'cogs',                -- 売上原価
      'sga',                 -- 販売費及び一般管理費
      'non_op_revenue',      -- 営業外収益
      'non_op_expense',      -- 営業外費用
      'extraordinary_gain',  -- 特別利益
      'extraordinary_loss',  -- 特別損失
      'tax'                  -- 法人税等
    )
  );

-- デフォルト勘定科目（is_default = true）に区分を設定
UPDATE accounts SET pl_classification = 'sales'
  WHERE is_default = true AND code = '4100';            -- 売上高

UPDATE accounts SET pl_classification = 'non_op_revenue'
  WHERE is_default = true AND code IN ('4200', '4300', '4400'); -- 受取利息/受取配当金/雑収入

UPDATE accounts SET pl_classification = 'cogs'
  WHERE is_default = true AND code = '5100';            -- 仕入高

UPDATE accounts SET pl_classification = 'non_op_expense'
  WHERE is_default = true AND code = '5600';            -- 支払利息

UPDATE accounts SET pl_classification = 'sga'
  WHERE is_default = true AND code IN (
    '5200', '5210', '5220', '5300', '5310', '5320', '5330',
    '5400', '5500', '5700', '5800', '5810', '5820'
  );                                                    -- 販管費各種
