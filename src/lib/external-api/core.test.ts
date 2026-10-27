import { describe, it, expect, beforeEach } from "vitest";
import {
  ApiError,
  authenticate,
  createJournalFromApi,
  getJournalFromApi,
  listAccountsFromApi,
  registerReceiptFromApi,
  RATE_LIMIT_PER_MINUTE,
  type ApiContext,
  type ApiKeyRecord,
  type ExternalApiStore,
  type JournalSummary,
  type NewJournalLine,
} from "./core";
import { canManageApiKeys, generateApiKey, hashApiKey, parseBearer } from "./keys";
import type { ReceiptInsert } from "@/lib/receipt-upload";

// テスト用の会社・利用者（実在しない値）
const COMPANY_A = "00000000-0000-4000-8000-00000000000a";
const COMPANY_B = "00000000-0000-4000-8000-00000000000b";
// 自社の科目を持たず、標準科目だけを使う会社
const COMPANY_C = "00000000-0000-4000-8000-00000000000c";
const USER_A = "00000000-0000-4000-8000-0000000000a1";
const USER_B = "00000000-0000-4000-8000-0000000000b1";
const USER_C = "00000000-0000-4000-8000-0000000000c1";

type StoredJournal = JournalSummary & { client_id: string; created_by: string; source: string; lines: NewJournalLine[] };
type StoredReceipt = ReceiptInsert & { id: string };

/** 手元で動く入れ物（Supabase の代わり） */
function memoryStore() {
  const keys: ApiKeyRecord[] = [];
  const keyHashes = new Map<string, string>();
  const hits = new Map<string, number>();
  const journals: StoredJournal[] = [];
  const receipts: StoredReceipt[] = [];
  const uploads = new Map<string, Uint8Array>();
  const lockedYears: { client_id: string; start: string; end: string }[] = [];
  type Acct = { id: string; code: string; name: string; type: string; is_active: boolean };
  const own = (list: Acct[]) => list.map((a) => ({ ...a, standard: false }));
  // 全社共通の標準科目（client_id IS NULL）
  const standard = [
    { id: "s-ar", code: "1150", name: "売掛金", type: "assets", is_active: true },
    { id: "s-sales", code: "4100", name: "売上高", type: "revenue", is_active: true },
    { id: "s-comm", code: "720", name: "通信費（標準）", type: "expenses", is_active: true },
    { id: "s-old", code: "9990", name: "標準の旧科目", type: "expenses", is_active: false },
  ].map((a) => ({ ...a, standard: true }));
  const accounts = new Map<string, ReturnType<typeof own>>([
    [
      COMPANY_A,
      own([
        { id: "a-cash", code: "100", name: "現金", type: "assets", is_active: true },
        { id: "a-bank", code: "110", name: "普通預金", type: "assets", is_active: true },
        { id: "a-comm", code: "720", name: "通信費", type: "expenses", is_active: true },
        { id: "a-sales", code: "500", name: "売上高", type: "revenue", is_active: true },
        { id: "a-old", code: "999", name: "旧科目", type: "expenses", is_active: false },
        { id: "a-ptax", code: "190", name: "仮払消費税", type: "assets", is_active: true },
      ]),
    ],
    [COMPANY_B, own([{ id: "b-comm", code: "720", name: "通信費", type: "expenses", is_active: true }])],
  ]);

  const store: ExternalApiStore = {
    async findKeyByHash(hash) {
      const id = keyHashes.get(hash);
      return keys.find((k) => k.id === id) ?? null;
    },
    async hitRateLimit(keyId, limit) {
      const n = (hits.get(keyId) ?? 0) + 1;
      hits.set(keyId, n);
      return n <= limit;
    },
    async getClientName(clientId) {
      return clientId === COMPANY_A ? "A社" : "B社";
    },
    async listAccounts(clientId) {
      return [...(accounts.get(clientId) ?? []), ...standard];
    },
    async isDateLocked(clientId, date) {
      return lockedYears.some((y) => y.client_id === clientId && y.start <= date && date <= y.end);
    },
    async findJournalByExternalId(clientId, externalId) {
      return journals.find((j) => j.client_id === clientId && j.external_id === externalId) ?? null;
    },
    async receiptExists(clientId, receiptId) {
      return receipts.some((r) => r.client_id === clientId && r.id === receiptId);
    },
    async insertJournal(entry, lines) {
      if (journals.some((j) => j.client_id === entry.client_id && j.external_id === entry.external_id)) return "conflict";
      const id = `j-${journals.length + 1}`;
      journals.push({
        id,
        client_id: entry.client_id,
        created_by: entry.created_by,
        source: entry.source ?? "manual",
        external_id: entry.external_id ?? null,
        entry_date: entry.entry_date,
        description: entry.description ?? null,
        status: entry.status ?? "draft",
        needs_review: entry.needs_review ?? false,
        receipt_id: entry.receipt_id ?? null,
        created_at: "2026-10-27T00:00:00Z",
        lines,
      });
      return { id };
    },
    async markReceiptJournalized() {},
    receiptIO: {
      async findByHash(clientId, fileHash) {
        const r = receipts.find((x) => x.client_id === clientId && x.file_hash === fileHash);
        return r
          ? { id: r.id, image_path: r.image_path, mime_type: r.mime_type ?? null, original_filename: r.original_filename ?? null, uploaded_at: "2026-10-27T00:00:00Z" }
          : null;
      },
      async upload(path, bytes) {
        uploads.set(path, bytes);
      },
      async insert(row) {
        receipts.push(row as StoredReceipt);
        return { id: row.id! };
      },
      async removeUpload(path) {
        uploads.delete(path);
      },
    },
  };

  /** キーを発行して、その平文を返す */
  const issueKey = (clientId: string, userId: string, opts: Partial<ApiKeyRecord> = {}) => {
    const key = generateApiKey();
    const rec: ApiKeyRecord = {
      id: `k-${keys.length + 1}`,
      client_id: clientId,
      user_id: userId,
      scopes: ["journals:write", "receipts:write"],
      revoked_at: null,
      ...opts,
    };
    keys.push(rec);
    keyHashes.set(hashApiKey(key), rec.id);
    return key;
  };

  return { store, issueKey, journals, receipts, uploads, lockedYears };
}

