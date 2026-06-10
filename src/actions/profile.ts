"use server";

import {
  createServerSupabaseClient,
  createAdminSupabaseClient,
} from "@/lib/supabase";

const BUCKET_NAME = "avatars";
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

let bucketEnsured = false;
async function ensureBucket() {
  if (bucketEnsured) return;
  const admin = createAdminSupabaseClient();
  const { data: buckets } = await admin.storage.listBuckets();
  const exists = buckets?.some((b) => b.name === BUCKET_NAME);
  if (!exists) {
    const { error } = await admin.storage.createBucket(BUCKET_NAME, {
      public: true, // アバターは公開URL（ヘッダー表示用）
      fileSizeLimit: MAX_FILE_SIZE,
      allowedMimeTypes: ALLOWED_TYPES,
    });
    if (error && !error.message.includes("already exists")) {
      throw new Error(`バケット作成エラー: ${error.message}`);
    }
  }
  bucketEnsured = true;
}

/**
 * ログイン中ユーザーのアバター画像をアップロードし、
 * auth の user_metadata.avatar_url に公開URLを保存する。
 */
export async function uploadAvatar(formData: FormData): Promise<string> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("認証エラー：再ログインしてください");

  const file = formData.get("file") as File;
  if (!file || file.size === 0) throw new Error("画像が選択されていません");
  if (file.size > MAX_FILE_SIZE)
    throw new Error("画像サイズが2MBを超えています");
  if (!ALLOWED_TYPES.includes(file.type))
    throw new Error("対応形式: JPG / PNG / WebP");

  await ensureBucket();

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${user.id}.${ext}`;
  const admin = createAdminSupabaseClient();
  const arrayBuffer = await file.arrayBuffer();

  const { error: upErr } = await admin.storage
    .from(BUCKET_NAME)
    .upload(path, new Uint8Array(arrayBuffer), {
      contentType: file.type,
      upsert: true, // 再アップロードで差し替え
    });
  if (upErr) throw new Error(`アップロードエラー: ${upErr.message}`);

  const { data: pub } = admin.storage.from(BUCKET_NAME).getPublicUrl(path);
  // キャッシュ回避のためバージョンを付与
  const url = `${pub.publicUrl}?v=${Date.now()}`;

  const { error: metaErr } = await admin.auth.admin.updateUserById(user.id, {
    user_metadata: { avatar_url: url },
  });
  if (metaErr) throw new Error(`プロフィール更新エラー: ${metaErr.message}`);

  return url;
}

/** アバターを削除して頭文字表示に戻す */
export async function removeAvatar(): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("認証エラー：再ログインしてください");

  const admin = createAdminSupabaseClient();
  await admin.storage
    .from(BUCKET_NAME)
    .remove([`${user.id}.jpg`, `${user.id}.png`, `${user.id}.webp`]);
  const { error } = await admin.auth.admin.updateUserById(user.id, {
    user_metadata: { avatar_url: null },
  });
  if (error) throw new Error(error.message);
}
