"use server";

import {
  createServerSupabaseClient,
  createAdminSupabaseClient,
} from "@/lib/supabase";
import type {
  Loan,
  LoanInput,
  LoanRepayment,
  LoanRepaymentInput,
} from "@/types/index";

type DbRow = Record<string, unknown>;

function rowToLoan(r: DbRow): Loan {
  return {
    id: r.id as string,
    client_id: r.client_id as string,
    lender_name: (r.lender_name as string) ?? "",
    loan_type: (r.loan_type as Loan["loan_type"]) ?? "borrowing",
    principal: (r.principal as number) ?? 0,
    current_balance: (r.current_balance as number) ?? 0,
    interest_rate: (r.interest_rate as number) ?? null,
    borrowed_date: (r.borrowed_date as string) ?? null,
    liability_account_id: (r.liability_account_id as string) ?? null,
    status: (r.status as Loan["status"]) ?? "active",
    memo: (r.memo as string) ?? null,
    created_at: (r.created_at as string) ?? "",
  };
}

function rowToRepayment(r: DbRow): LoanRepayment {
  return {
    id: r.id as string,
    loan_id: r.loan_id as string,
    client_id: r.client_id as string,
    repayment_date: (r.repayment_date as string) ?? "",
    principal_amount: (r.principal_amount as number) ?? 0,
    interest_amount: (r.interest_amount as number) ?? 0,
    payment_account_id: (r.payment_account_id as string) ?? null,
    interest_account_id: (r.interest_account_id as string) ?? null,
    journal_entry_id: (r.journal_entry_id as string) ?? null,
    status: (r.status as LoanRepayment["status"]) ?? "pending",
    memo: (r.memo as string) ?? null,
    created_at: (r.created_at as string) ?? "",
  };
}

// ---------------------------------------------------------------------------
// 借入金 CRUD
// ---------------------------------------------------------------------------

/** 借入金の一覧を取得（新しい順） */
export async function getLoans(clientId: string): Promise<Loan[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("loans")
    .select("*")
    .eq("client_id", clientId)
    .order("status")
    .order("borrowed_date", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToLoan);
}

