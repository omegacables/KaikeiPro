"use server";

/**
 * 帳簿閲覧の総勘定元帳・補助元帳（相手先別）・税区分別のデータ。
 * 残高の計算は src/lib/ledger.ts、税区分の集計は src/lib/tax-book.ts の純粋関数に任せる。
 */

import { createAdminSupabaseClient } from "@/lib/supabase";
import { assertClientAccess } from "@/lib/authz";
import { fetchAllRows } from "@/lib/fetch-all";
import { getFiscalPeriod } from "@/lib/fiscal";
import { CATEGORY_BY_DB_TYPE } from "@/lib/trial-balance";
import {
  buildLedger,
  summarizeBySubAccount,
  type LedgerCategory,
  type LedgerLine,
  type SubAccountSummaryRow,
} from "@/lib/ledger";
import { summarizeByTaxCategory, taxCodeOfLine, lineTaxAmounts, type TaxBookRow } from "@/lib/tax-book";
import { loadExclusiveEntries, toTaxBookLines } from "@/lib/tax-exclusive";
import type { SupabaseClient } from "@supabase/supabase-js";
import { taxCategoryInfo } from "@/lib/tax-category";

type Admin = ReturnType<typeof createAdminSupabaseClient>;

export type LedgerAccount = { id: string; code: string; name: string; category: LedgerCategory };

/** 元帳の1行に添える情報（相手科目・補助科目・税区分・相手先） */
export type LedgerRowView = LedgerLine & {
  balance: number;
  subAccountName: string | null;
  taxCategory: string | null;
  taxCategoryName: string | null;
  taxRate: number | null;
  /** 相手先（補助科目 → 仕訳の取引先名 → 請求書の取引先 → 証憑の発行者 の順に探す） */
  partnerName: string | null;
  counterAccount: string;
  counterLines: { accountName: string; subAccountName: string | null; debit: number; credit: number }[];
  receiptId: string | null;
};

export type LedgerBook = {
  account: LedgerAccount;
  fiscalStart: string;
  opening: number;
  rows: LedgerRowView[];
  debitTotal: number;
  creditTotal: number;
  closing: number;
};

// ---------------------------------------------------------------------------
// 共通
// ---------------------------------------------------------------------------

async function loadAccount(admin: Admin, clientId: string, accountId: string): Promise<LedgerAccount> {
  const { data } = await admin
    .from("accounts")
    .select("id, code, name, client_id, account_categories:category_id ( type )")
    .eq("id", accountId)
    .maybeSingle();
  const row = data as unknown as {
    id: string;
    code: string;
    name: string;
    client_id: string | null;
    account_categories: { type: string } | null;
  } | null;
  if (!row || (row.client_id != null && row.client_id !== clientId)) {
    throw new Error("この顧問先の勘定科目ではありません");
  }
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    category: CATEGORY_BY_DB_TYPE[row.account_categories?.type ?? ""] ?? "expense",
  };
}

/** 日付が属する事業年度の期首日（決算月を変えた変則期間は fiscal_years の記録を優先） */
async function fiscalStartOf(admin: Admin, clientId: string, date: string): Promise<string> {
  const [{ data: client }, { data: fy }] = await Promise.all([
    admin.from("clients").select("fiscal_year_start_month").eq("id", clientId).single(),
    admin
      .from("fiscal_years")
      .select("start_date")
      .eq("client_id", clientId)
      .lte("start_date", date)
      .gte("end_date", date)
      .limit(1),
  ]);
  if (fy && fy.length) return fy[0].start_date as string;
  const [y, m] = date.split("-").map(Number);
  return getFiscalPeriod(client?.fiscal_year_start_month as number | null, y, m).startDate;
}

type RawLine = {
  id: string;
  debit_amount: number;
  credit_amount: number;
  sub_account_id: string | null;
  tax_category: string | null;
  tax_rate: number | null;
  journal_entry_id: string;
  journal_entries: {
    client_id: string;
    entry_date: string;
    created_at: string;
    description: string | null;
    source: string | null;
    needs_review: boolean | null;
    metadata: { partner_name?: string } | null;
    receipt_id: string | null;
  };
};

