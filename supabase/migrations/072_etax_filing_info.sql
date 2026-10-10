-- e-Tax 用の申告書ファイル（.xtx）に入れる提出者の情報
--   提出先税務署（署番号 5桁）・利用者識別番号（16桁）・法人番号（13桁）・名称のフリガナ・代表者氏名とフリガナ
-- 消費税申告書の「基準期間の課税売上高」（帳簿から出せない年度もあるので入力）

alter table clients
    add column if not exists tax_office_code text
        check (tax_office_code is null or tax_office_code ~ '^\d{5}$'),
    add column if not exists etax_user_id text
        check (etax_user_id is null or etax_user_id ~ '^\d{16}$'),
    add column if not exists corporate_number text
        check (corporate_number is null or corporate_number ~ '^\d{13}$'),
    add column if not exists name_kana text,
    add column if not exists representative_name text,
    add column if not exists representative_kana text;

alter table consumption_tax_returns
    add column if not exists base_period_sales bigint;