export async function createLoan(input: LoanInput): Promise<Loan> {
  const supabase = await createServerSupabaseClient();
  const principal = input.principal ?? 0;
  const balance = input.current_balance ?? principal;
  const { data, error } = await supabase
    .from("loans")
    .insert({
      client_id: input.client_id,
      lender_name: input.lender_name,
      loan_type: input.loan_type,
      principal,
      current_balance: balance,
      interest_rate: input.interest_rate,
      borrowed_date: input.borrowed_date,
      liability_account_id: input.liability_account_id,
      memo: input.memo,
      status: balance <= 0 ? "completed" : "active",
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return rowToLoan(data as DbRow);
}

export async function updateLoan(
  id: string,
  input: Partial<LoanInput>
): Promise<Loan> {
  const supabase = await createServerSupabaseClient();
  const patch: Record<string, unknown> = { ...input };
  // current_balance を直接指定した場合は status を整合させる
  if (typeof input.current_balance === "number") {
    patch.status = input.current_balance <= 0 ? "completed" : "active";
  }
  const { data, error } = await supabase
    .from("loans")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return rowToLoan(data as DbRow);
}

export async function deleteLoan(id: string): Promise<void> {
  const supabase = await createServerSupabaseClient();
  // 返済記録に紐づく生成済み仕訳も削除
  const { data: reps } = await supabase
    .from("loan_repayments")
    .select("journal_entry_id")
    .eq("loan_id", id);
  const journalIds = (reps ?? [])
    .map((r) => (r as DbRow).journal_entry_id as string | null)
    .filter((v): v is string => Boolean(v));
  if (journalIds.length > 0) {
    const admin = createAdminSupabaseClient();
    await admin.from("journal_entries").delete().in("id", journalIds);
  }
  const { error } = await supabase.from("loans").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// 返済記録 CRUD
// ---------------------------------------------------------------------------

/** 指定した借入の返済記録一覧（新しい順） */
export async function getRepayments(loanId: string): Promise<LoanRepayment[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("loan_repayments")
    .select("*")
    .eq("loan_id", loanId)
    .order("repayment_date", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToRepayment);
}

export async function createRepayment(
  input: LoanRepaymentInput
): Promise<LoanRepayment> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("loan_repayments")
    .insert({
      loan_id: input.loan_id,
      client_id: input.client_id,
      repayment_date: input.repayment_date,
      principal_amount: input.principal_amount ?? 0,
      interest_amount: input.interest_amount ?? 0,
      payment_account_id: input.payment_account_id,
      interest_account_id: input.interest_account_id,
      memo: input.memo,
      status: "pending",
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return rowToRepayment(data as DbRow);
}

export async function updateRepayment(
  id: string,
  input: Partial<LoanRepaymentInput>
): Promise<LoanRepayment> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("loan_repayments")
    .update({ ...input })
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return rowToRepayment(data as DbRow);
}

export async function deleteRepayment(id: string): Promise<void> {
  const supabase = await createServerSupabaseClient();
  // 仕訳化済みなら取り消してから削除（残高を戻す）
  const { data: rec } = await supabase
    .from("loan_repayments")
    .select("status")
    .eq("id", id)
    .single();
  if ((rec as DbRow | null)?.status === "journalized") {
    await unjournalizeRepayment(id);
  }
  const { error } = await supabase
    .from("loan_repayments")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// 仕訳生成
// ---------------------------------------------------------------------------

type AccountLite = { id: string; name: string; is_default: boolean };

// 名称キーワードから科目を解決（顧問先固有を優先）
function findAccount(accounts: AccountLite[], keywords: string[]): string | null {
  for (const kw of keywords) {
    const hit = accounts.find((a) => a.name.includes(kw));
    if (hit) return hit.id;
  }
  return null;
}

/**
 * 返済記録から返済仕訳を生成する。
 *   借方 借入金/役員借入金 … 元金返済額
 *   借方 支払利息         … 利息額
 *   貸方 普通預金/現金     … 返済合計（元金＋利息）
 * 併せて loans.current_balance を元金分だけ減らす（0以下なら completed）。
 */
export async function journalizeRepayment(id: string): Promise<string> {
  const admin = createAdminSupabaseClient();

  const { data: repRaw, error: repErr } = await admin
    .from("loan_repayments")
    .select("*")
    .eq("id", id)
    .single();
  if (repErr || !repRaw) throw new Error("返済記録が見つかりません");
  const rep = rowToRepayment(repRaw as DbRow);

  if (rep.status === "journalized" && rep.journal_entry_id) {
    throw new Error("この返済は既に仕訳化されています");
  }

  const { data: loanRaw, error: loanErr } = await admin
    .from("loans")
    .select("*")
    .eq("id", rep.loan_id)
    .single();
  if (loanErr || !loanRaw) throw new Error("借入金が見つかりません");
  const loan = rowToLoan(loanRaw as DbRow);

  const principal = rep.principal_amount;
  const interest = rep.interest_amount;
  const total = principal + interest;
  if (total <= 0) throw new Error("返済額が0円のため仕訳化できません");

  // 科目を取得（顧問先固有 + デフォルト科目）
  const { data: acctData } = await admin
    .from("accounts")
    .select("id, name, is_default, client_id")
    .or(`client_id.eq.${rep.client_id},is_default.eq.true`)
    .eq("is_active", true);
  const accounts: AccountLite[] = (acctData ?? [])
    .map((a) => ({
      id: (a as DbRow).id as string,
      name: (a as DbRow).name as string,
      is_default: Boolean((a as DbRow).is_default),
    }))
    // 顧問先固有を優先（is_default=false を前に）
    .sort((a, b) => Number(a.is_default) - Number(b.is_default));

  const liabilityAccountId =
    loan.liability_account_id ??
    (loan.loan_type === "officer"
      ? findAccount(accounts, ["役員借入金", "役員からの借入金"])
      : findAccount(accounts, [
          "長期借入金",
          "短期借入金",
          "借入金",
        ]));
  const interestAccountId =
    rep.interest_account_id ?? findAccount(accounts, ["支払利息", "利息"]);
  const paymentAccountId =
    rep.payment_account_id ??
    findAccount(accounts, ["普通預金", "当座預金", "現金"]);

  if (!liabilityAccountId) {
    throw new Error(
      loan.loan_type === "officer"
        ? "「役員借入金」科目が見つかりません。勘定科目に登録してください。"
        : "「借入金」科目が見つかりません。勘定科目に登録してください。"
    );
  }
  if (!paymentAccountId) {
    throw new Error("支払元科目（普通預金/現金）が見つかりません。");
  }
  if (interest > 0 && !interestAccountId) {
    throw new Error("「支払利息」科目が見つかりません。勘定科目に登録してください。");
  }

  const { data: entry, error: entryError } = await admin
    .from("journal_entries")
    .insert({
      client_id: rep.client_id,
      entry_date: rep.repayment_date,
      description: `借入金返済 ${loan.lender_name}`,
      status: "draft",
      source: "manual",
      created_by: rep.client_id,
      needs_review: false,
    })
    .select()
    .single();
  if (entryError) throw new Error(`仕訳作成エラー: ${entryError.message}`);

  type LineInsert = {
    journal_entry_id: string;
    account_id: string;
    debit_amount: number;
    credit_amount: number;
    sort_order: number;
  };
  const lines: LineInsert[] = [];
  let sort = 0;
  if (principal > 0) {
    lines.push({
      journal_entry_id: entry.id,
      account_id: liabilityAccountId,
      debit_amount: principal,
      credit_amount: 0,
      sort_order: sort++,
    });
  }
  if (interest > 0 && interestAccountId) {
    lines.push({
      journal_entry_id: entry.id,
      account_id: interestAccountId,
      debit_amount: interest,
      credit_amount: 0,
      sort_order: sort++,
    });
  }
  lines.push({
    journal_entry_id: entry.id,
    account_id: paymentAccountId,
    debit_amount: 0,
    credit_amount: total,
    sort_order: sort++,
  });

  const { error: linesError } = await admin
    .from("journal_entry_lines")
    .insert(lines);
  if (linesError) throw new Error(`仕訳明細作成エラー: ${linesError.message}`);

  const { error: updErr } = await admin
    .from("loan_repayments")
    .update({
      journal_entry_id: entry.id,
      status: "journalized",
      interest_account_id: interestAccountId,
      payment_account_id: paymentAccountId,
    })
    .eq("id", id);
  if (updErr) throw new Error(updErr.message);

  // 残高を元金分だけ減らす
  const newBalance = Math.max(0, loan.current_balance - principal);
  const { error: loanUpdErr } = await admin
    .from("loans")
    .update({
      current_balance: newBalance,
      status: newBalance <= 0 ? "completed" : "active",
    })
    .eq("id", loan.id);
  if (loanUpdErr) throw new Error(loanUpdErr.message);

  return entry.id as string;
}

/** 仕訳化を取り消す（生成済み仕訳を削除し、残高を戻して pending に戻す） */
export async function unjournalizeRepayment(id: string): Promise<void> {
  const admin = createAdminSupabaseClient();
  const { data: repRaw } = await admin
    .from("loan_repayments")
    .select("*")
    .eq("id", id)
    .single();
  if (!repRaw) return;
  const rep = rowToRepayment(repRaw as DbRow);

  if (rep.journal_entry_id) {
    await admin.from("journal_entries").delete().eq("id", rep.journal_entry_id);
  }

  // 残高を元金分だけ戻す
  const { data: loanRaw } = await admin
    .from("loans")
    .select("*")
    .eq("id", rep.loan_id)
    .single();
  if (loanRaw) {
    const loan = rowToLoan(loanRaw as DbRow);
    const restored = loan.current_balance + rep.principal_amount;
    await admin
      .from("loans")
      .update({
        current_balance: restored,
        status: restored <= 0 ? "completed" : "active",
      })
      .eq("id", loan.id);
  }

  const { error } = await admin
    .from("loan_repayments")
    .update({ journal_entry_id: null, status: "pending" })
    .eq("id", id);
  if (error) throw new Error(error.message);
}
