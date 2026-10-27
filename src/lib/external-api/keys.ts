/**
 * 外部連携のAPIキー。
 *
 * 形は `rk_` + 32バイトの乱数（base64url）。保存するのは SHA-256 の指紋だけで、
 * キーそのものは発行したときに一度だけ画面に出す。
 */

import { createHash, randomBytes } from "crypto";

export const API_KEY_PREFIX = "rk_";
/** 画面に出す先頭の文字数（rk_ を含む） */
export const API_KEY_DISPLAY_LENGTH = 8;

export type ApiScope = "journals:write" | "receipts:write";
export const API_SCOPES: ApiScope[] = ["journals:write", "receipts:write"];

export function generateApiKey(): string {
  return API_KEY_PREFIX + randomBytes(32).toString("base64url");
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export function apiKeyDisplayPrefix(key: string): string {
  return key.slice(0, API_KEY_DISPLAY_LENGTH);
}

/** `Authorization: Bearer rk_…` からキーを取り出す。形が違えば null */
export function parseBearer(header: string | null | undefined): string | null {
  if (!header) return null;
  const m = header.match(/^Bearer\s+(\S+)\s*$/i);
  if (!m) return null;
  const key = m[1];
  if (!key.startsWith(API_KEY_PREFIX) || key.length < 20 || key.length > 200) return null;
  return key;
}

/**
 * APIキーを発行・無効化できるか。その会社の管理者（社長）・事務所の管理者（税理士）・システム管理者だけ。
 * 閲覧専用やアクセスを止められた人は、書き込めない（canWrite=false）ので発行できない。
 */
export function canManageApiKeys(me: { kind: string; role: string; canWrite: boolean }): boolean {
  if (me.kind === "super_admin") return true;
  if (!me.canWrite) return false;
  if (me.kind === "client") return me.role === "owner";
  if (me.kind === "firm") return me.role === "admin";
  return false;
}