const LINE_SELECT = `id, debit_amount, credit_amount, sub_account_id, tax_category, tax_rate, journal_entry_id,
  journal_entries!inner ( client_id, entry_date, created_at, description, source, needs_review, metadata, receipt_id )`;

async function loadAccountLines(
  admin: Admin,
  clientId: string,
  accountId: string,
  dateTo: string,
  since: string | null
): Promise<RawLine[]> {
  return fetchAllRows<RawLine>((from, to) => {
    let q = admin
      .from("journal_entry_lines")
      .select(LINE_SELECT)
      .eq("account_id", accountId)
      .eq("journal_entries.client_id", clientId)
      .lte("journal_entries.entry_date", dateTo);
    if (since) q = q.gte("journal_entries.entry_date", since);
    return q.range(from, to) as unknown as PromiseLike<{ data: RawLine[] | null; error: { message: string } | null }>;
  });
}

function toLedgerLine(l: RawLine): LedgerLine {
  return {
    lineId: l.id,
    entryId: l.journal_entry_id,
    entryDate: l.journal_entries.entry_date,
    createdAt: l.journal_entries.created_at,
    description: l.journal_entries.description ?? "",
    source: l.journal_entries.source,
    needsReview: Boolean(l.journal_entries.needs_review),
    debit: Number(l.debit_amount) || 0,
    credit: Number(l.credit_amount) || 0,
    subAccountId: l.sub_account_id,
  };
}

async function inChunks<T>(ids: string[], fn: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 100) out.push(...(await fn(ids.slice(i, i + 100))));
  return out;
}

async function subAccountNames(admin: Admin, clientId: string): Promise<Map<string, string>> {
  const { data } = await admin.from("sub_accounts").select("id, name").eq("client_id", clientId);
  return new Map((data ?? []).map((s) => [s.id as string, s.name as string]));
}

/** 仕訳ごとの相手先の手がかり（請求書の取引先・証憑の発行者） */
async function partnerHints(
  admin: Admin,
  entryIds: string[],
  receiptIds: string[]
): Promise<{ byEntry: Map<string, string>; byReceipt: Map<string, string> }> {
  const invoices = await inChunks(entryIds, async (chunk) => {
    const { data } = await admin
      .from("invoices")
      .select("journal_entry_id, business_partners:business_partner_id ( name )")
      .in("journal_entry_id", chunk);
    return (data ?? []) as unknown as { journal_entry_id: string; business_partners: { name: string } | null }[];
  });
  const receipts = await inChunks(receiptIds, async (chunk) => {
    const { data } = await admin.from("receipts").select("id, ocr_result").in("id", chunk);
    return (data ?? []) as unknown as { id: string; ocr_result: { vendor_name?: string } | null }[];
  });
  return {
    byEntry: new Map(
      invoices.filter((i) => i.business_partners?.name).map((i) => [i.journal_entry_id, i.business_partners!.name])
    ),
    byReceipt: new Map(
      receipts.filter((r) => r.ocr_result?.vendor_name?.trim()).map((r) => [r.id, r.ocr_result!.vendor_name!.trim()])
    ),
  };
}

// ---------------------------------------------------------------------------
// 総勘定元帳・補助元帳
// ---------------------------------------------------------------------------

/**
 * 勘定科目の元帳。subAccount を指定すると、その補助科目（"none" は補助科目なし）の行だけで作る。
 */
