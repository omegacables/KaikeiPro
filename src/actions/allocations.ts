"use server";

/**
 * 私的利用分の按分。
 *   個人事業主 … 家事按分（私用分を事業主貸へ）
 *   法人       … 役員の私的利用分（社宅・車両・携帯電話など。私用分を役員貸付金などへ）
 * 期末一括の計算は src/lib/private-use.ts（テストあり）。
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getGeminiModel, callGemini } from "@/lib/gemini";
import { createServerSupabaseClient } from "@/lib/supabase";
import { assertClientAccess } from "@/lib/authz";
import { fetchAllRows } from "@/lib/fetch-all";
import { createJournalEntry } from "./journals";
import { resolveFiscalPeriodByKey, type FiscalPeriodRow } from "@/lib/fiscal";
import { normalizeTaxCategory, taxCategoryInfo, defaultTaxCategory } from "@/lib/tax-category";
import { loadExclusiveEntries } from "@/lib/tax-exclusive";
import { buildPrivateUseAdjustment, type PrivateUseSourceLine } from "@/lib/private-use";

export interface AllocatableAccount {
  id: string;
  code: string;
  name: string;
}

export interface AllocationRate {
  account_id: string;
  business_ratio: number; // 0〜100 (%)
  basis_note: string | null;
}

// 按分対象になりうる科目（費用科目）を取得
export async function getAllocatableAccounts(clientId: string): Promise<AllocatableAccount[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("accounts")
    .select("id, code, name, account_categories!inner ( type )")
    .or(`client_id.eq.${clientId},client_id.is.null`)
    .eq("is_active", true)
    .eq("account_categories.type", "expenses")
    .order("code");
  if (error) throw new Error(error.message);
  return (data ?? []).map((a) => ({ id: a.id, code: a.code, name: a.name }));
}

// 支払い元になりうる科目（資産科目：現金・預金など）を取得
export async function getPaymentAccounts(clientId: string): Promise<AllocatableAccount[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("accounts")
    .select("id, code, name, account_categories!inner ( type )")
    .or(`client_id.eq.${clientId},client_id.is.null`)
    .eq("is_active", true)
    .eq("account_categories.type", "assets")
    .order("code");
  if (error) throw new Error(error.message);
  return (data ?? []).map((a) => ({ id: a.id, code: a.code, name: a.name }));
}

export interface AllocationSuggestion {
  account_id: string;
  name: string;
  ratio: number;       // 0〜100
  reason: string;      // 一言根拠
}

// AIによる按分率の提案（業種・科目名から事業使用割合の目安を提示）
export async function suggestAllocationRatios(clientId: string): Promise<AllocationSuggestion[]> {
  const supabase = await createServerSupabaseClient();

  const { data: client } = await supabase
    .from("clients")
    .select("name, business_type, ai_share_company_info, entity_type")
    .eq("id", clientId)
    .maybeSingle();
  // 顧問先の設定で会社情報をAIに渡さないときは、業種を添えない
  const shareCompany = (client as { ai_share_company_info?: boolean } | null)?.ai_share_company_info ?? true;
  const businessType = shareCompany
    ? (client as { business_type?: string | null } | null)?.business_type || "不明"
    : "（顧問先の設定により、AIには渡していません）";

  const accounts = await getAllocatableAccounts(clientId);
  if (accounts.length === 0) return [];

  const model = getGeminiModel("text");

  const isCorporation = (client as { entity_type?: string | null } | null)?.entity_type === "corporation";
  const prompt = isCorporation
    ? `あなたは日本の税務に詳しい税理士補助です。法人で、役員が私的にも使う費用（社宅・自宅兼事務所の家賃、車両、携帯電話など）について、各勘定科目の「業務に使う割合」（0〜100の整数%）の目安を提案してください。

業種: ${businessType}
前提: 中小法人。私的に使う分は役員が会社に返す（役員貸付金）か、役員の給与として扱う。

対象の費用科目:
${accounts.map((a) => `- ${a.name}`).join("\n")}

判断の目安:
- 仕入高・外注費・給料手当など、役員の私用が入らない経費 → 100
- 地代家賃（役員の自宅兼事務所・社宅）・水道光熱費・通信費・車両費・旅費 → 実務的な目安
- 判断が難しいものは保守的な目安とし、理由を簡潔に

必ず次のJSON形式のみで回答（説明文不要）:
{"suggestions":[{"name":"科目名（入力のまま）","ratio":70,"reason":"一言理由"}]}`
    : `あなたは日本の税務に詳しい税理士補助です。個人事業主の「家事按分」における、各勘定科目の事業使用割合（按分率, 0〜100の整数%）の目安を提案してください。

事業主の業種: ${businessType}
前提: 自宅兼事務所での個人事業主。生活と共用しやすい費目は実務的な目安、純粋な事業経費は100。

対象の費用科目:
${accounts.map((a) => `- ${a.name}`).join("\n")}

判断の目安:
- 仕入高・外注費・給料手当・賞与・法定福利費など純事業経費 → 100
- 地代家賃・水道光熱費・通信費・車両関連 → 業種に応じた実務的な目安（例: 在宅中心なら家賃30〜50%、光熱費30〜50%、通信費50〜70%）
- 判断が難しいものは保守的な目安とし、理由を簡潔に

必ず次のJSON形式のみで回答（説明文不要）:
{"suggestions":[{"name":"科目名（入力のまま）","ratio":40,"reason":"一言理由"}]}`;

  const result = await callGemini(() => model.generateContent(prompt));
  const text = result.response.text();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("AI提案の解析に失敗しました");
  const parsed = JSON.parse(match[0]) as { suggestions?: { name?: string; ratio?: number; reason?: string }[] };

  const byName = new Map(accounts.map((a) => [a.name, a]));
  const out: AllocationSuggestion[] = [];
  for (const s of parsed.suggestions ?? []) {
    const acc = s.name ? byName.get(s.name) : undefined;
    if (!acc) continue;
    let ratio = Number(s.ratio);
    if (Number.isNaN(ratio)) continue;
    ratio = Math.max(0, Math.min(100, Math.round(ratio)));
    out.push({ account_id: acc.id, name: acc.name, ratio, reason: (s.reason ?? "").toString().slice(0, 200) });
  }
  return out;
}

/**
 * 期の指定: 期首の年（2025）か期首日（"2025-04-01"）。決算月を変えた年は同じ年に始まる期が2つあるので、
 * 変則期間は期首日で指定する。按分率は期首の年ごとに持つ（同じ年に始まる2つの期は同じ按分率）
 */
