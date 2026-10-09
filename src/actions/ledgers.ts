"use server";

import { createAdminSupabaseClient } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/fetch-all";
import { assertClientAccess, resolveClientIdForRecord } from "@/lib/authz";

export interface JournalLedgerLine {
  debitAccount: string;
  debitCode: string;
  debitAmount: number;
  creditAccount: string;
  creditCode: string;
  creditAmount: number;
  /** 税区分（費用・収益の行だけ意味を持つ） */
  debitTax: string | null;
  creditTax: string | null;
  /** 費用・収益の行か（税区分が未設定なら一覧で知らせる） */
  debitIsPl: boolean;
  creditIsPl: boolean;
}

export interface JournalLedgerRow {
  date: string;
  createdAt: string;
  id: string;
  journalEntryId: string;
  description: string;
  debitAccount: string;
  creditAccount: string;
  debitAmount: number;
  creditAmount: number;
  source: string;
  receiptId: string | null;
  paymentMethod: string | null;
  /** 複合仕訳の各行（借方/貸方ペア） */
  lines: JournalLedgerLine[];
}

export interface JournalDetailItem {
  item_name: string;
  quantity: number;
  unit_price: number;
  tax_rate?: number;
  subtotal: number;
  tax_amount?: number;
}

export interface JournalEntryDetail {
  description: string;
  partnerName: string | null;
  date: string;
  source: string;
  items: JournalDetailItem[];
}

export async function getJournalLedger(
  clientId: string,
  dateFrom: string,
  dateTo: string
): Promise<JournalLedgerRow[]> {
  await assertClientAccess(clientId);
  const supabase = createAdminSupabaseClient();

  // 1000行の取得上限で黙って打ち切られないよう全件取得する。
  // 打ち切られると仕訳帳に古い仕訳が出てこなくなる
  type LedgerEntryRow = {
    id: string;
    entry_date: string;
    created_at: string;
    description: string | null;
    source: string | null;
    receipt_id: string | null;
    receipts: { payment_method: string | null } | null;
    journal_entry_lines: unknown[] | null;
  };
  const entries = await fetchAllRows<LedgerEntryRow>((from, to) =>
    supabase
      .from("journal_entries")
      .select(`
      id, entry_date, created_at, description, source, receipt_id,
      receipts:receipt_id ( payment_method ),
      journal_entry_lines (
        debit_amount, credit_amount, sort_order, tax_category,
        accounts:account_id ( code, name, account_categories:category_id ( type ) )
      )
    `)
      .eq("client_id", clientId)
      .eq("needs_review", false)
      .gte("entry_date", dateFrom)
      .lte("entry_date", dateTo)
      .order("entry_date", { ascending: true })
      .range(from, to) as unknown as PromiseLike<{
      data: LedgerEntryRow[] | null;
      error: { message: string } | null;
    }>
  );

  const rows: JournalLedgerRow[] = [];
  for (const entry of entries) {
    const rawLines = (entry.journal_entry_lines ?? []) as {
      debit_amount: number;
      credit_amount: number;
      sort_order: number;
      tax_category: string | null;
      accounts: { code: string; name: string; account_categories: { type: string } | null } | null;
    }[];
    const sorted = [...rawLines].sort((a, b) => a.sort_order - b.sort_order);
    const isPl = (l: (typeof rawLines)[number] | undefined) =>
      l?.accounts?.account_categories?.type === "revenue" || l?.accounts?.account_categories?.type === "expenses";

    const debitLines = sorted.filter((l) => l.debit_amount > 0);
    const creditLines = sorted.filter((l) => l.credit_amount > 0);

    const debitAccount = debitLines.map((l) => l.accounts?.name ?? "").join("・");
    const creditAccount = creditLines.map((l) => l.accounts?.name ?? "").join("・");
    const debitAmount = debitLines.reduce((s, l) => s + l.debit_amount, 0);
    const creditAmount = creditLines.reduce((s, l) => s + l.credit_amount, 0);

    // 複合仕訳の各行ペアを構築
    const maxLen = Math.max(debitLines.length, creditLines.length);
    const lines: JournalLedgerLine[] = [];
    for (let i = 0; i < maxLen; i++) {
      const dl = debitLines[i];
      const cl = creditLines[i];
      lines.push({
        debitAccount: dl?.accounts?.name ?? "",
        debitCode: dl?.accounts?.code ?? "",
        debitAmount: dl?.debit_amount ?? 0,
        creditAccount: cl?.accounts?.name ?? "",
        creditCode: cl?.accounts?.code ?? "",
        creditAmount: cl?.credit_amount ?? 0,
        debitTax: dl?.tax_category ?? null,
        creditTax: cl?.tax_category ?? null,
        debitIsPl: isPl(dl),
        creditIsPl: isPl(cl),
      });
    }

    rows.push({
      date: entry.entry_date,
      createdAt: (entry as unknown as { created_at: string }).created_at,
      id: entry.id.slice(0, 8),
      journalEntryId: entry.id,
      description: entry.description ?? "",
      debitAccount,
      creditAccount,
      debitAmount,
      creditAmount,
      source: (entry as unknown as { source: string }).source ?? "manual",
      receiptId: (entry as unknown as { receipt_id: string | null }).receipt_id,
      paymentMethod: (entry as unknown as { receipts: { payment_method: string } | null }).receipts?.payment_method ?? null,
      lines,
    });
  }

  return rows;
}

