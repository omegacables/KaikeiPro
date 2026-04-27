-- ============================================================================
-- KaikeiPro Initial Schema Migration
-- Supabase PostgreSQL Migration
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Extensions
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ----------------------------------------------------------------------------
-- 1. Helper: updated_at trigger function
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- MASTER TABLES (マスタ系)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- firms - 税理士事務所
-- ----------------------------------------------------------------------------
CREATE TABLE firms (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name                        text NOT NULL,
    postal_code                 text,
    address                     text,
    telephone                   text,
    email                       text,
    invoice_registration_number text,
    created_at                  timestamptz NOT NULL DEFAULT now(),
    updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_firms_updated_at
    BEFORE UPDATE ON firms
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ----------------------------------------------------------------------------
-- firm_members - 事務所メンバー
-- ----------------------------------------------------------------------------
CREATE TABLE firm_members (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firm_id    uuid NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
    user_id    uuid NOT NULL,
    name       text NOT NULL,
    email      text NOT NULL,
    role       text NOT NULL CHECK (role IN ('admin', 'staff')),
    is_active  boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_firm_members_firm_id  ON firm_members(firm_id);
CREATE INDEX idx_firm_members_user_id  ON firm_members(user_id);
CREATE INDEX idx_firm_members_email    ON firm_members(email);

-- ----------------------------------------------------------------------------
-- clients - 顧問先
-- ----------------------------------------------------------------------------
CREATE TABLE clients (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    firm_id                     uuid NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
    name                        text NOT NULL,
    business_type               text,
    postal_code                 text,
    address                     text,
    telephone                   text,
    email                       text,
    fiscal_year_start_month     int NOT NULL DEFAULT 4,
    tax_method                  text NOT NULL DEFAULT 'standard'
                                    CHECK (tax_method IN ('standard', 'simplified')),
    simplified_business_type    int,
    invoice_registration_number text,
    is_active                   boolean NOT NULL DEFAULT true,
    created_at                  timestamptz NOT NULL DEFAULT now(),
    updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_clients_firm_id   ON clients(firm_id);
CREATE INDEX idx_clients_is_active ON clients(firm_id, is_active);

CREATE TRIGGER trg_clients_updated_at
    BEFORE UPDATE ON clients
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ----------------------------------------------------------------------------
-- client_users - 顧問先ユーザー
-- ----------------------------------------------------------------------------
CREATE TABLE client_users (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id  uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    user_id    uuid NOT NULL,
    name       text NOT NULL,
    email      text NOT NULL,
    is_active  boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_client_users_client_id ON client_users(client_id);
CREATE INDEX idx_client_users_user_id   ON client_users(user_id);

-- ----------------------------------------------------------------------------
-- account_categories - 勘定科目分類
-- ----------------------------------------------------------------------------
CREATE TABLE account_categories (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    type       text NOT NULL CHECK (type IN ('assets', 'liabilities', 'equity', 'revenue', 'expenses')),
    name       text NOT NULL,
    sort_order int NOT NULL DEFAULT 0
);

-- ----------------------------------------------------------------------------
-- accounts - 勘定科目
-- ----------------------------------------------------------------------------
CREATE TABLE accounts (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id   uuid REFERENCES clients(id) ON DELETE CASCADE,
    category_id uuid NOT NULL REFERENCES account_categories(id) ON DELETE RESTRICT,
    code        text NOT NULL,
    name        text NOT NULL,
    is_active   boolean NOT NULL DEFAULT true,
    is_default  boolean NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_accounts_client_id   ON accounts(client_id);
CREATE INDEX idx_accounts_category_id ON accounts(category_id);
CREATE INDEX idx_accounts_code        ON accounts(code);

-- ----------------------------------------------------------------------------
-- sub_accounts - 補助科目
-- ----------------------------------------------------------------------------
CREATE TABLE sub_accounts (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name       text NOT NULL,
    is_active  boolean NOT NULL DEFAULT true
);

CREATE INDEX idx_sub_accounts_account_id ON sub_accounts(account_id);

-- ----------------------------------------------------------------------------
-- departments - 部門
-- ----------------------------------------------------------------------------
CREATE TABLE departments (
    id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    name      text NOT NULL,
    is_active boolean NOT NULL DEFAULT true
);

CREATE INDEX idx_departments_client_id ON departments(client_id);

-- ----------------------------------------------------------------------------
-- tax_categories - 税区分マスタ
-- ----------------------------------------------------------------------------
CREATE TABLE tax_categories (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code            text NOT NULL UNIQUE,
    name            text NOT NULL,
    rate            numeric NOT NULL,
    is_purchase     boolean NOT NULL DEFAULT false,
    transition_rate numeric
);

-- ----------------------------------------------------------------------------
-- business_partners - 取引先
-- ----------------------------------------------------------------------------
CREATE TABLE business_partners (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id                   uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    name                        text NOT NULL,
    type                        text NOT NULL CHECK (type IN ('customer', 'vendor', 'both')),
    postal_code                 text,
    address                     text,
    telephone                   text,
    email                       text,
    invoice_registration_number text,
    is_invoice_registered       boolean NOT NULL DEFAULT false,
    created_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_business_partners_client_id ON business_partners(client_id);
CREATE INDEX idx_business_partners_type      ON business_partners(client_id, type);

-- ============================================================================
-- TRANSACTION TABLES (トランザクション系)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- fiscal_years - 会計年度
-- ----------------------------------------------------------------------------
CREATE TABLE fiscal_years (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id  uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    start_date date NOT NULL,
    end_date   date NOT NULL,
    status     text NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open', 'closed', 'locked')),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_fiscal_years_client_id ON fiscal_years(client_id);
CREATE INDEX idx_fiscal_years_dates     ON fiscal_years(client_id, start_date, end_date);

-- ----------------------------------------------------------------------------
-- receipts - レシート/領収書
-- (Created before journal_entries because journal_entries references receipt_id)
-- ----------------------------------------------------------------------------
CREATE TABLE receipts (
    id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id              uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    uploaded_by            uuid NOT NULL,
    image_path             text NOT NULL,
    payment_method         text CHECK (payment_method IN ('cash', 'card', 'e_money', 'bank_transfer')),
    status                 text NOT NULL DEFAULT 'uploaded'
                               CHECK (status IN ('uploaded', 'processing', 'ocr_done', 'reviewed', 'journalized')),
    ocr_result             jsonb,
    ai_journal_suggestion  jsonb,
    fiscal_year_id         uuid REFERENCES fiscal_years(id) ON DELETE SET NULL,
    uploaded_at            timestamptz NOT NULL DEFAULT now(),
    reviewed_at            timestamptz,
    reviewed_by            uuid
);

CREATE INDEX idx_receipts_client_id      ON receipts(client_id);
CREATE INDEX idx_receipts_status         ON receipts(client_id, status);
CREATE INDEX idx_receipts_uploaded_by    ON receipts(uploaded_by);
CREATE INDEX idx_receipts_fiscal_year_id ON receipts(fiscal_year_id);

-- ----------------------------------------------------------------------------
-- journal_entries - 仕訳
-- ----------------------------------------------------------------------------
CREATE TABLE journal_entries (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id   uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    entry_date  date NOT NULL,
    description text,
    status      text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'confirmed', 'locked')),
    source      text NOT NULL DEFAULT 'manual'
                    CHECK (source IN ('manual', 'ai', 'import', 'raqto')),
    receipt_id  uuid REFERENCES receipts(id) ON DELETE SET NULL,
    created_by  uuid NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_journal_entries_client_id  ON journal_entries(client_id);
CREATE INDEX idx_journal_entries_entry_date ON journal_entries(client_id, entry_date);
CREATE INDEX idx_journal_entries_status     ON journal_entries(client_id, status);
CREATE INDEX idx_journal_entries_receipt_id ON journal_entries(receipt_id);
CREATE INDEX idx_journal_entries_created_by ON journal_entries(created_by);

CREATE TRIGGER trg_journal_entries_updated_at
    BEFORE UPDATE ON journal_entries
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ----------------------------------------------------------------------------
-- journal_entry_lines - 仕訳明細
-- ----------------------------------------------------------------------------
CREATE TABLE journal_entry_lines (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    journal_entry_id uuid NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    sub_account_id   uuid REFERENCES sub_accounts(id) ON DELETE SET NULL,
    department_id    uuid REFERENCES departments(id) ON DELETE SET NULL,
    debit_amount     numeric NOT NULL DEFAULT 0,
    credit_amount    numeric NOT NULL DEFAULT 0,
    tax_category     text,
    tax_rate         numeric,
    sort_order       int NOT NULL DEFAULT 0
);

CREATE INDEX idx_journal_entry_lines_entry_id   ON journal_entry_lines(journal_entry_id);
CREATE INDEX idx_journal_entry_lines_account_id ON journal_entry_lines(account_id);

-- ----------------------------------------------------------------------------
-- journal_templates - 仕訳テンプレート
-- ----------------------------------------------------------------------------
CREATE TABLE journal_templates (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id     uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    name          text NOT NULL,
    template_data jsonb NOT NULL DEFAULT '{}',
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_journal_templates_client_id ON journal_templates(client_id);

-- ----------------------------------------------------------------------------
-- invoices - 請求書
-- ----------------------------------------------------------------------------
CREATE TABLE invoices (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id           uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    business_partner_id uuid NOT NULL REFERENCES business_partners(id) ON DELETE RESTRICT,
    invoice_number      text NOT NULL,
    issued_date         date NOT NULL,
    due_date            date,
    subtotal            numeric NOT NULL DEFAULT 0,
    tax_amount          numeric NOT NULL DEFAULT 0,
    total_amount        numeric NOT NULL DEFAULT 0,
    status              text NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft', 'issued', 'sent', 'paid', 'overdue', 'void')),
    pdf_storage_path    text,
    journal_entry_id    uuid REFERENCES journal_entries(id) ON DELETE SET NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_invoices_client_id           ON invoices(client_id);
CREATE INDEX idx_invoices_business_partner_id ON invoices(business_partner_id);
CREATE INDEX idx_invoices_status              ON invoices(client_id, status);
CREATE INDEX idx_invoices_issued_date         ON invoices(client_id, issued_date);
CREATE INDEX idx_invoices_journal_entry_id    ON invoices(journal_entry_id);

CREATE TRIGGER trg_invoices_updated_at
    BEFORE UPDATE ON invoices
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ----------------------------------------------------------------------------
-- invoice_items - 請求書明細
-- ----------------------------------------------------------------------------
CREATE TABLE invoice_items (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    sort_order int NOT NULL DEFAULT 0,
    item_name  text NOT NULL,
    quantity   numeric NOT NULL DEFAULT 1,
    unit_price numeric NOT NULL DEFAULT 0,
    tax_rate   numeric NOT NULL DEFAULT 0,
    subtotal   numeric NOT NULL DEFAULT 0,
    tax_amount numeric NOT NULL DEFAULT 0
);

CREATE INDEX idx_invoice_items_invoice_id ON invoice_items(invoice_id);

-- ----------------------------------------------------------------------------
-- payments - 入金/支払
-- ----------------------------------------------------------------------------
CREATE TABLE payments (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id           uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    business_partner_id uuid NOT NULL REFERENCES business_partners(id) ON DELETE RESTRICT,
    amount              numeric NOT NULL DEFAULT 0,
    payment_date        date NOT NULL,
    payment_method      text,
    bank_account        text,
    memo                text,
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_payments_client_id           ON payments(client_id);
CREATE INDEX idx_payments_business_partner_id ON payments(business_partner_id);
CREATE INDEX idx_payments_payment_date        ON payments(client_id, payment_date);

-- ----------------------------------------------------------------------------
-- payment_allocations - 入金消込
-- ----------------------------------------------------------------------------
CREATE TABLE payment_allocations (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id       uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    invoice_id       uuid NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    allocated_amount numeric NOT NULL DEFAULT 0
);

CREATE INDEX idx_payment_allocations_payment_id ON payment_allocations(payment_id);
CREATE INDEX idx_payment_allocations_invoice_id ON payment_allocations(invoice_id);

-- ----------------------------------------------------------------------------
-- fixed_assets - 固定資産
-- ----------------------------------------------------------------------------
CREATE TABLE fixed_assets (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id            uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    name                 text NOT NULL,
    category             text,
    acquisition_date     date NOT NULL,
    acquisition_cost     numeric NOT NULL DEFAULT 0,
    useful_life          int NOT NULL,
    depreciation_method  text NOT NULL CHECK (depreciation_method IN ('straight_line', 'declining_balance')),
    salvage_value        numeric NOT NULL DEFAULT 0,
    disposed_at          date,
    created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_fixed_assets_client_id ON fixed_assets(client_id);

-- ----------------------------------------------------------------------------
-- closing_balances - 決算残高
-- ----------------------------------------------------------------------------
CREATE TABLE closing_balances (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    fiscal_year_id uuid NOT NULL REFERENCES fiscal_years(id) ON DELETE CASCADE,
    account_id     uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
    balance        numeric NOT NULL DEFAULT 0,
    UNIQUE (fiscal_year_id, account_id)
);

CREATE INDEX idx_closing_balances_fiscal_year_id ON closing_balances(fiscal_year_id);
CREATE INDEX idx_closing_balances_account_id     ON closing_balances(account_id);

-- ============================================================================
-- AI TABLES (AI系)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ai_journal_patterns - AI仕訳パターン学習
-- ----------------------------------------------------------------------------
CREATE TABLE ai_journal_patterns (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id      uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    vendor_name    text,
    keyword        text,
    account_id     uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    sub_account_id uuid REFERENCES sub_accounts(id) ON DELETE SET NULL,
    tax_category   text,
    confidence     numeric NOT NULL DEFAULT 0,
    usage_count    int NOT NULL DEFAULT 0,
    last_used_at   timestamptz
);

CREATE INDEX idx_ai_journal_patterns_client_id ON ai_journal_patterns(client_id);
CREATE INDEX idx_ai_journal_patterns_keyword   ON ai_journal_patterns(client_id, keyword);

-- ----------------------------------------------------------------------------
-- ai_feedback_logs - AIフィードバック
-- ----------------------------------------------------------------------------
CREATE TABLE ai_feedback_logs (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_id            uuid NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
    original_suggestion   jsonb NOT NULL,
    corrected_entry       jsonb NOT NULL,
    corrected_by          uuid NOT NULL,
    created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_feedback_logs_receipt_id ON ai_feedback_logs(receipt_id);

-- ============================================================================
-- COMMUNICATION TABLES (コミュニケーション系)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- comments - コメント
-- ----------------------------------------------------------------------------
CREATE TABLE comments (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_id       uuid REFERENCES receipts(id) ON DELETE CASCADE,
    journal_entry_id uuid REFERENCES journal_entries(id) ON DELETE CASCADE,
    parent_id        uuid REFERENCES comments(id) ON DELETE CASCADE,
    author_id        uuid NOT NULL,
    author_role      text NOT NULL CHECK (author_role IN ('staff', 'client')),
    body             text NOT NULL,
    status           text NOT NULL DEFAULT 'open'
                         CHECK (status IN ('open', 'answered', 'resolved')),
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_comments_receipt_id       ON comments(receipt_id);
CREATE INDEX idx_comments_journal_entry_id ON comments(journal_entry_id);
CREATE INDEX idx_comments_parent_id        ON comments(parent_id);
CREATE INDEX idx_comments_author_id        ON comments(author_id);

-- ----------------------------------------------------------------------------
-- comment_notifications - コメント通知
-- ----------------------------------------------------------------------------
CREATE TABLE comment_notifications (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    comment_id   uuid NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    recipient_id uuid NOT NULL,
    is_read      boolean NOT NULL DEFAULT false,
    notified_via text NOT NULL CHECK (notified_via IN ('app', 'email', 'line')),
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_comment_notifications_comment_id   ON comment_notifications(comment_id);
CREATE INDEX idx_comment_notifications_recipient_id ON comment_notifications(recipient_id, is_read);

-- ----------------------------------------------------------------------------
-- submission_schedules - 提出スケジュール
-- ----------------------------------------------------------------------------
CREATE TABLE submission_schedules (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id            uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    frequency            text NOT NULL CHECK (frequency IN ('monthly', 'weekly')),
    due_day              int NOT NULL,
    reminder_days        jsonb NOT NULL DEFAULT '[3, 1, 0]',
    notification_methods jsonb NOT NULL DEFAULT '["app"]',
    created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_submission_schedules_client_id ON submission_schedules(client_id);

-- ----------------------------------------------------------------------------
-- submission_periods - 提出期間
-- ----------------------------------------------------------------------------
CREATE TABLE submission_periods (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id     uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    period_start  date NOT NULL,
    period_end    date NOT NULL,
    due_date      date NOT NULL,
    status        text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'submitted', 'overdue', 'completed')),
    receipt_count int NOT NULL DEFAULT 0
);

CREATE INDEX idx_submission_periods_client_id ON submission_periods(client_id);
CREATE INDEX idx_submission_periods_status    ON submission_periods(client_id, status);
CREATE INDEX idx_submission_periods_due_date  ON submission_periods(due_date);

-- ----------------------------------------------------------------------------
-- reminder_logs - リマインダーログ
-- ----------------------------------------------------------------------------
CREATE TABLE reminder_logs (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_period_id uuid NOT NULL REFERENCES submission_periods(id) ON DELETE CASCADE,
    sent_at              timestamptz NOT NULL DEFAULT now(),
    method               text NOT NULL CHECK (method IN ('app', 'email', 'line')),
    status               text NOT NULL CHECK (status IN ('sent', 'failed'))
);

CREATE INDEX idx_reminder_logs_submission_period_id ON reminder_logs(submission_period_id);

-- ============================================================================
-- SYSTEM TABLES (システム系)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- notifications - お知らせ/通知
-- ----------------------------------------------------------------------------
CREATE TABLE notifications (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL,
    title      text NOT NULL,
    body       text,
    is_read    boolean NOT NULL DEFAULT false,
    link       text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user_id ON notifications(user_id, is_read);

-- ----------------------------------------------------------------------------
-- raqto_integrations - Raqto連携
-- ----------------------------------------------------------------------------
CREATE TABLE raqto_integrations (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id        uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    raqto_company_id text NOT NULL,
    is_active        boolean NOT NULL DEFAULT true,
    settings         jsonb,
    created_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (client_id)
);

-- ============================================================================
-- SEED DATA
-- ============================================================================

-- ----------------------------------------------------------------------------
-- account_categories - 勘定科目分類 初期データ
-- ----------------------------------------------------------------------------
INSERT INTO account_categories (type, name, sort_order) VALUES
    ('assets',      '資産',   1),
    ('liabilities', '負債',   2),
    ('equity',      '純資産', 3),
    ('revenue',     '収益',   4),
    ('expenses',    '費用',   5);

-- ----------------------------------------------------------------------------
-- tax_categories - 税区分マスタ 初期データ
-- Japanese consumption tax categories with rates and transitional measures
-- ----------------------------------------------------------------------------
INSERT INTO tax_categories (code, name, rate, is_purchase, transition_rate) VALUES
    -- 売上側 (Sales)
    ('sales_10',               '課税売上10%',                      0.10, false, NULL),
    ('sales_08_reduced',       '課税売上8%（軽減）',                0.08, false, NULL),
    ('sales_exempt',           '非課税売上',                        0.00, false, NULL),
    ('sales_tax_free',         '免税売上',                          0.00, false, NULL),
    ('sales_out_of_scope',     '不課税',                            0.00, false, NULL),
    -- 仕入側 (Purchases)
    ('purchase_10',            '課税仕入10%',                      0.10, true,  NULL),
    ('purchase_08_reduced',    '課税仕入8%（軽減）',                0.08, true,  NULL),
    -- 経過措置 10% (Transitional measures for 10%)
    ('purchase_10_trans_80',   '課税仕入10%（経過措置80%）',        0.10, true,  0.80),
    ('purchase_10_trans_50',   '課税仕入10%（経過措置50%）',        0.10, true,  0.50),
    -- 経過措置 8% (Transitional measures for 8%)
    ('purchase_08_trans_80',   '課税仕入8%（経過措置80%）',         0.08, true,  0.80),
    ('purchase_08_trans_50',   '課税仕入8%（経過措置50%）',         0.08, true,  0.50);

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE firms                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE firm_members          ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients               ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_users          ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_categories    ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts              ENABLE ROW LEVEL SECURITY;
ALTER TABLE sub_accounts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_categories        ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_partners     ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_years          ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipts              ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries       ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entry_lines   ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_templates     ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices              ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items         ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments              ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_allocations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE fixed_assets          ENABLE ROW LEVEL SECURITY;
ALTER TABLE closing_balances      ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_journal_patterns   ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_feedback_logs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE comments              ENABLE ROW LEVEL SECURITY;
ALTER TABLE comment_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission_schedules  ENABLE ROW LEVEL SECURITY;
ALTER TABLE submission_periods    ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminder_logs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications         ENABLE ROW LEVEL SECURITY;
ALTER TABLE raqto_integrations    ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- Helper function: get firm_ids for the current authenticated user
-- ============================================================================
CREATE OR REPLACE FUNCTION get_user_firm_ids()
RETURNS SETOF uuid AS $$
    SELECT firm_id FROM firm_members
    WHERE user_id = auth.uid() AND is_active = true;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================================
-- Helper function: get client_ids for the current authenticated user
-- (firm members can access all clients of their firm;
--  client_users can access only their client)
-- ============================================================================
CREATE OR REPLACE FUNCTION get_user_client_ids()
RETURNS SETOF uuid AS $$
    SELECT c.id FROM clients c
    INNER JOIN firm_members fm ON fm.firm_id = c.firm_id
    WHERE fm.user_id = auth.uid() AND fm.is_active = true
    UNION
    SELECT cu.client_id FROM client_users cu
    WHERE cu.user_id = auth.uid() AND cu.is_active = true;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================================
-- RLS POLICIES: firms
-- ============================================================================
CREATE POLICY "firms_select" ON firms FOR SELECT
    USING (id IN (SELECT get_user_firm_ids()));

CREATE POLICY "firms_insert" ON firms FOR INSERT
    WITH CHECK (true);

CREATE POLICY "firms_update" ON firms FOR UPDATE
    USING (id IN (
        SELECT firm_id FROM firm_members
        WHERE user_id = auth.uid() AND role = 'admin' AND is_active = true
    ));

CREATE POLICY "firms_delete" ON firms FOR DELETE
    USING (id IN (
        SELECT firm_id FROM firm_members
        WHERE user_id = auth.uid() AND role = 'admin' AND is_active = true
    ));

-- ============================================================================
-- RLS POLICIES: firm_members
-- ============================================================================
CREATE POLICY "firm_members_select" ON firm_members FOR SELECT
    USING (firm_id IN (SELECT get_user_firm_ids()));

CREATE POLICY "firm_members_insert" ON firm_members FOR INSERT
    WITH CHECK (firm_id IN (
        SELECT firm_id FROM firm_members
        WHERE user_id = auth.uid() AND role = 'admin' AND is_active = true
    ));

CREATE POLICY "firm_members_update" ON firm_members FOR UPDATE
    USING (firm_id IN (
        SELECT firm_id FROM firm_members
        WHERE user_id = auth.uid() AND role = 'admin' AND is_active = true
    ));

CREATE POLICY "firm_members_delete" ON firm_members FOR DELETE
    USING (firm_id IN (
        SELECT firm_id FROM firm_members
        WHERE user_id = auth.uid() AND role = 'admin' AND is_active = true
    ));

-- ============================================================================
-- RLS POLICIES: clients
-- ============================================================================
CREATE POLICY "clients_select" ON clients FOR SELECT
    USING (id IN (SELECT get_user_client_ids()));

CREATE POLICY "clients_insert" ON clients FOR INSERT
    WITH CHECK (firm_id IN (SELECT get_user_firm_ids()));

CREATE POLICY "clients_update" ON clients FOR UPDATE
    USING (firm_id IN (SELECT get_user_firm_ids()));

CREATE POLICY "clients_delete" ON clients FOR DELETE
    USING (firm_id IN (
        SELECT firm_id FROM firm_members
        WHERE user_id = auth.uid() AND role = 'admin' AND is_active = true
    ));

-- ============================================================================
-- RLS POLICIES: client_users
-- ============================================================================
CREATE POLICY "client_users_select" ON client_users FOR SELECT
    USING (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "client_users_insert" ON client_users FOR INSERT
    WITH CHECK (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "client_users_update" ON client_users FOR UPDATE
    USING (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "client_users_delete" ON client_users FOR DELETE
    USING (client_id IN (SELECT get_user_client_ids()));

-- ============================================================================
-- RLS POLICIES: account_categories (read-only for all authenticated users)
-- ============================================================================
CREATE POLICY "account_categories_select" ON account_categories FOR SELECT
    USING (true);

-- ============================================================================
-- RLS POLICIES: accounts
-- ============================================================================
CREATE POLICY "accounts_select" ON accounts FOR SELECT
    USING (
        client_id IS NULL
        OR client_id IN (SELECT get_user_client_ids())
    );

CREATE POLICY "accounts_insert" ON accounts FOR INSERT
    WITH CHECK (
        client_id IS NULL
        OR client_id IN (SELECT get_user_client_ids())
    );

CREATE POLICY "accounts_update" ON accounts FOR UPDATE
    USING (
        client_id IS NULL
        OR client_id IN (SELECT get_user_client_ids())
    );

CREATE POLICY "accounts_delete" ON accounts FOR DELETE
    USING (
        client_id IS NULL
        OR client_id IN (SELECT get_user_client_ids())
    );

-- ============================================================================
-- RLS POLICIES: sub_accounts
-- ============================================================================
CREATE POLICY "sub_accounts_select" ON sub_accounts FOR SELECT
    USING (account_id IN (
        SELECT id FROM accounts WHERE client_id IS NULL
        OR client_id IN (SELECT get_user_client_ids())
    ));

CREATE POLICY "sub_accounts_insert" ON sub_accounts FOR INSERT
    WITH CHECK (account_id IN (
        SELECT id FROM accounts WHERE client_id IN (SELECT get_user_client_ids())
    ));

CREATE POLICY "sub_accounts_update" ON sub_accounts FOR UPDATE
    USING (account_id IN (
        SELECT id FROM accounts WHERE client_id IN (SELECT get_user_client_ids())
    ));

CREATE POLICY "sub_accounts_delete" ON sub_accounts FOR DELETE
    USING (account_id IN (
        SELECT id FROM accounts WHERE client_id IN (SELECT get_user_client_ids())
    ));

-- ============================================================================
-- RLS POLICIES: departments
-- ============================================================================
CREATE POLICY "departments_select" ON departments FOR SELECT
    USING (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "departments_insert" ON departments FOR INSERT
    WITH CHECK (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "departments_update" ON departments FOR UPDATE
    USING (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "departments_delete" ON departments FOR DELETE
    USING (client_id IN (SELECT get_user_client_ids()));

-- ============================================================================
-- RLS POLICIES: tax_categories (read-only for all authenticated users)
-- ============================================================================
CREATE POLICY "tax_categories_select" ON tax_categories FOR SELECT
    USING (true);

-- ============================================================================
-- RLS POLICIES: business_partners
-- ============================================================================
CREATE POLICY "business_partners_select" ON business_partners FOR SELECT
    USING (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "business_partners_insert" ON business_partners FOR INSERT
    WITH CHECK (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "business_partners_update" ON business_partners FOR UPDATE
    USING (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "business_partners_delete" ON business_partners FOR DELETE
    USING (client_id IN (SELECT get_user_client_ids()));

-- ============================================================================
-- RLS POLICIES: fiscal_years
-- ============================================================================
CREATE POLICY "fiscal_years_select" ON fiscal_years FOR SELECT
    USING (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "fiscal_years_insert" ON fiscal_years FOR INSERT
    WITH CHECK (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "fiscal_years_update" ON fiscal_years FOR UPDATE
    USING (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "fiscal_years_delete" ON fiscal_years FOR DELETE
    USING (client_id IN (SELECT get_user_client_ids()));

-- ============================================================================
-- RLS POLICIES: receipts
-- ============================================================================
CREATE POLICY "receipts_select" ON receipts FOR SELECT
    USING (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "receipts_insert" ON receipts FOR INSERT
    WITH CHECK (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "receipts_update" ON receipts FOR UPDATE
    USING (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "receipts_delete" ON receipts FOR DELETE
    USING (client_id IN (SELECT get_user_client_ids()));

-- ============================================================================
-- RLS POLICIES: journal_entries
-- ============================================================================
CREATE POLICY "journal_entries_select" ON journal_entries FOR SELECT
    USING (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "journal_entries_insert" ON journal_entries FOR INSERT
    WITH CHECK (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "journal_entries_update" ON journal_entries FOR UPDATE
    USING (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "journal_entries_delete" ON journal_entries FOR DELETE
    USING (client_id IN (SELECT get_user_client_ids()));

-- ============================================================================
-- RLS POLICIES: journal_entry_lines
-- ============================================================================
CREATE POLICY "journal_entry_lines_select" ON journal_entry_lines FOR SELECT
    USING (journal_entry_id IN (
        SELECT id FROM journal_entries WHERE client_id IN (SELECT get_user_client_ids())
    ));

CREATE POLICY "journal_entry_lines_insert" ON journal_entry_lines FOR INSERT
    WITH CHECK (journal_entry_id IN (
        SELECT id FROM journal_entries WHERE client_id IN (SELECT get_user_client_ids())
    ));

CREATE POLICY "journal_entry_lines_update" ON journal_entry_lines FOR UPDATE
    USING (journal_entry_id IN (
        SELECT id FROM journal_entries WHERE client_id IN (SELECT get_user_client_ids())
    ));

CREATE POLICY "journal_entry_lines_delete" ON journal_entry_lines FOR DELETE
    USING (journal_entry_id IN (
        SELECT id FROM journal_entries WHERE client_id IN (SELECT get_user_client_ids())
    ));

-- ============================================================================
-- RLS POLICIES: journal_templates
-- ============================================================================
CREATE POLICY "journal_templates_select" ON journal_templates FOR SELECT
    USING (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "journal_templates_insert" ON journal_templates FOR INSERT
    WITH CHECK (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "journal_templates_update" ON journal_templates FOR UPDATE
    USING (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "journal_templates_delete" ON journal_templates FOR DELETE
    USING (client_id IN (SELECT get_user_client_ids()));

-- ============================================================================
-- RLS POLICIES: invoices
-- ============================================================================
CREATE POLICY "invoices_select" ON invoices FOR SELECT
    USING (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "invoices_insert" ON invoices FOR INSERT
    WITH CHECK (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "invoices_update" ON invoices FOR UPDATE
    USING (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "invoices_delete" ON invoices FOR DELETE
    USING (client_id IN (SELECT get_user_client_ids()));

-- ============================================================================
-- RLS POLICIES: invoice_items
-- ============================================================================
CREATE POLICY "invoice_items_select" ON invoice_items FOR SELECT
    USING (invoice_id IN (
        SELECT id FROM invoices WHERE client_id IN (SELECT get_user_client_ids())
    ));

CREATE POLICY "invoice_items_insert" ON invoice_items FOR INSERT
    WITH CHECK (invoice_id IN (
        SELECT id FROM invoices WHERE client_id IN (SELECT get_user_client_ids())
    ));

CREATE POLICY "invoice_items_update" ON invoice_items FOR UPDATE
    USING (invoice_id IN (
        SELECT id FROM invoices WHERE client_id IN (SELECT get_user_client_ids())
    ));

CREATE POLICY "invoice_items_delete" ON invoice_items FOR DELETE
    USING (invoice_id IN (
        SELECT id FROM invoices WHERE client_id IN (SELECT get_user_client_ids())
    ));

-- ============================================================================
-- RLS POLICIES: payments
-- ============================================================================
CREATE POLICY "payments_select" ON payments FOR SELECT
    USING (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "payments_insert" ON payments FOR INSERT
    WITH CHECK (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "payments_update" ON payments FOR UPDATE
    USING (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "payments_delete" ON payments FOR DELETE
    USING (client_id IN (SELECT get_user_client_ids()));

-- ============================================================================
-- RLS POLICIES: payment_allocations
-- ============================================================================
CREATE POLICY "payment_allocations_select" ON payment_allocations FOR SELECT
    USING (payment_id IN (
        SELECT id FROM payments WHERE client_id IN (SELECT get_user_client_ids())
    ));

CREATE POLICY "payment_allocations_insert" ON payment_allocations FOR INSERT
    WITH CHECK (payment_id IN (
        SELECT id FROM payments WHERE client_id IN (SELECT get_user_client_ids())
    ));

CREATE POLICY "payment_allocations_update" ON payment_allocations FOR UPDATE
    USING (payment_id IN (
        SELECT id FROM payments WHERE client_id IN (SELECT get_user_client_ids())
    ));

CREATE POLICY "payment_allocations_delete" ON payment_allocations FOR DELETE
    USING (payment_id IN (
        SELECT id FROM payments WHERE client_id IN (SELECT get_user_client_ids())
    ));

-- ============================================================================
-- RLS POLICIES: fixed_assets
-- ============================================================================
CREATE POLICY "fixed_assets_select" ON fixed_assets FOR SELECT
    USING (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "fixed_assets_insert" ON fixed_assets FOR INSERT
    WITH CHECK (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "fixed_assets_update" ON fixed_assets FOR UPDATE
    USING (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "fixed_assets_delete" ON fixed_assets FOR DELETE
    USING (client_id IN (SELECT get_user_client_ids()));

-- ============================================================================
-- RLS POLICIES: closing_balances
-- ============================================================================
CREATE POLICY "closing_balances_select" ON closing_balances FOR SELECT
    USING (fiscal_year_id IN (
        SELECT id FROM fiscal_years WHERE client_id IN (SELECT get_user_client_ids())
    ));

CREATE POLICY "closing_balances_insert" ON closing_balances FOR INSERT
    WITH CHECK (fiscal_year_id IN (
        SELECT id FROM fiscal_years WHERE client_id IN (SELECT get_user_client_ids())
    ));

CREATE POLICY "closing_balances_update" ON closing_balances FOR UPDATE
    USING (fiscal_year_id IN (
        SELECT id FROM fiscal_years WHERE client_id IN (SELECT get_user_client_ids())
    ));

CREATE POLICY "closing_balances_delete" ON closing_balances FOR DELETE
    USING (fiscal_year_id IN (
        SELECT id FROM fiscal_years WHERE client_id IN (SELECT get_user_client_ids())
    ));

-- ============================================================================
-- RLS POLICIES: ai_journal_patterns
-- ============================================================================
CREATE POLICY "ai_journal_patterns_select" ON ai_journal_patterns FOR SELECT
    USING (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "ai_journal_patterns_insert" ON ai_journal_patterns FOR INSERT
    WITH CHECK (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "ai_journal_patterns_update" ON ai_journal_patterns FOR UPDATE
    USING (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "ai_journal_patterns_delete" ON ai_journal_patterns FOR DELETE
    USING (client_id IN (SELECT get_user_client_ids()));

-- ============================================================================
-- RLS POLICIES: ai_feedback_logs
-- ============================================================================
CREATE POLICY "ai_feedback_logs_select" ON ai_feedback_logs FOR SELECT
    USING (receipt_id IN (
        SELECT id FROM receipts WHERE client_id IN (SELECT get_user_client_ids())
    ));

CREATE POLICY "ai_feedback_logs_insert" ON ai_feedback_logs FOR INSERT
    WITH CHECK (receipt_id IN (
        SELECT id FROM receipts WHERE client_id IN (SELECT get_user_client_ids())
    ));

-- ============================================================================
-- RLS POLICIES: comments
-- ============================================================================
CREATE POLICY "comments_select" ON comments FOR SELECT
    USING (
        receipt_id IN (
            SELECT id FROM receipts WHERE client_id IN (SELECT get_user_client_ids())
        )
        OR journal_entry_id IN (
            SELECT id FROM journal_entries WHERE client_id IN (SELECT get_user_client_ids())
        )
    );

CREATE POLICY "comments_insert" ON comments FOR INSERT
    WITH CHECK (
        receipt_id IN (
            SELECT id FROM receipts WHERE client_id IN (SELECT get_user_client_ids())
        )
        OR journal_entry_id IN (
            SELECT id FROM journal_entries WHERE client_id IN (SELECT get_user_client_ids())
        )
    );

CREATE POLICY "comments_update" ON comments FOR UPDATE
    USING (author_id = auth.uid());

CREATE POLICY "comments_delete" ON comments FOR DELETE
    USING (author_id = auth.uid());

-- ============================================================================
-- RLS POLICIES: comment_notifications
-- ============================================================================
CREATE POLICY "comment_notifications_select" ON comment_notifications FOR SELECT
    USING (recipient_id = auth.uid());

CREATE POLICY "comment_notifications_update" ON comment_notifications FOR UPDATE
    USING (recipient_id = auth.uid());

-- ============================================================================
-- RLS POLICIES: submission_schedules
-- ============================================================================
CREATE POLICY "submission_schedules_select" ON submission_schedules FOR SELECT
    USING (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "submission_schedules_insert" ON submission_schedules FOR INSERT
    WITH CHECK (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "submission_schedules_update" ON submission_schedules FOR UPDATE
    USING (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "submission_schedules_delete" ON submission_schedules FOR DELETE
    USING (client_id IN (SELECT get_user_client_ids()));

-- ============================================================================
-- RLS POLICIES: submission_periods
-- ============================================================================
CREATE POLICY "submission_periods_select" ON submission_periods FOR SELECT
    USING (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "submission_periods_insert" ON submission_periods FOR INSERT
    WITH CHECK (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "submission_periods_update" ON submission_periods FOR UPDATE
    USING (client_id IN (SELECT get_user_client_ids()));

-- ============================================================================
-- RLS POLICIES: reminder_logs
-- ============================================================================
CREATE POLICY "reminder_logs_select" ON reminder_logs FOR SELECT
    USING (submission_period_id IN (
        SELECT id FROM submission_periods WHERE client_id IN (SELECT get_user_client_ids())
    ));

-- ============================================================================
-- RLS POLICIES: notifications
-- ============================================================================
CREATE POLICY "notifications_select" ON notifications FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "notifications_update" ON notifications FOR UPDATE
    USING (user_id = auth.uid());

-- ============================================================================
-- RLS POLICIES: raqto_integrations
-- ============================================================================
CREATE POLICY "raqto_integrations_select" ON raqto_integrations FOR SELECT
    USING (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "raqto_integrations_insert" ON raqto_integrations FOR INSERT
    WITH CHECK (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "raqto_integrations_update" ON raqto_integrations FOR UPDATE
    USING (client_id IN (SELECT get_user_client_ids()));

CREATE POLICY "raqto_integrations_delete" ON raqto_integrations FOR DELETE
    USING (client_id IN (SELECT get_user_client_ids()));