export async function getLedgerBook(
  clientId: string,
  accountId: string,
  dateFrom: string,
  dateTo: string,
  subAccount?: string | "none" | null
): Promise<LedgerBook> {
  await assertClientAccess(clientId);
  const admin = createAdminSupabaseClient();
  const account = await loadAccount(admin, clientId, accountId);
  const fiscalStart = await fiscalStartOf(admin, clientId, dateFrom);
  const isPl = account.category === "revenue" || account.category === "expense";

  let raw = await loadAccountLines(admin, clientId, accountId, dateTo, isPl ? fiscalStart : null);
  if (subAccount === "none") raw = raw.filter((l) => !l.sub_account_id);
  else if (subAccount) raw = raw.filter((l) => l.sub_account_id === subAccount);

  const rawById = new Map(raw.map((l) => [l.id, l]));
  const ledger = buildLedger(account.category, raw.map(toLedgerLine), dateFrom, dateTo, fiscalStart);

  // 表示する行の仕訳の、他の行（相手科目）と相手先の手がかり
  const entryIds = [...new Set(ledger.rows.map((r) => r.entryId))];
  type Sibling = {
    id: string;
    journal_entry_id: string;
    account_id: string;
    debit_amount: number;
    credit_amount: number;
    sub_account_id: string | null;
    accounts: { name: string } | null;
  };
  const siblings = await inChunks(entryIds, async (chunk) => {
    const { data } = await admin
      .from("journal_entry_lines")
      .select("id, journal_entry_id, account_id, debit_amount, credit_amount, sub_account_id, accounts:account_id ( name )")
      .in("journal_entry_id", chunk);
    return (data ?? []) as unknown as Sibling[];
  });
  const subNames = await subAccountNames(admin, clientId);
  const receiptIds = [...new Set(raw.map((l) => l.journal_entries.receipt_id).filter(Boolean))] as string[];
  const hints = await partnerHints(admin, entryIds, receiptIds);

  const rows: LedgerRowView[] = ledger.rows.map((r) => {
    const l = rawById.get(r.lineId)!;
    const others = siblings.filter((s) => s.journal_entry_id === r.entryId && s.id !== r.lineId);
    const counterLines = others.map((s) => ({
      accountName: s.accounts?.name ?? "",
      subAccountName: s.sub_account_id ? subNames.get(s.sub_account_id) ?? null : null,
      debit: Number(s.debit_amount) || 0,
      credit: Number(s.credit_amount) || 0,
    }));
    const counterNames = [...new Set(counterLines.map((c) => c.accountName))];
    const info = taxCategoryInfo(l.tax_category);
    const subName = l.sub_account_id ? subNames.get(l.sub_account_id) ?? null : null;
    return {
      ...r,
      subAccountName: subName,
      taxCategory: l.tax_category,
      taxCategoryName: info?.name ?? null,
      taxRate: l.tax_rate,
      partnerName:
        subName ??
        (l.journal_entries.metadata?.partner_name?.trim() || null) ??
        hints.byEntry.get(r.entryId) ??
        (l.journal_entries.receipt_id ? hints.byReceipt.get(l.journal_entries.receipt_id) ?? null : null),
      counterAccount: counterNames.length > 1 ? "諸口" : counterNames[0] ?? "-",
      counterLines,
      receiptId: l.journal_entries.receipt_id,
    };
  });

  return {
    account,
    fiscalStart,
    opening: ledger.opening,
    rows,
    debitTotal: ledger.debitTotal,
    creditTotal: ledger.creditTotal,
    closing: ledger.closing,
  };
}

export type SubAccountSummaryView = SubAccountSummaryRow & { name: string };

/** 補助科目（相手先）ごとの 前期繰越・発生・減少・残高 */
export async function getSubAccountSummary(
  clientId: string,
  accountId: string,
  dateFrom: string,
  dateTo: string
): Promise<{ account: LedgerAccount; rows: SubAccountSummaryView[] }> {
  await assertClientAccess(clientId);
  const admin = createAdminSupabaseClient();
  const account = await loadAccount(admin, clientId, accountId);
  const fiscalStart = await fiscalStartOf(admin, clientId, dateFrom);
  const isPl = account.category === "revenue" || account.category === "expense";
  const raw = await loadAccountLines(admin, clientId, accountId, dateTo, isPl ? fiscalStart : null);
  const names = await subAccountNames(admin, clientId);
  const rows = summarizeBySubAccount(account.category, raw.map(toLedgerLine), dateFrom, dateTo, fiscalStart)
    .map((r) => ({ ...r, name: r.subAccountId ? names.get(r.subAccountId) ?? "（削除された補助科目）" : "補助科目なし" }))
    .sort((a, b) => {
      if (!a.subAccountId !== !b.subAccountId) return a.subAccountId ? -1 : 1;
      return a.name.localeCompare(b.name, "ja");
    });
  return { account, rows };
}

