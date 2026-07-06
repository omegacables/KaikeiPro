"use server";

import {
  createServerSupabaseClient,
  createAdminSupabaseClient,
} from "@/lib/supabase";
import { createRaqtoSupabaseClient } from "@/lib/supabase-raqto";
import { assertClientAccess, resolveClientIdForRecord } from "@/lib/authz";

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

  // 認証 & 所有権チェック（IDOR対策）:
  // uploaded_by はセッションから導出し、client_id は呼び出し者がアクセスできる
  // クライアントに限定する（formData の値は信用しない）。
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("認証が必要です");
  await assertClientAccess(clientId);

  // 拡張子は MIME から導出（ファイル名由来のパストラバーサルを防止）。
  // ALLOWED_TYPES で file.type は3種に制限済み。
  const extByMime: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "application/pdf": "pdf",
  };
  const ext = extByMime[file.type] ?? "bin";
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

  // receiptsレコード作成（RLS バウンドのクライアントで作成 → 所有権を二重に担保）
  const { data, error } = await supabase
    .from("receipts")
    .insert({
      id: receiptId,
      client_id: clientId,
      uploaded_by: user.id,
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
/**
 * Raqto受発注システム側の証憑PDFの署名付きURLを取得。
 * image_path = "raqto://documents/{documentId}" の証憑が対象。
 */
async function getRaqtoDocumentUrl(imagePath: string): Promise<string | null> {
  const docId = imagePath.replace("raqto://documents/", "");
  if (!docId || !/^[0-9a-f-]{36}$/i.test(docId)) return null;

  // 所有権チェック: RLSバウンドのクライアントでこの image_path を持つ証憑が
  // 見えること（= 呼び出し者がアクセスできるクライアントの証憑であること）を確認。
  const supabase = await createServerSupabaseClient();
  const { data: receipt } = await supabase
    .from("receipts")
    .select("id, client_id")
    .eq("image_path", imagePath)
    .limit(1)
    .maybeSingle();
  if (!receipt) return null;

  // テナント境界チェック: image_path は createReceipt/updateReceipt 経由で
  // 利用者が任意に設定できるため、証憑行の存在だけでは信用できない。
  // Raqto側ドキュメントの company_id が、この証憑のクライアントに連携された
  // Raqto会社IDと一致する場合のみ署名URLを発行する（他社証憑のIDOR防止）。
  const { data: integration } = await supabase
    .from("raqto_integrations")
    .select("raqto_company_id")
    .eq("client_id", receipt.client_id)
    .eq("is_active", true)
    .maybeSingle();
  if (!integration?.raqto_company_id) return null;

  try {
    const raqto = createRaqtoSupabaseClient();
    const { data: doc } = await raqto
      .from("documents")
      .select("pdf_storage_path")
      .eq("id", docId)
      .eq("company_id", integration.raqto_company_id)
      .maybeSingle();
    if (!doc?.pdf_storage_path) return null;

    const { data, error } = await raqto.storage
      .from("documents")
      .createSignedUrl(doc.pdf_storage_path, 3600);
    if (error) {
      console.error(`Raqto証憑URL取得エラー: ${error.message}`);
      return null;
    }
    return data.signedUrl;
  } catch {
    // RAQTO_SUPABASE_URL 未設定などの場合は閲覧不可として扱う
    return null;
  }
}

export async function getReceiptImageUrl(
  imagePath: string
): Promise<string | null> {
  if (!imagePath || imagePath.startsWith("receipts/")) {
    return null;
  }

  // Raqto連携証憑は受発注システム側のストレージからPDFを取得
  if (imagePath.startsWith("raqto://")) {
    return getRaqtoDocumentUrl(imagePath);
  }

  // 所有権チェック（IDOR対策）: パス先頭セグメント = client_id。
  // アクセスできないクライアントの画像 URL は発行しない。
  const pathClientId = imagePath.split("/")[0];
  try {
    await assertClientAccess(pathClientId);
  } catch {
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
  // 所有権チェック（IDOR対策）: パス先頭セグメント = client_id。
  // raqto:// などの非通常パスは clientId を持たないため、その場合はスキップ。
  if (imagePath && !imagePath.startsWith("raqto://") && !imagePath.startsWith("receipts/")) {
    await assertClientAccess(imagePath.split("/")[0]);
  }

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
  await resolveClientIdForRecord("receipts", receiptId);
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

  // 所有権チェック（IDOR対策）: パス先頭セグメント = client_id
  await assertClientAccess(imagePath.split("/")[0]);

  const adminSupabase = createAdminSupabaseClient();
  const { error } = await adminSupabase.storage
    .from(BUCKET_NAME)
    .remove([imagePath]);

  if (error) {
    console.error(`画像削除エラー: ${error.message}`);
  }
}
