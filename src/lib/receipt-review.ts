// 証憑（領収書）の「要確認」判定ロジック。
// クライアント側の一覧/詳細表示と、ダッシュボードの集計（サーバー）で
// 同じ基準を使うために共通化する。

// インボイス（適格請求書発行事業者）登録番号の検証
// 正: T + 数字13桁。受領側の仕入税額控除の可否判定に用いる。
export type InvoiceCheck = "valid" | "invalid" | "none";
export function checkInvoiceNumber(num?: string): InvoiceCheck {
  if (!num || !num.trim()) return "none";
  const normalized = num.replace(/[\s-]/g, "").toUpperCase();
  if (/^T\d{13}$/.test(normalized)) return "valid";
  // "T" で始まる＝登録番号を意図した入力だが桁数等が不正 → invalid（要確認）。
  if (/^T/.test(normalized)) return "invalid";
  // "T" で始まらない＝そもそも登録番号ではない（請求書番号・領収書No等）→ none 扱い。
  // 一般の書類番号を「形式不正の登録番号」と誤判定して(要確認)を付けないため。
  return "none";
}

// 「要確認」: インボイス番号だけでなく、OCR読取品質など複数の観点で
// レビューが必要なものを横断的に検知する。理由は複数同時に付き得る。
export const OCR_CONFIDENCE_THRESHOLD = 0.6;
export type ReviewReason = "invoice" | "low_confidence" | "missing_fields" | "needs_review";
export const reviewReasonLabels: Record<ReviewReason, string> = {
  invoice: "インボイス番号の形式が不正（T＋13桁ではない）",
  low_confidence: "OCRの読取信頼度が低い（手書き・不鮮明など）",
  missing_fields: "必須項目（金額・日付・発行者）が未取得",
  needs_review: "AIが要確認と判定",
};

export interface ReviewInput {
  invoiceNumber?: string;
  ocrConfidence?: number;
  amount: number;
  date: string;
  vendor: string;
  needsReview: boolean;
  documentType?: string;
}

export function getReviewReasons(r: ReviewInput, showInvoiceCheck: boolean): ReviewReason[] {
  // 明細書は別フロー（行ごとに仕訳化）のためレビュー判定の対象外
  if (r.documentType === "statement") return [];
  const reasons: ReviewReason[] = [];
  if (showInvoiceCheck && checkInvoiceNumber(r.invoiceNumber) === "invalid") reasons.push("invoice");
  if (typeof r.ocrConfidence === "number" && r.ocrConfidence < OCR_CONFIDENCE_THRESHOLD) reasons.push("low_confidence");
  if (!r.amount || r.amount <= 0 || !r.date || !r.vendor || r.vendor === "不明") reasons.push("missing_fields");
  if (r.needsReview) reasons.push("needs_review");
  return reasons;
}
