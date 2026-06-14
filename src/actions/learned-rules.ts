"use server";

// 仕訳の学習機能。
// 既存の ai_journal_patterns テーブルを「取引先名/摘要キーワード（＋入出金の方向）→
// 勘定科目」のルールとして使う。人手で確定した仕訳から学習し（recordLearnedRule）、
// 次回以降のAI仕訳提案に反映する（lookupLearnedRules / listLearnedRulesForPrompt）。
//
// 設計メモ:
// - 勘定科目は UUID（account_id / counter_account_id）で保存（名前一致の脆さを回避）。
// - すべて RLS バウンドのクライアントを使用するため、client_id スコープで自動的に保護される。
// - テーブル/列が未マイグレーションでも本処理が落ちないよう、失敗時は握りつぶす。

import { createServerSupabaseClient } from "@/lib/supabase";
import { assertClientAccess } from "@/lib/authz";
import { toHalfWidth } from "@/lib/account-reading";

/** 取引先名/摘要を学習キーに正規化（全角→半角・trim・小文字・空白圧縮・80字まで）。
 *  ※ "use server" ファイル内のエクスポートは async である必要があるため、本関数は
 *  内部関数として保持する（外部で使う場合は lib 側に切り出すこと）。 */
function normalizeSignal(s: string | null | undefined): string {
  if (!s) return "";
  return toHalfWidth(s).trim().toLowerCase().replace(/\s+/g, " ").slice(0, 80);
}

export type LearnedRule = {
  id: string;
  vendorName: string | null;
  keyword: string | null;
  direction: string | null;
  accountId: string;
  counterAccountId: string | null;
  taxCategory: string | null;
  taxRate: number | null;
  confidence: number;
  usageCount: number;
};

type PatternRow = {
  id: string;
  vendor_name: string | null;
  keyword: string | null;
  direction: string | null;
  account_id: string;
  counter_account_id: string | null;
  tax_category: string | null;
  tax_rate: number | null;
  confidence: number;
  usage_count: number;
};

function toLearnedRule(r: PatternRow): LearnedRule {
  return {
    id: r.id,
    vendorName: r.vendor_name,
    keyword: r.keyword,
    direction: r.direction,
    accountId: r.account_id,
    counterAccountId: r.counter_account_id,
    taxCategory: r.tax_category,
    taxRate: r.tax_rate,
    confidence: r.confidence,
    usageCount: r.usage_count,
  };
}

export type RuleSignal = {
  vendor?: string | null;
  keyword?: string | null;
  direction?: string | null;
};

/**
 * 学習ルールを検索。取引先（vendor）一致を優先し、なければ摘要（keyword）部分一致。
 * direction が指定されていれば、ルールの direction が異なるものは除外（同一取引先でも
 * 入出金で借貸が逆になるため）。一致が無ければ空配列。
 */
