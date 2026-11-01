"use server";

/**
 * AIの取込箱（仕訳入力の「1つの箱」）。
 *
 *   1. 入れられた写真・PDFを、AIが何の書類かを先に見分ける（triageInboxDocument）
 *        領収書・請求書・売上日報 → processInboxReceipt（読み取り → 仕訳 → 迷った点を要確認ボックスへ）
 *        通帳・カード明細のPDF    → processInboxStatement（行を読み取り → 銀行CSVと同じ仕訳の候補の表へ）
 *   2. 表（CSV・Excel）は画面で読み、見出しで見分けられなければ classifyInboxTable でAIに聞く
 *   3. 要確認ボックス（ai_inbox_items）: AIの質問に利用者がチャットで答えると、AIが仕訳を直す（answerInboxItem）
 *
 * 決まり（何を聞くか・表の見分け方）は src/lib/inbox.ts（テストあり）。
 */

import { getGeminiModel, callGemini, extractJson, INJECTION_GUARD } from "@/lib/gemini";
import { createServerSupabaseClient, createAdminSupabaseClient } from "@/lib/supabase";
import { assertClientAccess, resolveClientIdForRecord } from "@/lib/authz";
import { downloadReceiptImage, getReceiptImageUrl } from "./receipt-storage";
import { processReceiptOcr, updateOcrResult } from "./ocr";
import { generateJournalSuggestion } from "./ai-journal";
import { extractStatementTransactions } from "./statement-lines";
import { analyzeBankCsv, type BankCsvSuggestion } from "./bank-csv-ai";
import { updateJournalEntryWithLines, deleteJournalEntries } from "./journals";
import { loadEntertainmentContext } from "@/lib/entertainment-db";
import { isEntertainmentKind, perPersonLimit } from "@/lib/entertainment";
import { chunk, classifyTable, reviewQuestionFor, statementLinesToTable, type InboxReason, type TableKind } from "@/lib/inbox";
import { TAX_CATEGORY_LIST, sanitizeTaxCategory } from "@/lib/tax-category";
import type { OcrResult } from "@/types/index";
import type { Json } from "@/types/database";

// ---------------------------------------------------------------------------
// 1. 書類の見分け
// ---------------------------------------------------------------------------

export type DocumentTriage = {
  kind: "receipt" | "statement" | "payroll" | "other";
  /** 明細書のとき: 通帳（bank）かカード明細（card）か */
  subtype: "bank" | "card" | null;
  legibility: "clear" | "partly_unclear" | "unreadable";
  /** 利用者に見せる一言（例: 「通帳のPDF（3ページ）」） */
  label: string;
};

/**
 * 写真・PDFが何の書類かを、軽いモデルで先に見分ける。
 * 明細書を領収書として読むと合計で1本の仕訳になり、領収書を明細書として読むと行がばらけるため、読む前に分ける。
 */
export async function triageInboxDocument(receiptId: string): Promise<DocumentTriage> {
  const clientId = await resolveClientIdForRecord("receipts", receiptId);
  const admin = createAdminSupabaseClient();
  const { data: receipt } = await admin.from("receipts").select("image_path, ocr_result").eq("id", receiptId).single();
  if (!receipt) throw new Error("証憑が見つかりません");
  const { data: bytes, mimeType } = await downloadReceiptImage(receipt.image_path as string);
  const model = getGeminiModel("text");
  const result = await callGemini(() =>
    model.generateContent([
      { inlineData: { mimeType: mimeType as "image/jpeg" | "image/png" | "application/pdf", data: Buffer.from(bytes).toString("base64") } },
      {
        text: `この${mimeType === "application/pdf" ? "PDF" : "画像"}が何の書類かを見分け、JSONだけを返してください。
{"kind":"receipt|statement|payroll|other","subtype":"bank|card|null","legibility":"clear|partly_unclear|unreadable","label":"利用者に見せる短い説明（例: レシート2枚、通帳の入出金明細、カード利用明細、給与明細、見積書）"}
- receipt: 領収書・レシート・請求書・納品書・売上日報（レジ締め）など、1件ずつの取引の書類（1枚に複数のレシートが写っていても receipt）
- statement: 銀行の通帳・入出金明細、クレジットカードの利用明細など、たくさんの取引が行で並んだもの（subtype で bank か card）
- payroll: 給与明細・給与台帳・賃金台帳
- other: 見積書・契約書・名刺など、上のどれでもないもの
- legibility: 日付・金額が読めないほどぼやけている・暗い・切れているなら unreadable、一部だけなら partly_unclear
${INJECTION_GUARD}`,
      },
    ])
  );
  const parsed = extractJson<Record<string, unknown>>(result.response.text(), "書類の見分け");
  const kind = (["receipt", "statement", "payroll", "other"] as const).find((k) => k === parsed.kind) ?? "receipt";
  const subtype = kind === "statement" ? (parsed.subtype === "card" ? "card" : "bank") : null;
  const legibility = (["clear", "partly_unclear", "unreadable"] as const).find((k) => k === parsed.legibility) ?? "clear";
  const label = typeof parsed.label === "string" && parsed.label.trim() ? parsed.label.trim().slice(0, 60) : kind === "statement" ? "明細書" : "証憑";

  if (kind === "statement") {
    // 明細書として記録しておく（証憑管理の「明細の取込」からも同じ行を扱える）
    const ocr = ((receipt.ocr_result as OcrResult | null) ?? { confidence: 0 }) as OcrResult;
    await admin
      .from("receipts")
      .update({ document_type: "statement", ocr_result: { ...ocr, document_type: "statement", statement_subtype: subtype ?? "bank" } as unknown as Json })
      .eq("id", receiptId)
      .eq("client_id", clientId);
  }
  return { kind, subtype, legibility, label };
}

