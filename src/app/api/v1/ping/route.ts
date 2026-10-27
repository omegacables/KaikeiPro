import { handleApi } from "@/lib/external-api/http";
import { ping } from "@/lib/external-api/core";

// 接続の確認用：キーが有効か・どの会社のキーか
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return handleApi(req, undefined, async (store, ctx) => ({ status: 200, body: await ping(store, ctx) }));
}