export type PeriodKey = number | string;
function rateYear(key: PeriodKey): number {
  return typeof key === "number" ? key : Number(String(key).slice(0, 4));
}

// 指定年度の按分率設定を account_id をキーに取得
export async function getAllocationRates(
  clientId: string,
  fiscalYear: PeriodKey
): Promise<Record<string, AllocationRate>> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("allocation_rate_settings")
    .select("account_id, business_ratio, basis_note")
    .eq("client_id", clientId)
    .eq("fiscal_year", rateYear(fiscalYear));
  if (error) {
    // テーブル未適用でも落とさない
    return {};
  }
  const map: Record<string, AllocationRate> = {};
  for (const r of data ?? []) {
    map[r.account_id] = {
      account_id: r.account_id,
      business_ratio: Number(r.business_ratio),
      basis_note: r.basis_note,
    };
  }
  return map;
}

// 按分率の登録・更新（UNIQUE制約に依存しない検索→更新/挿入方式）
export async function upsertAllocationRate(
  clientId: string,
  fiscalYear: PeriodKey,
  accountId: string,
  businessRatio: number,
  basisNote: string | null
): Promise<void> {
  if (businessRatio < 0 || businessRatio > 100) {
    throw new Error("按分率は0〜100の範囲で入力してください");
  }
  const supabase = await createServerSupabaseClient();

  const { data: existing, error: selErr } = await supabase
    .from("allocation_rate_settings")
    .select("id")
    .eq("client_id", clientId)
    .eq("fiscal_year", rateYear(fiscalYear))
    .eq("account_id", accountId)
    .limit(1)
    .maybeSingle();
  if (selErr) throw new Error(selErr.message);

  if (existing) {
    const { error } = await supabase
      .from("allocation_rate_settings")
      .update({ business_ratio: businessRatio, basis_note: basisNote, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
    return;
  }

  const { error } = await supabase.from("allocation_rate_settings").insert({
    client_id: clientId,
    fiscal_year: rateYear(fiscalYear),
    account_id: accountId,
    business_ratio: businessRatio,
    basis_note: basisNote,
  });
  if (error) throw new Error(error.message);
}

// ---- 私用分の振替先 ----

/** 私用分の振替先になる科目（個人: 事業主貸、法人: 役員貸付金・役員報酬・未収入金など） */
const DESTINATION_ACCOUNT = /事業主貸|役員貸付金|役員報酬|役員給与|未収入金|未収金|立替金/;

export interface PrivateUseSetup {
  entityType: "individual" | "corporation" | null;
  destinations: AllocatableAccount[];
  /** 既定の振替先（個人: 事業主貸、法人: 役員貸付金） */
  defaultDestinationId: string | null;
}

type Db = Awaited<ReturnType<typeof createServerSupabaseClient>>;
type DestinationAccount = AllocatableAccount & { type: string };

async function loadDestinations(db: Db, clientId: string): Promise<DestinationAccount[]> {
  const { data } = await db
    .from("accounts")
    .select("id, code, name, client_id, account_categories!inner ( type )")
    .or(`client_id.eq.${clientId},client_id.is.null`)
    .eq("is_active", true)
    .order("code");
  type A = { id: string; code: string; name: string; account_categories: { type: string } | { type: string }[] };
  return ((data ?? []) as unknown as A[])
    .filter((a) => DESTINATION_ACCOUNT.test(a.name))
    .map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      type: (Array.isArray(a.account_categories) ? a.account_categories[0]?.type : a.account_categories?.type) ?? "",
    }));
}

