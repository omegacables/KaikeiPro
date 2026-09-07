-- ============================================================================
-- 040_loan_ledger
-- 借入金台帳を「1レコード＝1本の借入」から「1レコード＝1相手先＋増減明細」へ作り替える。
--
-- 背景:
--   033_loans.sql は金融機関からの1本の借入を前提に principal（当初借入額）と
--   current_balance（現在残高）を持っていたため、役員借入金を記録できなかった。
--   役員借入金は1本の借入ではなく、借入・立替・返済が積み上がる残高である。
--
-- 変更の要点:
--   1. loans をヘッダ（相手先）にし、増減明細 loan_entries を新設する
--   2. 残高はテーブルに持たず loan_entries の積み上げから算出する（手入力させない）
--   3. 役員貸付金（会社→役員）を direction で表現し、同じ構造で扱う
--   4. 証憑は多対多で明細行に紐付ける（通帳1枚が複数取引を含むため）
--
-- 残高はその台帳の方向における「正の値」で表す（借入金なら債務、貸付金なら債権）。
-- したがって増減の符号は entry_type だけで決まり、direction には依存しない。
-- direction が決めるのは残高の意味づけ（債務か債権か）である。
-- 符号の定義は SQL に持たず src/lib/loan-ledger.ts に集約する（ロジックの二重化を避けるため）。
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. loans のヘッダ化
-- ----------------------------------------------------------------------------
ALTER TABLE loans
    -- borrow=会社が借りる（借入金・役員借入金） / lend=会社が貸す（役員貸付金）
    ADD COLUMN IF NOT EXISTS direction text NOT NULL DEFAULT 'borrow'
        CHECK (direction IN ('borrow', 'lend')),
    -- institution=金融機関等 / officer=役員（既存 loan_type を置き換える）
    ADD COLUMN IF NOT EXISTS counterparty_kind text NOT NULL DEFAULT 'institution'
        CHECK (counterparty_kind IN ('institution', 'officer')),
    -- 勘定科目内訳明細書に所在地を出力するため（後続PRで使用）
    ADD COLUMN IF NOT EXISTS business_partner_id uuid
        REFERENCES business_partners(id) ON DELETE SET NULL,
    -- 返済条件。役員借入金は「定めなし」が既定
    ADD COLUMN IF NOT EXISTS repayment_terms text,
    -- 借入理由（内訳明細書の記載項目。後続PRで使用）
    ADD COLUMN IF NOT EXISTS purpose text;

-- 既存の loan_type から counterparty_kind を埋める（既存データは全件 borrow）
UPDATE loans SET counterparty_kind = 'officer'     WHERE loan_type = 'officer';
UPDATE loans SET counterparty_kind = 'institution' WHERE loan_type = 'borrowing';

-- principal / current_balance / loan_type は移行後は参照しない。
-- ただしコードのデプロイとマイグレーション適用は同時ではないため、ここでは DROP せず
-- 非推奨として残す（新旧どちらのコードでも落ちない状態を保つ）。削除は後続マイグレーションで行う。
COMMENT ON COLUMN loans.principal IS
    '非推奨（040）。残高は loan_entries から算出する。後続マイグレーションで削除予定。';
COMMENT ON COLUMN loans.current_balance IS
    '非推奨（040）。残高は loan_entries から算出する。後続マイグレーションで削除予定。';
COMMENT ON COLUMN loans.loan_type IS
    '非推奨（040）。counterparty_kind を使用すること。後続マイグレーションで削除予定。';

CREATE INDEX IF NOT EXISTS idx_loans_direction ON loans(client_id, direction);

