"use server";

/**
 * 消費税及び地方消費税の確定申告書。計算は src/lib/consumption-tax-return.ts（テストあり）。
 * 期ごとの設定（計算方法・仕入税額の計算・簡易課税の区分・中間納付額）は consumption_tax_returns に残す。
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase";
import { assertClientAccess } from "@/lib/authz";
import {
  resolveFiscalPeriodByKey,
  adjacentFiscalPeriodKeys,
  currentFiscalStartYear,
  toJstDate,
  type FiscalPeriodRow,
} from "@/lib/fiscal";
import { consumptionTaxXml } from "@/lib/etax-shohi-xml";
import { missingFilerInfo } from "@/lib/etax-xml";
import { taxOfficeName } from "@/lib/tax-offices";
import { loadTaxBookLines } from "@/lib/tax-exclusive";
import {
  aggregateReturnInput,
  computeConsumptionTaxReturn,
  special20Eligible,
  type CalcMethod,
  type PurchaseTaxCalc,
  type ConsumptionTaxReturn,
  type ReturnInput,
} from "@/lib/consumption-tax-return";

type Db = Awaited<ReturnType<typeof createServerSupabaseClient>>;

export type ReturnSettingsView = {
  method: CalcMethod;
  purchaseTaxCalc: PurchaseTaxCalc;
  deductionMethod: "proportional" | "individual";
  businessType: number | null;
  interimNational: number;
  interimLocal: number;
  note: string | null;
  /** 基準期間の課税売上高（入力した値。帳簿から出せない年度のため） */
  basePeriodSalesInput: number | null;
  /** この期の設定を保存しているか（無ければ顧問先の設定から） */
  saved: boolean;
};

export type ConsumptionTaxReturnView = {
  period: { startDate: string; endDate: string; key: string; prevKey: string; nextKey: string; months: number };
  entityType: "individual" | "corporation" | null;
  taxExempt: boolean;
  settings: ReturnSettingsView;
  /** 基準期間（前々事業年度）の課税売上高。記録が無ければ null */
  basePeriodSales: number | null;
  basePeriod: { startDate: string; endDate: string };
  result: ConsumptionTaxReturn;
  /** 計算方法を使えるかの注意 */
  eligibility: string[];
};

const monthIndex = (iso: string) => {
  const [y, m] = iso.split("-").map(Number);
  return y * 12 + (m - 1);
};

/** 課税売上高（税抜）＋免税売上（基準期間の判定に使う額） */
function taxableSalesOf(i: ReturnInput): number {
  return Math.floor((i.sales.A * 100) / 108) + Math.floor((i.sales.B * 100) / 110) + i.taxFree;
}

async function loadInput(db: Db, clientId: string, start: string, end: string) {
  return aggregateReturnInput(await loadTaxBookLines(db as unknown as SupabaseClient, clientId, start, end));
}

export async function getConsumptionTaxReturn(clientId: string, periodKey?: string): Promise<ConsumptionTaxReturnView> {
  await assertClientAccess(clientId);
  const db = await createServerSupabaseClient();
  const [{ data: client, error }, { data: fyRows }] = await Promise.all([
    db
      .from("clients")
      .select("fiscal_year_start_month, entity_type, tax_method, simplified_business_type, consumption_tax_status")
      .eq("id", clientId)
      .single(),
    db.from("fiscal_years").select("start_date, end_date").eq("client_id", clientId),
  ]);
  if (error || !client) throw new Error(error?.message ?? "顧問先が見つかりません");
  const sm = (client.fiscal_year_start_month as number | null) ?? null;
  const rows = (fyRows ?? []) as FiscalPeriodRow[];
  const p = resolveFiscalPeriodByKey(rows, sm, periodKey ?? String(currentFiscalStartYear(sm)));
  const adj = adjacentFiscalPeriodKeys(rows, p);
  // 基準期間＝前々事業年度
  const prev = resolveFiscalPeriodByKey(rows, sm, adj.prevKey);
  const base = resolveFiscalPeriodByKey(rows, sm, adjacentFiscalPeriodKeys(rows, prev).prevKey);

  const [{ data: saved }, input, baseInput, { count: baseEntries }] = await Promise.all([
    db
      .from("consumption_tax_returns")
      .select("calc_method, purchase_tax_calc, deduction_method, simplified_business_type, interim_national, interim_local, note, base_period_sales")
      .eq("client_id", clientId)
      .eq("period_start", p.startDate)
      .maybeSingle(),
    loadInput(db, clientId, p.startDate, p.endDate),
    loadInput(db, clientId, base.startDate, base.endDate),
    db
      .from("journal_entries")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .gte("entry_date", base.startDate)
      .lte("entry_date", base.endDate),
  ]);

  const settings: ReturnSettingsView = {
    method: (saved?.calc_method as CalcMethod | null) ?? ((client.tax_method as CalcMethod | null) === "simplified" ? "simplified" : "standard"),
    purchaseTaxCalc: (saved?.purchase_tax_calc as PurchaseTaxCalc | undefined) ?? "stacked",
    deductionMethod: (saved?.deduction_method as "proportional" | "individual" | undefined) ?? "proportional",
    businessType: (saved?.simplified_business_type as number | null) ?? (client.simplified_business_type as number | null) ?? null,
    interimNational: Number(saved?.interim_national ?? 0),
    interimLocal: Number(saved?.interim_local ?? 0),
    note: (saved?.note as string | null) ?? null,
    basePeriodSalesInput: saved?.base_period_sales === null || saved?.base_period_sales === undefined ? null : Number(saved.base_period_sales),
    saved: Boolean(saved),
  };
  const months = monthIndex(p.endDate) - monthIndex(p.startDate) + 1;
  const result = computeConsumptionTaxReturn(input, { ...settings, periodMonths: months });

  // 入力した値を優先。無ければ帳簿から（基準期間に仕訳が無ければ「記録なし」。0円と区別する）
  const basePeriodSales = settings.basePeriodSalesInput ?? ((baseEntries ?? 0) > 0 ? taxableSalesOf(baseInput) : null);

  const eligibility: string[] = [];
  if (settings.method === "simplified" && basePeriodSales !== null && basePeriodSales > 50_000_000)
    eligibility.push("基準期間の課税売上高が5,000万円を超えているため、簡易課税は使えません。");
  if (settings.method === "special_20") {
    if (!special20Eligible({ start: p.startDate, end: p.endDate }))
      eligibility.push("2割特例は、令和5年10月1日〜令和8年9月30日の日を含む課税期間だけ使えます。");
    if (basePeriodSales !== null && basePeriodSales > 10_000_000)
      eligibility.push("基準期間の課税売上高が1,000万円を超えているため、2割特例は使えません。");
    eligibility.push("2割特例は、インボイス登録を機に免税事業者から課税事業者になった事業者だけが使えます（申告書の参考事項に○を付けます）。");
  }
  if (basePeriodSales === null)
    eligibility.push(`基準期間（${base.startDate}〜${base.endDate}）の仕訳が無いため、基準期間の課税売上高は確認できません。`);

  return {
    period: { startDate: p.startDate, endDate: p.endDate, key: p.startDate, prevKey: adj.prevKey, nextKey: adj.nextKey, months },
    entityType: (client.entity_type as ConsumptionTaxReturnView["entityType"]) ?? null,
    taxExempt: client.consumption_tax_status === "exempt",
    settings,
    basePeriodSales,
    basePeriod: { startDate: base.startDate, endDate: base.endDate },
    result,
    eligibility,
  };
}

