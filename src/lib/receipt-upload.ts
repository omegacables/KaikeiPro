/**
 * 証憑ファイルの登録（画面の uploadReceipt と、外部連携の受け口 /api/v1/receipts で共用する）。
 *
 * 保存先は `receipts` バケットの `{client_id}/{uuid}.{ext}`。電子帳簿保存法の真実性の確保のため、
 * ファイルの SHA-256 を記録する。同じ顧問先に同じ内容のファイルがあれば二重に作らない
 * （画面では止めて知らせ、受け口では登録済みの id を返す）。
 *
 * 読み書きは ReceiptUploadIO を通す。画面は RLS バウンドのクライアントで照合・登録し、
 * 受け口は管理用クライアント（操作者＝キーの利用者）で行う。テストでは手元の入れ物に差し替える。
 */

import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import type { OcrResult } from "@/types";

export const RECEIPT_BUCKET = "receipts";
export const RECEIPT_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
export const RECEIPT_ALLOWED_TYPES = ["image/jpeg", "image/png", "application/pdf"];

// 拡張子は MIME から導出（ファイル名由来のパストラバーサルを防止）
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/pdf": "pdf",
};

export type PaymentMethod = "cash" | "card" | "e_money" | "bank_transfer";
const PAYMENT_METHODS: PaymentMethod[] = ["cash", "card", "e_money", "bank_transfer"];

/** 支払方法は決まった4つだけ。それ以外（空・打ち間違い）は null */
export function normalizePaymentMethod(v: string | null | undefined): PaymentMethod | null {
  return PAYMENT_METHODS.includes(v as PaymentMethod) ? (v as PaymentMethod) : null;
}

/** バイナリデータのSHA-256ハッシュを計算 */
export function computeSHA256(data: ArrayBuffer | Uint8Array): string {
  const hash = createHash("sha256");
  hash.update(data instanceof Uint8Array ? data : Buffer.from(data));
  return hash.digest("hex");
}

/** 入力の誤り（ファイルが無い・大きすぎる・形式違い）。受け口では 400 で返す */
export class ReceiptInputError extends Error {
  constructor(
    public code: "file_missing" | "file_too_large" | "file_type",
    message: string
  ) {
    super(message);
  }
}

export type ReceiptRow = Database["public"]["Tables"]["receipts"]["Row"];
export type ReceiptInsert = Database["public"]["Tables"]["receipts"]["Insert"];
export type ReceiptUpdate = Database["public"]["Tables"]["receipts"]["Update"];

/**
 * 読み取り結果が空か（取引先・日付・金額・書類種別のどれも無い）。
 * 空なら、外部連携で送られた値で埋めてよい
 */
export function isEmptyOcrResult(v: unknown): boolean {
  if (!v || typeof v !== "object" || Array.isArray(v)) return true;
  const o = v as Record<string, unknown>;
  return ["vendor_name", "date", "amount_total", "document_type"].every((k) => o[k] == null || o[k] === "");
}

