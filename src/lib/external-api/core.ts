/**
 * 外部連携の受け口（/api/v1）の中身。
 *
 * 決まり（設計: Secretary/経理/自動仕訳/docs/Raqto会計_受け口API_設計.md）
 * - 会社と操作者は APIキーで決める。本文に client_id があっても使わない
 * - 仕訳は確定済み（status=confirmed・needs_review=false）で登録する
 * - 中身の確かめは CSV 取り込み（importJournalEntries）と同じ：日付・その会社の科目・
 *   金額は正の整数・借方と貸方の合計が同じ。締めた年度（ロック済み）には入れない
 * - 同じ external_id は二重に作らず、前に作った仕訳を返す。同じ証憑ファイルは登録済みの id を返す
 *
 * データの読み書きは ExternalApiStore を通す（本番は Supabase、テストは手元の入れ物）。
 */

import type { Database, Json } from "@/types/database";
import { sanitizeTaxCategory, taxCategoryAllowed, taxCategoryInfo } from "@/lib/tax-category";
import {
  ReceiptInputError,
  normalizePaymentMethod,
  storeReceiptFile,
  type ReceiptUploadIO,
} from "@/lib/receipt-upload";
import { hashApiKey, parseBearer, type ApiScope } from "./keys";

/** キーごとの1分あたりの呼び出し回数の上限 */
export const RATE_LIMIT_PER_MINUTE = 60;
/** 1つの仕訳の明細の行数の上限 */
const MAX_LINES = 100;

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: string[]
  ) {
    super(message);
  }
}

export function errorBody(e: ApiError) {
  return { error: { code: e.code, message: e.message, ...(e.details?.length ? { details: e.details } : {}) } };
}

export type ApiKeyRecord = {
  id: string;
  client_id: string;
  user_id: string;
  scopes: string[];
  revoked_at: string | null;
};

export type ApiContext = { keyId: string; clientId: string; userId: string; scopes: string[] };

export type AccountRef = { id: string; code: string; name: string; type: string; is_active: boolean };

export type JournalSummary = {
  id: string;
  external_id: string | null;
  entry_date: string;
  description: string | null;
  status: string;
  needs_review: boolean;
  receipt_id: string | null;
  created_at: string;
};

type JournalEntryInsert = Database["public"]["Tables"]["journal_entries"]["Insert"];
type JournalLineInsert = Database["public"]["Tables"]["journal_entry_lines"]["Insert"];
export type NewJournalLine = Omit<JournalLineInsert, "journal_entry_id">;

export interface ExternalApiStore {
  findKeyByHash(hash: string): Promise<ApiKeyRecord | null>;
  /** 回数を1つ数え、上限以内なら true（最終利用日時も更新する） */
  hitRateLimit(keyId: string, limit: number): Promise<boolean>;
  getClientName(clientId: string): Promise<string | null>;
  listAccounts(clientId: string): Promise<AccountRef[]>;
  /** その日付がロック済みの会計年度に入っているか */
  isDateLocked(clientId: string, date: string): Promise<boolean>;
  findJournalByExternalId(clientId: string, externalId: string): Promise<JournalSummary | null>;
  receiptExists(clientId: string, receiptId: string): Promise<boolean>;
  /** 仕訳と明細を作る。(client_id, external_id) が既にあれば "conflict" */
  insertJournal(entry: JournalEntryInsert, lines: NewJournalLine[]): Promise<{ id: string } | "conflict">;
  markReceiptJournalized(clientId: string, receiptId: string, userId: string): Promise<void>;
  receiptIO: ReceiptUploadIO;
}

// ---------------------------------------------------------------------------
// 認証
// ---------------------------------------------------------------------------

