// ===== ユーザー・認証 =====
export type UserRole = "staff" | "client";

export interface Firm {
  id: string;
  name: string;
  postal_code?: string;
  address?: string;
  telephone?: string;
  email?: string;
  invoice_registration_number?: string;
  created_at: string;
}

export interface FirmMember {
  id: string;
  firm_id: string;
  user_id: string;
  name: string;
  email: string;
  role: "admin" | "staff";
  is_active: boolean;
}

export interface Client {
  id: string;
  firm_id: string;
  name: string;
  business_type?: string;
  postal_code?: string;
  address?: string;
  telephone?: string;
  email?: string;
  fiscal_year_start_month: number;
  tax_method: "standard" | "simplified";
  simplified_business_type?: number;
  invoice_registration_number?: string;
  is_active: boolean;
  created_at: string;
}

// ===== 勘定科目 =====
export type AccountCategoryType =
  | "assets"
  | "liabilities"
  | "equity"
  | "revenue"
  | "expenses";

export interface AccountCategory {
  id: string;
  type: AccountCategoryType;
  name: string;
  sort_order: number;
}

export interface Account {
  id: string;
  client_id: string;
  category_id: string;
  code: string;
  name: string;
  is_active: boolean;
  is_default: boolean;
  category?: AccountCategory;
}

export interface SubAccount {
  id: string;
  account_id: string;
  name: string;
  is_active: boolean;
}

export interface Department {
  id: string;
  client_id: string;
  name: string;
  is_active: boolean;
}

// ===== 仕訳 =====
export type JournalStatus = "draft" | "confirmed" | "locked";
export type JournalSource = "manual" | "ai" | "import" | "raqto" | "bank";

export interface JournalEntry {
  id: string;
  client_id: string;
  entry_date: string;
  description: string;
  status: JournalStatus;
  source: JournalSource;
  receipt_id?: string;
  created_by: string;
  created_at: string;
  lines?: JournalEntryLine[];
}

export interface JournalEntryLine {
  id: string;
  journal_entry_id: string;
  account_id: string;
  sub_account_id?: string;
  department_id?: string;
  debit_amount: number;
  credit_amount: number;
  tax_category?: string;
  tax_rate?: number;
  account?: Account;
}

export interface JournalTemplate {
  id: string;
  client_id: string;
  name: string;
  template_data: Record<string, unknown>;
}

// ===== 領収書 =====
export type ReceiptStatus =
  | "uploaded"
  | "processing"
  | "ocr_done"
  | "reviewed"
  | "journalized";

export type PaymentMethod = "cash" | "card" | "e_money" | "bank_transfer";

export interface Receipt {
  id: string;
  client_id: string;
  uploaded_by: string;
  image_path: string;
  payment_method: PaymentMethod;
  status: ReceiptStatus;
  ocr_result?: OcrResult;
  ai_journal_suggestion?: AiJournalSuggestion;
  fiscal_year_id?: string;
  uploaded_at: string;
  reviewed_at?: string;
  reviewed_by?: string;
  original_filename?: string;
  file_size?: number;
  mime_type?: string;
}

// 書類種別の唯一の定義。OCRの分類・バリデーション・UIバッジはすべてここを参照する。
export const DOCUMENT_TYPES = [
  "qualified_invoice",
  "category_invoice",
  "receipt",
  "statement",
  "delivery_note",
  "purchase_order",
  "goods_receipt",
  "estimate",
  "contract",
  "other",
] as const;
export type ReceiptDocumentType = (typeof DOCUMENT_TYPES)[number];

export interface OcrResult {
  date?: string;
  amount_total?: number;
  amount_tax_excluded?: number;
  tax_amount?: number;
  vendor_name?: string;
  items?: string[];
  tax_rate?: number;
  // 適格請求書発行事業者の登録番号（T+13桁）のみ。一般の請求書番号は document_number に入れる。
  invoice_number?: string;
  // 請求書番号・領収書No等の一般書類番号（登録番号ではない）。
  document_number?: string;
  confidence: number;
  // 支払い方法の自動判別
  payment_method?: "cash" | "card" | "e_money" | "bank_transfer" | null;
  // 多通貨対応
  currency?: string; // "JPY", "USD", "EUR" etc.
  original_amount?: number; // 原通貨の金額
  exchange_rate?: number; // 適用為替レート（→JPY）
  amount_jpy?: number; // 円換算額
  // 書類種別
  document_type?: ReceiptDocumentType;
  // 同一日付・同額の証憑が既に存在する場合に立てる（重複アップロードの可能性警告）
  possible_duplicate?: boolean;
  // 明細書(statement)の種別: 銀行明細 / クレカ明細 / その他。相手勘定（普通預金 or 未払金）の自動推定に使用。
  statement_subtype?: "bank" | "card" | "other";
}

