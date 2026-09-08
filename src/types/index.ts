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
// 借入金台帳（借入金・役員借入金・役員貸付金）
//
// 「1レコード＝1本の借入」ではなく「1レコード＝1相手先」とし、その下に増減明細
// （LoanEntry）を積む。残高は明細から算出するため Loan 自体は残高を持たない。
// 算出ロジックは src/lib/loan-ledger.ts。
// ---------------------------------------------------------------------------

/** borrow=会社が借りる（借入金・役員借入金） / lend=会社が貸す（役員貸付金） */
export type LoanDirection = "borrow" | "lend";
/** institution=金融機関等 / officer=役員 */
export type CounterpartyKind = "institution" | "officer";
export type LoanStatus = "active" | "completed";

/** @deprecated counterparty_kind を使うこと。既存データ互換のため残置。 */
export type LoanType = "borrowing" | "officer";

export interface Loan {
  id: string;
  client_id: string;
  /** 相手先の名称（○○銀行 / 代表取締役 ○○） */
  lender_name: string;
  direction: LoanDirection;
  counterparty_kind: CounterpartyKind;
  /** 年利(%)。金融機関等では必須、役員では原則不要 */
  interest_rate: number | null;
  /** 借入開始日（明細が無い相手先の表示用） */
  borrowed_date: string | null;
  /** 借入金/貸付金の科目。未設定なら仕訳化時に名称から解決する */
  liability_account_id: string | null;
  /** 内訳明細書に所在地を出すための取引先マスタ参照 */
  business_partner_id: string | null;
  /** 返済条件（役員は「定めなし」が既定） */
  repayment_terms: string | null;
  /** 借入理由（内訳明細書の記載項目） */
  purpose: string | null;
  status: LoanStatus;
  memo: string | null;
  created_at: string;
}

export type LoanInput = Omit<Loan, "id" | "status" | "created_at"> & {
  status?: LoanStatus;
};

// --- 増減明細 -------------------------------------------------------------

/**
 * borrow  : 元本の発生（借入／貸付）
 * advance : 立替（現金は動かないが残高が増える）
 * repay   : 返済／回収
 * interest: 利息
 * adjust  : 調整（移行時の差額など。signed_adjustment に符号付きの値を持つ）
 */
export type LoanEntryType = "borrow" | "advance" | "repay" | "interest" | "adjust";

/** draft はAIの下書き。人間が確定するまで残高に算入しない。 */
export type LoanEntryStatus = "draft" | "confirmed" | "journalized";
export type LoanEntrySource = "manual" | "ai_draft";

/** AIが下書きを作ったときの判断根拠（要件4-2の原則2）。 */
export interface LoanAiEvidence {
  /** どう解釈したか（人間が読む説明） */
  reasoning: string;
  /** 0〜1 */
  confidence: number;
  /** 解釈のもとになった証憑の記載（通帳の摘要など） */
  sourceText?: string | null;
  /** 判別時に検討した候補 */
  candidates?: { label: string; reason: string }[];
  /** 使用したモデル */
  model?: string;
}

export interface LoanEntry {
  id: string;
  loan_id: string;
  client_id: string;
  entry_date: string;
  entry_type: LoanEntryType;
  /** 常に正の値。増減の符号は entry_type で決まる */
  amount: number;
  /** entry_type='adjust' のときのみ使う符号付きの差額 */
  signed_adjustment: number | null;
  /** 立替時の費用科目 */
  expense_account_id: string | null;
  /** 借入・返済時の相手科目（普通預金/現金） */
  payment_account_id: string | null;
  journal_entry_id: string | null;
  status: LoanEntryStatus;
  source: LoanEntrySource;
  ai_evidence: LoanAiEvidence | null;
  memo: string | null;
  created_at: string;
}

export type LoanEntryInput = Omit<
  LoanEntry,
  "id" | "journal_entry_id" | "created_at" | "status" | "source"
> & {
  status?: LoanEntryStatus;
  source?: LoanEntrySource;
};

/** 明細に紐付いた証憑。1枚の証憑が複数の明細に紐付く（通帳PDFなど）。 */
export interface LoanEntryReceipt {
  id: string;
  loan_entry_id: string;
  receipt_id: string;
  client_id: string;
  /** 証憑内の何行目に対応するか */
  source_line_no: number | null;
  source_note: string | null;
  created_at: string;
}

/** 台帳1件分（ヘッダ＋明細＋算出済みの残高）。 */
export interface LoanLedger {
  loan: Loan;
  entries: LoanEntry[];
  /** 明細から算出した現在残高（その台帳の方向における正の値） */
  balance: number;
  /** 区分ごとの内訳 */
  byType: Record<LoanEntryType, number>;
  /** 移行時の差額調整など、要確認の明細を含むか */
  needsAttention: boolean;
}

