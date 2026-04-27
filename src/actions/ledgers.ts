"use server";

import { createAdminSupabaseClient } from "@/lib/supabase";

export interface JournalLedgerLine {
  debitAccount: string;
  debitCode: string;
  debitAmount: number;
  creditAccount: string;
  creditCode: string;
  creditAmount: number;
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

export interface CounterAccountDetail {
  name: string;
  debit: number;
  credit: number;
}

export interface GeneralLedgerRow {
  date: string;
  id: string;
  description: string;
  counterAccount: string;
  counterAccountDetails?: CounterAccountDetail[];
  debit: number;
  credit: number;
  balance: number;
}

export async function getJournalLedger(
  clientId: string,
  dateFrom: string,
  dateTo: string
): Promise<JournalLedgerRow[]> {
  const supabase = createAdminSupabaseClient();

  const { data: entries, error } = await supabase
    .from("journal_entries")
    .select(`
      id, entry_date, created_at, description, source, receipt_id,
      receipts:receipt_id ( payment_method ),
      journal_entry_lines (
        debit_amount, credit_amount, sort_order,
        accounts:account_id ( code, name )
      )
    `)
    .eq("client_id", clientId)
    .eq("needs_review", false)
    .gte("entry_date", dateFrom)
    .lte("entry_date", dateTo)
    .order("entry_date", { ascending: true });

  if (error) throw new Error(error.message);

  const rows: JournalLedgerRow[] = [];
  for (const entry of entries ?? []) {
    const rawLines = (entry.journal_entry_lines ?? []) as {
      debit_amount: number;
      credit_amount: number;
      sort_order: number;
      accounts: { code: string; name: string } | null;
    }[];
    const sorted = [...rawLines].sort((a, b) => a.sort_order - b.sort_order);

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

export async function getAccountList(clientId: string): Promise<string[]> {
  const supabase = createAdminSupabaseClient();

  const { data, error } = await supabase
    .from("accounts")
    .select("name")
    .or(`client_id.eq.${clientId},is_default.eq.true`)
    .eq("is_active", true)
    .order("code");

  if (error) throw new Error(error.message);
  return (data ?? []).map((a) => a.name);
}

export async function getGeneralLedger(
  clientId: string,
  accountName: string,
  dateFrom: string,
  dateTo: string
): Promise<GeneralLedgerRow[]> {
  const supabase = createAdminSupabaseClient();

  // Find account id by name
  const { data: accts } = await supabase
    .from("accounts")
    .select("id, category_id")
    .or(`client_id.eq.${clientId},is_default.eq.true`)
    .eq("name", accountName)
    .limit(1);

  if (!accts || accts.length === 0) return [];
  const accountId = accts[0].id;
  const categoryId = accts[0].category_id;

  // Determine if this is a debit-normal account (assets, expenses)
  const { data: cat } = await supabase
    .from("account_categories")
    .select("type")
    .eq("id", categoryId)
    .single();

  const isDebitNormal = cat?.type === "assets" || cat?.type === "expenses";

  // Fetch all journal lines for this account within the date range
  const { data: lines, error } = await supabase
    .from("journal_entry_lines")
    .select(`
      debit_amount, credit_amount,
      journal_entries!inner ( id, entry_date, description, client_id,
        journal_entry_lines ( account_id, debit_amount, credit_amount, accounts:account_id ( name ) )
      )
    `)
    .eq("account_id", accountId)
    .eq("journal_entries.client_id", clientId)
    .gte("journal_entries.entry_date", dateFrom)
    .lte("journal_entries.entry_date", dateTo);

  if (error) throw new Error(error.message);

  const rows: GeneralLedgerRow[] = [];
  let balance = 0;

  // Sort by entry_date
  const sorted = [...(lines ?? [])].sort((a, b) => {
    const entryA = a.journal_entries as unknown as { entry_date: string };
    const entryB = b.journal_entries as unknown as { entry_date: string };
    return entryA.entry_date.localeCompare(entryB.entry_date);
  });

  for (const line of sorted) {
    const entry = line.journal_entries as unknown as {
      id: string;
      entry_date: string;
      description: string | null;
      journal_entry_lines: { account_id: string; debit_amount: number; credit_amount: number; accounts: { name: string } | null }[];
    };

    // Find counter account(s) - other lines in the same entry
    const otherLines = (entry.journal_entry_lines ?? []).filter(
      (l) => l.account_id !== accountId
    );

    // 複数の相手勘定科目 → 諸口として表示（内訳はdetailsで保持）
    let counterAccount: string;
    let counterAccountDetails: CounterAccountDetail[] | undefined;
    if (otherLines.length > 1) {
      counterAccount = "諸口";
      counterAccountDetails = otherLines.map((l) => ({
        name: l.accounts?.name ?? "",
        debit: l.debit_amount,
        credit: l.credit_amount,
      }));
    } else if (otherLines.length === 1) {
      counterAccount = otherLines[0].accounts?.name ?? "-";
    } else {
      counterAccount = "-";
    }

    if (isDebitNormal) {
      balance += line.debit_amount - line.credit_amount;
    } else {
      balance += line.credit_amount - line.debit_amount;
    }

    rows.push({
      date: entry.entry_date,
      id: entry.id.slice(0, 8),
      description: entry.description ?? "",
      counterAccount,
      counterAccountDetails,
      debit: line.debit_amount,
      credit: line.credit_amount,
      balance,
    });
  }

  return rows;
}

export async function getJournalEntryDetail(
  journalEntryId: string
): Promise<JournalEntryDetail | null> {
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