// ---------------------------------------------------------------------------
// 税区分別
// ---------------------------------------------------------------------------

export type TaxBookLineView = {
  lineId: string;
  entryId: string;
  entryDate: string;
  description: string;
  accountName: string;
  side: "sales" | "purchase";
  code: string;
  codeName: string;
  /** 税抜金額・消費税額・税込金額 */
  net: number;
  tax: number;
  gross: number;
  /** 税抜経理の仕訳か（仮受消費税・仮払消費税を別に立てている） */
  exclusive: boolean;
  subAccountName: string | null;
  needsReview: boolean;
};

/** 期間内の売上・仕入（収益・費用の行）を税区分ごとに */
export async function getTaxCategoryBook(
  clientId: string,
  dateFrom: string,
  dateTo: string
): Promise<{ summary: TaxBookRow[]; lines: TaxBookLineView[] }> {
  await assertClientAccess(clientId);
  const admin = createAdminSupabaseClient();
  type Raw = {
    id: string;
    debit_amount: number;
    credit_amount: number;
    tax_category: string | null;
    tax_rate: number | null;
    sub_account_id: string | null;
    journal_entry_id: string;
    accounts: { name: string; account_categories: { type: string } | null } | null;
    journal_entries: { client_id: string; entry_date: string; description: string | null; needs_review: boolean | null };
  };
  const raw = await fetchAllRows<Raw>((from, to) =>
    admin
      .from("journal_entry_lines")
      .select(
        `id, debit_amount, credit_amount, tax_category, tax_rate, sub_account_id, journal_entry_id,
         accounts!inner ( name, account_categories!inner ( type ) ),
         journal_entries!inner ( client_id, entry_date, description, needs_review )`
      )
      .eq("journal_entries.client_id", clientId)
      .gte("journal_entries.entry_date", dateFrom)
      .lte("journal_entries.entry_date", dateTo)
      .in("accounts.account_categories.type", ["revenue", "expenses"])
      .range(from, to) as unknown as PromiseLike<{ data: Raw[] | null; error: { message: string } | null }>
  );
  const subNames = await subAccountNames(admin, clientId);
  const exclusive = await loadExclusiveEntries(admin as unknown as SupabaseClient, clientId, dateFrom, dateTo);

  const bookLines = toTaxBookLines(
    raw.map((l) => ({
      entryId: l.journal_entry_id,
      accountType: l.accounts?.account_categories?.type ?? "",
      taxCategory: l.tax_category,
      taxRate: l.tax_rate,
      debit: Number(l.debit_amount) || 0,
      credit: Number(l.credit_amount) || 0,
      needsReview: Boolean(l.journal_entries.needs_review),
    })),
    exclusive
  );
  const summary = summarizeByTaxCategory(bookLines);

  const lines: TaxBookLineView[] = [];
  raw.forEach((l, i) => {
    const b = bookLines[i];
    const code = taxCodeOfLine(b);
    if (code === undefined) return;
    lines.push({
      lineId: l.id,
      entryId: l.journal_entry_id,
      entryDate: l.journal_entries.entry_date,
      description: l.journal_entries.description ?? "",
      accountName: l.accounts?.name ?? "",
      side: b.accountType === "revenue" ? "sales" : "purchase",
      code,
      codeName: code === "none" ? "税区分未設定" : taxCategoryInfo(code)?.name ?? code,
      ...lineTaxAmounts(b),
      exclusive: b.exclusive,
      subAccountName: l.sub_account_id ? subNames.get(l.sub_account_id) ?? null : null,
      needsReview: b.needsReview,
    });
  });
  lines.sort((a, b) => a.entryDate.localeCompare(b.entryDate));
  return { summary, lines };
}