const bearer = (key: string) => `Bearer ${key}`;

async function expectApiError(p: Promise<unknown>, status: number, code: string) {
  const e = await p.then(
    () => null,
    (err) => err
  );
  expect(e).toBeInstanceOf(ApiError);
  expect((e as ApiError).status).toBe(status);
  expect((e as ApiError).code).toBe(code);
  return e as ApiError;
}

const validJournal = (over: Record<string, unknown> = {}) => ({
  external_id: "sha256:abc",
  entry_date: "2026-06-10",
  description: "回線使用料",
  lines: [
    { account: "通信費", debit: 5500, credit: 0, tax_category: "purchase_10" },
    { account: "110", debit: 0, credit: 5500 },
  ],
  ...over,
});

describe("APIキー", () => {
  it("キーの形と指紋", () => {
    const k = generateApiKey();
    expect(k.startsWith("rk_")).toBe(true);
    expect(hashApiKey(k)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKey(k)).not.toContain(k);
    expect(parseBearer(`Bearer ${k}`)).toBe(k);
    expect(parseBearer(k)).toBeNull();
    expect(parseBearer("Bearer abc")).toBeNull();
    expect(parseBearer(null)).toBeNull();
  });

  it("発行・無効化できるのは会社の管理者・事務所の管理者・システム管理者だけ", () => {
    expect(canManageApiKeys({ kind: "client", role: "owner", canWrite: true })).toBe(true);
    expect(canManageApiKeys({ kind: "firm", role: "admin", canWrite: true })).toBe(true);
    expect(canManageApiKeys({ kind: "super_admin", role: "admin", canWrite: true })).toBe(true);
    expect(canManageApiKeys({ kind: "client", role: "member", canWrite: true })).toBe(false);
    expect(canManageApiKeys({ kind: "firm", role: "staff", canWrite: true })).toBe(false);
    expect(canManageApiKeys({ kind: "client", role: "viewer", canWrite: false })).toBe(false);
    // アクセスを止められた事務所の管理者
    expect(canManageApiKeys({ kind: "firm", role: "admin", canWrite: false })).toBe(false);
  });
});

