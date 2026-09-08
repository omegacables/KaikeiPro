"use server";

import {
  createServerSupabaseClient,
  createAdminSupabaseClient,
} from "@/lib/supabase";
import { assertClientAccess, resolveClientIdForRecord } from "@/lib/authz";
import { fetchAllRows } from "@/lib/fetch-all";
import {
  currentBalance,
  balanceAsOf,
  balanceByType,
  entryTypeLabel,
  buildJournalLines,
  generateRepaymentSchedule,
  reconcileLoanLedger,
  type RepaymentMethod,
  type ReconcileResult,
  type JournalLineForCheck,
} from "@/lib/loan-ledger";
import { fiscalRangeFromStartYear } from "@/lib/fiscal";
import type { Json } from "@/types/database";
import type {
  Loan,
  LoanInput,
  LoanEntry,
  LoanEntryInput,
  LoanEntryReceipt,
  LoanLedger,
  LoanDirection,
  LoanEntryType,
  LoanAiEvidence,
  StatutoryInterestRate,
  LoanRepaymentSchedule,
  LoanBreakdownReport,
  LoanBreakdownRow,
} from "@/types/index";

type DbRow = Record<string, unknown>;

function rowToLoan(r: DbRow): Loan {
  return {
    id: r.id as string,
    client_id: r.client_id as string,
    lender_name: (r.lender_name as string) ?? "",
    direction: (r.direction as LoanDirection) ?? "borrow",
    counterparty_kind: (r.counterparty_kind as Loan["counterparty_kind"]) ?? "institution",
    interest_rate: (r.interest_rate as number) ?? null,
    borrowed_date: (r.borrowed_date as string) ?? null,
    liability_account_id: (r.liability_account_id as string) ?? null,
    business_partner_id: (r.business_partner_id as string) ?? null,
    repayment_terms: (r.repayment_terms as string) ?? null,
    purpose: (r.purpose as string) ?? null,
    status: (r.status as Loan["status"]) ?? "active",
    memo: (r.memo as string) ?? null,
    created_at: (r.created_at as string) ?? "",
  };
}

function rowToEntry(r: DbRow): LoanEntry {
  return {
    id: r.id as string,
    loan_id: r.loan_id as string,
    client_id: r.client_id as string,
    entry_date: (r.entry_date as string) ?? "",
    entry_type: (r.entry_type as LoanEntryType) ?? "borrow",
    amount: (r.amount as number) ?? 0,
    signed_adjustment: (r.signed_adjustment as number) ?? null,
    expense_account_id: (r.expense_account_id as string) ?? null,
    payment_account_id: (r.payment_account_id as string) ?? null,
    journal_entry_id: (r.journal_entry_id as string) ?? null,
    status: (r.status as LoanEntry["status"]) ?? "confirmed",
    source: (r.source as LoanEntry["source"]) ?? "manual",
    ai_evidence: (r.ai_evidence as LoanAiEvidence) ?? null,
    memo: (r.memo as string) ?? null,
    created_at: (r.created_at as string) ?? "",
  };
}

// ---------------------------------------------------------------------------
// 台帳の取得
// ---------------------------------------------------------------------------

/**
 * 顧問先の借入金台帳を、ヘッダ＋明細＋算出済み残高でまとめて返す。
 * 残高はDBに持たず、常に明細から算出する。
 */
