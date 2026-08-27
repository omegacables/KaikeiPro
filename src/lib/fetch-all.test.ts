import { describe, it, expect } from "vitest";
import { fetchAllRows } from "./fetch-all";

/** from/to を受け取り、指定件数のデータからページを切り出す疑似クエリ */
const pagedSource = (total: number) => {
  const all = Array.from({ length: total }, (_, i) => ({ id: i }));
  const calls: Array<[number, number]> = [];
  const query = (from: number, to: number) => {
    calls.push([from, to]);
    return Promise.resolve({ data: all.slice(from, to + 1), error: null });
  };
  return { query, calls };
};

describe("fetchAllRows", () => {
  it("1000行を超えるデータを全件取得する", async () => {
    // 1ページ=1000行の上限を超えるケース（集計金額が過少になっていた不具合の再現）
    const { query, calls } = pagedSource(1200);
    const rows = await fetchAllRows<{ id: number }>(query);
    expect(rows).toHaveLength(1200);
    expect(calls.length).toBe(2); // 0-999, 1000-1999
  });

  it("ちょうど1000行のときは追加ページを取得して終了する", async () => {
    const { query, calls } = pagedSource(1000);
    const rows = await fetchAllRows<{ id: number }>(query);
    expect(rows).toHaveLength(1000);
    // 1000件返った時点では最終ページか判別できないため、もう1回問い合わせる
    expect(calls.length).toBe(2);
  });

  it("1000行未満なら1回で終わる", async () => {
    const { query, calls } = pagedSource(150);
    const rows = await fetchAllRows<{ id: number }>(query);
    expect(rows).toHaveLength(150);
    expect(calls.length).toBe(1);
  });

  it("0件でも空配列を返す", async () => {
    const { query } = pagedSource(0);
    expect(await fetchAllRows(query)).toEqual([]);
  });

  it("エラーは例外として投げる", async () => {
    await expect(
      fetchAllRows(() => Promise.resolve({ data: null, error: { message: "権限がありません" } }))
    ).rejects.toThrow("権限がありません");
  });

  it("3ページ以上でも順序を保って結合する", async () => {
    const { query } = pagedSource(2500);
    const rows = await fetchAllRows<{ id: number }>(query);
    expect(rows).toHaveLength(2500);
    expect(rows[0].id).toBe(0);
    expect(rows[2499].id).toBe(2499);
  });
});