// ===== 明細書の行データ =====
export type StatementLineDirection = "deposit" | "withdrawal";
export type StatementLineStatus = "pending" | "journalized" | "ignored";

export interface StatementLine {
  id: string;
  receipt_id: string;
  client_id: string;
  line_date: string | null;
  description: string;
  amount: number; // 符号付き（+入金/-出金）
  direction: StatementLineDirection;
  balance_after: number | null;
  counterparty: string | null;
  journal_entry_id: string | null;
  status: StatementLineStatus;
  suggested_account_id: string | null;
  sort_order: number;
  created_at: string;
}

// ===== AI仕訳提案 =====
export interface AiJournalSuggestion {
  description: string;
  entry_date: string;
  lines: AiJournalLine[];
  confidence: number;
  reasoning?: string;
}

export interface AiJournalLine {
  account_name: string;
  account_code?: string;
  debit_amount: number;
  credit_amount: number;
  tax_category?: string;
  tax_rate?: number;
}

// ===== 銀行口座 =====
export type BankAccountType = "ordinary" | "checking" | "savings";
export type BankProvider = "manual" | "moneytree" | "moneyforward" | "zaim";
export type BankSyncStatus = "idle" | "syncing" | "error" | "success";
export type BankTransactionType = "deposit" | "withdrawal";
export type BankMatchStatus = "unmatched" | "matched" | "ignored";

export interface BankAccount {
  id: string;
  client_id: string;
  bank_name: string;
  branch_name?: string;
  account_type: BankAccountType;
  account_number: string;
  account_holder?: string;
  account_id?: string;
  provider: BankProvider;
  provider_account_id?: string;
  is_active: boolean;
  last_synced_at?: string;
  sync_status: BankSyncStatus;
  settings?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  account?: Account;
}

export interface BankTransaction {
  id: string;
  bank_account_id: string;
  transaction_date: string;
  description: string;
  amount: number;
  balance_after?: number;
  transaction_type: BankTransactionType;
  counterparty?: string;
  reference_number?: string;
  journal_entry_id?: string;
  match_status: BankMatchStatus;
  match_confidence?: number;
  suggested_account_id?: string;
  raw_data?: Record<string, unknown>;
  created_at: string;
  bank_account?: BankAccount;
  suggested_account?: Account;
}

// ===== 取引先 =====
export type PartnerType = "customer" | "vendor" | "both";

export interface BusinessPartner {
  id: string;
  client_id: string;
  name: string;
  type: PartnerType;
  postal_code?: string;
  address?: string;
  telephone?: string;
  email?: string;
  invoice_registration_number?: string;
  is_invoice_registered: boolean;
}

// ===== 請求書 =====
export type InvoiceStatus =
  | "draft"
  | "issued"
  | "sent"
  | "paid"
  | "overdue"
  | "void";

export interface Invoice {
  id: string;
  client_id: string;
  business_partner_id: string;
  invoice_number: string;
  issued_date: string;
  due_date: string;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  status: InvoiceStatus;
  pdf_storage_path?: string;
  journal_entry_id?: string;
  partner?: BusinessPartner;
  items?: InvoiceItem[];
}

export interface InvoiceItem {
  id: string;
  invoice_id: string;
  sort_order: number;
  item_name: string;
  quantity: number;
  unit_price: number;
  tax_rate: number;
  subtotal: number;
  tax_amount: number;
}

// ===== 入金 =====
export interface Payment {
  id: string;
  client_id: string;
  business_partner_id: string;
  amount: number;
  payment_date: string;
  payment_method: string;
  bank_account?: string;
  memo?: string;
  partner?: BusinessPartner;
}

export interface PaymentAllocation {
  id: string;
  payment_id: string;
  invoice_id: string;
  allocated_amount: number;
}

// ===== 固定資産 =====
export type DepreciationMethod = "straight_line" | "declining_balance";

export interface FixedAsset {
  id: string;
  client_id: string;
  name: string;
  category: string;
  acquisition_date: string;
  acquisition_cost: number;
  useful_life: number;
  depreciation_method: DepreciationMethod;
  salvage_value: number;
  disposed_at?: string;
}