export async function getLoanLedgers(clientId: string): Promise<LoanLedger[]> {
  await assertClientAccess(clientId);
  const supabase = await createServerSupabaseClient();

  const { data: loanRows, error: loanErr } = await supabase
    .from("loans")
    .select("*")
    .eq("client_id", clientId)
    .order("direction")
    .order("created_at", { ascending: true });
  if (loanErr) throw new Error(loanErr.message);

  const loans = (loanRows ?? []).map(rowToLoan);
  if (loans.length === 0) return [];

  // 明細は件数が伸びるため 1000 行上限に当たらないようページングして全件取得する
  const entryRows = await fetchAllRows<DbRow>((from, to) =>
    supabase
      .from("loan_entries")
      .select("*")
      .eq("client_id", clientId)
      .order("entry_date", { ascending: true })
      .order("created_at", { ascending: true })
      .range(from, to)
  );
  const entries = entryRows.map(rowToEntry);

  const byLoan = new Map<string, LoanEntry[]>();
  for (const e of entries) {
    const list = byLoan.get(e.loan_id);
    if (list) list.push(e);
    else byLoan.set(e.loan_id, [e]);
  }

  return loans.map((loan) => {
    const es = byLoan.get(loan.id) ?? [];
    return {
      loan,
      entries: es,
      balance: currentBalance(es),
      byType: balanceByType(es),
      // 移行時の差額調整は内容の確認が必要なので画面で目立たせる
      needsAttention: es.some((e) => e.entry_type === "adjust"),
    };
  });
}

/**
 * 認定利息の利率マスタ（貸付けを行った暦年 → 年利%）。
 * 利率は貸付を行った年で固定されるため、会計年度ではなく暦年で引く。
 */
export async function getStatutoryInterestRates(): Promise<StatutoryInterestRate[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("statutory_interest_rates")
    .select("*")
    .order("loan_year", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    loan_year: (r as DbRow).loan_year as number,
    rate: Number((r as DbRow).rate ?? 0),
    note: ((r as DbRow).note as string) ?? null,
  }));
}

// ---------------------------------------------------------------------------
// 相手先（ヘッダ）の CRUD
// ---------------------------------------------------------------------------

function validateLoanInput(input: Partial<LoanInput>): void {
  if (input.lender_name != null && !input.lender_name.trim()) {
    throw new Error("相手先を入力してください");
  }
  // 金融機関等からの借入は年利が必須（要件3-7）
  if (
    input.counterparty_kind === "institution" &&
    input.direction === "borrow" &&
    (input.interest_rate == null || Number.isNaN(input.interest_rate))
  ) {
    throw new Error("金融機関等からの借入は年利を入力してください");
  }
}

