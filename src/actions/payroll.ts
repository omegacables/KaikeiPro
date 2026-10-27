"use server";

import {
  createServerSupabaseClient,
  createAdminSupabaseClient,
} from "@/lib/supabase";
import { assertClientAccess, resolveClientIdForRecord } from "@/lib/authz";
import { getGeminiModel, callGemini, extractJson, INJECTION_GUARD } from "@/lib/gemini";
import type { PayrollRecord, PayrollInput } from "@/types/index";

type DbRow = Record<string, unknown>;

// pay_month を YYYY-MM-01 に正規化
function normalizeMonth(value: string): string {
  // "2026-06", "2026-06-15", "2026-06-01" いずれも受ける
  const m = value.match(/^(\d{4})-(\d{2})/);
  if (!m) throw new Error(`給与計算対象月の形式が不正です: ${value}`);
  return `${m[1]}-${m[2]}-01`;
}

function deductionTotal(r: {
  income_tax: number;
  resident_tax: number;
  health_insurance: number;
  pension_insurance: number;
  employment_insurance: number;
  other_deduction: number;
}): number {
  return (
    r.income_tax +
    r.resident_tax +
    r.health_insurance +
    r.pension_insurance +
    r.employment_insurance +
    r.other_deduction
  );
}

function rowToPayroll(r: DbRow): PayrollRecord {
  return {
    id: r.id as string,
    client_id: r.client_id as string,
    pay_month: r.pay_month as string,
    pay_date: (r.pay_date as string) ?? null,
    employee_name: (r.employee_name as string) ?? "",
    employee_type: (r.employee_type as PayrollRecord["employee_type"]) ?? "employee",
    gross_salary: (r.gross_salary as number) ?? 0,
    income_tax: (r.income_tax as number) ?? 0,
    resident_tax: (r.resident_tax as number) ?? 0,
    health_insurance: (r.health_insurance as number) ?? 0,
    pension_insurance: (r.pension_insurance as number) ?? 0,
    employment_insurance: (r.employment_insurance as number) ?? 0,
    other_deduction: (r.other_deduction as number) ?? 0,
    net_pay: (r.net_pay as number) ?? 0,
    salary_account_id: (r.salary_account_id as string) ?? null,
    withholding_account_id: (r.withholding_account_id as string) ?? null,
    payment_account_id: (r.payment_account_id as string) ?? null,
    journal_entry_id: (r.journal_entry_id as string) ?? null,
    status: (r.status as PayrollRecord["status"]) ?? "pending",
    memo: (r.memo as string) ?? null,
    created_at: (r.created_at as string) ?? "",
  };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/** 給与台帳の一覧を取得（月指定があればその月のみ） */
export async function getPayrollRecords(
  clientId: string,
  payMonth?: string
): Promise<PayrollRecord[]> {
  const supabase = await createServerSupabaseClient();
  let query = supabase
    .from("payroll_records")
    .select("*")
    .eq("client_id", clientId);
  if (payMonth) query = query.eq("pay_month", normalizeMonth(payMonth));
  const { data, error } = await query
    .order("pay_month", { ascending: false })
    .order("employee_type")
    .order("employee_name");
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowToPayroll);
}

/** 登録済みの給与計算対象月の一覧（新しい順） */
export async function getPayrollMonths(clientId: string): Promise<string[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("payroll_records")
    .select("pay_month")
    .eq("client_id", clientId)
    .order("pay_month", { ascending: false });
  if (error) throw new Error(error.message);
  const months = (data ?? []).map((r) => (r as DbRow).pay_month as string);
  return Array.from(new Set(months));
}

export async function createPayrollRecord(
  input: PayrollInput
): Promise<PayrollRecord> {
  const supabase = await createServerSupabaseClient();
  const gross = input.gross_salary ?? 0;
  const net = gross - deductionTotal(input);
  const { data, error } = await supabase
    .from("payroll_records")
    .insert({
      ...input,
      pay_month: normalizeMonth(input.pay_month),
      net_pay: net,
      status: "pending",
    })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return rowToPayroll(data as DbRow);
}

