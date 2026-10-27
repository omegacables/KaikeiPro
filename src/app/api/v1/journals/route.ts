import { handleApi } from "@/lib/external-api/http";
import { ApiError, createJournalFromApi, getJournalFromApi } from "@/lib/external-api/core";

// 仕訳の受け口。登録は確定済み（confirmed）。同じ external_id は前に作った仕訳を返す
export const dynamic = "force-dynamic";

export function POST(req: Request) {
  return handleApi(req, "journals:write", async (store, ctx) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new ApiError(400, "invalid_json", "本文を JSON として読めません");
    }
    return createJournalFromApi(store, ctx, body);
  });
}

export function GET(req: Request) {
  return handleApi(req, "journals:write", (store, ctx) =>
    getJournalFromApi(store, ctx, new URL(req.url).searchParams.get("external_id"))
  );
}
