"use client";

import { getClients } from "@/actions/clients";
import { getStatutoryInterestRates } from "@/actions/loans";

/**
 * 画面をまたいで使い回す読み取り専用データのキャッシュ。
 *
 * 顧問先の一覧はヘッダーとサイドバーの両方が、認定利息の利率は
 * 借入金台帳が読んでいた。どれも同じ内容を毎回サーバーへ取りに行っており、
 * ページを開くたびに往復が増えていた。
 *
 * いずれも滅多に変わらないので、タブを開いている間は1回だけ読む。
 * 読み込み中に複数から呼ばれても、同じ約束（Promise）を返して二重取得を防ぐ。
 * 変更後に読み直したい場合は clearClientCache() を呼ぶ。
 */

export type CachedClient = { id: string; name: string; fiscal_year_start_month?: number };

let clientsCache: CachedClient[] | null = null;
let clientsPromise: Promise<CachedClient[]> | null = null;

export function loadClients(): Promise<CachedClient[]> {
  if (clientsCache) return Promise.resolve(clientsCache);
  if (!clientsPromise) {
    clientsPromise = getClients()
      .then((cs) => {
        clientsCache = (cs ?? []).map((c) => ({
          id: c.id as string,
          name: c.name as string,
          fiscal_year_start_month: (c as { fiscal_year_start_month?: number })
            .fiscal_year_start_month,
        }));
        return clientsCache;
      })
      .catch(() => {
        // 失敗は覚えない。次に呼ばれたらもう一度試す
        clientsPromise = null;
        return [];
      });
  }
  return clientsPromise;
}

let ratesCache: Record<number, number> | null = null;
let ratesPromise: Promise<Record<number, number>> | null = null;

/** 認定利息の利率（貸付を行った暦年 → 年利%）。年に一度しか変わらない */
export function loadStatutoryRates(): Promise<Record<number, number>> {
  if (ratesCache) return Promise.resolve(ratesCache);
  if (!ratesPromise) {
    ratesPromise = getStatutoryInterestRates()
      .then((rows) => {
        ratesCache = Object.fromEntries(rows.map((r) => [r.loan_year, r.rate]));
        return ratesCache;
      })
      .catch(() => {
        ratesPromise = null;
        return {};
      });
  }
  return ratesPromise;
}

/** 顧問先の追加・改名のあとに呼ぶ */
export function clearClientCache() {
  clientsCache = null;
  clientsPromise = null;
}
