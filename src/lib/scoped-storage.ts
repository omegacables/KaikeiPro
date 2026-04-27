/**
 * ユーザーIDでスコーピングされたlocalStorageラッパー
 *
 * 全てのlocalStorageキーをログイン中のユーザーIDでプレフィックスし、
 * アカウント間でデータが漏れないようにする。
 */

import { createBrowserClient } from "@/lib/supabase-browser";

// キャッシュ: 同一セッション中は再取得不要
let cachedUserId: string | null = null;

/**
 * 現在のログインユーザーIDを取得（同期的にキャッシュから返せる場合はそうする）
 */
export async function getCurrentUserId(): Promise<string | null> {
  if (cachedUserId) return cachedUserId;
  if (typeof window === "undefined") return null;

  try {
    const supabase = createBrowserClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.user?.id) {
      cachedUserId = session.user.id;
      return cachedUserId;
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * ユーザーIDキャッシュをセット（AuthProviderから呼び出す）
 */
export function setCurrentUserId(userId: string | null) {
  cachedUserId = userId;
}

/**
 * スコープドキーを生成
 */
function getScopedKey(userId: string, baseKey: string): string {
  return `raqto_${userId}_${baseKey}`;
}

/**
 * スコーピングされたlocalStorage.getItem
 * userId が確定している前提で同期的に呼び出す
 */
export function scopedGetItem(
  userId: string | null,
  baseKey: string
): string | null {
  if (typeof window === "undefined") return null;

  // ユーザーIDがある場合: スコープドキーから読む
  if (userId) {
    const scopedKey = getScopedKey(userId, baseKey);
    const scopedValue = localStorage.getItem(scopedKey);

    // スコープドキーにデータがない場合、旧キーからマイグレーション
    if (scopedValue === null) {
      const legacyKey = `raqto_${baseKey}`;
      const legacyValue = localStorage.getItem(legacyKey);
      if (legacyValue !== null) {
        // 旧データをスコープドキーにコピー
        localStorage.setItem(scopedKey, legacyValue);
        return legacyValue;
      }
    }

    return scopedValue;
  }

  // ユーザーIDがない場合: 旧キーにフォールバック（ログイン前）
  return localStorage.getItem(`raqto_${baseKey}`);
}

/**
 * スコーピングされたlocalStorage.setItem
 */
export function scopedSetItem(
  userId: string | null,
  baseKey: string,
  value: string
): void {
  if (typeof window === "undefined") return;

  if (userId) {
    localStorage.setItem(getScopedKey(userId, baseKey), value);
  } else {
    // フォールバック
    localStorage.setItem(`raqto_${baseKey}`, value);
  }
}