async function entityTypeOf(db: Db, clientId: string): Promise<"individual" | "corporation" | null> {
  const { data } = await db.from("clients").select("entity_type").eq("id", clientId).maybeSingle();
  return ((data as { entity_type?: "individual" | "corporation" | null } | null)?.entity_type ?? null);
}

function defaultDestination(list: DestinationAccount[], entityType: PrivateUseSetup["entityType"]) {
  const name = entityType === "corporation" ? "役員貸付金" : "事業主貸";
  return list.find((a) => a.name === name) ?? null;
}

export async function getPrivateUseSetup(clientId: string): Promise<PrivateUseSetup> {
  await assertClientAccess(clientId);
  const db = await createServerSupabaseClient();
  const [list, entityType] = await Promise.all([loadDestinations(db, clientId), entityTypeOf(db, clientId)]);
  // 法人は事業主貸を使わない。個人事業主には役員がいないので役員の科目は出さない
  const destinations = list
    .filter((a) => (entityType === "corporation" ? a.name !== "事業主貸" : !a.name.startsWith("役員")))
    .map(({ id, code, name }) => ({ id, code, name }));
  return { entityType, destinations, defaultDestinationId: defaultDestination(list, entityType)?.id ?? null };
}

/** 振替先の科目を決める（指定が無ければ既定の科目） */
async function resolveDestination(db: Db, clientId: string, destinationAccountId?: string | null): Promise<DestinationAccount> {
  const [list, entityType] = await Promise.all([loadDestinations(db, clientId), entityTypeOf(db, clientId)]);
  const dest = destinationAccountId ? list.find((a) => a.id === destinationAccountId) : defaultDestination(list, entityType);
  if (!dest) {
    throw new Error(
      entityType === "corporation"
        ? "振替先の科目（役員貸付金など）が見つかりません。勘定科目管理で確認してください。"
        : "「事業主貸」科目が見つかりません。勘定科目管理で追加してください。"
    );
  }
  return dest;
}

/** 振替先が費用（役員報酬など）なら、消費税のかからない区分を付ける */
function destinationTaxCategory(dest: DestinationAccount): string | null {
  return dest.type === "expenses" ? "purchase_out_of_scope" : null;
}

async function currentUserId(db: Db): Promise<string> {
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) throw new Error("ログインが必要です");
  return user.id;
}

// ---- 1件ずつの按分仕訳 ----