// ダッシュボード用：口座（現金・預金）残高サマリーと補助科目別残高一覧。
export interface AccountBalance {
  account_id: string;
  code: string;
  name: string;
  balance: number; // 符号付き（正＝正常残高側／負＝逆側）。表示側で絶対値＋借方残/貸方残タグにする。
  debitNormal: boolean; // 正常残高が借方側か（資産・費用）。負残時の向き判定に使用。
}
export interface SubAccountBalance {
  sub_account_id: string;
  sub_name: string;
  account_name: string;
  account_code: string;
  balance: number;
  debitNormal: boolean;
}
export interface BalanceSummary {
  accountBalances: AccountBalance[]; // 現金・預金の勘定科目
  cashTotal: number;
  subAccountBalances: SubAccountBalance[];
}

export async function getBalanceSummary(clientId: string): Promise<BalanceSummary> {
  await assertClientAccess(clientId);
  const supabase = createAdminSupabaseClient();

  // 勘定科目（事務所共通＋当該クライアント）を取得し、借方正/貸方正を判定。
  const { data: accounts, error: accErr } = await supabase
    .from("accounts")
    .select("id, code, name, account_categories:category_id ( type )")
    .or(`client_id.eq.${clientId},is_default.eq.true`)
    .eq("is_active", true);
  if (accErr) throw new Error(accErr.message);

  type AcctMeta = { code: string; name: string; type: string; debitNormal: boolean };
  const acctMap = new Map<string, AcctMeta>();
  for (const a of accounts ?? []) {
    const type =
      (a as unknown as { account_categories: { type: string } | null })
        .account_categories?.type ?? "";
    acctMap.set(a.id, {
      code: a.code,
      name: a.name,
      type,
      debitNormal: type === "assets" || type === "expenses",
    });
  }
  const acctIds = [...acctMap.keys()];
  if (acctIds.length === 0) {
    return { accountBalances: [], cashTotal: 0, subAccountBalances: [] };
  }

  // 補助科目を取得（account_id → 補助科目名）。
  const { data: subs } = await supabase
    .from("sub_accounts")
    .select("id, name, account_id")
    .eq("client_id", clientId)
    .eq("is_active", true);
  const subMap = new Map<string, { name: string; account_id: string }>();
  for (const s of subs ?? []) {
    subMap.set(s.id, { name: s.name, account_id: s.account_id });
  }

  // 確定済み仕訳（needs_review=false、本日以前）の明細を集計。
  const today = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const todayStr = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`;

  // 1000行の取得上限で黙って打ち切られないよう全ページ取得する
  type BalLine = {
    account_id: string;
    sub_account_id: string | null;
    debit_amount: number;
    credit_amount: number;
    journal_entries: { client_id: string; needs_review: boolean; entry_date: string };
  };
  const lines = await fetchAllRows<BalLine>((from, to) =>
    supabase
      .from("journal_entry_lines")
      .select(
        `account_id, sub_account_id, debit_amount, credit_amount,
       journal_entries!inner ( client_id, needs_review, entry_date )`
      )
      .eq("journal_entries.client_id", clientId)
      .eq("journal_entries.needs_review", false)
      .lte("journal_entries.entry_date", todayStr)
      .range(from, to) as unknown as PromiseLike<{ data: BalLine[] | null; error: { message: string } | null }>
  );

  const acctBalance = new Map<string, number>();
  const subBalance = new Map<string, number>();

  for (const l of lines ?? []) {
    const meta = acctMap.get(l.account_id);
    if (!meta) continue;
    const delta = meta.debitNormal
      ? l.debit_amount - l.credit_amount
      : l.credit_amount - l.debit_amount;
    acctBalance.set(l.account_id, (acctBalance.get(l.account_id) ?? 0) + delta);
    if (l.sub_account_id) {
      subBalance.set(
        l.sub_account_id,
        (subBalance.get(l.sub_account_id) ?? 0) + delta
      );
    }
  }

  // 口座 = 資産で名称に「現金/預金/貯金」を含む勘定科目。
  const isCash = (m: AcctMeta) => m.type === "assets" && /現金|預金|貯金/.test(m.name);
  const accountBalances: AccountBalance[] = [];
  let cashTotal = 0;
  for (const [id, m] of acctMap) {
    if (!isCash(m)) continue;
    const balance = acctBalance.get(id) ?? 0;
    accountBalances.push({
      account_id: id,
      code: m.code,
      name: m.name,
      balance,
      debitNormal: m.debitNormal,
    });
    cashTotal += balance;
  }
  accountBalances.sort((a, b) => a.code.localeCompare(b.code));

  // 補助科目別残高（残高が0でないもののみ）。
  const subAccountBalances: SubAccountBalance[] = [];
  for (const [id, bal] of subBalance) {
    if (bal === 0) continue;
    const sub = subMap.get(id);
    if (!sub) continue;
    const parent = acctMap.get(sub.account_id);
    subAccountBalances.push({
      sub_account_id: id,
      sub_name: sub.name,
      account_name: parent?.name ?? "",
      account_code: parent?.code ?? "",
      balance: bal,
      debitNormal: parent?.debitNormal ?? true,
    });
  }
  subAccountBalances.sort(
    (a, b) =>
      a.account_code.localeCompare(b.account_code) ||
      a.sub_name.localeCompare(b.sub_name)
  );

  return { accountBalances, cashTotal, subAccountBalances };
}

export async function getJournalEntryDetail(
  journalEntryId: string
): Promise<JournalEntryDetail | null> {
  await resolveClientIdForRecord("journal_entries", journalEntryId);
  const supabase = createAdminSupabaseClient();

  const { data: entry, error } = await supabase
    .from("journal_entries")
    .select("id, entry_date, description, source, receipt_id, metadata, raqto_source_id")
    .eq("id", journalEntryId)
    .single();

  if (error || !entry) return null;

  const typedEntry = entry as {
    id: string;
    entry_date: string;
    description: string | null;
    source: string;
    receipt_id: string | null;
    metadata: { order_number?: string; partner_name?: string; items?: JournalDetailItem[] } | null;
    raqto_source_id: string | null;
  };

  let items: JournalDetailItem[] = [];
  let partnerName: string | null = null;

  if (typedEntry.source === "raqto") {
    // 1. Check metadata.items (PO)
    if (typedEntry.metadata?.items && typedEntry.metadata.items.length > 0) {
      items = typedEntry.metadata.items;
      partnerName = typedEntry.metadata.partner_name ?? null;
    }
    // 2. Check receipt → ocr_result.items
    else if (typedEntry.receipt_id) {
      const { data: receipt } = await supabase
        .from("receipts")
        .select("ocr_result")
        .eq("id", typedEntry.receipt_id)
        .single();

      if (receipt) {
        const ocr = receipt.ocr_result as {
          vendor_name?: string;
          items?: JournalDetailItem[];
        } | null;
        items = ocr?.items ?? [];
        partnerName = ocr?.vendor_name ?? null;
      }
    }
    // 3. Check invoices → invoice_items
    else {
      const { data: invoice } = await supabase
        .from("invoices")
        .select("id, business_partner_id")
        .eq("journal_entry_id", typedEntry.id)
        .maybeSingle();

      if (invoice) {
        const { data: invItems } = await supabase
          .from("invoice_items")
          .select("item_name, quantity, unit_price, tax_rate, subtotal, tax_amount")
          .eq("invoice_id", invoice.id)
          .order("sort_order");

        items = (invItems ?? []).map((it) => ({
          item_name: it.item_name,
          quantity: it.quantity,
          unit_price: it.unit_price,
          tax_rate: it.tax_rate,
          subtotal: it.subtotal,
          tax_amount: it.tax_amount,
        }));

        // Get partner name
        const { data: partner } = await supabase
          .from("business_partners")
          .select("name")
          .eq("id", invoice.business_partner_id)
          .single();

        partnerName = partner?.name ?? null;
      }
    }
  }

  return {
    description: typedEntry.description ?? "",
    partnerName,
    date: typedEntry.entry_date,
    source: typedEntry.source,
    items,
  };
}

export type ReceiptJournalRef = { id: string; entryDate: string; description: string; needsReview: boolean };

/** 証憑から作られた仕訳（証憑の画面から仕訳帳・元帳へ移るために使う） */
export async function getJournalEntriesForReceipt(receiptId: string): Promise<ReceiptJournalRef[]> {
  const clientId = await resolveClientIdForRecord("receipts", receiptId);
  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from("journal_entries")
    .select("id, entry_date, description, needs_review")
    .eq("client_id", clientId)
    .eq("receipt_id", receiptId)
    .order("entry_date");
  if (error) throw new Error(error.message);
  return (data ?? []).map((e) => ({
    id: e.id as string,
    entryDate: e.entry_date as string,
    description: (e.description as string | null) ?? "",
    needsReview: Boolean(e.needs_review),
  }));
}
