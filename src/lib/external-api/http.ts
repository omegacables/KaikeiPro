/**
 * 外部連携の受け口（/api/v1）の共通の入口：キーの確認 → 本処理 → JSON で返す。
 * エラーは日本語で { "error": { "code", "message", "details"? } }。
 */

import { NextResponse } from "next/server";
import { ApiError, authenticate, errorBody, type ApiContext, type ApiResult, type ExternalApiStore } from "./core";
import type { ApiScope } from "./keys";
import { createKeyLookupStore, createSupabaseStore } from "./supabase-store";

export async function handleApi(
  req: Request,
  scope: ApiScope | undefined,
  run: (store: ExternalApiStore, ctx: ApiContext) => Promise<ApiResult>
): Promise<NextResponse> {
  try {
    const ctx = await authenticate(
      createKeyLookupStore() as ExternalApiStore,
      req.headers.get("authorization"),
      scope
    );
    const { status, body } = await run(createSupabaseStore(ctx), ctx);
    return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof ApiError) {
      return NextResponse.json(errorBody(e), {
        status: e.status,
        headers: { "Cache-Control": "no-store", ...(e.status === 429 ? { "Retry-After": "60" } : {}) },
      });
    }
    console.error("[api/v1] 想定外のエラー:", e);
    return NextResponse.json(
      errorBody(new ApiError(500, "internal_error", "サーバーで問題が起きました。時間をおいて送り直してください")),
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