describe("認証", () => {
  let m: ReturnType<typeof memoryStore>;
  beforeEach(() => {
    m = memoryStore();
  });

  it("正しいキーなら、会社と操作者はキーから決まる", async () => {
    const key = m.issueKey(COMPANY_A, USER_A);
    const ctx = await authenticate(m.store, bearer(key), "journals:write");
    expect(ctx.clientId).toBe(COMPANY_A);
    expect(ctx.userId).toBe(USER_A);
  });

  it("キーが無い・違う・無効化済み・権限が無い", async () => {
    await expectApiError(authenticate(m.store, null), 401, "unauthorized");
    await expectApiError(authenticate(m.store, bearer(generateApiKey())), 401, "invalid_key");
    const revoked = m.issueKey(COMPANY_A, USER_A, { revoked_at: "2026-10-01T00:00:00Z" });
    await expectApiError(authenticate(m.store, bearer(revoked)), 401, "revoked_key");
    const onlyReceipts = m.issueKey(COMPANY_A, USER_A, { scopes: ["receipts:write"] });
    await expectApiError(authenticate(m.store, bearer(onlyReceipts), "journals:write"), 403, "insufficient_scope");
  });

  it("キーごとの回数の上限を超えたら 429", async () => {
    const key = m.issueKey(COMPANY_A, USER_A);
    for (let i = 0; i < RATE_LIMIT_PER_MINUTE; i++) await authenticate(m.store, bearer(key));
    await expectApiError(authenticate(m.store, bearer(key)), 429, "rate_limited");
  });
});

