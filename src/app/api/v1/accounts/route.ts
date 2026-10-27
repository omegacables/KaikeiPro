import { handleApi } from "@/lib/external-api/http";
import { listAccountsFromApi } from "@/lib/external-api/core";

// 科目の一覧（読み取りだけ）。送る前に、その会社に科目があるかを確かめる
export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return handleApi(req, "journals:write", (store, ctx) => listAccountsFromApi(store, ctx));
}