export interface AllocationJournalInput {
  date: string;
  expenseAccountId: string;
  paymentAccountId: string;
  totalAmount: number;
  businessRatio: number; // 0〜100
  memo?: string;
  /** 私用分の振替先（省略時は 個人: 事業主貸 / 法人: 役員貸付金） */
  destinationAccountId?: string | null;
}

// 按分仕訳を作成（私用分を振替先へ）
// 按分後の金額: 事業分は四捨五入、私用分は差額で必ず合計一致
export async function createAllocationJournal(
  clientId: string,
  input: AllocationJournalInput
): Promise<void> {
  if (!input.expenseAccountId) throw new Error("費用科目を選択してください");
  if (!input.paymentAccountId) throw new Error("支払元の科目を選択してください");
  if (!(input.totalAmount > 0)) throw new Error("取引金額を入力してください");
  if (input.businessRatio < 0 || input.businessRatio > 100) {
    throw new Error("按分率は0〜100で入力してください");
  }

  await assertClientAccess(clientId);
  const supabase = await createServerSupabaseClient();
  const dest = await resolveDestination(supabase, clientId, input.destinationAccountId);
  const entityType = await entityTypeOf(supabase, clientId);

  const { data: expense } = await supabase.from("accounts").select("name").eq("id", input.expenseAccountId).maybeSingle();
  // 事業分は通常の経費として消費税の区分を付ける（私用分は仕入税額控除の対象にしない）
  const expenseTax = defaultTaxCategory("expenses", (expense?.name as string) ?? "");

  const business = Math.round((input.totalAmount * input.businessRatio) / 100);
  const priv = input.totalAmount - business;

  const lines: { account_id: string; debit_amount: number; credit_amount: number; tax_category?: string | null }[] = [];
  if (business > 0)
    lines.push({ account_id: input.expenseAccountId, debit_amount: business, credit_amount: 0, tax_category: expenseTax });
  if (priv > 0) lines.push({ account_id: dest.id, debit_amount: priv, credit_amount: 0, tax_category: destinationTaxCategory(dest) });
  lines.push({ account_id: input.paymentAccountId, debit_amount: 0, credit_amount: input.totalAmount });

  const label = entityType === "corporation" ? "役員の私的利用分の按分（業務割合" : "家事按分（事業割合";
  const description = (input.memo && input.memo.trim())
    ? input.memo.trim()
    : `${label}${input.businessRatio}%）`;

  await createJournalEntry(
    {
      client_id: clientId,
      entry_date: input.date,
      description,
      status: "draft",
      source: "manual",
      created_by: await currentUserId(supabase),
    },
    lines
  );
}

// ---- 期末一括按分 ----

export interface BatchAllocationRow {
  account_id: string;
  code: string;
  name: string;
  ratio: number;   // 事業割合 %
  total: number;   // 期中の合計（借方-貸方）
  business: number; // 事業分（残す経費）
  private: number;  // 私用分（振替先へ）
}

export interface BatchAllocationPreview {
  rows: BatchAllocationRow[];
  /** 仮払消費税から減らす額（税抜経理の仕訳から来た私用分の消費税） */
  inputTax: number;
  /** 振替先へ振り替える額（私用分＋その消費税） */
  transfer: number;
  period: { startDate: string; endDate: string };
  /** この年度の期末一括按分が作成済みか */
  posted: boolean;
}

/** 期末一括の仕訳の摘要（二重作成の確認と、集計から除くのに使う） */
const BATCH_PREFIXES = ["家事按分（期末一括）", "役員の私的利用分（期末一括）"];
function batchDescription(fiscalYear: PeriodKey, entityType: PrivateUseSetup["entityType"]) {
  return `${entityType === "corporation" ? BATCH_PREFIXES[1] : BATCH_PREFIXES[0]}${rateYear(fiscalYear)}年度`;
}