describe("仕訳の受け口", () => {
  let m: ReturnType<typeof memoryStore>;
  let ctxA: ApiContext;
  beforeEach(async () => {
    m = memoryStore();
    ctxA = await authenticate(m.store, bearer(m.issueKey(COMPANY_A, USER_A)), "journals:write");
  });

  it("確定済み・要確認なし・出どころ api で、キーの会社に登録する", async () => {
    const r = await createJournalFromApi(m.store, ctxA, validJournal());
    expect(r.status).toBe(201);
    expect(m.journals).toHaveLength(1);
    const j = m.journals[0];
    expect(j.client_id).toBe(COMPANY_A);
    expect(j.created_by).toBe(USER_A);
    expect(j.status).toBe("confirmed");
    expect(j.needs_review).toBe(false);
    expect(j.source).toBe("api");
    // 科目は名前（通信費）でもコード（110）でも引ける。税区分は費用の行だけ、税率も付く
    expect(j.lines.map((l) => [l.account_id, l.debit_amount, l.credit_amount, l.tax_category, l.tax_rate])).toEqual([
      ["a-comm", 5500, 0, "purchase_10", 0.1],
      ["a-bank", 0, 5500, null, null],
    ]);
  });

  it("本文で client_id・needs_review・status を偽っても無視する", async () => {
    await createJournalFromApi(
      m.store,
      ctxA,
      validJournal({ client_id: COMPANY_B, created_by: USER_B, needs_review: true, status: "draft" })
    );
    expect(m.journals[0].client_id).toBe(COMPANY_A);
    expect(m.journals[0].created_by).toBe(USER_A);
    expect(m.journals[0].needs_review).toBe(false);
    expect(m.journals[0].status).toBe("confirmed");
  });

  it("別の会社のキーでは、その会社の科目しか使えず、仕訳も見えない", async () => {
    const ctxB = await authenticate(m.store, bearer(m.issueKey(COMPANY_B, USER_B)), "journals:write");
    // B社には普通預金が無い
    const e = await expectApiError(createJournalFromApi(m.store, ctxB, validJournal()), 400, "validation_failed");
    expect(e.details?.some((d) => d.includes("110"))).toBe(true);
    // A社で作った仕訳は、B社のキーでは見つからない
    await createJournalFromApi(m.store, ctxA, validJournal());
    await expectApiError(getJournalFromApi(m.store, ctxB, "sha256:abc"), 404, "not_found");
    const own = await getJournalFromApi(m.store, ctxA, "sha256:abc");
    expect((own.body as { status: string }).status).toBe("confirmed");
  });

  it("借方と貸方の合計が合わなければ登録しない", async () => {
    const e = await expectApiError(
      createJournalFromApi(
        m.store,
        ctxA,
        validJournal({
          lines: [
            { account: "通信費", debit: 5500, credit: 0 },
            { account: "普通預金", debit: 0, credit: 5000 },
          ],
        })
      ),
      400,
      "validation_failed"
    );
    expect(e.details?.[0]).toContain("借方 5500 / 貸方 5000");
    expect(m.journals).toHaveLength(0);
  });

  it("金額・日付・科目・税区分の誤りをまとめて返す", async () => {
    const e = await expectApiError(
      createJournalFromApi(
        m.store,
        ctxA,
        validJournal({
          entry_date: "2026-02-30",
          lines: [
            { account: "通信費", debit: 10.5, credit: 0 },
            { account: "旧科目", debit: 100, credit: 0 },
            { account: "存在しない科目", debit: 0, credit: 100 },
            { account: "普通預金", debit: 0, credit: 100, tax_category: "purchase_10" },
            { account: "現金", debit: 100, credit: 100 },
          ],
        })
      ),
      400,
      "validation_failed"
    );
    const all = e.details!.join("\n");
    expect(all).toContain("entry_date");
    expect(all).toContain("1行目");
    expect(all).toContain("使われていない科目");
    expect(all).toContain("科目がありません");
    expect(all).toContain("この税区分を付けられません");
    expect(all).toContain("どちらか一方");
    expect(m.journals).toHaveLength(0);
  });

  it("締めた（ロック済みの）年度には入れない", async () => {
    m.lockedYears.push({ client_id: COMPANY_A, start: "2026-01-01", end: "2026-12-31" });
    await expectApiError(createJournalFromApi(m.store, ctxA, validJournal()), 409, "fiscal_year_locked");
    expect(m.journals).toHaveLength(0);
    // 別の会社の年度ロックは関係ない
    m.lockedYears.length = 0;
    m.lockedYears.push({ client_id: COMPANY_B, start: "2026-01-01", end: "2026-12-31" });
    expect((await createJournalFromApi(m.store, ctxA, validJournal())).status).toBe(201);
  });

  it("同じ external_id を2回送っても1件だけ。2回目は前の仕訳を返す", async () => {
    const first = await createJournalFromApi(m.store, ctxA, validJournal());
    const second = await createJournalFromApi(m.store, ctxA, validJournal({ description: "送り直し" }));
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect((second.body as { duplicate: boolean }).duplicate).toBe(true);
    expect((second.body as { journal_entry_id: string }).journal_entry_id).toBe(
      (first.body as { journal_entry_id: string }).journal_entry_id
    );
    expect(m.journals).toHaveLength(1);
    expect(m.journals[0].description).toBe("回線使用料");
  });

  it("同時に送られて一意索引で止まったときも、先にできた仕訳を返す", async () => {
    const realFind = m.store.findJournalByExternalId;
    let calls = 0;
    // 最初の確認では「まだ無い」と見え、登録の時点では先にできている状況
    m.store.findJournalByExternalId = async (c, e) => (calls++ === 0 ? null : realFind(c, e));
    m.journals.push({
      id: "j-race",
      client_id: COMPANY_A,
      created_by: USER_A,
      source: "api",
      external_id: "sha256:abc",
      entry_date: "2026-06-10",
      description: null,
      status: "confirmed",
      needs_review: false,
      receipt_id: null,
      created_at: "2026-10-27T00:00:00Z",
      lines: [],
    });
    const r = await createJournalFromApi(m.store, ctxA, validJournal());
    expect(r.status).toBe(200);
    expect((r.body as { journal_entry_id: string }).journal_entry_id).toBe("j-race");
    expect(m.journals).toHaveLength(1);
  });

  it("receipt_id は同じ会社の証憑だけ", async () => {
    const ctxB = await authenticate(m.store, bearer(m.issueKey(COMPANY_B, USER_B)), "receipts:write");
    const rb = await registerReceiptFromApi(m.store, ctxB, {
      file: { bytes: new Uint8Array([1, 2, 3]), type: "image/png", size: 3, name: "b.png" },
      paymentMethod: null,
      direction: null,
      originalFilename: null,
    });
    const otherReceipt = (rb.body as { receipt_id: string }).receipt_id;
    await expectApiError(
      createJournalFromApi(m.store, ctxA, validJournal({ receipt_id: otherReceipt })),
      400,
      "receipt_not_found"
    );
  });
});