// ---------------------------------------------------------------------------
// 2. 領収書・請求書の読み取りと要確認
// ---------------------------------------------------------------------------

export type InboxReceiptResult = {
  receiptId: string;
  date: string | null;
  vendor: string | null;
  amount: number | null;
  journalEntryId: string | null;
  /** 仕訳の主な科目（例: 「消耗品費」） */
  account: string | null;
  /** 要確認ボックスに入れたもの */
  itemId: string | null;
  reasonTitle: string | null;
};

type EntryWithLines = {
  id: string;
  receipt_id: string | null;
  needs_review: boolean;
  description: string | null;
  journal_entry_lines: {
    debit_amount: number;
    credit_amount: number;
    entertainment_kind: string | null;
    attendees: number | null;
    accounts: { name: string } | null;
  }[];
};

/**
 * 証憑を読み取って仕訳を作り、迷った点・読み取りにくい点を要確認ボックスに入れる。
 * 1枚の写真に複数のレシートがあれば、分けた証憑ごとに結果を返す。
 */
export async function processInboxReceipt(receiptId: string, fileName: string, memo?: string | null): Promise<InboxReceiptResult[]> {
  const clientId = await resolveClientIdForRecord("receipts", receiptId);
  const db = await createServerSupabaseClient();
  const {
    data: { user },
  } = await db.auth.getUser();

  let ocrFailed: string | null = null;
  try {
    await processReceiptOcr(receiptId, memo);
  } catch (e) {
    ocrFailed = e instanceof Error ? e.message : "読み取りに失敗しました";
  }

  const admin = createAdminSupabaseClient();
  const { data: base } = await admin.from("receipts").select("image_path").eq("id", receiptId).single();
  const { data: group } = await admin
    .from("receipts")
    .select("id, ocr_result, document_type, uploaded_at")
    .eq("client_id", clientId)
    .eq("image_path", (base?.image_path as string) ?? "")
    .order("uploaded_at", { ascending: true });
  const receipts = (group ?? []) as { id: string; ocr_result: OcrResult | null; document_type: string | null }[];
  const ids = receipts.map((r) => r.id);
  const { data: entries } = await admin
    .from("journal_entries")
    .select("id, receipt_id, needs_review, description, journal_entry_lines ( debit_amount, credit_amount, entertainment_kind, attendees, accounts:account_id ( name ) )")
    .in("receipt_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  const entryByReceipt = new Map(((entries ?? []) as unknown as EntryWithLines[]).map((e) => [e.receipt_id as string, e]));
  // AIが残した質問（仕訳の提案に入っている）
  const { data: suggs } = await admin.from("receipts").select("id, ai_journal_suggestion").in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  const questionByReceipt = new Map(
    (suggs ?? []).map((r) => [r.id as string, ((r.ai_journal_suggestion as { question?: string | null } | null)?.question ?? null) as string | null])
  );
  // 既に要確認に入っている証憑は二重に入れない（読み取り直したとき）
  const { data: existing } = await admin
    .from("ai_inbox_items")
    .select("id, receipt_id")
    .eq("client_id", clientId)
    .eq("status", "open")
    .in("receipt_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
  const existingByReceipt = new Map((existing ?? []).map((x) => [x.receipt_id as string, x.id as string]));

  const today = new Date().toISOString().slice(0, 10);
  const ent = await loadEntertainmentContext(admin, clientId, today);
  const out: InboxReceiptResult[] = [];
  for (const r of receipts.length ? receipts : [{ id: receiptId, ocr_result: null, document_type: null }]) {
    const ocr = r.ocr_result;
    const e = entryByReceipt.get(r.id) ?? null;
    const lines = (e?.journal_entry_lines ?? []).map((l) => ({
      accountName: l.accounts?.name ?? "",
      debit: Number(l.debit_amount) || 0,
      credit: Number(l.credit_amount) || 0,
      entertainmentKind: l.entertainment_kind,
      attendees: l.attendees,
    }));
    const q = reviewQuestionFor({
      fileName,
      ocr: ocrFailed && !ocr ? null : ocr,
      journal: e ? { needsReview: e.needs_review, description: e.description, question: questionByReceipt.get(r.id) ?? null, lines } : null,
      perPersonLimit: perPersonLimit(ocr?.date ?? today, ent.settings),
      underLimitAccount: ent.settings.underLimitAccount,
    });
    let itemId: string | null = existingByReceipt.get(r.id) ?? null;
    if (q && !itemId) {
      const { data: item, error } = await db
        .from("ai_inbox_items")
        .insert({
          client_id: clientId,
          kind: "receipt",
          reason: q.reason,
          title: q.title,
          question: q.question,
          options: q.options as unknown as Json,
          messages: [{ role: "ai", text: q.question, at: new Date().toISOString() }] as unknown as Json,
          receipt_id: r.id,
          journal_entry_id: e?.id ?? null,
          file_name: fileName,
          created_by: user?.id ?? null,
        })
        .select("id")
        .single();
      if (error) console.error("[ai-inbox] 要確認の登録に失敗:", error.message);
      itemId = item?.id ?? null;
    }
    const main = lines.find((l) => l.debit > 0 && !/仮払消費税|仮受消費税/.test(l.accountName)) ?? lines.find((l) => l.credit > 0 && !/消費税/.test(l.accountName));
    out.push({
      receiptId: r.id,
      date: ocr?.date ?? null,
      vendor: ocr?.vendor_name ?? null,
      amount: ocr?.amount_jpy ?? ocr?.amount_total ?? null,
      journalEntryId: e?.id ?? null,
      account: main?.accountName ?? null,
      itemId,
      reasonTitle: q?.title ?? null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3. 通帳・カード明細のPDF
// ---------------------------------------------------------------------------

export type StatementSuggestion = BankCsvSuggestion & { statementLineId: string };

/**
 * 明細書のPDF・写真から取引の行を読み、銀行CSVと同じ形の仕訳の候補にする（画面の「銀行明細」の表で確かめて登録）。
 */
export async function processInboxStatement(
  receiptId: string,
  subtype: "bank" | "card"
): Promise<{ suggestions: StatementSuggestion[]; warnings: string[]; lineCount: number }> {
  const clientId = await resolveClientIdForRecord("receipts", receiptId);
  const lines = (await extractStatementTransactions(receiptId)).filter((l) => l.status === "pending");
  const suggestions: StatementSuggestion[] = [];
  const warnings: string[] = [];
  let offset = 0;
  for (const part of chunk(lines, 50)) {
    const table = statementLinesToTable(
      part.map((l) => ({ date: l.line_date, description: l.description, counterparty: l.counterparty, amount: l.amount, direction: l.direction, balanceAfter: l.balance_after }))
    );
    const res = await analyzeBankCsv(clientId, table.header, table.rows, { kind: subtype });
    for (const s of res.suggestions) {
      const line = part[s.rowIdx];
      if (!line) continue;
      suggestions.push({ ...s, rowIdx: s.rowIdx + offset, statementLineId: line.id });
    }
    warnings.push(...res.warnings.map((w) => w.replace(/^行(\d+)/, (_, n) => `行${Number(n) + offset}`)));
    offset += part.length;
  }
  return { suggestions, warnings, lineCount: lines.length };
}

// ---------------------------------------------------------------------------
// 4. 表（CSV・Excel）の見分け
// ---------------------------------------------------------------------------

/** 見出しで見分けられない表を、最初の数行を見てAIに見分けてもらう */
export async function classifyInboxTable(clientId: string, header: string[], sample: string[][]): Promise<TableKind> {
  await assertClientAccess(clientId);
  const quick = classifyTable(header);
  if (quick !== "unknown") return quick;
  const model = getGeminiModel("text");
  const text = [header, ...sample.slice(0, 8)].map((r) => r.join(",")).join("\n");
  const result = await callGemini(() =>
    model.generateContent(`次の表が何の表かを1つ選び、JSONだけを返してください。{"kind":"journal|bank|card|payroll|unknown"}
journal=仕訳帳・会計ソフトの仕訳の書き出し、bank=銀行の入出金明細、card=クレジットカードの利用明細、payroll=給与台帳、unknown=それ以外
${INJECTION_GUARD}

${text}`)
  );
  const parsed = extractJson<{ kind?: string }>(result.response.text(), "表の見分け");
  return (["journal", "bank", "card", "payroll"] as const).find((k) => k === parsed.kind) ?? "unknown";
}

// ---------------------------------------------------------------------------
// 5. 要確認ボックスとチャット
// ---------------------------------------------------------------------------

export type InboxMessage = { role: "ai" | "user"; text: string; at: string };

export type InboxItem = {
  id: string;
  kind: "receipt" | "statement" | "table" | "consult" | "other";
  reason: InboxReason;
  status: "open" | "resolved" | "dismissed";
  title: string | null;
  question: string;
  options: string[];
  messages: InboxMessage[];
  receiptId: string | null;
  journalEntryId: string | null;
  fileName: string | null;
  createdAt: string;
  /** 重複だと答えたとき、証憑と仕訳を消すボタンを出す */
  suggestDelete: boolean;
};

type ItemRow = {
  id: string;
  kind: InboxItem["kind"];
  reason: InboxReason;
  status: InboxItem["status"];
  title: string | null;
  question: string;
  options: unknown;
  messages: unknown;
  receipt_id: string | null;
  journal_entry_id: string | null;
  file_name: string | null;
  created_at: string;
};

const ITEM_COLUMNS = "id, kind, reason, status, title, question, options, messages, receipt_id, journal_entry_id, file_name, created_at";

function toItem(r: ItemRow): InboxItem {
  const messages = (Array.isArray(r.messages) ? r.messages : []) as (InboxMessage & { suggestDelete?: boolean })[];
  return {
    id: r.id,
    kind: r.kind,
    reason: r.reason,
    status: r.status,
    title: r.title,
    question: r.question,
    options: (Array.isArray(r.options) ? r.options : []).filter((o): o is string => typeof o === "string"),
    messages: messages.map(({ role, text, at }) => ({ role, text, at })),
    receiptId: r.receipt_id,
    journalEntryId: r.journal_entry_id,
    fileName: r.file_name,
    createdAt: r.created_at,
    suggestDelete: Boolean(messages[messages.length - 1]?.suggestDelete),
  };
}

export async function listInboxItems(clientId: string, opts: { includeClosed?: boolean } = {}): Promise<InboxItem[]> {
  await assertClientAccess(clientId);
  const db = await createServerSupabaseClient();
  let q = db.from("ai_inbox_items").select(ITEM_COLUMNS).eq("client_id", clientId).order("created_at", { ascending: false }).limit(100);
  if (!opts.includeClosed) q = q.eq("status", "open");
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return ((data ?? []) as ItemRow[]).map(toItem);
}

export type InboxItemDetail = InboxItem & {
  imageUrl: string | null;
  mimeType: string | null;
  journal: {
    entryDate: string;
    description: string | null;
    lines: { accountName: string; debit: number; credit: number; taxCategory: string | null; entertainmentKind: string | null; attendees: number | null }[];
  } | null;
};

export async function getInboxItemDetail(itemId: string): Promise<InboxItemDetail> {
  const db = await createServerSupabaseClient();
  const { data, error } = await db.from("ai_inbox_items").select(ITEM_COLUMNS).eq("id", itemId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("要確認の項目が見つかりません");
  const item = toItem(data as ItemRow);
  let imageUrl: string | null = null;
  let mimeType: string | null = null;
  if (item.receiptId) {
    const { data: r } = await db.from("receipts").select("image_path, mime_type").eq("id", item.receiptId).maybeSingle();
    if (r?.image_path) {
      imageUrl = await getReceiptImageUrl(r.image_path as string);
      mimeType = (r.mime_type as string | null) ?? null;
    }
  }
  return { ...item, imageUrl, mimeType, journal: item.journalEntryId ? await loadJournal(item.journalEntryId) : null };
}

async function loadJournal(entryId: string): Promise<InboxItemDetail["journal"]> {
  const db = await createServerSupabaseClient();
  const { data } = await db
    .from("journal_entries")
    .select("entry_date, description, journal_entry_lines ( debit_amount, credit_amount, tax_category, entertainment_kind, attendees, sort_order, accounts:account_id ( name ) )")
    .eq("id", entryId)
    .maybeSingle();
  if (!data) return null;
  type L = { debit_amount: number; credit_amount: number; tax_category: string | null; entertainment_kind: string | null; attendees: number | null; sort_order: number; accounts: { name: string } | null };
  const lines = ((data.journal_entry_lines ?? []) as unknown as L[]).sort((a, b) => a.sort_order - b.sort_order);
  return {
    entryDate: data.entry_date as string,
    description: (data.description as string | null) ?? null,
    lines: lines.map((l) => ({
      accountName: l.accounts?.name ?? "",
      debit: Number(l.debit_amount) || 0,
      credit: Number(l.credit_amount) || 0,
      taxCategory: l.tax_category,
      entertainmentKind: l.entertainment_kind,
      attendees: l.attendees,
    })),
  };
}

export async function setInboxItemStatus(itemId: string, status: "open" | "resolved" | "dismissed"): Promise<void> {
  const db = await createServerSupabaseClient();
  const { data: item } = await db.from("ai_inbox_items").select("id, journal_entry_id").eq("id", itemId).maybeSingle();
  if (!item) throw new Error("要確認の項目が見つかりません");
  const { error } = await db
    .from("ai_inbox_items")
    .update({ status, resolved_at: status === "open" ? null : new Date().toISOString() })
    .eq("id", itemId);
  if (error) throw new Error(error.message);
  // 「このままでよい」は、仕訳を確かめたことにする
  if (status !== "open" && item.journal_entry_id) {
    await db.from("journal_entries").update({ needs_review: false }).eq("id", item.journal_entry_id as string);
  }
}

/** 重複していた証憑と、その証憑から作った仕訳を消す（利用者がボタンで選んだときだけ） */
export async function deleteInboxDuplicate(itemId: string): Promise<void> {
  const db = await createServerSupabaseClient();
  const { data: item } = await db.from("ai_inbox_items").select("id, client_id, receipt_id, journal_entry_id").eq("id", itemId).maybeSingle();
  if (!item) throw new Error("要確認の項目が見つかりません");
  const clientId = await assertClientAccess(item.client_id as string);
  if (item.journal_entry_id) await deleteJournalEntries([item.journal_entry_id as string]);
  if (item.receipt_id) {
    const admin = createAdminSupabaseClient();
    const { data: r } = await admin.from("receipts").select("image_path").eq("id", item.receipt_id as string).eq("client_id", clientId).maybeSingle();
    await admin.from("comments").delete().eq("receipt_id", item.receipt_id as string);
    await admin.from("receipts").delete().eq("id", item.receipt_id as string).eq("client_id", clientId);
    // 同じ写真から分けたほかの証憑が使っている画像は残す
    if (r?.image_path) {
      const { count } = await admin.from("receipts").select("id", { count: "exact", head: true }).eq("image_path", r.image_path as string);
      if (!count) {
        const { deleteReceiptImage } = await import("./receipt-storage");
        await deleteReceiptImage(r.image_path as string).catch(() => {});
      }
    }
  }
  await db.from("ai_inbox_items").update({ status: "resolved", resolved_at: new Date().toISOString() }).eq("id", itemId);
}

/** 証憑を指定しない相談（「この支払いは何の科目？」など）を始める */
export async function startInboxConsult(clientId: string, text: string): Promise<InboxItem> {
  await assertClientAccess(clientId);
  const body = text.trim().slice(0, 2000);
  if (!body) throw new Error("相談の内容を入れてください");
  const db = await createServerSupabaseClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  const { data, error } = await db
    .from("ai_inbox_items")
    .insert({
      client_id: clientId,
      kind: "consult",
      reason: "consult",
      title: body.slice(0, 40),
      question: body,
      messages: [] as unknown as Json,
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "相談を始められませんでした");
  return answerInboxItem(data.id as string, body);
}

type AiAnswer = {
  reply?: string;
  resolved?: boolean;
  next_question?: string | null;
  options?: unknown;
  journal?: {
    entry_date?: string;
    description?: string;
    lines?: {
      account_name?: string;
      debit_amount?: number;
      credit_amount?: number;
      tax_category?: string | null;
      entertainment_kind?: string | null;
      attendees?: number | null;
      attendee_note?: string | null;
    }[];
  } | null;
  ocr_fix?: { date?: string; vendor_name?: string; amount_total?: number; payment_method?: string } | null;
  suggest_delete?: boolean;
};

const TAX_PROMPT = TAX_CATEGORY_LIST.map((c) => `- ${c.code}: ${c.name}`).join("\n");

/**
 * 利用者の答えを受け取り、AIが返事をして、必要なら仕訳を直す。
 * 直した結果（貸借・科目・締めた年度）は既存の仕訳の更新処理で確かめる。直せなかったときは理由を返事に足す。
 */
export async function answerInboxItem(itemId: string, text: string): Promise<InboxItem> {
  const answer = text.trim().slice(0, 2000);
  if (!answer) throw new Error("答えを入れてください");
  const db = await createServerSupabaseClient();
  const { data: row, error } = await db.from("ai_inbox_items").select(`client_id, ${ITEM_COLUMNS}`).eq("id", itemId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw new Error("要確認の項目が見つかりません");
  const clientId = await assertClientAccess((row as { client_id: string }).client_id);
  const item = toItem(row as unknown as ItemRow);
  const admin = createAdminSupabaseClient();

  // ---- 文脈を集める ----
  const [{ data: client }, { data: accounts }] = await Promise.all([
    admin.from("clients").select("entity_type, consumption_tax_status").eq("id", clientId).maybeSingle(),
    admin
      .from("accounts")
      .select("id, name, account_categories(type, name)")
      .or(`client_id.eq.${clientId},client_id.is.null`)
      .eq("is_active", true)
      .order("code"),
  ]);
  const accountList = (accounts ?? []) as unknown as { id: string; name: string; account_categories: { type: string; name: string } | null }[];
  const accountIdByName = new Map(accountList.map((a) => [a.name, a.id]));
  const receipt = item.receiptId
    ? ((await admin.from("receipts").select("ocr_result, document_type, payment_method, direction, original_filename").eq("id", item.receiptId).maybeSingle()).data as {
        ocr_result: OcrResult | null;
        document_type: string | null;
        payment_method: string | null;
        direction: string | null;
        original_filename: string | null;
      } | null)
    : null;
  const journal = item.journalEntryId ? await loadJournal(item.journalEntryId) : null;
  const ent = await loadEntertainmentContext(admin, clientId, receipt?.ocr_result?.date ?? new Date().toISOString().slice(0, 10));
  const history = item.messages.map((m) => `${m.role === "ai" ? "AI" : "利用者"}: ${m.text}`).join("\n");
  const ocr = receipt?.ocr_result;

  const context =
    item.kind === "consult"
      ? "（証憑の指定なし。経理の相談）"
      : `## 証憑の読み取り結果
- ファイル: ${item.fileName ?? receipt?.original_filename ?? "不明"}
- 書類の種類: ${receipt?.document_type ?? "不明"} / ${receipt?.direction === "issued" ? "自社が発行" : "取引先から受領"}
- 日付: ${ocr?.date ?? "不明"} / 支払先: ${ocr?.vendor_name ?? "不明"} / 合計（税込）: ${ocr?.amount_jpy ?? ocr?.amount_total ?? "不明"} / 消費税: ${ocr?.tax_amount ?? "不明"}
- 品目: ${ocr?.items?.join("、") ?? "不明"} / 支払方法: ${receipt?.payment_method ?? ocr?.payment_method ?? "不明"} / 人数の印字: ${ocr?.guest_count ?? "なし"} / 源泉徴収税額: ${ocr?.withholding_tax ?? "なし"}
- 読み取りやすさ: ${ocr?.legibility ?? "不明"}${ocr?.unclear_fields?.length ? `（読みにくい項目: ${ocr.unclear_fields.join("・")}）` : ""}

## 今の仕訳
${
  journal
    ? `日付 ${journal.entryDate} / 摘要 ${journal.description ?? ""}\n` +
      journal.lines
        .map((l) => `- ${l.accountName} 借方 ${l.debit} 貸方 ${l.credit} 税区分 ${l.taxCategory ?? "null"} 交際費区分 ${l.entertainmentKind ?? "null"} 人数 ${l.attendees ?? "null"}`)
        .join("\n")
    : "まだ仕訳はありません"
}`;

  const prompt = `あなたは日本の会計事務所で働く経理のAIエージェントです。顧問先の利用者と、取り込んだ証憑や経理の疑問について話しています。
利用者の答えをもとに、会計として正しい仕訳に直すのが役目です。分からないことは1つずつ短く聞き返してください。
${INJECTION_GUARD}

## 顧問先
- 区分: ${client?.entity_type === "individual" ? "個人事業主" : "法人"} / 消費税: ${client?.consumption_tax_status === "exempt" ? "免税事業者" : "課税事業者"}

## この会社の交際費の決まり
${ent.prompt}

${context}

## 使える勘定科目（この中の名前だけを使う）
${accountList.map((a) => `${a.name}（${a.account_categories?.name ?? ""}）`).join("、")}

## 税区分のコード（費用・収益の行だけに付ける。現金・預金・未払金・預り金・仮払消費税の行は null）
${TAX_PROMPT}

## ${item.kind === "consult" ? "相談の最初の内容" : "AIの最初の質問"}
${item.question}

## これまでの会話
${history || "（なし）"}

## 利用者の今回の答え
${answer}

## 返し方（JSONだけ）
{
  "reply": "利用者への返事（です・ます調で2〜3文。直した内容は科目と金額を具体的に）",
  "resolved": true または false,
  "next_question": "まだ聞くことがあれば次の質問（1つだけ）。無ければ null",
  "options": ["次の質問にすぐ答えられる短い答えの候補（0〜3個）"],
  "journal": null または {"entry_date":"YYYY-MM-DD","description":"摘要","lines":[{"account_name":"科目名","debit_amount":数値,"credit_amount":数値,"tax_category":"コードまたはnull","entertainment_kind":"dining|dining_under_limit|gift|golf|condolence|otherまたはnull","attendees":人数またはnull,"attendee_note":"相手の名前・関係またはnull"}]},
  "ocr_fix": null または {"date":"YYYY-MM-DD","vendor_name":"支払先","amount_total":税込の合計,"payment_method":"cash|card|e_money|bank_transfer"},
  "suggest_delete": false
}
決まり:
- 仕訳を直すときは journal に「直した後の仕訳の全部の行」を入れる（借方の合計＝貸方の合計）。直さないなら null
- 仕訳がまだ無く（読み取れなかった証憑など）、利用者が日付・金額・支払先を教えてくれたら ocr_fix に入れる（仕訳はシステムが作る）。journal は null
- 1人当たりの額は、費用の行の額 ÷ 人数（円未満は切り上げ）。取引先などとの飲食で基準額以下なら「${ent.settings.underLimitAccount}」（entertainment_kind は dining_under_limit・人数と相手を入れる）、超えるなら接待交際費（dining）。社内の人だけなら除けない
- 私的な支出だと分かったら、法人は役員貸付金（または仮払金）、個人事業主は事業主貸にする
- 重複していると利用者が言ったら suggest_delete を true にし、reply で「下の［重複を削除］ボタンで消せます」と伝える（自分では消さない）
- 「撮り直します」と言われたら、reply で「新しい写真を上の箱に入れてください」と伝え、resolved は false
- 利用者が「合っています」など今の内容でよいと答えたら journal は null、resolved は true
- 経理の相談（証憑の指定なし）には、一般的な考え方と、この会社の決まりに沿った答えを返す。journal・ocr_fix は null。税務の最終判断は税理士に確認するよう添える`;

  const model = getGeminiModel("text");
  const result = await callGemini(() => model.generateContent(prompt));
  const ai = extractJson<AiAnswer>(result.response.text(), "AIの返事");

  // ---- 答えに応じて直す ----
  let reply = typeof ai.reply === "string" && ai.reply.trim() ? ai.reply.trim() : "承知しました。";
  let resolved = ai.resolved === true;
  let journalEntryId = item.journalEntryId;
  const notes: string[] = [];

  if (ai.journal?.lines?.length && journalEntryId) {
    try {
      // 補助科目は、同じ科目の今の行のものを引き継ぐ（AIは補助科目を返さない）
      const { data: oldLines } = await db.from("journal_entry_lines").select("account_id, sub_account_id").eq("journal_entry_id", journalEntryId);
      const subByAccount = new Map(
        (oldLines ?? []).filter((o) => o.sub_account_id).map((o) => [o.account_id as string, o.sub_account_id as string])
      );
      const lines = ai.journal.lines.map((l) => {
        const accountId = accountIdByName.get(String(l.account_name ?? ""));
        if (!accountId) throw new Error(`「${l.account_name}」という科目が見つかりません`);
        return {
          account_id: accountId,
          sub_account_id: subByAccount.get(accountId) ?? null,
          debit_amount: Math.round(Number(l.debit_amount) || 0),
          credit_amount: Math.round(Number(l.credit_amount) || 0),
          tax_category: sanitizeTaxCategory(l.tax_category ?? null),
          entertainment_kind: isEntertainmentKind(l.entertainment_kind) ? l.entertainment_kind : null,
          attendees: Number.isInteger(l.attendees) && (l.attendees as number) > 0 && (l.attendees as number) <= 10_000 ? (l.attendees as number) : null,
          attendee_note: typeof l.attendee_note === "string" && l.attendee_note.trim() ? l.attendee_note.trim().slice(0, 500) : null,
        };
      });
      const date = /^\d{4}-\d{2}-\d{2}$/.test(ai.journal.entry_date ?? "") ? (ai.journal.entry_date as string) : journal?.entryDate;
      await updateJournalEntryWithLines(
        journalEntryId,
        { entry_date: date ?? new Date().toISOString().slice(0, 10), description: ai.journal.description ?? journal?.description ?? null, needs_review: !resolved },
        lines
      );
    } catch (e) {
      resolved = false;
      notes.push(`（仕訳は直せませんでした: ${e instanceof Error ? e.message : "不明なエラー"}。仕訳一覧から直接直すこともできます）`);
    }
  } else if (ai.ocr_fix && item.receiptId && !journalEntryId) {
    // 読み取れなかった証憑: 教えてもらった内容で読み取り結果を直し、仕訳を作る
    try {
      const fix: Partial<OcrResult> = { legibility: "clear" };
      if (ai.ocr_fix.date && /^\d{4}-\d{2}-\d{2}$/.test(ai.ocr_fix.date)) fix.date = ai.ocr_fix.date;
      if (ai.ocr_fix.vendor_name) fix.vendor_name = String(ai.ocr_fix.vendor_name).slice(0, 100);
      const amt = Number(ai.ocr_fix.amount_total);
      if (Number.isFinite(amt) && amt > 0) fix.amount_total = Math.round(amt);
      await updateOcrResult(item.receiptId, fix);
      const pm = ["cash", "card", "e_money", "bank_transfer"].find((x) => x === ai.ocr_fix?.payment_method);
      if (pm) await db.from("receipts").update({ payment_method: pm as "cash" }).eq("id", item.receiptId);
      if (fix.amount_total) {
        await generateJournalSuggestion(item.receiptId, answer);
        const { data: je } = await db.from("journal_entries").select("id").eq("receipt_id", item.receiptId).order("created_at", { ascending: false }).limit(1);
        journalEntryId = (je?.[0]?.id as string | undefined) ?? null;
        if (journalEntryId) {
          const j = await loadJournal(journalEntryId);
          const main = j?.lines.find((l) => l.debit > 0 && !/消費税/.test(l.accountName));
          notes.push(main ? `仕訳を作りました（${main.accountName} ${main.debit.toLocaleString()}円）。` : "仕訳を作りました。");
        }
      }
    } catch (e) {
      resolved = false;
      notes.push(`（仕訳を作れませんでした: ${e instanceof Error ? e.message : "不明なエラー"}）`);
    }
  } else if (resolved && journalEntryId) {
    await db.from("journal_entries").update({ needs_review: false }).eq("id", journalEntryId);
  }

  if (notes.length) reply = `${reply}\n${notes.join("\n")}`;
  const next = !resolved && typeof ai.next_question === "string" && ai.next_question.trim() ? ai.next_question.trim() : null;
  const options = Array.isArray(ai.options) ? (ai.options as unknown[]).filter((o): o is string => typeof o === "string").slice(0, 3) : [];
  const now = new Date().toISOString();
  const messages = [
    ...item.messages,
    { role: "user", text: answer, at: now },
    { role: "ai", text: next ? `${reply}\n\n${next}` : reply, at: now, ...(ai.suggest_delete ? { suggestDelete: true } : {}) },
  ];
  const { data: updated, error: upErr } = await db
    .from("ai_inbox_items")
    .update({
      messages: messages as unknown as Json,
      // 相談は答えたら閉じる（同じ会話は続けられる）。要確認ボックスには証憑の確認だけを残す
      status: resolved || item.kind === "consult" ? "resolved" : "open",
      resolved_at: resolved || item.kind === "consult" ? now : null,
      question: next ?? item.question,
      options: (next ? options : resolved ? [] : options) as unknown as Json,
      journal_entry_id: journalEntryId,
    })
    .eq("id", itemId)
    .select(ITEM_COLUMNS)
    .single();
  if (upErr || !updated) throw new Error(upErr?.message ?? "会話を保存できませんでした");
  return toItem(updated as ItemRow);
}
