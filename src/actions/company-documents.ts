"use server";

import {
  createServerSupabaseClient,
  createAdminSupabaseClient,
} from "@/lib/supabase";
import { createHash } from "crypto";
import type { CompanyDocument, CompanyDocType } from "@/types/index";

type DbRow = Record<string, unknown>;

const BUCKET_NAME = "company-docs";
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "application/pdf"];
const DOC_TYPES: CompanyDocType[] = [
  "articles",
  "registry",
  "tax_filing",
  "license",
  "other",
];

function computeSHA256(data: ArrayBuffer): string {
  const hash = createHash("sha256");
  hash.update(Buffer.from(data));
  return hash.digest("hex");
}

function rowToDoc(r: DbRow): CompanyDocument {
  return {
    id: r.id as string,
    client_id: r.client_id as string,
    doc_type: (r.doc_type as CompanyDocType) ?? "other",
    title: (r.title as string) ?? "",
    file_path: (r.file_path as string) ?? "",
    original_filename: (r.original_filename as string) ?? null,
    file_size: (r.file_size as number) ?? null,
    mime_type: (r.mime_type as string) ?? null,
    file_hash: (r.file_hash as string) ?? null,
    hash_algorithm: (r.hash_algorithm as string) ?? null,
    issued_date: (r.issued_date as string) ?? null,
    memo: (r.memo as string) ?? null,
    uploaded_by: (r.uploaded_by as string) ?? null,
    created_at: (r.created_at as string) ?? "",
  };
}

let bucketEnsured = false;
async function ensureBucket() {
  if (bucketEnsured) return;
  const admin = createAdminSupabaseClient();
  const { data: buckets } = await admin.storage.listBuckets();
  const exists = buckets?.some((b) => b.name === BUCKET_NAME);
  if (!exists) {
    const { error } = await admin.storage.createBucket(BUCKET_NAME, {
      public: false,
      fileSizeLimit: MAX_FILE_SIZE,
      allowedMimeTypes: ALLOWED_TYPES,
    });
    if (error && !error.message.includes("already exists")) {
      throw new Error(`バケット作成エラー: ${error.message}`);
    }
  }
  bucketEnsured = true;
}

/** 会社書類の一覧を取得（新しい順） */
export async function getCompanyDocuments(
  clientId: string
): Promise<CompanyDocument[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("company_documents")
    .select("*")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToDoc);
}

/** ファイルをアップロードして company_documents レコードを作成 */
export async function uploadCompanyDocument(
  formData: FormData
): Promise<CompanyDocument> {
  const file = formData.get("file") as File;
  const clientId = formData.get("client_id") as string;
  const uploadedBy = (formData.get("uploaded_by") as string | null) || null;
  const docTypeRaw = (formData.get("doc_type") as string | null) || "other";
  const docType: CompanyDocType = DOC_TYPES.includes(docTypeRaw as CompanyDocType)
    ? (docTypeRaw as CompanyDocType)
    : "other";
  const title =
    ((formData.get("title") as string | null)?.trim() || "") ||
    (file?.name ?? "無題");
  const issuedDate = (formData.get("issued_date") as string | null) || null;
  const memo = (formData.get("memo") as string | null)?.trim() || null;

  await ensureBucket();

  if (!file || file.size === 0) throw new Error("ファイルが選択されていません");
  if (file.size > MAX_FILE_SIZE)
    throw new Error("ファイルサイズが10MBを超えています");
  if (!ALLOWED_TYPES.includes(file.type))
    throw new Error("対応ファイル形式: JPG, PNG, PDF");
  if (!clientId) throw new Error("クライアントIDが指定されていません");

  const ext = file.name.split(".").pop()?.toLowerCase() || "pdf";
  const docId = crypto.randomUUID();
  const storagePath = `${clientId}/${docId}.${ext}`;

  const admin = createAdminSupabaseClient();
  const arrayBuffer = await file.arrayBuffer();
  const fileHash = computeSHA256(arrayBuffer);

  const { error: uploadError } = await admin.storage
    .from(BUCKET_NAME)
    .upload(storagePath, new Uint8Array(arrayBuffer), {
      contentType: file.type,
      upsert: false,
    });
  if (uploadError) throw new Error(`アップロードエラー: ${uploadError.message}`);

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("company_documents")
    .insert({
      id: docId,
      client_id: clientId,
      doc_type: docType,
      title,
      file_path: storagePath,
      original_filename: file.name,
      file_size: file.size,
      mime_type: file.type,
      file_hash: fileHash,
      hash_algorithm: "SHA-256",
      issued_date: issuedDate,
      memo,
      uploaded_by: uploadedBy,
    })
    .select()
    .single();

  if (error) {
    // ロールバック: アップロード済みファイルを削除
    await admin.storage.from(BUCKET_NAME).remove([storagePath]);
    throw new Error(`レコード作成エラー: ${error.message}`);
  }
  return rowToDoc(data as DbRow);
}

/** 書類メタ情報（種類・名称・日付・メモ）を更新 */
export async function updateCompanyDocument(
  id: string,
  patch: {
    doc_type?: CompanyDocType;
    title?: string;
    issued_date?: string | null;
    memo?: string | null;
  }
): Promise<CompanyDocument> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("company_documents")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return rowToDoc(data as DbRow);
}

/** 署名付きURLを取得（1時間有効） */
export async function getCompanyDocumentUrl(
  filePath: string
): Promise<string | null> {
  if (!filePath) return null;
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin.storage
    .from(BUCKET_NAME)
    .createSignedUrl(filePath, 3600);
  if (error) {
    console.error(`URL取得エラー: ${error.message}`);
    return null;
  }
  return data.signedUrl;
}

/** 書類を削除（ストレージのファイルも削除） */
export async function deleteCompanyDocument(id: string): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const { data: rec } = await supabase
    .from("company_documents")
    .select("file_path")
    .eq("id", id)
    .single();
  const filePath = (rec as DbRow | null)?.file_path as string | undefined;

  const { error } = await supabase
    .from("company_documents")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);

  if (filePath) {
    const admin = createAdminSupabaseClient();
    await admin.storage.from(BUCKET_NAME).remove([filePath]);
  }
}
