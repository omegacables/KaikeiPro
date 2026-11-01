import type { ActionResult } from "@/actions/ai-inbox";

/** サーバーの処理の結果を取り出す（失敗なら理由を例外にして、画面に出す） */
export function unwrap<T>(r: ActionResult<T>): T {
  if (!r.ok) throw new Error(r.error);
  return r.data;
}