export type ReceiptUploadIO = {
  findByHash(
    clientId: string,
    fileHash: string
  ): Promise<Pick<
    ReceiptRow,
    "id" | "image_path" | "mime_type" | "original_filename" | "uploaded_at" | "ocr_result" | "document_type" | "status"
  > | null>;
  upload(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  insert(row: ReceiptInsert): Promise<{ id: string }>;
  update(clientId: string, id: string, patch: ReceiptUpdate): Promise<void>;
  removeUpload(path: string): Promise<void>;
};

export type StoreReceiptInput = {
  clientId: string;
  userId: string;
  file: { bytes: Uint8Array; type: string; size: number; name: string };
  paymentMethod: PaymentMethod | null;
  direction: "issued" | "received";
  /** 同じファイルが登録済みのとき: throw=止めて知らせる（画面） / return=登録済みの id を返す（受け口） */
  onDuplicate: "throw" | "return";
  /**
   * 送り手が読み取り済みの値（外部連携の受け口）。あれば ocr_result・document_type に入れ、読み取り済みにする。
   * 登録済みのファイルなら、読み取り結果が空のときだけ埋める（中身がある場合は上書きしない）
   */
  ocr?: OcrResult | null;
};

export type StoreReceiptResult = {
  id: string;
  image_path: string;
  mime_type: string;
  duplicate: boolean;
  /** 送られた読み取り結果を保存したか（登録済みで中身があったときは false） */
  ocrSaved: boolean;
};

export async function storeReceiptFile(io: ReceiptUploadIO, input: StoreReceiptInput): Promise<StoreReceiptResult> {
  const { file, clientId } = input;
  if (!file || file.size === 0) throw new ReceiptInputError("file_missing", "ファイルが選択されていません");
  if (file.size > RECEIPT_MAX_FILE_SIZE) throw new ReceiptInputError("file_too_large", "ファイルサイズが10MBを超えています");
  if (!RECEIPT_ALLOWED_TYPES.includes(file.type)) throw new ReceiptInputError("file_type", "対応ファイル形式: JPG, PNG, PDF");

  // SHA-256ハッシュを計算（電子帳簿保存法: 真実性の確保）
  const fileHash = computeSHA256(file.bytes);

  // 重複ガード: 同じ顧問先に同一内容のファイルが登録済みなら二重に作らない。
  // 証憑管理・仕訳入力・ポータル・外部連携のどの経路から上げても同じ証憑が作られるのを防ぐ
  const dup = await io.findByHash(clientId, fileHash);
  if (dup) {
    if (input.onDuplicate === "return") {
      let ocrSaved = false;
      if (input.ocr && isEmptyOcrResult(dup.ocr_result)) {
        await io.update(clientId, dup.id, {
          ocr_result: input.ocr as unknown as Json,
          ...(dup.document_type ? {} : { document_type: input.ocr.document_type ?? null }),
          ...(dup.status === "uploaded" || dup.status === "processing" ? { status: "ocr_done" as const } : {}),
        });
        ocrSaved = true;
      }
      return { id: dup.id, image_path: dup.image_path, mime_type: dup.mime_type ?? file.type, duplicate: true, ocrSaved };
    }
    const when = dup.uploaded_at ? dup.uploaded_at.slice(0, 10) : "";
    throw new Error(
      `同じファイルが既に登録されています（${dup.original_filename ?? "登録済み証憑"}${when ? ` / ${when}` : ""}）`
    );
  }

  const ext = EXT_BY_MIME[file.type] ?? "bin";
  const receiptId = crypto.randomUUID();
  const storagePath = `${clientId}/${receiptId}.${ext}`;

  await io.upload(storagePath, file.bytes, file.type);

  try {
    const row = await io.insert({
      id: receiptId,
      client_id: clientId,
      uploaded_by: input.userId,
      image_path: storagePath,
      payment_method: input.paymentMethod,
      // 読み取り済みの値が一緒に来たら、そのまま読み取り済みにする（AIの読み取りを待たない）
      status: input.ocr ? "ocr_done" : "uploaded",
      ...(input.ocr
        ? { ocr_result: input.ocr as unknown as Json, document_type: input.ocr.document_type ?? null }
        : {}),
      direction: input.direction,
      original_filename: file.name,
      file_size: file.size,
      mime_type: file.type,
      file_hash: fileHash,
      hash_algorithm: "SHA-256",
    });
    return { id: row.id, image_path: storagePath, mime_type: file.type, duplicate: false, ocrSaved: Boolean(input.ocr) };
  } catch (e) {
    // ロールバック: アップロード済みファイルを削除
    await io.removeUpload(storagePath);
    throw e;
  }
}

type Db = SupabaseClient<Database>;

// バケット作成済みフラグ（プロセス内キャッシュ）
let bucketEnsured = false;

/** Storageバケットが存在しなければ自動作成（初回のみ実行） */
export async function ensureReceiptBucket(admin: Db) {
  if (bucketEnsured) return;
  const { data: buckets } = await admin.storage.listBuckets();
  const exists = buckets?.some((b) => b.name === RECEIPT_BUCKET);
  if (!exists) {
    const { error } = await admin.storage.createBucket(RECEIPT_BUCKET, {
      public: false,
      fileSizeLimit: RECEIPT_MAX_FILE_SIZE,
      allowedMimeTypes: RECEIPT_ALLOWED_TYPES,
    });
    if (error && !error.message.includes("already exists")) {
      throw new Error(`バケット作成エラー: ${error.message}`);
    }
    console.log(`Storage bucket "${RECEIPT_BUCKET}" を自動作成しました`);
  }
  bucketEnsured = true;
}

/**
 * Supabase を使う読み書き。
 * @param db    照合と行の作成に使うクライアント（画面は RLS バウンド、受け口は管理用）
 * @param admin ストレージの操作に使う管理用クライアント
 */
export function supabaseReceiptIO(db: Db, admin: Db): ReceiptUploadIO {
  return {
    async findByHash(clientId, fileHash) {
      const { data } = await db
        .from("receipts")
        .select("id, image_path, mime_type, original_filename, uploaded_at, ocr_result, document_type, status")
        .eq("client_id", clientId)
        .eq("file_hash", fileHash)
        .limit(1)
        .maybeSingle();
      return data ?? null;
    },
    async upload(path, bytes, contentType) {
      await ensureReceiptBucket(admin);
      const { error } = await admin.storage.from(RECEIPT_BUCKET).upload(path, bytes, { contentType, upsert: false });
      if (error) throw new Error(`アップロードエラー: ${error.message}`);
    },
    async insert(row) {
      const { data, error } = await db.from("receipts").insert(row).select("id").single();
      if (error || !data) throw new Error(`レコード作成エラー: ${error?.message ?? "unknown"}`);
      return data;
    },
    async update(clientId, id, patch) {
      const { error } = await db.from("receipts").update(patch).eq("id", id).eq("client_id", clientId);
      if (error) throw new Error(`レコード更新エラー: ${error.message}`);
    },
    async removeUpload(path) {
      await admin.storage.from(RECEIPT_BUCKET).remove([path]);
    },
  };
}