export async function updatePayrollRecord(
  id: string,
  input: Partial<PayrollInput>
): Promise<PayrollRecord> {
  const supabase = await createServerSupabaseClient();

  // 金額に変更があれば net_pay を再計算するため現在値を取得
  const { data: current, error: getErr } = await supabase
    .from("payroll_records")
    .select("*")
    .eq("id", id)
    .single();
  if (getErr) throw new Error(getErr.message);
  const merged = { ...(current as DbRow), ...input } as unknown as PayrollInput;

  const patch: Record<string, unknown> = { ...input };
  if (input.pay_month) patch.pay_month = normalizeMonth(input.pay_month);
  patch.net_pay = (merged.gross_salary ?? 0) - deductionTotal(merged);

  const { data, error } = await supabase
    .from("payroll_records")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return rowToPayroll(data as DbRow);
}

export async function deletePayrollRecord(id: string): Promise<void> {
  await resolveClientIdForRecord("payroll_records", id);
  const supabase = await createServerSupabaseClient();
  // 仕訳化済みなら生成済み仕訳も削除
  const { data: rec } = await supabase
    .from("payroll_records")
    .select("journal_entry_id")
    .eq("id", id)
    .single();
  const journalId = (rec as DbRow | null)?.journal_entry_id as string | undefined;
  if (journalId) {
    const admin = createAdminSupabaseClient();
    await admin.from("journal_entries").delete().eq("id", journalId);
  }
  const { error } = await supabase.from("payroll_records").delete().eq("id", id);
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
 * 給与レコードから給与仕訳を生成する。
 *   借方 給与手当/役員報酬 … 総支給額
 *   貸方 預り金 … 控除合計
 *   貸方 普通預金/現金/未払金 … 差引支給額
 */
export async function journalizePayroll(id: string): Promise<string> {
  await resolveClientIdForRecord("payroll_records", id);
  const admin = createAdminSupabaseClient();

  const { data: recRaw, error: recErr } = await admin
    .from("payroll_records")
    .select("*")
    .eq("id", id)
    .single();
  if (recErr || !recRaw) throw new Error("給与レコードが見つかりません");
  const rec = rowToPayroll(recRaw as DbRow);

  if (rec.status === "journalized" && rec.journal_entry_id) {
    throw new Error("この給与は既に仕訳化されています");
  }

  const gross = rec.gross_salary;
  const deductions = deductionTotal(rec);
  const net = gross - deductions;
  if (gross <= 0) throw new Error("総支給額が0円のため仕訳化できません");
  if (net < 0) throw new Error("控除合計が総支給額を超えています");

  // 科目を取得（顧問先固有 + デフォルト科目）
  const { data: acctData } = await admin
    .from("accounts")
    .select("id, name, is_default, client_id")
    .or(`client_id.eq.${rec.client_id},is_default.eq.true`)
    .eq("is_active", true);
  const accounts: AccountLite[] = (acctData ?? [])
    .map((a) => ({
      id: (a as DbRow).id as string,
      name: (a as DbRow).name as string,
      is_default: Boolean((a as DbRow).is_default),
    }))
    // 顧問先固有を優先（is_default=false を前に）
    .sort((a, b) => Number(a.is_default) - Number(b.is_default));

  const salaryAccountId =
    rec.salary_account_id ??
    (rec.employee_type === "officer"
      ? findAccount(accounts, ["役員報酬"])
      : findAccount(accounts, ["給与手当", "給料手当", "給料", "給与"]));
  const withholdingAccountId =
    rec.withholding_account_id ?? findAccount(accounts, ["預り金", "預かり金"]);
  const paymentAccountId =
    rec.payment_account_id ?? findAccount(accounts, ["普通預金", "当座預金", "現金"]);

  if (!salaryAccountId) {
    throw new Error(
      rec.employee_type === "officer"
        ? "「役員報酬」科目が見つかりません。勘定科目に登録してください。"
        : "「給与手当」科目が見つかりません。勘定科目に登録してください。"
    );
  }
  if (!paymentAccountId) {
    throw new Error("支払元科目（普通預金/現金）が見つかりません。");
  }
  if (deductions > 0 && !withholdingAccountId) {
    throw new Error("「預り金」科目が見つかりません。勘定科目に登録してください。");
  }

  const entryDate = rec.pay_date ?? new Date().toISOString().split("T")[0];
  const typeLabel = rec.employee_type === "officer" ? "役員報酬" : "給与";

  const { data: entry, error: entryError } = await admin
    .from("journal_entries")
    .insert({
      client_id: rec.client_id,
      entry_date: entryDate,
      description: `${rec.pay_month.slice(0, 7)} ${typeLabel} ${rec.employee_name}`,
      status: "draft",
      source: "manual",
      created_by: rec.client_id,
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
  const lines: LineInsert[] = [
    {
      journal_entry_id: entry.id,
      account_id: salaryAccountId,
      debit_amount: gross,
      credit_amount: 0,
      sort_order: 0,
    },
  ];
  let sort = 1;
  if (deductions > 0 && withholdingAccountId) {
    lines.push({
      journal_entry_id: entry.id,
      account_id: withholdingAccountId,
      debit_amount: 0,
      credit_amount: deductions,
      sort_order: sort++,
    });
  }
  lines.push({
    journal_entry_id: entry.id,
    account_id: paymentAccountId,
    debit_amount: 0,
    credit_amount: net,
    sort_order: sort++,
  });

  const { error: linesError } = await admin
    .from("journal_entry_lines")
    .insert(lines);
  if (linesError) throw new Error(`仕訳明細作成エラー: ${linesError.message}`);

  const { error: updErr } = await admin
    .from("payroll_records")
    .update({
      journal_entry_id: entry.id,
      status: "journalized",
      net_pay: net,
      salary_account_id: salaryAccountId,
      withholding_account_id: withholdingAccountId,
      payment_account_id: paymentAccountId,
    })
    .eq("id", id);
  if (updErr) throw new Error(updErr.message);

  return entry.id as string;
}

/** 仕訳化を取り消す（生成済み仕訳を削除し pending に戻す） */
export async function unjournalizePayroll(id: string): Promise<void> {
  await resolveClientIdForRecord("payroll_records", id);
  const admin = createAdminSupabaseClient();
  const { data: rec } = await admin
    .from("payroll_records")
    .select("journal_entry_id")
    .eq("id", id)
    .single();
  const journalId = (rec as DbRow | null)?.journal_entry_id as string | undefined;
  if (journalId) {
    await admin.from("journal_entries").delete().eq("id", journalId);
  }
  const { error } = await admin
    .from("payroll_records")
    .update({ journal_entry_id: null, status: "pending" })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// 給与台帳・給与明細の取り込み
//
// CSV・Excel・文字の入ったPDFはブラウザで表に直して読む（src/lib/payroll-import.ts）。
// 画像・スキャンしたPDFだけ、AIに「表を見たまま書き写す」ことを頼み、同じ読み取りに通す
// （AIには計算・推測をさせない）。
// ---------------------------------------------------------------------------

export type PayrollImportRow = {
  employee_name: string;
  employee_type: "employee" | "officer";
  pay_month: string;
  pay_date: string | null;
  gross_salary: number;
  income_tax: number;
  resident_tax: number;
  health_insurance: number;
  pension_insurance: number;
  employment_insurance: number;
  other_deduction: number;
};

export type PayrollImportResult = {
  created: number;
  skipped: { employee_name: string; pay_month: string; reason: string }[];
};

const AMOUNT_KEYS = [
  "gross_salary",
  "income_tax",
  "resident_tax",
  "health_insurance",
  "pension_insurance",
  "employment_insurance",
  "other_deduction",
] as const;

/**
 * 取り込んだ給与をまとめて登録する。
 * 同じ月・同じ氏名の給与が登録済みなら、二重にせず飛ばして知らせる。
 */
export async function importPayrollRecords(clientId: string, rows: PayrollImportRow[]): Promise<PayrollImportResult> {
  await assertClientAccess(clientId);
  if (rows.length === 0) return { created: 0, skipped: [] };
  if (rows.length > 500) throw new Error("一度に登録できるのは500件までです");

  const skipped: PayrollImportResult["skipped"] = [];
  const valid: (PayrollImportRow & { pay_month: string })[] = [];
  for (const r of rows) {
    const name = (r.employee_name ?? "").trim();
    const month = /^\d{4}-\d{2}$/.test(r.pay_month ?? "") ? r.pay_month : null;
    const label = { employee_name: name || "（氏名なし）", pay_month: r.pay_month ?? "" };
    if (!name || name.length > 100) {
      skipped.push({ ...label, reason: "氏名がありません" });
      continue;
    }
    if (!month) {
      skipped.push({ ...label, reason: "対象月がありません" });
      continue;
    }
    if (r.pay_date && !/^\d{4}-\d{2}-\d{2}$/.test(r.pay_date)) {
      skipped.push({ ...label, reason: "支給日の形が正しくありません" });
      continue;
    }
    if (AMOUNT_KEYS.some((k) => !Number.isInteger(r[k]) || r[k] < 0 || r[k] > 1e10)) {
      skipped.push({ ...label, reason: "金額は0以上の整数にしてください" });
      continue;
    }
    valid.push({ ...r, employee_name: name, pay_month: month });
  }

  // 登録済みの同じ月・同じ氏名は飛ばす（同じファイルを2回入れても二重にならない）
  const supabase = await createServerSupabaseClient();
  const months = [...new Set(valid.map((r) => normalizeMonth(r.pay_month)))];
  const { data: existing, error: exErr } = months.length
    ? await supabase
        .from("payroll_records")
        .select("pay_month, employee_name")
        .eq("client_id", clientId)
        .in("pay_month", months)
    : { data: [], error: null };
  if (exErr) throw new Error(exErr.message);
  const key = (m: string, n: string) => `${m.slice(0, 7)}|${n.replace(/\s+/g, "")}`;
  const seen = new Set((existing ?? []).map((e) => key(e.pay_month as string, e.employee_name as string)));

  const inserts = [];
  for (const r of valid) {
    const k = key(r.pay_month, r.employee_name);
    if (seen.has(k)) {
      skipped.push({ employee_name: r.employee_name, pay_month: r.pay_month, reason: "同じ月の給与が登録済みです" });
      continue;
    }
    seen.add(k);
    inserts.push({
      client_id: clientId,
      pay_month: normalizeMonth(r.pay_month),
      pay_date: r.pay_date || null,
      employee_name: r.employee_name,
      employee_type: r.employee_type === "officer" ? ("officer" as const) : ("employee" as const),
      gross_salary: r.gross_salary,
      income_tax: r.income_tax,
      resident_tax: r.resident_tax,
      health_insurance: r.health_insurance,
      pension_insurance: r.pension_insurance,
      employment_insurance: r.employment_insurance,
      other_deduction: r.other_deduction,
      net_pay: r.gross_salary - deductionTotal(r),
      status: "pending" as const,
    });
  }
  if (inserts.length) {
    const { error } = await supabase.from("payroll_records").insert(inserts);
    if (error) throw new Error(error.message);
  }
  return { created: inserts.length, skipped };
}

const AI_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

/**
 * 画像・スキャンしたPDFの給与明細／給与台帳を、AIに表として書き写してもらう。
 * 返すのは「行×セルの文字」だけ。金額の意味の見分け・計算は parsePayrollGrid が行う。
 */
export async function transcribePayrollWithAi(clientId: string, formData: FormData): Promise<string[][]> {
  await assertClientAccess(clientId);
  const file = formData.get("file");
  if (!file || typeof file === "string") throw new Error("ファイルがありません");
  if (file.size > 10 * 1024 * 1024) throw new Error("ファイルサイズが10MBを超えています");
  if (!AI_TYPES.includes(file.type)) throw new Error("AIで読めるのは JPG・PNG・WEBP・PDF です");

  const model = getGeminiModel("vision");
  const data = Buffer.from(await file.arrayBuffer()).toString("base64");
  const result = await callGemini(() =>
    model.generateContent([
      { inlineData: { mimeType: file.type, data } },
      {
        text: `これは給与明細または給与台帳（賃金台帳）です。書かれている表を、見たままの「行×セル」の文字として書き写してください。
- 1行は配列1つ、セルは左から順に文字列で入れる。項目名と金額は書いてあるとおり（カンマ・円・△もそのまま）
- 計算・合計・推測はしない。読めないセルは "" にする。表以外の見出し（対象月・支給日・氏名など）も1行ずつ入れる
- JSONだけを返す: {"rows":[["項目","値",...],...]}
${INJECTION_GUARD}`,
      },
    ])
  );
  const parsed = extractJson<{ rows?: unknown }>(result.response.text(), "給与の読み取り");
  if (!Array.isArray(parsed.rows)) throw new Error("給与の表を読み取れませんでした");
  return parsed.rows
    .slice(0, 500)
    .filter(Array.isArray)
    .map((row) => (row as unknown[]).slice(0, 60).map((c) => (c == null ? "" : String(c).slice(0, 200))));
}
