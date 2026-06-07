"use server";

import { createServerSupabaseClient, createAdminSupabaseClient } from "@/lib/supabase";
import type { Database } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getFiscalPeriod } from "@/lib/fiscal";
import { deferToBusinessDay } from "@/lib/japanese-holidays";

type ClientRow = Database["public"]["Tables"]["clients"]["Row"];
type ClientInsert = Database["public"]["Tables"]["clients"]["Insert"];
type ClientUpdate = Database["public"]["Tables"]["clients"]["Update"];

// Super admin uses admin client (bypasses RLS) for read operations
async function getClientForQuery(): Promise<SupabaseClient<Database>> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("認証が必要です");

  const { data: superAdmin } = await supabase
    .from("super_admins")
    .select("id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .single();

  if (superAdmin) {
    return createAdminSupabaseClient();
  }
  return supabase;
}

export async function getClients() {
  const supabase = await getClientForQuery();
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("is_active", true)
    .order("name");

  if (error) throw new Error(error.message);
  return data as ClientRow[];
}

export async function getClient(id: string) {
  const supabase = await getClientForQuery();
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .eq("id", id)
    .single();

  if (error) throw new Error(error.message);
  return data as ClientRow;
}

export async function createClient(input: Omit<ClientInsert, "firm_id"> & { firm_id?: string }) {
  const supabase = await createServerSupabaseClient();
  const queryClient = await getClientForQuery();

  // Auto-detect firm_id if not provided
  let firmId: string | null | undefined = input.firm_id;
  if (!firmId) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("認証が必要です");

    const { data: member } = await supabase
      .from("firm_members")
      .select("firm_id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .single();

    // 事務所未所属（super_admin等）の場合はfirm_id=nullで登録
    firmId = member?.firm_id ?? null;
  }

  const { data, error } = await queryClient
    .from("clients")
    .insert({ ...input, firm_id: firmId })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as ClientRow;
}

export async function updateClient(id: string, input: ClientUpdate) {
  // Verify the caller is authenticated
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("認証が必要です");

  // Use admin client to bypass RLS (client users cannot update clients table via RLS)
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("clients")
    .update(input)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data as ClientRow;
}

export async function deleteClient(id: string) {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("clients")
    .update({ is_active: false })
    .eq("id", id);

  if (error) throw new Error(error.message);
}

export async function assignClientToFirm(clientId: string, firmId: string | null) {
  return updateClient(clientId, { firm_id: firmId });
}

export async function getClientUsers(clientId: string) {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("client_users")
    .select("id, name, email, is_active")
    .eq("client_id", clientId)
    .order("name");

  if (error) throw new Error(error.message);
  return data;
}

