/**
 * PostgREST の1リクエストあたり取得上限（Supabase の既定は1000行）を超えるデータを
 * ページングして全件取得する。
 *
 * 集計クエリで行数が上限に達しても **エラーにはならず黙って打ち切られる** ため、
 * 試算表・元帳・消費税集計などの金額が過少になる。仕訳が数千件規模になると
 * 必ず発生するので、集計系のクエリでは必ずこのヘルパーを使うこと。
 */
const PAGE_SIZE = 1000;

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

export async function fetchAllRows<T>(
  buildQuery: (from: number, to: number) => PromiseLike<PageResult<T>>
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    all.push(...rows);
    // 取得数が1ページ未満なら最終ページ
    if (rows.length < PAGE_SIZE) break;
  }
  return all;
}