/** 按分率の年度（期首の年）から、事業年度の期間（決算月を変えた変則期間も記録どおり） */
async function fiscalRange(db: Db, clientId: string, fiscalYear: PeriodKey) {
  const [{ data: client }, { data: fyRows }] = await Promise.all([
    db.from("clients").select("fiscal_year_start_month").eq("id", clientId).maybeSingle(),
    db.from("fiscal_years").select("start_date, end_date").eq("client_id", clientId),
  ]);
  const sm = (client as { fiscal_year_start_month?: number } | null)?.fiscal_year_start_month ?? 4;
  const p = resolveFiscalPeriodByKey((fyRows ?? []) as FiscalPeriodRow[], sm, String(fiscalYear));
  return { start: p.startDate, end: p.endDate };
}

/** 期中の、按分率を決めた科目の行（期末一括の仕訳そのものは除く） */
async function loadSourceLines(db: Db, clientId: string, start: string, end: string, accountIds: string[]) {
  type L = {
    journal_entry_id: string;
    account_id: string;
    debit_amount: number;
    credit_amount: number;
    tax_category: string | null;
    tax_rate: number | null;
    journal_entries: { description: string | null };
  };
  const [lines, ex] = await Promise.all([
    fetchAllRows<L>((from, to) =>
      db
        .from("journal_entry_lines")
        .select("journal_entry_id, account_id, debit_amount, credit_amount, tax_category, tax_rate, journal_entries!inner ( client_id, entry_date, description )")
        .eq("journal_entries.client_id", clientId)
        .gte("journal_entries.entry_date", start)
        .lte("journal_entries.entry_date", end)
        .in("account_id", accountIds)
        .range(from, to) as unknown as PromiseLike<{ data: L[] | null; error: { message: string } | null }>
    ),
    loadExclusiveEntries(db as unknown as SupabaseClient, clientId, start, end),
  ]);
  const isBatch = (d: string | null) => BATCH_PREFIXES.some((p) => (d ?? "").startsWith(p));
  return {
    posted: lines.some((l) => isBatch(l.journal_entries.description)),
    lines: lines
      .filter((l) => !isBatch(l.journal_entries.description))
      .map((l): PrivateUseSourceLine => {
        const code = normalizeTaxCategory(l.tax_category, "expenses", l.tax_rate);
        return {
          accountId: l.account_id,
          taxCategory: code,
          taxRate: taxCategoryInfo(code)?.rate ?? 0,
          exclusive: ex.purchase.has(l.journal_entry_id),
          amount: (Number(l.debit_amount) || 0) - (Number(l.credit_amount) || 0),
        };
      }),
  };
}

async function computeBatch(db: Db, clientId: string, fiscalYear: PeriodKey) {
  const { start, end } = await fiscalRange(db, clientId, fiscalYear);
  const ratesMap = await getAllocationRates(clientId, fiscalYear);
  // 0% は画面で「未設定」と同じ扱い（空欄にすると0%で保存される）。全額を私用として振り替えてしまわないよう除く
  const ids = Object.keys(ratesMap).filter((id) => ratesMap[id].business_ratio > 0);
  const ratios = Object.fromEntries(ids.map((id) => [id, ratesMap[id].business_ratio]));
  const { lines, posted } = ids.length ? await loadSourceLines(db, clientId, start, end, ids) : { lines: [], posted: false };
  const adj = buildPrivateUseAdjustment(lines, ratios);

  const { data: accs } = ids.length ? await db.from("accounts").select("id, code, name").in("id", ids) : { data: [] };
  const accMap = new Map((accs ?? []).map((a) => [a.id as string, a]));
  // 画面には科目ごとにまとめて出す（税区分・経理方式の違いは仕訳で分ける）
  const byAccount = new Map<string, BatchAllocationRow>();
  for (const g of adj.groups) {
    const a = accMap.get(g.accountId);
    const r = byAccount.get(g.accountId) ?? {
      account_id: g.accountId,
      code: (a?.code as string) ?? "",
      name: (a?.name as string) ?? "",
      ratio: g.ratio,
      total: 0,
      business: 0,
      private: 0,
    };
    r.total += g.total;
    r.business += g.business;
    r.private += g.private;
    byAccount.set(g.accountId, r);
  }
  const rows = [...byAccount.values()].sort((a, b) => a.code.localeCompare(b.code));
  return { adj, rows, start, end, posted, ratesMap };
}

