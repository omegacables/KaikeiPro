"use server";

import {
  createServerSupabaseClient,
  createAdminSupabaseClient,
} from "@/lib/supabase";
import { createRaqtoSupabaseClient } from "@/lib/supabase-raqto";
import { assertClientAccess, resolveClientIdForRecord } from "@/lib/authz";

import {
  RECEIPT_BUCKET as BUCKET_NAME,
  computeSHA256,
  normalizePaymentMethod,
  storeReceiptFile,
  supabaseReceiptIO,
} from "@/lib/receipt-upload";

/**
 * レシート画像をアップロードしてrecordsレコードを作成
 * （保存の処理は外部連携の受け口と共用: src/lib/receipt-upload.ts）
 */
export async function uploadReceipt(formData: FormData) {
  const file = formData.get("file") as File;
  const clientId = formData.get("client_id") as string;
  const paymentMethod = formData.get("payment_method") as string | null;
  const directionRaw = (formData.get("direction") as string | null) || "received";
  const direction: "issued" | "received" = directionRaw === "issued" ? "issued" : "received";

  if (!file || file.size === 0) {
    throw new Error("ファイルが選択されていません");
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

  // 照合と行の作成は RLS バウンドのクライアントで（所有権を二重に担保）、ストレージは管理用で
  const io = supabaseReceiptIO(supabase, createAdminSupabaseClient());
  const saved = await storeReceiptFile(io, {
    clientId,
    userId: user.id,
    file: { bytes: new Uint8Array(await file.arrayBuffer()), type: file.type, size: file.size, name: file.name },
    paymentMethod: normalizePaymentMethod(paymentMethod),
    direction,
    onDuplicate: "throw",
  });

  return { id: saved.id, image_path: saved.image_path, mime_type: saved.mime_type };
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