export async function createLoan(input: LoanInput): Promise<Loan> {
  await assertClientAccess(input.client_id);
  validateLoanInput(input);
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("loans")
    .insert({
      client_id: input.client_id,
      lender_name: input.lender_name.trim(),
      direction: input.direction,
      counterparty_kind: input.counterparty_kind,
      // 役員借入金は無利息が原則なので年利を持たせない
      interest_rate: input.counterparty_kind === "officer" ? null : input.interest_rate,
      borrowed_date: input.borrowed_date,
      liability_account_id: input.liability_account_id,
      business_partner_id: input.business_partner_id,
      repayment_terms: input.repayment_terms,
      purpose: input.purpose,
      memo: input.memo,
      status: "active",
      // 非推奨カラム。旧コードが読んでも壊れないよう 0 を入れておく
      loan_type: input.counterparty_kind === "officer" ? "officer" : "borrowing",
      principal: 0,
      current_balance: 0,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return rowToLoan(data as DbRow);
}

export async function updateLoan(id: string, input: Partial<LoanInput>): Promise<Loan> {
  await resolveClientIdForRecord("loans", id);
  validateLoanInput(input);
  const supabase = await createServerSupabaseClient();

  const patch: Record<string, unknown> = {};
  const copy = [
    "lender_name",
    "direction",
    "counterparty_kind",
    "borrowed_date",
    "liability_account_id",
    "business_partner_id",
    "repayment_terms",
    "purpose",
    "memo",
    "status",
  ] as const;
  for (const k of copy) {
    if (input[k] !== undefined) patch[k] = input[k];
  }
  if (input.interest_rate !== undefined) {
    patch.interest_rate = input.counterparty_kind === "officer" ? null : input.interest_rate;
  }
  if (input.counterparty_kind !== undefined) {
    patch.loan_type = input.counterparty_kind === "officer" ? "officer" : "borrowing";
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
  await resolveClientIdForRecord("loans", id);
  const supabase = await createServerSupabaseClient();

  // 明細から生成済みの仕訳も併せて削除する（明細は ON DELETE CASCADE）
  const { data: entries } = await supabase
    .from("loan_entries")
    .select("journal_entry_id")
    .eq("loan_id", id);
  const journalIds = (entries ?? [])
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
// 増減明細の CRUD
// ---------------------------------------------------------------------------

function validateEntryInput(input: Partial<LoanEntryInput>): void {
  if (input.entry_date != null && !/^\d{4}-\d{2}-\d{2}$/.test(input.entry_date)) {
    throw new Error("日付の形式が不正です");
  }
  if (input.amount != null && input.amount < 0) {
    throw new Error("金額は0以上で入力してください");
  }
  if (input.entry_type === "adjust" && input.signed_adjustment == null) {
    throw new Error("調整には符号付きの差額が必要です");
  }
  if (input.entry_type != null && input.entry_type !== "adjust" && input.signed_adjustment != null) {
    throw new Error("符号付きの差額は調整のときのみ指定できます");
  }
  // 立替は費用科目が無いと仕訳が立てられない（要件3-2）
  if (input.entry_type === "advance" && !input.expense_account_id) {
    throw new Error("立替には費用科目の指定が必要です");
  }
}

export async function createLoanEntry(input: LoanEntryInput): Promise<LoanEntry> {
  await assertClientAccess(input.client_id);
  await resolveClientIdForRecord("loans", input.loan_id);
  validateEntryInput(input);

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("loan_entries")
    .insert({
      loan_id: input.loan_id,
      client_id: input.client_id,
      entry_date: input.entry_date,
      entry_type: input.entry_type,
      amount: Math.round(input.amount ?? 0),
      signed_adjustment:
        input.entry_type === "adjust" ? Math.round(input.signed_adjustment ?? 0) : null,
      expense_account_id: input.expense_account_id,
      payment_account_id: input.payment_account_id,
      status: input.status ?? "confirmed",
      source: input.source ?? "manual",
      // JSONB カラムなので型を落として渡す（形は LoanAiEvidence で担保している）
      ai_evidence: input.ai_evidence as unknown as Json,
      memo: input.memo,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return rowToEntry(data as DbRow);
}

export async function updateLoanEntry(
  id: string,
  input: Partial<LoanEntryInput>
): Promise<LoanEntry> {
  await resolveClientIdForRecord("loans", await loanIdOfEntry(id));
  validateEntryInput(input);

  const supabase = await createServerSupabaseClient();
  const patch: Record<string, unknown> = {};
  const copy = [
    "entry_date",
    "entry_type",
    "expense_account_id",
    "payment_account_id",
    "status",
    "memo",
  ] as const;
  for (const k of copy) {
    if (input[k] !== undefined) patch[k] = input[k];
  }
  if (input.amount !== undefined) patch.amount = Math.round(input.amount);
  if (input.signed_adjustment !== undefined) {
    patch.signed_adjustment =
      input.signed_adjustment == null ? null : Math.round(input.signed_adjustment);
  }

  const { data, error } = await supabase
    .from("loan_entries")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return rowToEntry(data as DbRow);
}

export async function deleteLoanEntry(id: string): Promise<void> {
  const loanId = await loanIdOfEntry(id);
  await resolveClientIdForRecord("loans", loanId);

  const supabase = await createServerSupabaseClient();
  const { data: row } = await supabase
    .from("loan_entries")
    .select("journal_entry_id")
    .eq("id", id)
    .maybeSingle();

  // 仕訳化済みなら生成済みの仕訳も消す（残高は明細から算出するため戻し処理は不要）
  const journalId = (row as DbRow | null)?.journal_entry_id as string | null;
  if (journalId) {
    const admin = createAdminSupabaseClient();
    await admin.from("journal_entries").delete().eq("id", journalId);
  }

  const { error } = await supabase.from("loan_entries").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * 明細IDから loan_id を引く。
 * loan_entries は authz.ts の ClientScopedTable に無いため、RLS バウンドのクライアントで
 * 読めること自体をアクセス可の判定に使い、得た loan_id を loans 側のガードに渡す。
 */
async function loanIdOfEntry(entryId: string): Promise<string> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("loan_entries")
    .select("loan_id")
    .eq("id", entryId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("明細が見つからないか、アクセスする権限がありません");
  return (data as DbRow).loan_id as string;
}

// ---------------------------------------------------------------------------
// 証憑の紐付け（要件3-3）
// ---------------------------------------------------------------------------

export async function getEntryReceipts(loanId: string): Promise<LoanEntryReceipt[]> {
  await resolveClientIdForRecord("loans", loanId);
  const supabase = await createServerSupabaseClient();

  const { data: entryRows } = await supabase
    .from("loan_entries")
    .select("id")
    .eq("loan_id", loanId);
  const ids = (entryRows ?? []).map((r) => (r as DbRow).id as string);
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from("loan_entry_receipts")
    .select("*")
    .in("loan_entry_id", ids);
  if (error) throw new Error(error.message);

  return (data ?? []).map((r) => ({
    id: (r as DbRow).id as string,
    loan_entry_id: (r as DbRow).loan_entry_id as string,
    receipt_id: (r as DbRow).receipt_id as string,
    client_id: (r as DbRow).client_id as string,
    source_line_no: ((r as DbRow).source_line_no as number) ?? null,
    source_note: ((r as DbRow).source_note as string) ?? null,
    created_at: ((r as DbRow).created_at as string) ?? "",
  }));
}

/**
 * 証憑を明細行に紐付ける。
 * 1枚の証憑（通帳PDFなど）が複数の取引を含むため、どの行に対応するかを
 * source_line_no で記録する。
 */
export async function attachReceiptToEntry(params: {
  loanEntryId: string;
  receiptId: string;
  sourceLineNo?: number | null;
  sourceNote?: string | null;
}): Promise<void> {
  const loanId = await loanIdOfEntry(params.loanEntryId);
  const clientId = await resolveClientIdForRecord("loans", loanId);
  // 証憑側も同じ顧問先のものであることを確認する（別テナントの証憑を紐付けさせない）
  const receiptClientId = await resolveClientIdForRecord("receipts", params.receiptId);
  if (receiptClientId !== clientId) {
    throw new Error("他の顧問先の証憑は紐付けできません");
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.from("loan_entry_receipts").insert({
    loan_entry_id: params.loanEntryId,
    receipt_id: params.receiptId,
    client_id: clientId,
    source_line_no: params.sourceLineNo ?? null,
    source_note: params.sourceNote ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function detachReceiptFromEntry(linkId: string): Promise<void> {
  const supabase = await createServerSupabaseClient();
  // RLS バウンドのクライアントで消せること自体がアクセス可の証明になる
  const { data, error } = await supabase
    .from("loan_entry_receipts")
    .delete()
    .eq("id", linkId)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    throw new Error("証憑の紐付けが見つからないか、削除する権限がありません");
  }
}

// ---------------------------------------------------------------------------
// 仕訳生成
// ---------------------------------------------------------------------------

type AccountLite = { id: string; name: string; is_default: boolean };

/** 名称キーワードから科目を解決（顧問先固有を優先）。 */
function findAccount(accounts: AccountLite[], keywords: string[]): string | null {
  for (const kw of keywords) {
    const hit = accounts.find((a) => a.name.includes(kw));
    if (hit) return hit.id;
  }
  return null;
}

async function loadAccounts(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  clientId: string
): Promise<AccountLite[]> {
  const { data } = await admin
    .from("accounts")
    .select("id, name, is_default, client_id")
    .or(`client_id.eq.${clientId},is_default.eq.true`)
    .eq("is_active", true);
  return (data ?? [])
    .map((a) => ({
      id: (a as DbRow).id as string,
      name: (a as DbRow).name as string,
      is_default: Boolean((a as DbRow).is_default),
    }))
    // 顧問先固有を優先（is_default=false を前に）
    .sort((a, b) => Number(a.is_default) - Number(b.is_default));
}

/** 明細から仕訳を生成する。残高は明細から算出するため、ここで残高は触らない。 */
export async function journalizeLoanEntry(entryId: string): Promise<string> {
  const loanId = await loanIdOfEntry(entryId);
  const clientId = await resolveClientIdForRecord("loans", loanId);
  const admin = createAdminSupabaseClient();

  const { data: entryRaw } = await admin
    .from("loan_entries")
    .select("*")
    .eq("id", entryId)
    .single();
  if (!entryRaw) throw new Error("明細が見つかりません");
  const entry = rowToEntry(entryRaw as DbRow);

  if (entry.status === "draft") {
    throw new Error("下書きのままでは仕訳化できません。内容を確認して確定してください。");
  }
  if (entry.journal_entry_id) {
    throw new Error("この明細は既に仕訳化されています");
  }
  if (entry.amount <= 0) {
    throw new Error("金額が0円のため仕訳化できません");
  }

  const { data: loanRaw } = await admin.from("loans").select("*").eq("id", loanId).single();
  if (!loanRaw) throw new Error("台帳が見つかりません");
  const loan = rowToLoan(loanRaw as DbRow);

  const accounts = await loadAccounts(admin, clientId);

  const ledgerAccountId =
    loan.liability_account_id ??
    (loan.direction === "lend"
      ? findAccount(accounts, ["役員貸付金", "貸付金"])
      : loan.counterparty_kind === "officer"
        ? findAccount(accounts, ["役員借入金", "役員からの借入金"])
        : findAccount(accounts, ["長期借入金", "短期借入金", "借入金"]));

  if (!ledgerAccountId) {
    throw new Error(
      loan.direction === "lend"
        ? "「役員貸付金」科目が見つかりません。勘定科目に登録してください。"
        : loan.counterparty_kind === "officer"
          ? "「役員借入金」科目が見つかりません。勘定科目に登録してください。"
          : "「借入金」科目が見つかりません。勘定科目に登録してください。"
    );
  }

  const lines = buildJournalLines({
    direction: loan.direction,
    entryType: entry.entry_type,
    amount: entry.amount,
    ledgerAccountId,
    paymentAccountId:
      entry.payment_account_id ?? findAccount(accounts, ["普通預金", "当座預金", "現金"]),
    expenseAccountId: entry.expense_account_id,
    interestAccountId:
      loan.direction === "lend"
        ? findAccount(accounts, ["受取利息"])
        : findAccount(accounts, ["支払利息", "利息"]),
  });

  const totalDebit = lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = lines.reduce((s, l) => s + l.credit, 0);
  if (totalDebit <= 0 || totalDebit !== totalCredit) {
    throw new Error(`貸借が一致していません（借方 ${totalDebit} / 貸方 ${totalCredit}）`);
  }

  const label = entryTypeLabel(entry.entry_type, loan.direction);
  const { data: created, error: entryError } = await admin
    .from("journal_entries")
    .insert({
      client_id: clientId,
      entry_date: entry.entry_date,
      description: `${label} ${loan.lender_name}`,
      status: "draft",
      source: "loan",
      created_by: clientId,
      needs_review: false,
    })
    .select()
    .single();
  if (entryError) throw new Error(`仕訳作成エラー: ${entryError.message}`);

  const { error: linesError } = await admin.from("journal_entry_lines").insert(
    lines.map((l, i) => ({
      journal_entry_id: created.id,
      account_id: l.accountId,
      debit_amount: l.debit,
      credit_amount: l.credit,
      sort_order: i,
    }))
  );
  if (linesError) {
    // 明細の作成に失敗したらヘッダを残さない
    await admin.from("journal_entries").delete().eq("id", created.id);
    throw new Error(`仕訳明細作成エラー: ${linesError.message}`);
  }

  const { error: updErr } = await admin
    .from("loan_entries")
    .update({ journal_entry_id: created.id, status: "journalized" })
    .eq("id", entryId);
  if (updErr) throw new Error(updErr.message);

  return created.id as string;
}

/** 仕訳化を取り消す（生成済み仕訳を削除して confirmed に戻す）。 */
export async function unjournalizeLoanEntry(entryId: string): Promise<void> {
  const loanId = await loanIdOfEntry(entryId);
  await resolveClientIdForRecord("loans", loanId);
  const admin = createAdminSupabaseClient();

  const { data: raw } = await admin
    .from("loan_entries")
    .select("journal_entry_id")
    .eq("id", entryId)
    .maybeSingle();
  const journalId = (raw as DbRow | null)?.journal_entry_id as string | null;
  if (journalId) {
    await admin.from("journal_entries").delete().eq("id", journalId);
  }

  const { error } = await admin
    .from("loan_entries")
    .update({ journal_entry_id: null, status: "confirmed" })
    .eq("id", entryId);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// 返済予定表（要件3-7）
// ---------------------------------------------------------------------------

function rowToSchedule(r: DbRow): LoanRepaymentSchedule {
  return {
    id: r.id as string,
    loan_id: r.loan_id as string,
    client_id: r.client_id as string,
    due_date: (r.due_date as string) ?? "",
    principal_amount: (r.principal_amount as number) ?? 0,
    interest_amount: (r.interest_amount as number) ?? 0,
    principal_entry_id: (r.principal_entry_id as string) ?? null,
    interest_entry_id: (r.interest_entry_id as string) ?? null,
    memo: (r.memo as string) ?? null,
    created_at: (r.created_at as string) ?? "",
  };
}

export async function getRepaymentSchedules(loanId: string): Promise<LoanRepaymentSchedule[]> {
  await resolveClientIdForRecord("loans", loanId);
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("loan_repayment_schedules")
    .select("*")
    .eq("loan_id", loanId)
    .order("due_date", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToSchedule);
}

/**
 * 借入条件から返済予定表を作る。既存の予定は入れ替える。
 * 実績（消し込み済み）がある場合は、取り違えを防ぐため作り直しを拒否する。
 */
export async function generateSchedules(params: {
  loanId: string;
  principal: number;
  annualRatePercent: number;
  termMonths: number;
  firstDueDate: string;
  method: RepaymentMethod;
}): Promise<number> {
  const clientId = await resolveClientIdForRecord("loans", params.loanId);
  const supabase = await createServerSupabaseClient();

  const { data: existing } = await supabase
    .from("loan_repayment_schedules")
    .select("id, principal_entry_id, interest_entry_id")
    .eq("loan_id", params.loanId);

  const hasActual = (existing ?? []).some(
    (r) => (r as DbRow).principal_entry_id || (r as DbRow).interest_entry_id
  );
  if (hasActual) {
    throw new Error(
      "実績のある予定表は作り直せません。個別に修正するか、実績の消し込みを取り消してください。"
    );
  }

  const rows = generateRepaymentSchedule({
    principal: params.principal,
    annualRatePercent: params.annualRatePercent,
    termMonths: params.termMonths,
    firstDueDate: params.firstDueDate,
    method: params.method,
  });
  if (rows.length === 0) throw new Error("借入額と返済回数を入力してください");

  await supabase.from("loan_repayment_schedules").delete().eq("loan_id", params.loanId);

  const { error } = await supabase.from("loan_repayment_schedules").insert(
    rows.map((r) => ({
      loan_id: params.loanId,
      client_id: clientId,
      due_date: r.due_date,
      principal_amount: r.principal_amount,
      interest_amount: r.interest_amount,
    }))
  );
  if (error) throw new Error(error.message);
  return rows.length;
}

export async function deleteSchedule(id: string): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("loan_repayment_schedules")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    throw new Error("予定が見つからないか、削除する権限がありません");
  }
}

/**
 * 予定を実績にする（消し込み）。
 * 予定の元金・利息をそれぞれ増減明細として作り、予定行に結び付ける。
 * 手入力の手間を減らすのが目的なので、金額は予定どおりで作る（違えば後から明細を直す）。
 */
export async function applySchedule(scheduleId: string): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const { data: raw, error: readErr } = await supabase
    .from("loan_repayment_schedules")
    .select("*")
    .eq("id", scheduleId)
    .maybeSingle();
  if (readErr) throw new Error(readErr.message);
  if (!raw) throw new Error("予定が見つからないか、アクセスする権限がありません");
  const sch = rowToSchedule(raw as DbRow);

  if (sch.principal_entry_id || sch.interest_entry_id) {
    throw new Error("この予定はすでに実績になっています");
  }

  const patch: Record<string, unknown> = {};

  if (sch.principal_amount > 0) {
    const e = await createLoanEntry({
      loan_id: sch.loan_id,
      client_id: sch.client_id,
      entry_date: sch.due_date,
      entry_type: "repay",
      amount: sch.principal_amount,
      signed_adjustment: null,
      expense_account_id: null,
      payment_account_id: null,
      ai_evidence: null,
      memo: `返済予定より（元金）${sch.memo ?? ""}`.trim(),
    });
    patch.principal_entry_id = e.id;
  }

  if (sch.interest_amount > 0) {
    const e = await createLoanEntry({
      loan_id: sch.loan_id,
      client_id: sch.client_id,
      entry_date: sch.due_date,
      entry_type: "interest",
      amount: sch.interest_amount,
      signed_adjustment: null,
      expense_account_id: null,
      payment_account_id: null,
      ai_evidence: null,
      memo: `返済予定より（利息）${sch.memo ?? ""}`.trim(),
    });
    patch.interest_entry_id = e.id;
  }

  if (Object.keys(patch).length === 0) return;

  const { error } = await supabase
    .from("loan_repayment_schedules")
    .update(patch)
    .eq("id", scheduleId);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// 整合性チェック（要件3-5 / 4-6）
// ---------------------------------------------------------------------------

/**
 * 台帳の残高と、仕訳から集計した勘定残高を突き合わせる。
 *
 * 台帳は管理用の記録で、決算書に出るのは仕訳の方。両者がずれていると
 * 「台帳では返し終わっているのに決算書には残債がある」といった事故になる。
 */
export async function reconcileLoan(loanId: string): Promise<ReconcileResult> {
  const clientId = await resolveClientIdForRecord("loans", loanId);
  const supabase = await createServerSupabaseClient();
  const admin = createAdminSupabaseClient();

  const { data: loanRaw } = await supabase.from("loans").select("*").eq("id", loanId).single();
  if (!loanRaw) throw new Error("台帳が見つかりません");
  const loan = rowToLoan(loanRaw as DbRow);

  const { data: entryRows } = await supabase
    .from("loan_entries")
    .select("*")
    .eq("loan_id", loanId);
  const entries = (entryRows ?? []).map(rowToEntry);

  // 対象となる勘定科目を決める（仕訳化に使うものと同じ解決方法）
  const accounts = await loadAccounts(admin, clientId);
  const ledgerAccountId =
    loan.liability_account_id ??
    (loan.direction === "lend"
      ? findAccount(accounts, ["役員貸付金", "貸付金"])
      : loan.counterparty_kind === "officer"
        ? findAccount(accounts, ["役員借入金", "役員からの借入金"])
        : findAccount(accounts, ["長期借入金", "短期借入金", "借入金"]));

  if (!ledgerAccountId) {
    throw new Error("対象の勘定科目が見つかりません。勘定科目に登録してください。");
  }

  // 1000行の上限に当たらないようページングして全件取得する
  const lineRows = await fetchAllRows<DbRow>((from, to) =>
    admin
      .from("journal_entry_lines")
      .select("journal_entry_id, debit_amount, credit_amount, journal_entries(client_id, entry_date, description, source)")
      .eq("account_id", ledgerAccountId)
      .range(from, to)
  );

  const journalLines: JournalLineForCheck[] = lineRows
    .map((r) => {
      const je = r.journal_entries as
        | { client_id?: string; entry_date?: string; description?: string; source?: string }
        | null;
      return {
        journalEntryId: r.journal_entry_id as string,
        date: je?.entry_date ?? "",
        debit: Number(r.debit_amount ?? 0),
        credit: Number(r.credit_amount ?? 0),
        description: je?.description ?? null,
        source: je?.source ?? null,
        clientId: je?.client_id ?? "",
      };
    })
    // サービスロールで引いているので、顧問先が一致するものだけに絞る
    .filter((l) => l.clientId === clientId)
    .map(({ clientId: _omit, ...rest }) => rest);

  return reconcileLoanLedger({
    direction: loan.direction,
    entries,
    journalLines,
  });
}

// ---------------------------------------------------------------------------
// 勘定科目内訳明細書「借入金及び支払利子の内訳書」（要件3-6）
// ---------------------------------------------------------------------------

/**
 * 期末現在高と期中の支払利子額を、指定した会計年度で集計する。
 * 役員借入金は内訳書の記載対象になるため、残高が0でも行として残す。
 */
export async function getLoanBreakdownReport(
  clientId: string,
  fiscalStartYear: number
): Promise<LoanBreakdownReport> {
  await assertClientAccess(clientId);
  const supabase = await createServerSupabaseClient();

  const { data: client } = await supabase
    .from("clients")
    .select("name, fiscal_year_start_month")
    .eq("id", clientId)
    .single();

  const { startDate, endDate } = fiscalRangeFromStartYear(
    (client as DbRow | null)?.fiscal_year_start_month as number | undefined,
    fiscalStartYear
  );

  const { data: loanRows } = await supabase
    .from("loans")
    .select("*, business_partners(address)")
    .eq("client_id", clientId)
    .eq("direction", "borrow");

  const entryRows = await fetchAllRows<DbRow>((from, to) =>
    supabase.from("loan_entries").select("*").eq("client_id", clientId).range(from, to)
  );

  const byLoan = new Map<string, LoanEntry[]>();
  for (const r of entryRows) {
    const e = rowToEntry(r);
    const list = byLoan.get(e.loan_id);
    if (list) list.push(e);
    else byLoan.set(e.loan_id, [e]);
  }

  const rows: LoanBreakdownRow[] = (loanRows ?? []).map((raw) => {
    const loan = rowToLoan(raw as DbRow);
    const es = byLoan.get(loan.id) ?? [];
    const partner = (raw as DbRow).business_partners as { address?: string } | null;

    return {
      lender_name: loan.lender_name,
      address: partner?.address ?? null,
      // 期末現在高＝決算日時点の残高
      closing_balance: balanceAsOf(es, endDate),
      // 期中の支払利子額＝当期に計上した利息の合計
      interest_paid: es
        .filter(
          (e) =>
            e.entry_type === "interest" &&
            e.status !== "draft" &&
            e.entry_date >= startDate &&
            e.entry_date <= endDate
        )
        .reduce((s, e) => s + e.amount, 0),
      interest_rate: loan.interest_rate,
      purpose: loan.purpose,
      is_officer: loan.counterparty_kind === "officer",
    };
  });

  // 役員借入金は残高0でも記載対象。それ以外は残高も利子もなければ省く
  const visible = rows.filter(
    (r) => r.is_officer || r.closing_balance !== 0 || r.interest_paid !== 0
  );

  return {
    clientName: ((client as DbRow | null)?.name as string) ?? "",
    fiscalYear: fiscalStartYear,
    periodStart: startDate,
    periodEnd: endDate,
    rows: visible,
    totalClosingBalance: visible.reduce((s, r) => s + r.closing_balance, 0),
    totalInterestPaid: visible.reduce((s, r) => s + r.interest_paid, 0),
  };
}
