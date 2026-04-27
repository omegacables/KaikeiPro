"use server";

import { createServerSupabaseClient, createAdminSupabaseClient } from "@/lib/supabase";
import type { Database } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";

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