export async function lookupLearnedRules(
  clientId: string,
  signal: RuleSignal
): Promise<LearnedRule[]> {
  try {
    const vendor = normalizeSignal(signal.vendor);
    const keyword = normalizeSignal(signal.keyword);
    if (!vendor && !keyword) return [];

    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase
      .from("ai_journal_patterns")
      .select(
        "id, vendor_name, keyword, direction, account_id, counter_account_id, tax_category, tax_rate, confidence, usage_count"
      )
      .eq("client_id", clientId)
      .order("usage_count", { ascending: false })
      .limit(300);
    if (error || !data) return [];

    const dir = signal.direction ?? null;
    const scored = (data as PatternRow[])
      .map((r) => {
        if (dir && r.direction && r.direction !== dir) return null;
        const rv = normalizeSignal(r.vendor_name);
        const rk = normalizeSignal(r.keyword);
        let score = 0;
        if (vendor && rv) {
          if (rv === vendor) score = 100;
          else if (vendor.includes(rv) || rv.includes(vendor)) score = 60;
        }
        if (!score && keyword && rk) {
          if (rk === keyword) score = 50;
          else if (keyword.includes(rk) || rk.includes(keyword)) score = 30;
        }
        if (!score) return null;
        return { r, score: score + Math.min(r.usage_count, 20) };
      })
      .filter((x): x is { r: PatternRow; score: number } => x !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    return scored.map((x) => toLearnedRule(x.r));
  } catch {
    return [];
  }
}

/**
 * 人手で確定した仕訳から学習ルールを記録/強化する（ベストエフォート）。
 * 既存の一致ルールがあれば usage_count/confidence を更新、無ければ新規作成。
 */
export async function recordLearnedRule(
  clientId: string,
  input: {
    vendor?: string | null;
    keyword?: string | null;
    direction?: string | null;
    accountId: string;
    counterAccountId?: string | null;
    taxCategory?: string | null;
    taxRate?: number | null;
  }
): Promise<void> {
  try {
    if (!clientId || !input.accountId) return;
    const vendor = normalizeSignal(input.vendor);
    const keyword = normalizeSignal(input.keyword);
    if (!vendor && !keyword) return;

    const supabase = await createServerSupabaseClient();

    // 同一クライアント・同一主科目で、同じ signal/direction のルールを探す
    const { data: existingRows } = await supabase
      .from("ai_journal_patterns")
      .select("id, usage_count, confidence, vendor_name, keyword, direction")
      .eq("client_id", clientId)
      .eq("account_id", input.accountId)
      .limit(200);

    const dir = input.direction ?? null;
    const match = (existingRows as PatternRow[] | null)?.find((r) => {
      if ((r.direction ?? null) !== dir) return false;
      if (vendor) return normalizeSignal(r.vendor_name) === vendor;
      return normalizeSignal(r.keyword) === keyword;
    });

    const now = new Date().toISOString();

    if (match) {
      await supabase
        .from("ai_journal_patterns")
        .update({
          usage_count: (match.usage_count ?? 0) + 1,
          confidence: Math.min(1, (match.confidence ?? 0) + 0.1),
          last_used_at: now,
          counter_account_id: input.counterAccountId ?? undefined,
          tax_category: input.taxCategory ?? undefined,
          tax_rate: input.taxRate ?? undefined,
        })
        .eq("id", match.id);
    } else {
      await supabase.from("ai_journal_patterns").insert({
        client_id: clientId,
        vendor_name: vendor || null,
        keyword: keyword || null,
        direction: dir,
        account_id: input.accountId,
        counter_account_id: input.counterAccountId ?? null,
        tax_category: input.taxCategory ?? null,
        tax_rate: input.taxRate ?? null,
        confidence: 0.5,
        usage_count: 1,
        last_used_at: now,
      });
    }
  } catch {
    // 学習の失敗は本処理に影響させない
  }
}

export type LearnedRuleForPrompt = {
  signal: string;
  direction: string | null;
  debit: { code: string; name: string } | null;
  credit: { code: string; name: string } | null;
  taxCategory: string | null;
  usageCount: number;
};

/**
 * プロンプト埋め込み用に、学習ルールを科目コード/名称付きで取得（使用回数の多い順）。
 * AI仕訳（銀行CSV等）のバイアスヒントに使う。
 */
export async function listLearnedRulesForPrompt(
  clientId: string,
  limit = 30
): Promise<LearnedRuleForPrompt[]> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase
      .from("ai_journal_patterns")
      .select(
        "vendor_name, keyword, direction, account_id, counter_account_id, tax_category, usage_count"
      )
      .eq("client_id", clientId)
      .order("usage_count", { ascending: false })
      .limit(limit);
    if (error || !data || data.length === 0) return [];

    const ids = Array.from(
      new Set(
        data.flatMap((r) => [r.account_id, r.counter_account_id]).filter((x): x is string => !!x)
      )
    );
    const { data: accs } = await supabase
      .from("accounts")
      .select("id, code, name")
      .in("id", ids);
    const byId = new Map((accs ?? []).map((a) => [a.id, { code: a.code, name: a.name }]));

    return data.map((r) => ({
      signal: r.vendor_name || r.keyword || "",
      direction: r.direction,
      debit: r.account_id ? byId.get(r.account_id) ?? null : null,
      credit: r.counter_account_id ? byId.get(r.counter_account_id) ?? null : null,
      taxCategory: r.tax_category,
      usageCount: r.usage_count,
    }));
  } catch {
    return [];
  }
}

// ── 管理UI用 ────────────────────────────────────────────────────────────────

export type LearnedRuleListItem = {
  id: string;
  signal: string;
  direction: string | null;
  accountName: string;
  counterAccountName: string | null;
  taxCategory: string | null;
  usageCount: number;
  confidence: number;
  lastUsedAt: string | null;
};

/** 学習ルール一覧（管理画面用）。 */
export async function listLearnedRules(clientId: string): Promise<LearnedRuleListItem[]> {
  await assertClientAccess(clientId);
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("ai_journal_patterns")
    .select(
      "id, vendor_name, keyword, direction, account_id, counter_account_id, tax_category, usage_count, confidence, last_used_at"
    )
    .eq("client_id", clientId)
    .order("usage_count", { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) return [];

  const ids = Array.from(
    new Set(
      data.flatMap((r) => [r.account_id, r.counter_account_id]).filter((x): x is string => !!x)
    )
  );
  const { data: accs } = await supabase.from("accounts").select("id, name").in("id", ids);
  const nameById = new Map((accs ?? []).map((a) => [a.id, a.name]));

  return data.map((r) => ({
    id: r.id,
    signal: r.vendor_name || r.keyword || "",
    direction: r.direction,
    accountName: nameById.get(r.account_id) ?? "(不明)",
    counterAccountName: r.counter_account_id ? nameById.get(r.counter_account_id) ?? null : null,
    taxCategory: r.tax_category,
    usageCount: r.usage_count,
    confidence: r.confidence,
    lastUsedAt: r.last_used_at,
  }));
}

/** 学習ルールを削除（RLS により自分のクライアントのもののみ）。 */
export async function deleteLearnedRule(id: string): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("認証が必要です");
  const { error } = await supabase.from("ai_journal_patterns").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
