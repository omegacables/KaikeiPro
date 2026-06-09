"use server";

import { createAdminSupabaseClient } from "@/lib/supabase";

type DbRow = Record<string, unknown>;

export interface DocSearchCriteria {
  dateFrom?: string | null;
  dateTo?: string | null;
  amountMin?: number | null;
  amountMax?: number | null;
  vendor?: string | null;
  direction?: "issued" | "received" | null;
}

export interface DocSearchRow {
  id: string;
  date: string; // 取引年月日
  vendor: string; // 取引先
  amount: number; // 取引金額
  invoiceNumber: string | null;
  direction: "issued" | "received";
  documentType: string | null;
  imagePath: string;
  originalFilename: string | null;
  hashProtected: boolean; // 改ざん防止ハッシュの有無
  hashVerifiedAt: string | null;
}

export interface DocSearchResult {
  rows: DocSearchRow[];
  total: number; // ヒット件数
  scanned: number; // 走査した証憑数
}

function ocrField(ocr: DbRow | null, keys: string[]): unknown {
  if (!ocr) return undefined;
  for (const k of keys) {
    if (ocr[k] !== undefined && ocr[k] !== null && ocr[k] !== "") return ocr[k];
  }
  return undefined;
}

/**
 * 電子帳簿保存法の検索要件に対応した証憑検索。
 *   - 取引年月日（範囲）・取引金額（範囲）・取引先（部分一致）を AND 条件で検索
 *   - いずれの項目も組合せ可能
 * 取引情報は receipts.ocr_result（取引先・金額・日付）から取得する。
 */
export async function searchDocuments(
  clientId: string,
  criteria: DocSearchCriteria
): Promise<DocSearchResult> {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("receipts")
    .select(
      `id, image_path, direction, ocr_result, document_type, original_filename,
       file_hash, hash_verified_at, uploaded_at`
    )
    .eq("client_id", clientId)
    .order("uploaded_at", { ascending: false })
    .limit(2000);
  if (error) throw new Error(error.message);

  const vendorQuery = criteria.vendor?.trim().toLowerCase() || null;
  const rows: DocSearchRow[] = [];

  for (const r of data ?? []) {
    const row = r as DbRow;
    const ocr = (row.ocr_result as DbRow | null) ?? null;

    const dateVal =
      (ocrField(ocr, ["date", "issued_date", "transaction_date"]) as string) ??
      ((row.uploaded_at as string) ?? "").split("T")[0];
    const vendorVal =
      (ocrField(ocr, ["vendor_name", "vendor", "partner_name"]) as string) ?? "不明";
    const amountVal = Number(
      ocrField(ocr, ["amount_total", "total_amount", "amount"]) ?? 0
    );
    const invoiceNumber =
      (ocrField(ocr, ["invoice_number", "registration_number"]) as string) ?? null;
    const direction: "issued" | "received" =
      (row.direction as "issued" | "received") ?? "received";

    // --- AND 条件フィルタ ---
    if (criteria.direction && direction !== criteria.direction) continue;
    if (criteria.dateFrom && dateVal < criteria.dateFrom) continue;
    if (criteria.dateTo && dateVal > criteria.dateTo) continue;
    if (criteria.amountMin != null && amountVal < criteria.amountMin) continue;
    if (criteria.amountMax != null && amountVal > criteria.amountMax) continue;
    if (vendorQuery && !vendorVal.toLowerCase().includes(vendorQuery)) continue;

    rows.push({
      id: row.id as string,
      date: dateVal,
      vendor: vendorVal,
      amount: amountVal,
      invoiceNumber,
      direction,
      documentType: (row.document_type as string) ?? null,
      imagePath: (row.image_path as string) ?? "",
      originalFilename: (row.original_filename as string) ?? null,
      hashProtected: Boolean(row.file_hash),
      hashVerifiedAt: (row.hash_verified_at as string) ?? null,
    });
  }

  // 取引年月日の新しい順
  rows.sort((a, b) => b.date.localeCompare(a.date));

  return { rows, total: rows.length, scanned: (data ?? []).length };
}