export async function updateClientUser(
  id: string,
  input: { name?: string; is_active?: boolean }
) {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("client_users")
    .update(input)
    .eq("id", id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function getClientSummaries() {
  const supabase = await getClientForQuery();

  const { data: clients, error } = await supabase
    .from("clients")
    .select("*")
    .eq("is_active", true)
    .order("name");

  if (error) throw new Error(error.message);
  if (!clients) return [];

  // Fetch aggregated counts for each client
  const summaries = await Promise.all(
    clients.map(async (client) => {
      const [receiptsRes, commentsRes, journalsRes, periodsRes, needsReviewRes] =
        await Promise.all([
          supabase
            .from("receipts")
            .select("id", { count: "exact", head: true })
            .eq("client_id", client.id)
            .in("status", ["uploaded", "processing", "ocr_done"]),
          supabase
            .from("comments")
            .select("id", { count: "exact", head: true })
            .eq("status", "open")
            .in(
              "receipt_id",
              (
                await supabase
                  .from("receipts")
                  .select("id")
                  .eq("client_id", client.id)
              ).data?.map((r) => r.id) ?? []
            ),
          supabase
            .from("journal_entries")
            .select("id", { count: "exact", head: true })
            .eq("client_id", client.id)
            .eq("status", "draft")
            .eq("source", "ai"),
          supabase
            .from("submission_periods")
            .select("*")
            .eq("client_id", client.id)
            .order("due_date", { ascending: false })
            .limit(1),
          supabase
            .from("journal_entries")
            .select("id", { count: "exact", head: true })
            .eq("client_id", client.id)
            .eq("needs_review", true),
        ]);

      const pendingReceipts = receiptsRes.count ?? 0;
      const unansweredQuestions = commentsRes.count ?? 0;
      const aiPendingReviews = journalsRes.count ?? 0;
      const needsReviewCount = needsReviewRes.count ?? 0;
      const latestPeriod = periodsRes.data?.[0];

      let status: "good" | "warning" | "overdue" = "good";
      let submissionProgress = 0;

      if (latestPeriod) {
        submissionProgress =
          latestPeriod.status === "completed"
            ? 100
            : latestPeriod.status === "submitted"
              ? 80
              : latestPeriod.status === "overdue"
                ? 10
                : 50;
        if (latestPeriod.status === "overdue") status = "overdue";
        else if (pendingReceipts > 5 || unansweredQuestions > 2 || needsReviewCount > 0)
          status = "warning";
      }

      return {
        client,
        status,
        pending_receipts: pendingReceipts,
        unanswered_questions: unansweredQuestions,
        ai_pending_reviews: aiPendingReviews,
        needs_review_count: needsReviewCount,
        submission_progress: submissionProgress,
      };
    })
  );

  return summaries;
}

// ダッシュボード用：税務カレンダー。
// ① 顧問先ごとの決算日・申告期限（期首月から算出。決算/申告の2ヶ月前から）
// ② 事務所共通の定例税務期限（源泉所得税の納期特例・法定調書・確定申告 等。40日前から）
// を統合し、期日順に返す。
export type TaxCalendarItem = {
  id: string;
  title: string;
  date: string; // 期日 YYYY-MM-DD
  days_until: number; // 残り日数（0=当日）
  kind: "settlement" | "filing" | "fixed";
  note?: string;
  client_id?: string;
  client_name?: string;
};

const CLIENT_ALERT_DAYS = 62; // 決算・申告: 約2ヶ月前から
const FIXED_ALERT_DAYS = 40; // 定例期限: 約40日前から

// 事務所共通の定例税務期限（毎年同じ月日）。
const FIXED_TAX_EVENTS: { md: string; title: string; note?: string }[] = [
  { md: "01-20", title: "源泉所得税 納期特例 納付期限", note: "7〜12月分" },
  { md: "01-31", title: "法定調書・給与支払報告書 提出期限", note: "年末調整関連" },
  { md: "01-31", title: "償却資産申告 期限" },
  { md: "03-15", title: "所得税 確定申告 期限" },
  { md: "03-31", title: "個人事業者 消費税 確定申告 期限" },
  { md: "07-10", title: "源泉所得税 納期特例 納付期限", note: "1〜6月分" },
  { md: "07-10", title: "労働保険 年度更新 期限" },
];

function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function fmtYmd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

export async function getTaxCalendar(): Promise<TaxCalendarItem[]> {
  const supabase = await getClientForQuery();

  const { data: clients, error } = await supabase
    .from("clients")
    .select("id, name, fiscal_year_start_month")
    .eq("is_active", true)
    .order("name");
  if (error) throw new Error(error.message);

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const items: TaxCalendarItem[] = [];

  // ① 顧問先ごとの決算・申告
  for (const c of clients ?? []) {
    const startMonth = (c as { fiscal_year_start_month?: number }).fiscal_year_start_month;
    const { startDate, endDate } = getFiscalPeriod(startMonth, now.getFullYear(), now.getMonth() + 1);

    // 次回決算日（本日が属する会計年度の期末日）
    const settlement = parseYmd(endDate);
    const dToSettlement = daysBetween(today, settlement);
    if (dToSettlement >= 0 && dToSettlement <= CLIENT_ALERT_DAYS) {
      items.push({
        id: `settlement-${c.id}`,
        title: "決算",
        date: endDate,
        days_until: dToSettlement,
        kind: "settlement",
        client_id: c.id,
        client_name: c.name,
      });
    }

    // 申告・納付期限 = 直近に終了した会計年度の期末日 + 2ヶ月（法人税等の原則）
    // 期限が土日祝・年末年始に当たる場合は翌営業日へ繰り延べ。
    const prevEnd = new Date(parseYmd(startDate));
    prevEnd.setDate(prevEnd.getDate() - 1); // 期首日の前日 = 前会計年度の期末日
    const filingRaw = new Date(prevEnd);
    filingRaw.setMonth(filingRaw.getMonth() + 2);
    const filing = deferToBusinessDay(filingRaw);
    const dToFiling = daysBetween(today, filing);
    if (dToFiling >= 0 && dToFiling <= CLIENT_ALERT_DAYS) {
      items.push({
        id: `filing-${c.id}`,
        title: "申告・納付期限",
        date: fmtYmd(filing),
        days_until: dToFiling,
        kind: "filing",
        note: `${fmtYmd(prevEnd)} 期末分`,
        client_id: c.id,
        client_name: c.name,
      });
    }
  }

  // ② 事務所共通の定例税務期限
  for (const ev of FIXED_TAX_EVENTS) {
    const [mm, dd] = ev.md.split("-").map(Number);
    // 期限が土日祝・年末年始に当たる場合は翌営業日へ繰り延べてから判定。
    let date = deferToBusinessDay(new Date(today.getFullYear(), mm - 1, dd));
    if (daysBetween(today, date) < 0) {
      date = deferToBusinessDay(new Date(today.getFullYear() + 1, mm - 1, dd)); // 過ぎていれば翌年
    }
    const dUntil = daysBetween(today, date);
    if (dUntil >= 0 && dUntil <= FIXED_ALERT_DAYS) {
      items.push({
        id: `fixed-${ev.md}-${ev.title}`,
        title: ev.title,
        date: fmtYmd(date),
        days_until: dUntil,
        kind: "fixed",
        note: ev.note,
      });
    }
  }

  items.sort((a, b) => a.date.localeCompare(b.date) || a.days_until - b.days_until);
  return items;
}