describe("証憑の受け口", () => {
  let m: ReturnType<typeof memoryStore>;
  let ctxA: ApiContext;
  const png = (bytes: number[]) => ({ bytes: new Uint8Array(bytes), type: "image/png", size: bytes.length, name: "r.png" });
  beforeEach(async () => {
    m = memoryStore();
    ctxA = await authenticate(m.store, bearer(m.issueKey(COMPANY_A, USER_A)), "receipts:write");
  });

  it("キーの会社のフォルダに保存し、SHA-256 を記録する", async () => {
    const r = await registerReceiptFromApi(m.store, ctxA, {
      file: png([1, 2, 3]),
      paymentMethod: "card",
      direction: "received",
      originalFilename: "2026-06-10_NTT.png",
    });
    expect(r.status).toBe(201);
    expect(m.receipts).toHaveLength(1);
    const rec = m.receipts[0];
    expect(rec.client_id).toBe(COMPANY_A);
    expect(rec.uploaded_by).toBe(USER_A);
    expect(rec.image_path.startsWith(`${COMPANY_A}/`)).toBe(true);
    expect(rec.file_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rec.payment_method).toBe("card");
    expect(rec.original_filename).toBe("2026-06-10_NTT.png");
  });

  it("同じファイルを2回送ると、登録済みの id を返して二重に作らない", async () => {
    const input = { file: png([9, 9, 9]), paymentMethod: null, direction: null, originalFilename: null };
    const a = await registerReceiptFromApi(m.store, ctxA, input);
    const b = await registerReceiptFromApi(m.store, ctxA, input);
    expect(b.status).toBe(200);
    expect((b.body as { duplicate: boolean }).duplicate).toBe(true);
    expect((b.body as { receipt_id: string }).receipt_id).toBe((a.body as { receipt_id: string }).receipt_id);
    expect(m.receipts).toHaveLength(1);
    expect(m.uploads.size).toBe(1);
  });

  it("同じファイルでも別の会社なら別の証憑", async () => {
    const ctxB = await authenticate(m.store, bearer(m.issueKey(COMPANY_B, USER_B)), "receipts:write");
    const input = { file: png([7, 7]), paymentMethod: null, direction: null, originalFilename: null };
    await registerReceiptFromApi(m.store, ctxA, input);
    const b = await registerReceiptFromApi(m.store, ctxB, input);
    expect(b.status).toBe(201);
    expect(m.receipts.map((r) => r.client_id)).toEqual([COMPANY_A, COMPANY_B]);
  });

  it("ファイルが無い・形式違い・支払方法の打ち間違いは 400", async () => {
    await expectApiError(
      registerReceiptFromApi(m.store, ctxA, { file: null, paymentMethod: null, direction: null, originalFilename: null }),
      400,
      "file_missing"
    );
    await expectApiError(
      registerReceiptFromApi(m.store, ctxA, {
        file: { bytes: new Uint8Array([1]), type: "text/plain", size: 1, name: "a.txt" },
        paymentMethod: null,
        direction: null,
        originalFilename: null,
      }),
      400,
      "file_type"
    );
    await expectApiError(
      registerReceiptFromApi(m.store, ctxA, { file: png([1]), paymentMethod: "visa", direction: null, originalFilename: null }),
      400,
      "invalid_payment_method"
    );
    expect(m.receipts).toHaveLength(0);
  });
});