export async function authenticate(
  store: ExternalApiStore,
  authorization: string | null | undefined,
  scope?: ApiScope
): Promise<ApiContext> {
  const key = parseBearer(authorization);
  if (!key) {
    throw new ApiError(401, "unauthorized", "APIキーがありません。Authorization: Bearer rk_… を付けてください");
  }
  const rec = await store.findKeyByHash(hashApiKey(key));
  if (!rec) throw new ApiError(401, "invalid_key", "APIキーが正しくありません");
  if (rec.revoked_at) throw new ApiError(401, "revoked_key", "このAPIキーは無効にされています");
  if (scope && !rec.scopes.includes(scope)) {
    throw new ApiError(403, "insufficient_scope", `このAPIキーには「${scope}」の権限がありません`);
  }
  if (!(await store.hitRateLimit(rec.id, RATE_LIMIT_PER_MINUTE))) {
    throw new ApiError(429, "rate_limited", `呼び出しが多すぎます（1分あたり${RATE_LIMIT_PER_MINUTE}回まで）。少し待ってから送り直してください`);
  }
  return { keyId: rec.id, clientId: rec.client_id, userId: rec.user_id, scopes: rec.scopes };
}

export async function ping(store: ExternalApiStore, ctx: ApiContext) {
  return {
    ok: true,
    client: { id: ctx.clientId, name: await store.getClientName(ctx.clientId) },
    scopes: ctx.scopes,
  };
}

