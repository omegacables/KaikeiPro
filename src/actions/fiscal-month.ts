"use server";

import { createServerSupabaseClient, createAdminSupabaseClient } from "@/lib/supabase";
import { assertClientAccess } from "@/lib/authz";
import { transitionalPeriodEnd } from "@/lib/fiscal";

// 決算月（期首月）の変更。
// 税理士（事務所メンバー）だけでなく顧問先ユーザーも、自社の決算月を変えられる。
// 変更のたびに履歴（fiscal_month_changes）を残し、株主総会議事録・異動届出書の控えなど
// 根拠書類（company_documents）を紐づける。

export interface FiscalMonthChange {
  id: string;
  old_start_month: number;
  new_start_month: number;
  resolution_date: string | null;
  old_period_end: string | null;
  new_period_end: string | null;
  memo: string | null;
  changed_by_name: string | null;
  created_at: string;
  documents: { id: string; title: string; doc_type: string; file_path: string }[];
}

export interface FiscalMonthOverview {
  startMonth: number;
  /** 締めていない当期（決算月を変えると期末日が付け替わる年度） */
  openYear: { id: string; start_date: string; end_date: string } | null;
  /** 締めた（closed / locked）年度の数 */
  closedYearCount: number;
  history: FiscalMonthChange[];
  /** 履歴の表（移行ファイル060）が本番DBにあるか */
  historyAvailable: boolean;
}

// 表がまだ無いとき（移行ファイル未適用）のエラーか
function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || /does not exist|schema cache/i.test(error.message ?? "");
}

async function getOpenYear(clientId: string) {
  const admin = createAdminSupabaseClient();
  const { data, error } = await admin
    .from("fiscal_years")
    .select("id, start_date, end_date")
    .eq("client_id", clientId)
    .eq("status", "open")
    .order("end_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function getFiscalMonthOverview(clientId: string): Promise<FiscalMonthOverview> {
  await assertClientAccess(clientId);
  const admin = createAdminSupabaseClient();

  const { data: client, error: clientError } = await admin
    .from("clients")
    .select("fiscal_year_start_month")
    .eq("id", clientId)
    .single();
  if (clientError) throw new Error(clientError.message);

  const openYear = await getOpenYear(clientId);

  const { count: closedYearCount } = await admin
    .from("fiscal_years")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .in("status", ["closed", "locked"]);

  const { data: rows, error: historyError } = await admin
    .from("fiscal_month_changes")
    .select("*")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false });

  let history: FiscalMonthChange[] = [];
  const historyAvailable = !isMissingTable(historyError);
  if (historyError && historyAvailable) throw new Error(historyError.message);

  if (rows && rows.length > 0) {
    const docIds = [...new Set(rows.flatMap((r) => r.document_ids ?? []))];
    const docsById = new Map<string, FiscalMonthChange["documents"][number]>();
    if (docIds.length > 0) {
      const { data: docs } = await admin
        .from("company_documents")
        .select("id, title, doc_type, file_path")
        .eq("client_id", clientId)
        .in("id", docIds);
      for (const d of docs ?? []) docsById.set(d.id, d);
    }
    history = rows.map((r) => ({
      id: r.id,
      old_start_month: r.old_start_month,
      new_start_month: r.new_start_month,
      resolution_date: r.resolution_date,
      old_period_end: r.old_period_end,
      new_period_end: r.new_period_end,
      memo: r.memo,
      changed_by_name: r.changed_by_name,
      created_at: r.created_at,
      // 書類を後から削除した場合は一覧から消える
      documents: (r.document_ids ?? []).flatMap((id) => docsById.get(id) ?? []),
    }));
  }

  return {
    startMonth: client.fiscal_year_start_month,
    openYear,
    closedYearCount: closedYearCount ?? 0,
    history,
    historyAvailable,
  };
}

export async function changeFiscalStartMonth(input: {
  clientId: string;
  newStartMonth: number;
  resolutionDate?: string | null;
  memo?: string | null;
  documentIds?: string[];
}): Promise<{ newPeriodEnd: string | null; historySaved: boolean }> {
  const { clientId } = input;
  await assertClientAccess(clientId);

  const newStartMonth = Number(input.newStartMonth);
  if (!Number.isInteger(newStartMonth) || newStartMonth < 1 || newStartMonth > 12) {
    throw new Error("決算月の指定が正しくありません");
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("認証が必要です");

  // 顧問先ユーザーは clients を RLS で更新できないため、確認済みの上でサービスロールを使う
  const admin = createAdminSupabaseClient();
  const { data: client, error: clientError } = await admin
    .from("clients")
    .select("fiscal_year_start_month")
    .eq("id", clientId)
    .single();
  if (clientError) throw new Error(clientError.message);
  const oldStartMonth = client.fiscal_year_start_month;
  if (oldStartMonth === newStartMonth) throw new Error("決算月が変わっていません");

  // 紐づける書類は、この会社のものだけに限る
  let documentIds: string[] = [];
  if (input.documentIds && input.documentIds.length > 0) {
    const { data: docs, error } = await admin
      .from("company_documents")
      .select("id")
      .eq("client_id", clientId)
      .in("id", input.documentIds);
    if (error) throw new Error(error.message);
    documentIds = (docs ?? []).map((d) => d.id);
  }

  // 締めていない当期は、期首日はそのままに期末日を新しい決算月へ付け替える（変則期間）
  const openYear = await getOpenYear(clientId);
  const newPeriodEnd = openYear ? transitionalPeriodEnd(openYear.start_date, newStartMonth) : null;

  const { error: updateError } = await admin
    .from("clients")
    .update({ fiscal_year_start_month: newStartMonth })
    .eq("id", clientId);
  if (updateError) throw new Error(updateError.message);

  if (openYear && newPeriodEnd && newPeriodEnd !== openYear.end_date) {
    const { error } = await admin
      .from("fiscal_years")
      .update({ end_date: newPeriodEnd })
      .eq("id", openYear.id)
      .eq("status", "open");
    if (error) {
      // 決算月だけ変わって当期が古いままにならないよう戻す
      await admin.from("clients").update({ fiscal_year_start_month: oldStartMonth }).eq("id", clientId);
      throw new Error(`会計年度の期末日を更新できませんでした: ${error.message}`);
    }
  }

  const { error: historyError } = await admin.from("fiscal_month_changes").insert({
    client_id: clientId,
    old_start_month: oldStartMonth,
    new_start_month: newStartMonth,
    resolution_date: input.resolutionDate || null,
    fiscal_year_id: openYear?.id ?? null,
    old_period_end: openYear?.end_date ?? null,
    new_period_end: newPeriodEnd,
    document_ids: documentIds,
    memo: input.memo?.trim() || null,
    changed_by: user.id,
    changed_by_name: (user.user_metadata?.name as string | undefined) || user.email || null,
  });
  if (historyError && !isMissingTable(historyError)) {
    console.error("決算月の変更履歴を保存できませんでした:", historyError.message);
  }

  return { newPeriodEnd, historySaved: !historyError };
}