// ===== 会計年度 =====
export type FiscalYearStatus = "open" | "closed" | "locked";

export interface FiscalYear {
  id: string;
  client_id: string;
  start_date: string;
  end_date: string;
  status: FiscalYearStatus;
}

// ===== コミュニケーション =====
export type CommentStatus = "open" | "answered" | "resolved";

export interface Comment {
  id: string;
  receipt_id?: string;
  journal_entry_id?: string;
  parent_id?: string;
  author_id: string;
  author_role: UserRole;
  body: string;
  status: CommentStatus;
  created_at: string;
}

// ===== 提出管理 =====
export type SubmissionStatus = "pending" | "submitted" | "overdue" | "completed";

export interface SubmissionSchedule {
  id: string;
  client_id: string;
  frequency: "monthly" | "weekly";
  due_day: number;
  reminder_days: number[];
  notification_methods: ("app" | "email" | "line")[];
}

export interface SubmissionPeriod {
  id: string;
  client_id: string;
  period_start: string;
  period_end: string;
  due_date: string;
  status: SubmissionStatus;
  receipt_count: number;
}

// ===== ダッシュボード =====
export interface ClientSummary {
  client: Client;
  status: "good" | "warning" | "overdue";
  pending_receipts: number;
  unanswered_questions: number;
  ai_pending_reviews: number;
  submission_progress: number;
  last_activity?: string;
  fiscal_year_end?: string;
}

// ---------------------------------------------------------------------------
// 給与台帳（給与・役員報酬）
// ---------------------------------------------------------------------------
export type EmployeeType = "employee" | "officer";
export type PayrollStatus = "pending" | "journalized";

export interface PayrollRecord {
  id: string;
  client_id: string;
  pay_month: string; // YYYY-MM-01
  pay_date: string | null;
  employee_name: string;
  employee_type: EmployeeType;
  gross_salary: number;
  income_tax: number;
  resident_tax: number;
  health_insurance: number;
  pension_insurance: number;
  employment_insurance: number;
  other_deduction: number;
  net_pay: number;
  salary_account_id: string | null;
  withholding_account_id: string | null;
  payment_account_id: string | null;
  journal_entry_id: string | null;
  status: PayrollStatus;
  memo: string | null;
  created_at: string;
}

export type PayrollInput = Omit<
  PayrollRecord,
  "id" | "net_pay" | "journal_entry_id" | "status" | "created_at"
>;

// ---------------------------------------------------------------------------
// 借入金台帳（借入金・役員借入金）
// ---------------------------------------------------------------------------
export type LoanType = "borrowing" | "officer";
export type LoanStatus = "active" | "completed";
export type LoanRepaymentStatus = "pending" | "journalized";

export interface Loan {
  id: string;
  client_id: string;
  lender_name: string;
  loan_type: LoanType;
  principal: number;
  current_balance: number;
  interest_rate: number | null;
  borrowed_date: string | null;
  liability_account_id: string | null;
  status: LoanStatus;
  memo: string | null;
  created_at: string;
}

export type LoanInput = Omit<
  Loan,
  "id" | "current_balance" | "status" | "created_at"
> & { current_balance?: number };

export interface LoanRepayment {
  id: string;
  loan_id: string;
  client_id: string;
  repayment_date: string;
  principal_amount: number;
  interest_amount: number;
  payment_account_id: string | null;
  interest_account_id: string | null;
  journal_entry_id: string | null;
  status: LoanRepaymentStatus;
  memo: string | null;
  created_at: string;
}

export type LoanRepaymentInput = Omit<
  LoanRepayment,
  "id" | "journal_entry_id" | "status" | "created_at"
>;

// ---------------------------------------------------------------------------
// 会社書類管理（定款・登記簿・届出控え等）
// ---------------------------------------------------------------------------
export type CompanyDocType =
  | "articles" // 定款
  | "registry" // 登記簿謄本
  | "tax_filing" // 税務署等への届出控え
  | "license" // 許認可
  | "other"; // その他

export interface CompanyDocument {
  id: string;
  client_id: string;
  doc_type: CompanyDocType;
  title: string;
  file_path: string;
  original_filename: string | null;
  file_size: number | null;
  mime_type: string | null;
  file_hash: string | null;
  hash_algorithm: string | null;
  issued_date: string | null;
  memo: string | null;
  uploaded_by: string | null;
  created_at: string;
}