// --- 返済予定表（要件3-7） --------------------------------------------------

/** 金融機関等からの借入の返済予定。役員借入金では通常使わない。 */
export interface LoanRepaymentSchedule {
  id: string;
  loan_id: string;
  client_id: string;
  due_date: string;
  principal_amount: number;
  interest_amount: number;
  /** 消し込みで作られた増減明細。埋まっていれば実績あり */
  principal_entry_id: string | null;
  interest_entry_id: string | null;
  memo: string | null;
  created_at: string;
}

export type LoanRepaymentScheduleInput = Omit<
  LoanRepaymentSchedule,
  "id" | "principal_entry_id" | "interest_entry_id" | "created_at"
>;

// --- 勘定科目内訳明細書（要件3-6） -----------------------------------------

/** 「借入金及び支払利子の内訳書」の1行 */
export interface LoanBreakdownRow {
  lender_name: string;
  /** 取引先マスタから引いた所在地 */
  address: string | null;
  /** 期末現在高 */
  closing_balance: number;
  /** 期中の支払利子額 */
  interest_paid: number;
  /** 年利(%) */
  interest_rate: number | null;
  /** 借入理由 */
  purpose: string | null;
  /** 役員借入金かどうか（内訳書では必ず記載対象になる） */
  is_officer: boolean;
}

export interface LoanBreakdownReport {
  clientName: string;
  fiscalYear: number;
  periodStart: string;
  periodEnd: string;
  rows: LoanBreakdownRow[];
  totalClosingBalance: number;
  totalInterestPaid: number;
}

// --- 認定利息の利率マスタ --------------------------------------------------

export interface StatutoryInterestRate {
  /** 貸付けを行った日の属する年（暦年）。会計年度ではない */
  loan_year: number;
  /** 年利(%) */
  rate: number;
  note: string | null;
}

// --- 対話型AI起票（要件4章） ------------------------------------------------

/**
 * AIが生成した明細の下書き。
 *
 * 重要: この時点ではDBに保存しない。人間が確認画面で採用して初めて
 * loan_entries に書き込む（要件4-2の原則1「AIは提案のみ。確定は必ず人間が行う」）。
 */
export interface LoanAiDraft {
  /** 既存の台帳に紐付く場合はそのID。新規の相手先なら null */
  loan_id: string | null;
  /** AIが読み取った相手先名 */
  counterparty_name: string;
  direction: LoanDirection;
  entry_date: string;
  entry_type: LoanEntryType;
  amount: number;
  /** 立替のときの費用科目（AIは名称で返し、サーバー側でIDに解決する） */
  expense_account_id: string | null;
  expense_account_name: string | null;
  memo: string | null;
  evidence: LoanAiEvidence;
  /** 採用した場合の起票後残高。台帳が特定できない場合は null */
  balance_after: number | null;
  /** 生成される仕訳のプレビュー（借方科目名 / 貸方科目名 / 金額） */
  journal_preview: { debit: string; credit: string; amount: number } | null;
}

/** 証憑からの一括起票の結果（要件4-4）。 */
export interface LoanAiDocumentResult {
  candidates: LoanAiDraft[];
  /** 台帳に無関係と判断した行。拾い漏れの確認に使うので理由を必ず添える */
  excluded: { line: string; reason: string }[];
  warnings: string[];
}

/** 役員個人への送金の判別結果（要件4-5）。 */
export interface OfficerPaymentOption {
  key: "loan_repayment" | "officer_salary" | "expense_settlement" | "other";
  label: string;
  /** その可能性を検討した根拠 */
  reason: string;
  recommended: boolean;
}

export interface OfficerPaymentClassification {
  /** 推定した区分。確信が持てない場合は null（勝手に決めない） */
  conclusion: OfficerPaymentOption["key"] | null;
  confidence: number;
  options: OfficerPaymentOption[];
  reasoning: string;
  /** 確認を求める文言。確定させず必ず人間に問う（要件4-2の原則4） */
  question: string;
  /** 採用した場合の下書き。conclusion が null なら null */
  draft: LoanAiDraft | null;
}

// --- 質問応答（要件4-7） ----------------------------------------------------

/** 回答の根拠。必ず台帳の明細か証憑を指す（言いっぱなしにしない）。 */
export interface LedgerAnswerSource {
  label: string;
  loan_id: string | null;
  entry_id: string | null;
  entry_date: string | null;
  amount: number | null;
}

export interface LedgerAnswer {
  answer: string;
  sources: LedgerAnswerSource[];
  /** 台帳から答えられない質問だった場合に true */
  outOfScope: boolean;
}

// --- 旧構造（移行のため残置） ----------------------------------------------

export type LoanRepaymentStatus = "pending" | "journalized";

/** @deprecated LoanEntry に移行済み。040 で loan_entries へ移された。 */
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