export type ReturnSettingsInput = {
  method: CalcMethod;
  purchaseTaxCalc: PurchaseTaxCalc;
  deductionMethod?: "proportional" | "individual";
  businessType: number | null;
  interimNational: number;
  interimLocal: number;
  note?: string | null;
  basePeriodSales?: number | null;
};

/** 期ごとの申告の設定を保存する */
export async function saveConsumptionTaxReturnSettings(
  clientId: string,
  period: { startDate: string; endDate: string },
  input: ReturnSettingsInput
): Promise<void> {
  await assertClientAccess(clientId);
  if (!["standard", "simplified", "special_20"].includes(input.method)) throw new Error("計算方法が正しくありません");
  if (!["stacked", "proportional"].includes(input.purchaseTaxCalc)) throw new Error("仕入税額の計算方法が正しくありません");
  if (input.businessType !== null && !(Number.isInteger(input.businessType) && input.businessType >= 1 && input.businessType <= 6))
    throw new Error("簡易課税の事業区分が正しくありません");
  if (!(input.interimNational >= 0) || !(input.interimLocal >= 0)) throw new Error("中間納付額を正しく入力してください");
  if (input.basePeriodSales != null && !(input.basePeriodSales >= 0)) throw new Error("基準期間の課税売上高を正しく入力してください");
  const db = await createServerSupabaseClient();
  const { error } = await db.from("consumption_tax_returns").upsert(
    {
      client_id: clientId,
      period_start: period.startDate,
      period_end: period.endDate,
      calc_method: input.method,
      purchase_tax_calc: input.purchaseTaxCalc,
      deduction_method: input.deductionMethod === "individual" ? "individual" : "proportional",
      simplified_business_type: input.businessType,
      interim_national: Math.round(input.interimNational),
      interim_local: Math.round(input.interimLocal),
      note: input.note?.trim() || null,
      base_period_sales: input.basePeriodSales == null ? null : Math.round(input.basePeriodSales),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "client_id,period_start" }
  );
  if (error) throw new Error(error.message);
}

/**
 * 申告書を e-Tax 用ファイル（.xtx）にする。e-Taxソフト（WEB版は「作成済みデータの利用」、PC版は「組み込み」）で
 * 読み込んで、署名・送信する。作り方は src/lib/etax-shohi-xml.ts（テストあり）。
 */
export async function getConsumptionTaxXtx(
  clientId: string,
  periodKey: string
): Promise<{ fileName: string; xml: string } | { missing: string[] }> {
  const view = await getConsumptionTaxReturn(clientId, periodKey); // アクセス権もここで確かめる
  const db = await createServerSupabaseClient();
  const { data: c, error } = await db
    .from("clients")
    .select("name, postal_code, address, telephone, tax_office_code, etax_user_id, corporate_number, name_kana, representative_name, representative_kana")
    .eq("id", clientId)
    .single();
  if (error || !c) throw new Error(error?.message ?? "顧問先が見つかりません");
  const filer = {
    taxOfficeCode: (c.tax_office_code as string | null) ?? "",
    taxOfficeName: taxOfficeName(c.tax_office_code as string | null),
    etaxUserId: (c.etax_user_id as string | null) ?? "",
    corporateNumber: (c.corporate_number as string | null) ?? null,
    name: (c.name as string) ?? "",
    nameKana: (c.name_kana as string | null) ?? null,
    postalCode: (c.postal_code as string | null) ?? null,
    address: (c.address as string | null) ?? "",
    telephone: (c.telephone as string | null) ?? null,
    representativeName: (c.representative_name as string | null) ?? null,
    representativeKana: (c.representative_kana as string | null) ?? null,
  };
  const missing = missingFilerInfo(filer);
  if (missing.length) return { missing };
  return consumptionTaxXml({
    ret: view.result,
    filer,
    period: { start: view.period.startDate, end: view.period.endDate },
    basePeriodSales: view.basePeriodSales,
    today: toJstDate(new Date().toISOString()),
  });
}