// 期末一括按分のプレビュー（対象年度の科目別 期中合計と按分額）
export async function getBatchAllocationPreview(clientId: string, fiscalYear: PeriodKey): Promise<BatchAllocationPreview> {
  await assertClientAccess(clientId);
  const db = await createServerSupabaseClient();
  const { adj, rows, start, end, posted } = await computeBatch(db, clientId, fiscalYear);
  return { rows, inputTax: adj.inputTax, transfer: adj.transfer, period: { startDate: start, endDate: end }, posted };
}

export interface AllocationReportRow {
  account_id: string;
  code: string;
  name: string;
  ratio: number;
  total: number;     // 期中の実績合計
  business: number;  // 事業分
  private: number;   // 私用分
  note: string | null; // 按分根拠
}

// 実績集計レポート：対象年度の実際の仕訳から科目別に総額/事業分/私用分を集計
export async function getAllocationReport(clientId: string, fiscalYear: PeriodKey): Promise<AllocationReportRow[]> {
  await assertClientAccess(clientId);
  const db = await createServerSupabaseClient();
  const { rows, ratesMap } = await computeBatch(db, clientId, fiscalYear);
  return rows
    .filter((r) => r.ratio > 0)
    .map((r) => ({ ...r, note: ratesMap[r.account_id]?.basis_note ?? null }));
}

/**
 * 期末一括按分の実行（私用分を振替先へ一括振替する調整仕訳を、期末日付の下書きで作る）。
 *   (借)振替先 / (貸)各経費（元の仕訳と同じ税区分）
 *   税抜経理の仕訳から来た分は (貸)仮払消費税 も立てる。税込経理の分とは仕訳を分ける
 *   （同じ仕訳に仮払消費税の行があると、税込の行まで税抜として消費税を計算してしまうため）
 */
export async function runBatchAllocation(
  clientId: string,
  fiscalYear: PeriodKey,
  destinationAccountId?: string | null
): Promise<{ count: number }> {
  await assertClientAccess(clientId);
  const db = await createServerSupabaseClient();
  const { adj, rows, end, posted } = await computeBatch(db, clientId, fiscalYear);
  if (posted) throw new Error("この年度の期末一括按分は既に作成済みです。");
  if (adj.groups.length === 0) throw new Error("按分対象の実績がありません");

  const dest = await resolveDestination(db, clientId, destinationAccountId);
  const entityType = await entityTypeOf(db, clientId);
  let inputTaxAccountId: string | null = null;
  if (adj.inputTax > 0) {
    const { data: rowsTax } = await db
      .from("accounts")
      .select("id, client_id")
      .or(`client_id.eq.${clientId},client_id.is.null`)
      .eq("is_active", true)
      .eq("name", "仮払消費税");
    const sorted = (rowsTax ?? []).sort((a, b) => (a.client_id ? 0 : 1) - (b.client_id ? 0 : 1));
    inputTaxAccountId = (sorted[0]?.id as string) ?? null;
    if (!inputTaxAccountId) throw new Error("「仮払消費税」科目が見つかりません。");
  }

  const desc = batchDescription(fiscalYear, entityType);
  const createdBy = await currentUserId(db);
  for (const exclusive of [false, true]) {
    const groups = adj.groups.filter((g) => g.exclusive === exclusive);
    if (groups.length === 0) continue;
    const tax = groups.reduce((s, g) => s + g.privateTax, 0);
    const transfer = groups.reduce((s, g) => s + g.private, 0) + tax;
    const lines = [
      { account_id: dest.id, debit_amount: transfer, credit_amount: 0, tax_category: destinationTaxCategory(dest) },
      ...groups.map((g) => ({ account_id: g.accountId, debit_amount: 0, credit_amount: g.private, tax_category: g.taxCategory })),
      ...(tax > 0 && inputTaxAccountId ? [{ account_id: inputTaxAccountId, debit_amount: 0, credit_amount: tax }] : []),
    ];
    await createJournalEntry(
      {
        client_id: clientId,
        entry_date: end,
        description: exclusive && adj.groups.some((g) => !g.exclusive) ? `${desc}（税抜経理分）` : desc,
        status: "draft",
        source: "manual",
        created_by: createdBy,
      },
      lines
    );
  }
  return { count: rows.length };
}