// ---------------------------------------------------------------------------
// 仕訳
// ---------------------------------------------------------------------------

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRealDate(s: string): boolean {
  const m = s.match(DATE_RE);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function journalResponse(j: JournalSummary, duplicate: boolean) {
  return {
    journal_entry_id: j.id,
    external_id: j.external_id,
    entry_date: j.entry_date,
    description: j.description,
    status: j.status,
    needs_review: j.needs_review,
    receipt_id: j.receipt_id,
    created_at: j.created_at,
    duplicate,
  };
}

export type ApiResult = { status: number; body: unknown };

/**
 * POST /api/v1/journals
 * 本文: { external_id, entry_date, description?, receipt_id?, lines: [{ account, debit, credit, tax_category? }], metadata? }
 */
export async function createJournalFromApi(store: ExternalApiStore, ctx: ApiContext, body: unknown): Promise<ApiResult> {
  if (!isPlainObject(body)) throw new ApiError(400, "invalid_body", "本文は JSON のオブジェクトで送ってください");

  const externalId = typeof body.external_id === "string" ? body.external_id.trim() : "";
  if (!externalId || externalId.length > 200) {
    throw new ApiError(400, "invalid_external_id", "external_id（1〜200文字）を付けてください");
  }

  // 同じ外部IDは前に作った仕訳を返す（送り直しても二重にならない）
  const existing = await store.findJournalByExternalId(ctx.clientId, externalId);
  if (existing) return { status: 200, body: journalResponse(existing, true) };

  const errors: string[] = [];

  const entryDate = typeof body.entry_date === "string" ? body.entry_date.trim() : "";
  if (!isRealDate(entryDate)) errors.push(`entry_date が正しい日付（YYYY-MM-DD）ではありません: "${String(body.entry_date ?? "")}"`);

  let description: string | null = null;
  if (body.description != null) {
    if (typeof body.description !== "string") errors.push("description は文字列で送ってください");
    else if (body.description.length > 1000) errors.push("description は1000文字までです");
    else description = body.description.trim() || null;
  }

  let receiptId: string | null = null;
  if (body.receipt_id != null && body.receipt_id !== "") {
    if (typeof body.receipt_id !== "string" || !UUID_RE.test(body.receipt_id)) errors.push("receipt_id の形が正しくありません");
    else receiptId = body.receipt_id;
  }

  let metadata: Record<string, unknown> = {};
  if (body.metadata != null) {
    if (!isPlainObject(body.metadata)) errors.push("metadata は JSON のオブジェクトで送ってください");
    else if (JSON.stringify(body.metadata).length > 10000) errors.push("metadata が大きすぎます（10,000文字まで）");
    else metadata = body.metadata;
  }

  const rawLines = Array.isArray(body.lines) ? body.lines : null;
  if (!rawLines || rawLines.length < 2) errors.push("lines（明細）を2行以上送ってください");
  else if (rawLines.length > MAX_LINES) errors.push(`lines（明細）は${MAX_LINES}行までです`);

  // 科目はその会社の科目から、コード → 名前の順に引く
  const accounts = rawLines && rawLines.length <= MAX_LINES ? await store.listAccounts(ctx.clientId) : [];
  const byCode = new Map(accounts.map((a) => [a.code.trim(), a]));
  const byName = new Map<string, AccountRef[]>();
  for (const a of accounts) byName.set(a.name.trim(), [...(byName.get(a.name.trim()) ?? []), a]);

  const lines: NewJournalLine[] = [];
  (rawLines && rawLines.length <= MAX_LINES ? rawLines : []).forEach((raw: unknown, i: number) => {
    const no = `${i + 1}行目`;
    if (!isPlainObject(raw)) {
      errors.push(`${no}: 明細はオブジェクトで送ってください`);
      return;
    }
    const ref = typeof raw.account === "string" ? raw.account.trim() : typeof raw.account === "number" ? String(raw.account) : "";
    let account: AccountRef | undefined;
    if (!ref) errors.push(`${no}: account（科目名またはコード）がありません`);
    else {
      account = byCode.get(ref);
      if (!account) {
        const named = byName.get(ref) ?? [];
        const active = named.filter((a) => a.is_active);
        if (active.length > 1) errors.push(`${no}: 同じ名前の科目が複数あります。コードで指定してください: "${ref}"`);
        account = active[0] ?? named[0];
      }
      if (!account) errors.push(`${no}: この会社に科目がありません: "${ref}"`);
      else if (!account.is_active) errors.push(`${no}: 使われていない科目です: "${ref}"`);
    }

    const debit = raw.debit ?? 0;
    const credit = raw.credit ?? 0;
    const okAmount = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 1e13;
    if (!okAmount(debit) || !okAmount(credit)) {
      errors.push(`${no}: 金額（debit・credit）は0以上の整数で送ってください`);
      return;
    }
    if (((debit as number) > 0) === ((credit as number) > 0)) {
      errors.push(`${no}: 借方（debit）か貸方（credit）のどちらか一方だけに金額を入れてください`);
      return;
    }

    let taxCategory: string | null = null;
    if (raw.tax_category != null && raw.tax_category !== "") {
      const code = typeof raw.tax_category === "string" ? sanitizeTaxCategory(raw.tax_category) : null;
      if (!code) errors.push(`${no}: 税区分のコードが正しくありません: "${String(raw.tax_category)}"`);
      else if (account && !taxCategoryAllowed(account.type, account.name, code)) {
        errors.push(`${no}: 科目「${account.name}」にはこの税区分を付けられません: "${code}"（税区分は収益・費用の行にだけ付けます）`);
      } else taxCategory = code;
    }

    if (!account) return;
    lines.push({
      account_id: account.id,
      debit_amount: debit as number,
      credit_amount: credit as number,
      tax_category: taxCategory,
      tax_rate: taxCategory ? (taxCategoryInfo(taxCategory)?.rate ?? null) : null,
      sort_order: i,
    });
  });

  if (errors.length === 0) {
    const totalD = lines.reduce((s, l) => s + (l.debit_amount ?? 0), 0);
    const totalC = lines.reduce((s, l) => s + (l.credit_amount ?? 0), 0);
    if (totalD !== totalC) errors.push(`借方と貸方の合計が一致しません（借方 ${totalD} / 貸方 ${totalC}）`);
  }

  if (errors.length > 0) {
    throw new ApiError(400, "validation_failed", "仕訳の内容に誤りがあります", errors);
  }

  if (await store.isDateLocked(ctx.clientId, entryDate)) {
    throw new ApiError(409, "fiscal_year_locked", `${entryDate} は締めた（ロック済みの）会計年度に入るため登録できません`);
  }

  if (receiptId && !(await store.receiptExists(ctx.clientId, receiptId))) {
    throw new ApiError(400, "receipt_not_found", "receipt_id の証憑がこの会社にありません");
  }

  const created = await store.insertJournal(
    {
      // 会社と操作者はキーから決める（本文の client_id などは使わない）
      client_id: ctx.clientId,
      created_by: ctx.userId,
      entry_date: entryDate,
      description,
      status: "confirmed",
      needs_review: false,
      source: "api",
      receipt_id: receiptId,
      external_id: externalId,
      metadata: { ...metadata, api: { key_id: ctx.keyId } } as Json,
    },
    lines
  );

  if (created === "conflict") {
    // 同時に同じ外部IDが送られた（一意索引で止まった）。先にできた方を返す
    const again = await store.findJournalByExternalId(ctx.clientId, externalId);
    if (!again) throw new ApiError(500, "internal_error", "仕訳の登録に失敗しました");
    return { status: 200, body: journalResponse(again, true) };
  }

  if (receiptId) await store.markReceiptJournalized(ctx.clientId, receiptId, ctx.userId);

  const saved = await store.findJournalByExternalId(ctx.clientId, externalId);
  return {
    status: 201,
    body: saved
      ? journalResponse(saved, false)
      : { journal_entry_id: created.id, external_id: externalId, status: "confirmed", needs_review: false, duplicate: false },
  };
}

/** GET /api/v1/journals?external_id=… */
export async function getJournalFromApi(store: ExternalApiStore, ctx: ApiContext, externalId: string | null): Promise<ApiResult> {
  const id = externalId?.trim() ?? "";
  if (!id) throw new ApiError(400, "invalid_external_id", "external_id を付けてください");
  const j = await store.findJournalByExternalId(ctx.clientId, id);
  if (!j) throw new ApiError(404, "not_found", "その external_id の仕訳はありません（取り消された可能性があります）");
  return { status: 200, body: journalResponse(j, false) };
}

// ---------------------------------------------------------------------------
// 証憑
// ---------------------------------------------------------------------------

export type ReceiptApiInput = {
  file: { bytes: Uint8Array; type: string; size: number; name: string } | null;
  paymentMethod: string | null;
  direction: string | null;
  originalFilename: string | null;
};

/** POST /api/v1/receipts（multipart）。同じファイルが登録済みならその id を返す */
export async function registerReceiptFromApi(
  store: ExternalApiStore,
  ctx: ApiContext,
  input: ReceiptApiInput
): Promise<ApiResult> {
  if (!input.file) throw new ApiError(400, "file_missing", "file（JPG・PNG・PDF）を付けてください");
  const pm = input.paymentMethod?.trim() || null;
  const paymentMethod = normalizePaymentMethod(pm);
  if (pm && !paymentMethod) {
    throw new ApiError(400, "invalid_payment_method", "payment_method は cash・card・e_money・bank_transfer のどれかです");
  }
  const dir = input.direction?.trim() || "received";
  if (dir !== "received" && dir !== "issued") {
    throw new ApiError(400, "invalid_direction", "direction は received（受け取った）か issued（発行した）です");
  }
  const name = (input.originalFilename?.trim() || input.file.name || "receipt").slice(0, 255);

  try {
    const saved = await storeReceiptFile(store.receiptIO, {
      clientId: ctx.clientId,
      userId: ctx.userId,
      file: { ...input.file, name },
      paymentMethod,
      direction: dir,
      onDuplicate: "return",
    });
    return {
      status: saved.duplicate ? 200 : 201,
      body: { receipt_id: saved.id, duplicate: saved.duplicate, mime_type: saved.mime_type },
    };
  } catch (e) {
    if (e instanceof ReceiptInputError) {
      throw new ApiError(e.code === "file_too_large" ? 413 : 400, e.code, e.message);
    }
    throw e;
  }
}
