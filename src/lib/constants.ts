// ===== 勘定科目分類 =====
export const ACCOUNT_CATEGORIES = [
  { type: "assets", name: "資産" },
  { type: "liabilities", name: "負債" },
  { type: "equity", name: "純資産" },
  { type: "revenue", name: "収益" },
  { type: "expenses", name: "費用" },
] as const;

// ===== 税区分 =====
export const TAX_CATEGORIES = [
  { code: "sales_10", name: "課税売上10%", rate: 0.1, is_purchase: false },
  { code: "sales_8", name: "課税売上8%（軽減）", rate: 0.08, is_purchase: false },
  { code: "sales_exempt", name: "非課税売上", rate: 0, is_purchase: false },
  { code: "sales_zero", name: "免税売上", rate: 0, is_purchase: false },
  { code: "sales_non", name: "不課税", rate: 0, is_purchase: false },
  { code: "purchase_10", name: "課税仕入10%", rate: 0.1, is_purchase: true },
  { code: "purchase_8", name: "課税仕入8%（軽減）", rate: 0.08, is_purchase: true },
  { code: "purchase_10_80", name: "課税仕入10%（経過措置80%）", rate: 0.1, is_purchase: true, transition_rate: 0.8 },
  { code: "purchase_10_50", name: "課税仕入10%（経過措置50%）", rate: 0.1, is_purchase: true, transition_rate: 0.5 },
  { code: "purchase_8_80", name: "課税仕入8%（経過措置80%）", rate: 0.08, is_purchase: true, transition_rate: 0.8 },
  { code: "purchase_8_50", name: "課税仕入8%（経過措置50%）", rate: 0.08, is_purchase: true, transition_rate: 0.5 },
] as const;

// ===== 簡易課税 みなし仕入率 =====
export const SIMPLIFIED_TAX_RATES = [
  { type: 1, name: "第1種事業（卸売業）", rate: 0.9 },
  { type: 2, name: "第2種事業（小売業）", rate: 0.8 },
  { type: 3, name: "第3種事業（製造業等）", rate: 0.7 },
  { type: 4, name: "第4種事業（その他）", rate: 0.6 },
  { type: 5, name: "第5種事業（サービス業等）", rate: 0.5 },
  { type: 6, name: "第6種事業（不動産業）", rate: 0.4 },
] as const;

// ===== インボイス経過措置 =====
export function getInvoiceTransitionRate(date: Date): number {
  const d = date.getTime();
  const phase1End = new Date("2026-09-30").getTime();
  const phase2End = new Date("2029-09-30").getTime();

  if (d <= phase1End) return 0.8;
  if (d <= phase2End) return 0.5;
  return 0;
}

// ===== 支払方法 =====
export const PAYMENT_METHODS = [
  { key: "cash", label: "現金" },
  { key: "card", label: "カード" },
  { key: "e_money", label: "電子マネー" },
  { key: "bank_transfer", label: "銀行振込" },
] as const;

// ===== 仕訳ステータス =====
export const JOURNAL_STATUSES = [
  { key: "draft", label: "下書き" },
  { key: "confirmed", label: "確定" },
  { key: "locked", label: "締め済" },
] as const;

// ===== 領収書ステータス =====
export const RECEIPT_STATUSES = [
  { key: "uploaded", label: "アップロード済" },
  { key: "processing", label: "処理中" },
  { key: "ocr_done", label: "OCR完了" },
  { key: "reviewed", label: "確認済" },
  { key: "journalized", label: "仕訳済" },
] as const;

// ===== 固定資産カテゴリ =====
export const ASSET_CATEGORIES = [
  { key: "building", label: "建物" },
  { key: "vehicle", label: "車両運搬具" },
  { key: "equipment", label: "器具備品" },
  { key: "software", label: "ソフトウェア" },
  { key: "land", label: "土地" },
] as const;

// ===== 減価償却方法 =====
export const DEPRECIATION_METHODS = [
  { key: "straight_line", label: "定額法" },
  { key: "declining_balance", label: "定率法" },
] as const;
