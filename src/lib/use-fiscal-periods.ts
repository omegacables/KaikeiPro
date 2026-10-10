"use client";

/**
 * 画面の「年度」選択に使う、顧問先の事業年度の一覧（決算月を変えた年の変則期間も記録どおり）。
 * 読み込み前は ready=false。期の指定は期首日（option.key）で行う。
 */

import { useEffect, useMemo, useState } from "react";
import { getClient } from "@/actions/clients";
import { getFiscalPeriodRows } from "@/actions/fiscal-month";
import { fiscalPeriodOptions, toJstDate, type FiscalPeriodOption, type FiscalPeriodRow } from "@/lib/fiscal";

export function useFiscalPeriods(
  clientId: string,
  opts: { past?: number; future?: number } = {}
): { ready: boolean; startMonth: number; options: FiscalPeriodOption[]; current: FiscalPeriodOption | null } {
  const [basis, setBasis] = useState<{ startMonth: number; rows: FiscalPeriodRow[] } | null>(null);
  useEffect(() => {
    let alive = true;
    Promise.all([getClient(clientId), getFiscalPeriodRows(clientId).catch(() => [] as FiscalPeriodRow[])])
      .then(([c, rows]) => {
        if (alive) setBasis({ startMonth: (c as { fiscal_year_start_month?: number }).fiscal_year_start_month ?? 4, rows });
      })
      .catch(() => alive && setBasis({ startMonth: 4, rows: [] }));
    return () => {
      alive = false;
    };
  }, [clientId]);

  const { past, future } = opts;
  const options = useMemo(
    () => (basis ? fiscalPeriodOptions(basis.rows, basis.startMonth, toJstDate(new Date().toISOString()), { past, future }) : []),
    [basis, past, future]
  );
  const today = toJstDate(new Date().toISOString());
  const current = options.find((o) => o.startDate <= today && today <= o.endDate) ?? null;
  return { ready: basis !== null, startMonth: basis?.startMonth ?? 4, options, current };
}