describe("科目の受け口", () => {
  it("キーの会社の使える科目だけを、区分と税区分を付けられるかと一緒に返す", async () => {
    const m = memoryStore();
    const ctxA = await authenticate(m.store, bearer(m.issueKey(COMPANY_A, USER_A)), "journals:write");
    const r = await listAccountsFromApi(m.store, ctxA);
    type Row = {
      code: string;
      name: string;
      type: string;
      type_label: string;
      scope: string;
      tax_category_allowed: boolean;
      tax_categories: string[];
    };
    const rows = (r.body as { accounts: Row[] }).accounts;
    // 使われていない科目（旧科目）は出さない。コード順
    // 標準科目は、同じコード（720）・同じ名前（売上高）の会社の科目があれば外す
    expect(rows.map((a) => a.code)).toEqual(["100", "110", "190", "500", "720", "1150"]);
    expect(rows.find((a) => a.code === "1150")).toMatchObject({ name: "売掛金", scope: "standard" });
    expect(rows.find((a) => a.code === "720")).toMatchObject({ name: "通信費", scope: "company" });
    const by = new Map(rows.map((a) => [a.name, a]));
    expect(by.get("通信費")).toMatchObject({ type: "expenses", type_label: "費用", tax_category_allowed: true });
    expect(by.get("通信費")!.tax_categories).toContain("purchase_10");
    expect(by.get("売上高")).toMatchObject({ type_label: "収益", tax_category_allowed: true });
    expect(by.get("普通預金")).toMatchObject({ type_label: "資産", tax_category_allowed: false, tax_categories: [] });
    // 仮払消費税は輸入の消費税だけ
    expect(by.get("仮払消費税")!.tax_categories.every((c) => c.startsWith("purchase_import"))).toBe(true);
  });

  it("別の会社のキーでは、その会社の科目と標準科目だけ", async () => {
    const m = memoryStore();
    const ctxB = await authenticate(m.store, bearer(m.issueKey(COMPANY_B, USER_B)), "journals:write");
    const rows = ((await listAccountsFromApi(m.store, ctxB)).body as { accounts: { name: string }[] }).accounts;
    expect(rows.map((a) => a.name)).toEqual(["通信費", "売掛金", "売上高"]);
  });

  it("自社の科目が0件の会社は、標準科目（使われているものだけ）を返す", async () => {
    const m = memoryStore();
    const ctxC = await authenticate(m.store, bearer(m.issueKey(COMPANY_C, USER_C)), "journals:write");
    const rows = ((await listAccountsFromApi(m.store, ctxC)).body as { accounts: { code: string; scope: string }[] }).accounts;
    expect(rows.map((a) => a.code)).toEqual(["720", "1150", "4100"]);
    expect(rows.every((a) => a.scope === "standard")).toBe(true);
  });
});

describe("標準科目だけの会社への仕訳", () => {
  it("標準科目をコードでも名前でも引いて登録する", async () => {
    const m = memoryStore();
    const ctxC = await authenticate(m.store, bearer(m.issueKey(COMPANY_C, USER_C)), "journals:write");
    const r = await createJournalFromApi(m.store, ctxC, {
      external_id: "sha256:c1",
      entry_date: "2026-07-01",
      lines: [
        { account: "1150", debit: 33000, credit: 0 },
        { account: "売上高", debit: 0, credit: 33000, tax_category: "sales_10" },
      ],
    });
    expect(r.status).toBe(201);
    expect(m.journals[0].client_id).toBe(COMPANY_C);
    expect(m.journals[0].lines.map((l) => [l.account_id, l.tax_category])).toEqual([
      ["s-ar", null],
      ["s-sales", "sales_10"],
    ]);
    // 使われていない標準科目は使えない
    await expectApiError(
      createJournalFromApi(m.store, ctxC, {
        external_id: "sha256:c2",
        entry_date: "2026-07-01",
        lines: [
          { account: "標準の旧科目", debit: 100, credit: 0 },
          { account: "1150", debit: 0, credit: 100 },
        ],
      }),
      400,
      "validation_failed"
    );
  });

  it("会社に同じ名前の科目があれば、標準科目より会社の科目を使う", async () => {
    const m = memoryStore();
    const ctxA = await authenticate(m.store, bearer(m.issueKey(COMPANY_A, USER_A)), "journals:write");
    await createJournalFromApi(m.store, ctxA, {
      external_id: "sha256:a-sales",
      entry_date: "2026-07-01",
      lines: [
        { account: "売掛金", debit: 1100, credit: 0 },
        { account: "売上高", debit: 0, credit: 1100 },
      ],
    });
    // 売掛金は A社に無いので標準科目、売上高は A社の科目
    expect(m.journals[0].lines.map((l) => l.account_id)).toEqual(["s-ar", "a-sales"]);
  });
});