-- ----------------------------------------------------------------------------
-- 2. loan_entries（増減明細）— 本改修の中心
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS loan_entries (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    loan_id            uuid NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
    client_id          uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    entry_date         date NOT NULL,
    -- borrow  : 借入（現金が動く。会社の債務が増える）
    -- advance : 立替（現金は動かないが債務が増える。役員が会社の経費を個人資金で負担）
    -- repay   : 返済
    -- interest: 利息の計上
    -- adjust  : 調整（移行時の差額など。signed_adjustment に符号付きの値を持つ）
    entry_type         text NOT NULL
                           CHECK (entry_type IN ('borrow', 'advance', 'repay', 'interest', 'adjust')),
    -- 常に正の値。増減の符号は entry_type で決まる（src/lib/loan-ledger.ts の signOf）
    amount             integer NOT NULL CHECK (amount >= 0),
    -- entry_type='adjust' のときのみ使う符号付きの差額。
    -- 調整は増減どちらにもなり得るため、区分では符号を決められない。
    signed_adjustment  integer,
    -- 立替時の費用科目（entry_type='advance' のとき必須。アプリ側で検証）
    expense_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
    -- 借入・返済時の相手科目（普通預金/現金）
    payment_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
    journal_entry_id   uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
    -- draft      : AIの下書き。人間が確定するまでこの状態（残高に算入しない）
    -- confirmed  : 人間が確定済み。残高に算入する
    -- journalized: 仕訳化済み
    status             text NOT NULL DEFAULT 'confirmed'
                           CHECK (status IN ('draft', 'confirmed', 'journalized')),
    -- manual=手入力 / ai_draft=AIが生成した下書き（採用後も由来を残す）
    source             text NOT NULL DEFAULT 'manual'
                           CHECK (source IN ('manual', 'ai_draft')),
    -- AIの判断根拠（どの証憑をどう解釈したか・信頼度・候補）。要件4-2の原則2。
    ai_evidence        jsonb,
    memo               text,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    -- 調整のときだけ符号付きの値を持ち、それ以外では持たない
    CONSTRAINT loan_entries_signed_adjustment_ck CHECK (
        (entry_type =  'adjust' AND signed_adjustment IS NOT NULL) OR
        (entry_type <> 'adjust' AND signed_adjustment IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_loan_entries_loan    ON loan_entries(loan_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_loan_entries_client  ON loan_entries(client_id, entry_date);
CREATE INDEX IF NOT EXISTS idx_loan_entries_journal ON loan_entries(journal_entry_id);
CREATE INDEX IF NOT EXISTS idx_loan_entries_draft   ON loan_entries(client_id) WHERE status = 'draft';

DROP TRIGGER IF EXISTS trg_loan_entries_updated_at ON loan_entries;
CREATE TRIGGER trg_loan_entries_updated_at
    BEFORE UPDATE ON loan_entries
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ----------------------------------------------------------------------------
-- 3. loan_entry_receipts（証憑の紐付け）
--
-- 既存の証憑紐付けは journal_entries.receipt_id のような FK 1本方式だが、
-- 通帳明細・振込明細のPDFは1枚で複数取引を含むため多対多にする。
-- 「添付元の証憑のどの行に対応するか」を source_line_no で記録する（要件3-3）。
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS loan_entry_receipts (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    loan_entry_id  uuid NOT NULL REFERENCES loan_entries(id) ON DELETE CASCADE,
    receipt_id     uuid NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
    client_id      uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    -- 証憑内の何行目に対応するか（通帳PDFの行番号など）
    source_line_no int,
    source_note    text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (loan_entry_id, receipt_id, source_line_no)
);

CREATE INDEX IF NOT EXISTS idx_loan_entry_receipts_entry   ON loan_entry_receipts(loan_entry_id);
CREATE INDEX IF NOT EXISTS idx_loan_entry_receipts_receipt ON loan_entry_receipts(receipt_id);
CREATE INDEX IF NOT EXISTS idx_loan_entry_receipts_client  ON loan_entry_receipts(client_id);

-- ----------------------------------------------------------------------------
-- 4. statutory_interest_rates（認定利息の利率）
--
-- 役員貸付金を期末をまたいで放置すると認定利息の計上義務が生じる。
-- 利率は年度ごとに国が定めるため設定値として保持する（要件3-4）。
-- 全テナント共通のマスタなので client_id を持たない。
--
-- ⚠ seed の値は国税庁の公表値で必ず検証し、毎年更新すること。
--    未登録の年度は「利率未設定」としてUIに表示し、試算は行わない（推測しない）。
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS statutory_interest_rates (
    fiscal_year int PRIMARY KEY,                         -- 会計年度の開始年
    rate        numeric(5,3) NOT NULL CHECK (rate >= 0), -- 年利(%)
    note        text,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO statutory_interest_rates (fiscal_year, rate, note) VALUES
    (2021, 1.000, '要検証: 国税庁の公表値で確認すること'),
    (2022, 0.900, '要検証: 国税庁の公表値で確認すること'),
    (2023, 0.900, '要検証: 国税庁の公表値で確認すること'),
    (2024, 0.900, '要検証: 国税庁の公表値で確認すること')
ON CONFLICT (fiscal_year) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 5. 標準勘定科目に「役員借入金」「役員貸付金」を追加
--
-- 既存の標準科目には短期借入金(2200)/長期借入金(2600)しか無く、役員借入金は
-- 顧問先が自分で登録しない限り仕訳化できなかった（loans.ts の名称解決が失敗する）。
-- 本機能の中心科目なのでデフォルト科目として提供する。
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  cat_assets      uuid;
  cat_liabilities uuid;
BEGIN
  SELECT id INTO cat_assets      FROM account_categories WHERE type = 'assets';
  SELECT id INTO cat_liabilities FROM account_categories WHERE type = 'liabilities';

  IF cat_liabilities IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM accounts WHERE is_default = true AND code = '2210') THEN
    INSERT INTO accounts (client_id, category_id, code, name, is_default)
      VALUES (NULL, cat_liabilities, '2210', '役員借入金', true);
  END IF;

  IF cat_assets IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM accounts WHERE is_default = true AND code = '1160') THEN
    INSERT INTO accounts (client_id, category_id, code, name, is_default)
      VALUES (NULL, cat_assets, '1160', '役員貸付金', true);
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 6. journal_entries.source に 'loan' を追加
--
-- 借入金台帳から起票した仕訳は現在 source='manual' で作られており由来を追跡できない。
-- 039_journal_source_payment と同形で拡張する。
-- ----------------------------------------------------------------------------
ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS journal_entries_source_check;
ALTER TABLE journal_entries ADD CONSTRAINT journal_entries_source_check
    CHECK (source IN ('manual', 'ai', 'import', 'raqto', 'bank', 'closing', 'card', 'payment', 'loan'));

-- ----------------------------------------------------------------------------
-- 7. 既存データの移行
--
--   loans.principal        → entry_type='borrow' の明細1件
--   loan_repayments の各行 → entry_type='repay'（元金）と 'interest'（利息）の明細
--
-- 積み上げ残高が旧 current_balance と一致しない場合は差額を 'adjust' として記録する。
-- 勝手に丸めず、画面で要確認として提示するため（signed_adjustment に符号込みで持つ）。
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  l         record;
  built     integer;
  diff      integer;
  last_date date;
BEGIN
  -- 二重移行の防止（再適用しても明細が増えない）
  IF EXISTS (SELECT 1 FROM loan_entries LIMIT 1) THEN
    RAISE NOTICE '040: loan_entries に既存データがあるため移行をスキップしました';
    RETURN;
  END IF;

  FOR l IN SELECT * FROM loans LOOP
    -- 当初借入
    IF COALESCE(l.principal, 0) > 0 THEN
      INSERT INTO loan_entries (loan_id, client_id, entry_date, entry_type, amount, status, memo)
      VALUES (l.id, l.client_id,
              COALESCE(l.borrowed_date, l.created_at::date),
              'borrow', l.principal, 'confirmed', '移行: 当初借入額');
    END IF;

    -- 返済記録 → 元金 / 利息 の明細に分解
    INSERT INTO loan_entries (loan_id, client_id, entry_date, entry_type, amount,
                              payment_account_id, journal_entry_id, status, memo)
    SELECT r.loan_id, r.client_id, r.repayment_date, 'repay', r.principal_amount,
           r.payment_account_id, r.journal_entry_id,
           CASE WHEN r.status = 'journalized' THEN 'journalized' ELSE 'confirmed' END,
           COALESCE(r.memo, '移行: 元金返済')
      FROM loan_repayments r
     WHERE r.loan_id = l.id AND r.principal_amount > 0;

    INSERT INTO loan_entries (loan_id, client_id, entry_date, entry_type, amount,
                              payment_account_id, journal_entry_id, status, memo)
    SELECT r.loan_id, r.client_id, r.repayment_date, 'interest', r.interest_amount,
           r.payment_account_id, r.journal_entry_id,
           CASE WHEN r.status = 'journalized' THEN 'journalized' ELSE 'confirmed' END,
           COALESCE(r.memo, '移行: 支払利息')
      FROM loan_repayments r
     WHERE r.loan_id = l.id AND r.interest_amount > 0;

    -- 積み上げ残高（borrow + interest - repay）と旧 current_balance の差
    SELECT COALESCE(SUM(
             CASE WHEN entry_type IN ('borrow', 'advance', 'interest') THEN amount
                  WHEN entry_type = 'repay' THEN -amount
                  ELSE 0 END), 0)
      INTO built
      FROM loan_entries WHERE loan_id = l.id;

    diff := COALESCE(l.current_balance, 0) - built;

    IF diff <> 0 THEN
      SELECT COALESCE(MAX(entry_date), COALESCE(l.borrowed_date, l.created_at::date))
        INTO last_date FROM loan_entries WHERE loan_id = l.id;

      INSERT INTO loan_entries (loan_id, client_id, entry_date, entry_type,
                                amount, signed_adjustment, status, memo)
      VALUES (l.id, l.client_id, last_date, 'adjust',
              ABS(diff), diff, 'confirmed',
              '移行時の差額調整（要確認）: 旧「現在残高」' || COALESCE(l.current_balance, 0)
              || ' に対し、明細の積み上げは ' || built || ' でした。差額 ' || diff
              || ' を調整として記録しています。内容を確認して修正してください。');
    END IF;
  END LOOP;
END $$;

-- loan_repayments は loan_entries へ移行済み。参照はしないが追跡のため当面残す。
COMMENT ON TABLE loan_repayments IS
    '非推奨（040）。loan_entries に移行済み。後続マイグレーションで削除予定。';

-- ----------------------------------------------------------------------------
-- 8. ROW LEVEL SECURITY
--    既存 loans と同形（client_id ベース）。
--    statutory_interest_rates は全テナント共通マスタのため SELECT のみ全許可。
-- ----------------------------------------------------------------------------
ALTER TABLE loan_entries             ENABLE ROW LEVEL SECURITY;
ALTER TABLE loan_entry_receipts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE statutory_interest_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "loan_entries_select" ON loan_entries;
DROP POLICY IF EXISTS "loan_entries_insert" ON loan_entries;
DROP POLICY IF EXISTS "loan_entries_update" ON loan_entries;
DROP POLICY IF EXISTS "loan_entries_delete" ON loan_entries;
CREATE POLICY "loan_entries_select" ON loan_entries FOR SELECT
    USING (client_id IN (SELECT get_user_client_ids()));
CREATE POLICY "loan_entries_insert" ON loan_entries FOR INSERT
    WITH CHECK (client_id IN (SELECT get_user_client_ids()));
CREATE POLICY "loan_entries_update" ON loan_entries FOR UPDATE
    USING (client_id IN (SELECT get_user_client_ids()));
CREATE POLICY "loan_entries_delete" ON loan_entries FOR DELETE
    USING (client_id IN (SELECT get_user_client_ids()));

DROP POLICY IF EXISTS "loan_entry_receipts_select" ON loan_entry_receipts;
DROP POLICY IF EXISTS "loan_entry_receipts_insert" ON loan_entry_receipts;
DROP POLICY IF EXISTS "loan_entry_receipts_update" ON loan_entry_receipts;
DROP POLICY IF EXISTS "loan_entry_receipts_delete" ON loan_entry_receipts;
CREATE POLICY "loan_entry_receipts_select" ON loan_entry_receipts FOR SELECT
    USING (client_id IN (SELECT get_user_client_ids()));
CREATE POLICY "loan_entry_receipts_insert" ON loan_entry_receipts FOR INSERT
    WITH CHECK (client_id IN (SELECT get_user_client_ids()));
CREATE POLICY "loan_entry_receipts_update" ON loan_entry_receipts FOR UPDATE
    USING (client_id IN (SELECT get_user_client_ids()));
CREATE POLICY "loan_entry_receipts_delete" ON loan_entry_receipts FOR DELETE
    USING (client_id IN (SELECT get_user_client_ids()));

DROP POLICY IF EXISTS "statutory_interest_rates_select" ON statutory_interest_rates;
DROP POLICY IF EXISTS "statutory_interest_rates_write" ON statutory_interest_rates;
CREATE POLICY "statutory_interest_rates_select" ON statutory_interest_rates FOR SELECT
    USING (auth.role() = 'authenticated');
CREATE POLICY "statutory_interest_rates_write" ON statutory_interest_rates FOR ALL
    USING (is_super_admin()) WITH CHECK (is_super_admin());
