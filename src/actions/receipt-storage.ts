"use server";

import {
  createServerSupabaseClient,
  createAdminSupabaseClient,
} from "@/lib/supabase";

import { createHash } from "crypto";

const BUCKET_NAME = "receipts";
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "application/pdf"];

/**
 * バイナリデータのSHA-256ハッシュを計算
 */
function computeSHA256(data: ArrayBuffer): string {
  const hash = createHash("sha256");
  hash.update(Buffer.from(data));
  return hash.digest("hex");
}

// バケット作成済みフラグ（プロセス内キャッシュ）
let bucketEnsured = false;

/**
 * Storageバケットが存在しなければ自動作成（初回のみ実行）
 */
async function ensureBucket() {
  if (bucketEnsured) return;

  const adminSupabase = createAdminSupabaseClient();

  // バケット存在確認
  const { data: buckets } = await adminSupabase.storage.listBuckets();
  const exists = buckets?.some((b) => b.name === BUCKET_NAME);

  if (!exists) {
    const { error } = await adminSupabase.storage.createBucket(BUCKET_NAME, {
      public: false,
      fileSizeLimit: MAX_FILE_SIZE,
      allowedMimeTypes: ALLOWED_TYPES,
    });
    if (error && !error.message.includes("already exists")) {
      throw new Error(`バケット作成エラー: ${error.message}`);
    }
    console.log(`Storage bucket "${BUCKET_NAME}" を自動作成しました`);
  }

  bucketEnsured = true;
}

/**
 * レシート画像をアップロードしてrecordsレコードを作成
 */
export async function uploadReceipt(formData: FormData) {
  const file = formData.get("file") as File;
  const clientId = formData.get("client_id") as string;
  const uploadedBy = formData.get("uploaded_by") as string;
  const paymentMethod = formData.get("payment_method") as string | null;
  const memo = (formData.get("memo") as string | null)?.trim() || null;
  const directionRaw = (formData.get("direction") as string | null) || "received";
  const direction: "issued" | "received" = directionRaw === "issued" ? "issued" : "received";

  // バケット自動作成（初回のみ）
  await ensureBucket();

  // バリデーション
  if (!file || file.size === 0) {
    throw new Error("ファイルが選択されていません");
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new Error("ファイルサイズが10MBを超えています");
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    throw new Error("対応ファイル形式: JPG, PNG, PDF");
  }
  if (!clientId) {
    throw new Error("クライアントIDが指定されていません");
  }

  // ストレージパス生成: {client_id}/{receipt_id}.{ext}
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const receiptId = crypto.randomUUID();
  const storagePath = `${clientId}/${receiptId}.${ext}`;

  // adminクライアントでStorage操作（RLS回避）
  const adminSupabase = createAdminSupabaseClient();

  const arrayBuffer = await file.arrayBuffer();

  // SHA-256ハッシュを計算（電子帳簿保存法: 真実性の確保）
  const fileHash = computeSHA256(arrayBuffer);

  const { error: uploadError } = await adminSupabase.storage
    .from(BUCKET_NAME)
    .upload(storagePath, new Uint8Array(arrayBuffer), {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    throw new Error(`アップロードエラー: ${uploadError.message}`);
  }

  // receiptsレコード作成
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("receipts")
    .insert({
      id: receiptId,
      client_id: clientId,
      uploaded_by: uploadedBy,
      image_path: storagePath,
      payment_method: (paymentMethod || null) as "cash" | "card" | "e_money" | "bank_transfer" | null,
      status: "uploaded",
      direction,
      original_filename: file.name,
      file_size: file.size,
      mime_type: file.type,
      file_hash: fileHash,
      hash_algorithm: "SHA-256",
    })
    .select()
    .single();

  if (error) {
    // ロールバック: アップロード済みファイルを削除
    await adminSupabase.storage.from(BUCKET_NAME).remove([storagePath]);
    throw new Error(`レコード作成エラー: ${error.message}`);
  }

  return { id: data.id, image_path: storagePath, mime_type: file.type };
}

/**
 * レシート画像の署名付きURLを取得（1時間有効）
 */
export async function getReceiptImageUrl(
  imagePath: string
): Promise<string | null> {
  // Raqto連携パスやプレースホルダーはスキップ
  if (!imagePath || imagePath.startsWith("raqto://") || imagePath.startsWith("receipts/")) {
    return null;
  }

  const adminSupabase = createAdminSupabaseClient();
  const { data, error } = await adminSupabase.storage
    .from(BUCKET_NAME)
    .createSignedUrl(imagePath, 3600);

  if (error) {
    console.error(`画像URL取得エラー: ${error.message}`);
    return null;
  }
  return data.signedUrl;
}

/**
 * レシート画像をバイナリでダウンロード（OCR処理用）
 */
export async function downloadReceiptImage(
  imagePath: string
): Promise<{ data: Uint8Array; mimeType: string }> {
  const adminSupabase = createAdminSupabaseClient();
  const { data, error } = await adminSupabase.storage
    .from(BUCKET_NAME)
    .download(imagePath);

  if (error) {
    throw new Error(`画像ダウンロードエラー: ${error.message}`);
  }

  const arrayBuffer = await data.arrayBuffer();
  return {
    data: new Uint8Array(arrayBuffer),
    mimeType: data.type,
  };
}

/**
 * レシート画像の整合性を検証（電子帳簿保存法: 改ざん検知）
 */
export async function verifyReceiptIntegrity(receiptId: string): Promise<{
  valid: boolean;
  storedHash: string | null;
  computedHash: string;
  verifiedAt: string;
}> {
  const adminSupabase = createAdminSupabaseClient();

  // レコード取得
  const { data: receipt, error: fetchError } = await adminSupabase
    .from("receipts")
    .select("file_hash, image_path")
    .eq("id", receiptId)
    .single();

  if (fetchError || !receipt) {
    throw new Error("領収書レコードが見つかりません");
  }

  if (!receipt.image_path || receipt.image_path.startsWith("raqto://")) {
    throw new Error("検証対象外のファイルです");
  }

  // ファイルをダウンロードしてハッシュ計算
  const { data: fileData, error: dlError } = await adminSupabase.storage
    .from(BUCKET_NAME)
    .download(receipt.image_path);

  if (dlError || !fileData) {
    throw new Error(`ファイルダウンロードエラー: ${dlError?.message}`);
  }

  const arrayBuffer = await fileData.arrayBuffer();
  const computedHash = computeSHA256(arrayBuffer);
  const now = new Date().toISOString();
  const valid = receipt.file_hash === computedHash;

  // 検証日時を更新
  await adminSupabase
    .from("receipts")
    .update({ hash_verified_at: now })
    .eq("id", receiptId);

  return {
    valid,
    storedHash: receipt.file_hash,
    computedHash,
    verifiedAt: now,
  };
}

/**
 * レシート画像をストレージから削除
 */
export async function deleteReceiptImage(imagePath: string): Promise<void> {
  if (!imagePath || imagePath.startsWith("raqto://") || imagePath.startsWith("receipts/")) {
    return;
  }

  const adminSupabase = createAdminSupabaseClient();
  const { error } = await adminSupabase.storage
    .from(BUCKET_NAME)
    .remove([imagePath]);

  if (error) {
    console.error(`画像削除エラー: ${error.message}`);
  }
}
