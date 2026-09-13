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
  // 免税事業者等からの仕入れに係る経過措置。令和8年度改正で 80→70→50→30 の4段階になった
  { code: "purchase_10_trans_80", name: "課税仕入10%（経過措置80%）", rate: 0.1, is_purchase: true, transition_rate: 0.8 },
  { code: "purchase_10_trans_70", name: "課税仕入10%（経過措置70%）", rate: 0.1, is_purchase: true, transition_rate: 0.7 },
  { code: "purchase_10_trans_50", name: "課税仕入10%（経過措置50%）", rate: 0.1, is_purchase: true, transition_rate: 0.5 },
  { code: "purchase_10_trans_30", name: "課税仕入10%（経過措置30%）", rate: 0.1, is_purchase: true, transition_rate: 0.3 },
  { code: "purchase_08_trans_80", name: "課税仕入8%（経過措置80%）", rate: 0.08, is_purchase: true, transition_rate: 0.8 },
  { code: "purchase_08_trans_70", name: "課税仕入8%（経過措置70%）", rate: 0.08, is_purchase: true, transition_rate: 0.7 },
  { code: "purchase_08_trans_50", name: "課税仕入8%（経過措置50%）", rate: 0.08, is_purchase: true, transition_rate: 0.5 },
  { code: "purchase_08_trans_30", name: "課税仕入8%（経過措置30%）", rate: 0.08, is_purchase: true, transition_rate: 0.3 },
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
//
// 免税事業者等からの課税仕入れについて、仕入税額の一定割合を控除できる経過措置
// （平成28年改正法附則52・53）。
//
// 令和8年度改正で**期限が2年延長され4段階**になった。
// 改正前は「80%（3年）→50%（3年）→終了」で、この実装もそれに合わせていたが、
// そのままだと令和8年10月1日以降に**控除できる額を少なく計算**してしまい、
// 顧問先が本来より多く消費税を納めることになる。
//
//   〜令和8年9月30日        80%
//   令和8年10月1日〜令和10年9月30日   70%
//   令和10年10月1日〜令和12年9月30日  50%
//   令和12年10月1日〜令和13年9月30日  30%
//   令和13年10月1日以後      なし
//
// 割合は「課税仕入れを行った日」で判定する（役務は完了日、物品は引渡日）。
// 期間で按分するのではない。
const INVOICE_TRANSITION_PHASES: { until: string; rate: number }[] = [
  { until: "2026-09-30", rate: 0.8 },
  { until: "2028-09-30", rate: 0.7 },
  { until: "2030-09-30", rate: 0.5 },
  { until: "2031-09-30", rate: 0.3 },
];

/**
 * 課税仕入れを行った日から、経過措置の控除割合を返す。
 * 経過措置の期間を過ぎていれば 0（控除できない）。
 */
export function getInvoiceTransitionRate(date: Date): number {
  // その日の終わりまでを含める（境界日そのものは経過措置の対象）
  const d = date.getTime();
  for (const phase of INVOICE_TRANSITION_PHASES) {
    if (d <= new Date(`${phase.until}T23:59:59.999Z`).getTime()) return phase.rate;
  }
  return 0;
}

/** 控除割合に対応する税区分コードを返す（10%用・8%用）。割合が0なら null */
export function transitionTaxCategoryCode(rate: number, taxRate: 0.1 | 0.08): string | null {
  const pct = Math.round(rate * 100);
  if (pct === 0) return null;
  // コードは税区分マスタ（tax_categories テーブル）の命名に合わせる
  return taxRate === 0.1 ? `purchase_10_trans_${pct}` : `purchase_08_trans_${pct}`;
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
