"use server";

/**
 * 定期仕訳（毎月くり返す仕訳）の登録と、まだ作っていない月の仕訳をまとめて作る処理。
 * どの月を作るか・計上日・貸借の検査は src/lib/recurring-journals.ts。
 *
 * - 権限は先頭の assertClientAccess。書き込みは利用者のトークン（RLS）で行うので、
 *   閲覧専用のアカウントはデータベースで止まる。
 * - 作る仕訳は下書き（status='draft'、source='recurring'）。同じ定期仕訳・同じ月は
 *   (recurring_journal_id, recurring_month) の一意制約で二重に作らない。
 * - 締めた会計年度（fiscal_years.status='locked'）の月は作らない（減価償却・決算の仕訳と同じ方針）。
 */

import { createServerSupabaseClient } from "@/lib/supabase";
import { assertClientAccess } from "@/lib/authz";
import { sanitizeTaxCategory, taxCategoryAllowed, taxCategoryInfo } from "@/lib/tax-category";
import { classifyEntryLines } from "@/lib/tax-classify-db";
import { fetchAllRows } from "@/lib/fetch-all";
import { toJstDate } from "@/lib/fiscal";
import {
  END_OF_MONTH,
  addMonths,
  checkBalance,
  isMonth,
  pendingMonths,
  postingDateOf,
  scheduledMonths,
  validateRecurringInput,
  type RecurringJournalInput,
  type RecurringLine,
  type RecurringSchedule,
} from "@/lib/recurring-journals";
import type { Database, Json } from "@/types/database";

type Db = Awaited<ReturnType<typeof createServerSupabaseClient>>;
type RecurringRow = Database["public"]["Tables"]["recurring_journals"]["Row"];

/** 1回の「まとめて作成」で作る仕訳の上限（時間切れで途中まで作られて分からなくなるのを防ぐ） */
const MAX_CREATE_PER_RUN = 100;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PURCHASE_USES = new Set(["taxable", "non_taxable", "common"]);

/** 日本時間の今日（サーバーはUTCで動くため、日本時間の0:00〜9:00に前日にならないように） */
function todayJst(): string {
  return toJstDate(new Date().toISOString());
}

export type RecurringJournalLineView = RecurringLine & {
  accountCode: string;
  accountName: string;
  subAccountName: string | null;
};

export type RecurringJournal = {
  id: string;
  name: string;
  description: string | null;
  lines: RecurringJournalLineView[];
  dayOfMonth: number;
  startMonth: string;
  endMonth: string | null;
  intervalMonths: number;
  isActive: boolean;
  lastGeneratedMonth: string | null;
  /** 1回の金額（借方の合計） */
  amount: number;
  /** 作成済みの対象月（古い順）。次に作る月・未作成の月は画面で lib の関数から出す */
  createdMonths: string[];
  updatedAt: string;
};

/** jsonb の明細を型どおりに読む（形の崩れた要素は落とす） */
function parseLines(json: Json): RecurringLine[] {
  if (!Array.isArray(json)) return [];
  const out: RecurringLine[] = [];
  for (const raw of json) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const l = raw as Record<string, Json | undefined>;
    if (typeof l.account_id !== "string" || !l.account_id) continue;
    out.push({
      account_id: l.account_id,
      sub_account_id: typeof l.sub_account_id === "string" && l.sub_account_id ? l.sub_account_id : null,
      debit_amount: Number(l.debit_amount) || 0,
      credit_amount: Number(l.credit_amount) || 0,
      tax_category: typeof l.tax_category === "string" && l.tax_category ? l.tax_category : null,
      ...(typeof l.purchase_use === "string" && PURCHASE_USES.has(l.purchase_use)
        ? { purchase_use: l.purchase_use as RecurringLine["purchase_use"] }
        : {}),
      ...(typeof l.business_type === "number" ? { business_type: l.business_type } : {}),
    });
  }
  return out;
}

function scheduleOf(r: RecurringRow): RecurringSchedule {
  return {
    dayOfMonth: r.day_of_month,
    startMonth: r.start_month,
    endMonth: r.end_month,
    intervalMonths: r.interval_months,
    isActive: r.is_active,
  };
}

/** 定期仕訳ごとの作成済みの対象月 */
async function loadCreatedMonths(db: Db, clientId: string, ids: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (ids.length === 0) return map;
  const rows = await fetchAllRows<{ recurring_journal_id: string | null; recurring_month: string | null }>((from, to) =>
    db
      .from("journal_entries")
      .select("recurring_journal_id, recurring_month")
      .eq("client_id", clientId)
      .in("recurring_journal_id", ids)
      .order("id")
      .range(from, to)
  );
  for (const r of rows) {
    if (!r.recurring_journal_id || !r.recurring_month) continue;
    map.set(r.recurring_journal_id, [...(map.get(r.recurring_journal_id) ?? []), r.recurring_month]);
  }
  for (const [k, v] of map) map.set(k, [...new Set(v)].sort());
  return map;
}

/** 締めた会計年度の期間 */
async function loadLockedRanges(db: Db, clientId: string): Promise<{ start: string; end: string }[]> {
  const { data, error } = await db
    .from("fiscal_years")
    .select("start_date, end_date")
    .eq("client_id", clientId)
    .eq("status", "locked");
  if (error) throw new Error(error.message);
  return (data ?? []).map((f) => ({ start: f.start_date, end: f.end_date }));
}

const inLocked = (date: string, ranges: { start: string; end: string }[]) =>
  ranges.some((r) => r.start <= date && date <= r.end);

/**
 * 明細の科目・補助科目がこの顧問先のものかを確かめ、税区分などを整える。
 * 税区分は仕訳の修正（updateJournalEntryWithLines）と同じ決まり:
 *   マスタに無いコード・その科目に付けられない区分は外す（収益・費用の行と、仮払消費税の輸入の区分だけ）。
 *   用途区分は費用（と輸入の消費税）の行だけ、事業区分は収益の行だけに残す。
 */
async function cleanLines(db: Db, clientId: string, lines: RecurringLine[]): Promise<RecurringLine[]> {
  const accountIds = [...new Set(lines.map((l) => l.account_id))];
  const { data: accts, error } = await db
    .from("accounts")
    .select("id, name, client_id, account_categories:category_id ( type )")
    .in("id", accountIds.length ? accountIds : ["00000000-0000-0000-0000-000000000000"]);
  if (error) throw new Error(error.message);
  type Acct = { id: string; name: string; client_id: string | null; account_categories: { type: string } | null };
  const byId = new Map(((accts ?? []) as unknown as Acct[]).map((a) => [a.id, a]));

  const subIds = [...new Set(lines.map((l) => l.sub_account_id).filter(Boolean))] as string[];
  const subById = new Map<string, { account_id: string; client_id: string }>();
  if (subIds.length) {
    const { data: subs, error: sErr } = await db.from("sub_accounts").select("id, account_id, client_id").in("id", subIds);
    if (sErr) throw new Error(sErr.message);
    for (const s of subs ?? []) subById.set(s.id, { account_id: s.account_id, client_id: s.client_id });
  }

  return lines.map((l) => {
    const a = byId.get(l.account_id);
    if (!a || (a.client_id !== null && a.client_id !== clientId)) {
      throw new Error("勘定科目が見つからないか、この顧問先のものではありません。科目を選び直してください");
    }
    if (l.sub_account_id) {
      const s = subById.get(l.sub_account_id);
      if (!s || s.client_id !== clientId || s.account_id !== l.account_id) {
        throw new Error("補助科目が勘定科目と合っていません。科目を変えたときは補助科目を選び直してください");
      }
    }
    const type = a.account_categories?.type ?? "";
    const raw = sanitizeTaxCategory(l.tax_category);
    const code = raw && taxCategoryAllowed(type, a.name, raw) ? raw : null;
    const out: RecurringLine = {
      account_id: l.account_id,
      sub_account_id: l.sub_account_id || null,
      debit_amount: Math.round(Number(l.debit_amount) || 0),
      credit_amount: Math.round(Number(l.credit_amount) || 0),
      tax_category: code,
    };
    if ((type === "expenses" || (code && taxCategoryInfo(code)?.importTax)) && l.purchase_use !== undefined) {
      out.purchase_use = l.purchase_use && PURCHASE_USES.has(l.purchase_use) ? l.purchase_use : null;
    }
    if (type === "revenue" && l.business_type !== undefined) {
      const bt = l.business_type;
      out.business_type = Number.isInteger(bt) && bt! >= 1 && bt! <= 6 ? bt : null;
    }
    return out;
  });
}

// ---------------------------------------------------------------------------
// 一覧・保存・削除・停止
// ---------------------------------------------------------------------------

export async function listRecurringJournals(clientId: string): Promise<RecurringJournal[]> {
  await assertClientAccess(clientId);
  const db = await createServerSupabaseClient();
  const { data, error } = await db
    .from("recurring_journals")
    .select("*")
    .eq("client_id", clientId)
    .order("created_at");
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  if (rows.length === 0) return [];

  const created = await loadCreatedMonths(db, clientId, rows.map((r) => r.id));
  const parsed = rows.map((r) => ({ row: r, lines: parseLines(r.lines) }));

  // 科目名・補助科目名（使わなくなった科目も名前を出せるよう、有効・無効を問わず引く）
  const accountIds = [...new Set(parsed.flatMap((p) => p.lines.map((l) => l.account_id)))];
  const subIds = [...new Set(parsed.flatMap((p) => p.lines.map((l) => l.sub_account_id).filter(Boolean)))] as string[];
  const [{ data: accts }, { data: subs }] = await Promise.all([
    accountIds.length
      ? db.from("accounts").select("id, code, name").in("id", accountIds)
      : Promise.resolve({ data: [] as { id: string; code: string; name: string }[] }),
    subIds.length
      ? db.from("sub_accounts").select("id, name").in("id", subIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const acctById = new Map((accts ?? []).map((a) => [a.id, a]));
  const subName = new Map((subs ?? []).map((s) => [s.id, s.name]));

  return parsed.map(({ row: r, lines }) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    lines: lines.map((l) => ({
      ...l,
      accountCode: String(acctById.get(l.account_id)?.code ?? ""),
      accountName: acctById.get(l.account_id)?.name ?? "（見つからない科目）",
      subAccountName: l.sub_account_id ? subName.get(l.sub_account_id) ?? null : null,
    })),
    dayOfMonth: r.day_of_month,
    startMonth: r.start_month,
    endMonth: r.end_month,
    intervalMonths: r.interval_months,
    isActive: r.is_active,
    lastGeneratedMonth: r.last_generated_month,
    amount: lines.reduce((s, l) => s + l.debit_amount, 0),
    createdMonths: created.get(r.id) ?? [],
    updatedAt: r.updated_at,
  }));
}

/**
 * 定期仕訳を保存する（id があれば更新）。保存した id を返す。
 * 変えても、すでに作った仕訳は変わらない（これから作る月の分だけに効く）。
 */
export async function saveRecurringJournal(
  clientId: string,
  input: RecurringJournalInput,
  id?: string | null
): Promise<{ id: string }> {
  await assertClientAccess(clientId);
  const v = validateRecurringInput(input);
  if (!v.ok) throw new Error(v.message);
  const db = await createServerSupabaseClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) throw new Error("認証が必要です");

  const lines = await cleanLines(db, clientId, v.value.lines);
  const fields = {
    name: v.value.name,
    description: v.value.description,
    lines: lines as unknown as Json,
    day_of_month: v.value.dayOfMonth,
    start_month: v.value.startMonth,
    end_month: v.value.endMonth,
    interval_months: v.value.intervalMonths,
  };

  if (id) {
    const { data, error } = await db
      .from("recurring_journals")
      .update(fields)
      .eq("id", id)
      .eq("client_id", clientId)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("定期仕訳が見つからないか、変更する権限がありません");
    return { id: data.id };
  }

  const { data, error } = await db
    .from("recurring_journals")
    .insert({ ...fields, client_id: clientId, created_by: user.id, is_active: true })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id };
}

/** 停止・再開。停止中は「まとめて作成」の対象にしない（作った仕訳はそのまま） */
export async function setRecurringJournalActive(clientId: string, id: string, isActive: boolean): Promise<void> {
  await assertClientAccess(clientId);
  const db = await createServerSupabaseClient();
  const { data, error } = await db
    .from("recurring_journals")
    .update({ is_active: isActive })
    .eq("id", id)
    .eq("client_id", clientId)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("定期仕訳が見つからないか、変更する権限がありません");
}

/**
 * 定期仕訳を削除する。作った仕訳は残り、元の定期仕訳とのつながりだけが外れる。
 * 締めた会計年度にこの定期仕訳から作った仕訳があると、つながりを外す（＝その仕訳を変える）ことが
 * できないため削除しない。これ以上作らないようにするには停止する。
 */
export async function deleteRecurringJournal(clientId: string, id: string): Promise<void> {
  await assertClientAccess(clientId);
  const db = await createServerSupabaseClient();
  const [made, locked] = await Promise.all([
    fetchAllRows<{ entry_date: string }>((from, to) =>
      db
        .from("journal_entries")
        .select("entry_date")
        .eq("client_id", clientId)
        .eq("recurring_journal_id", id)
        .order("id")
        .range(from, to)
    ),
    loadLockedRanges(db, clientId),
  ]);
  if (made.some((e) => inLocked(e.entry_date, locked))) {
    throw new Error(
      "締めた会計年度に、この定期仕訳から作った仕訳があるため削除できません。これ以上作らないようにするには「停止」にしてください"
    );
  }
  const { data, error } = await db
    .from("recurring_journals")
    .delete()
    .eq("id", id)
    .eq("client_id", clientId)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("定期仕訳が見つからないか、削除する権限がありません");
}

// ---------------------------------------------------------------------------
// 既存の仕訳から作る
// ---------------------------------------------------------------------------

export type JournalForRecurring = {
  id: string;
  date: string;
  description: string | null;
  amount: number;
};

/** 定期仕訳の元にする仕訳の候補（新しい順・摘要で絞り込み） */
export async function searchJournalsForRecurring(clientId: string, query: string): Promise<JournalForRecurring[]> {
  await assertClientAccess(clientId);
  const db = await createServerSupabaseClient();
  let q = db
    .from("journal_entries")
    .select("id, entry_date, description, journal_entry_lines ( debit_amount )")
    .eq("client_id", clientId)
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(30);
  const word = query.trim();
  // % と _ は ilike の記号なので、文字として探すために逃がす
  if (word) q = q.ilike("description", `%${word.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  type Row = { id: string; entry_date: string; description: string | null; journal_entry_lines: { debit_amount: number }[] | null };
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    date: r.entry_date,
    description: r.description,
    amount: (r.journal_entry_lines ?? []).reduce((s, l) => s + (Number(l.debit_amount) || 0), 0),
  }));
}

/**
 * 既存の仕訳から定期仕訳の下書きを作る（保存はしない。画面で確かめてから saveRecurringJournal で保存する）。
 * - 明細は科目・補助科目・金額・税区分・用途区分・事業区分を引き継ぐ。交際費の区分・人数・部門は
 *   その回だけの情報なので引き継がない
 * - 計上日は元の仕訳の日にち（月の最終日なら「末日」）
 * - 開始月は元の仕訳の翌月（元の仕訳の月は手入力済みなので、二重に作らないため）
 */
export async function recurringDraftFromJournal(clientId: string, journalEntryId: string): Promise<RecurringJournalInput> {
  await assertClientAccess(clientId);
  const db = await createServerSupabaseClient();
  const { data, error } = await db
    .from("journal_entries")
    .select(
      "id, entry_date, description, journal_entry_lines ( account_id, sub_account_id, debit_amount, credit_amount, tax_category, purchase_use, business_type, sort_order )"
    )
    .eq("id", journalEntryId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("仕訳が見つかりません");
  type Line = {
    account_id: string;
    sub_account_id: string | null;
    debit_amount: number;
    credit_amount: number;
    tax_category: string | null;
    purchase_use: RecurringLine["purchase_use"];
    business_type: number | null;
    sort_order: number;
  };
  const entry = data as unknown as { entry_date: string; description: string | null; journal_entry_lines: Line[] | null };
  const lines = [...(entry.journal_entry_lines ?? [])]
    .sort((a, b) => a.sort_order - b.sort_order)
    // 借方の行を先に（画面の並びと同じ）
    .sort((a, b) => Number(b.debit_amount > 0) - Number(a.debit_amount > 0))
    .map((l) => ({
      account_id: l.account_id,
      sub_account_id: l.sub_account_id,
      debit_amount: Number(l.debit_amount) || 0,
      credit_amount: Number(l.credit_amount) || 0,
      tax_category: l.tax_category,
      purchase_use: l.purchase_use,
      business_type: l.business_type,
    }));

  const month = entry.entry_date.slice(0, 7);
  const [y, m, d] = entry.entry_date.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const name = (entry.description ?? "").trim().slice(0, 100);
  return {
    name: name || "定期仕訳",
    description: entry.description?.trim() || null,
    lines,
    dayOfMonth: d === lastDay ? END_OF_MONTH : d,
    startMonth: isMonth(month) ? addMonths(month, 1) : "",
    endMonth: null,
    intervalMonths: 1,
  };
}

// ---------------------------------------------------------------------------
// まだ作っていない月の仕訳をまとめて作る
// ---------------------------------------------------------------------------

export type RecurringGenerationResult = {
  /** どの日までの分を作ったか（YYYY-MM-DD） */
  through: string;
  created: { recurringId: string; name: string; month: string; date: string; entryId: string; amount: number }[];
  /** 作らなかった月。already＝作成済み、locked＝締めた会計年度 */
  skipped: { recurringId: string; name: string; month: string; reason: "already" | "locked" }[];
  failed: { recurringId: string; name: string; month: string | null; message: string }[];
  /** 上限に達して今回は作らなかった件数（もう一度押すと続きを作る） */
  remaining: number;
};

/**
 * 有効な定期仕訳について、through（既定は今日）までに計上日が来ていて、まだ作っていない月の仕訳を作る。
 * 作るのは下書き。1回に作るのは MAX_CREATE_PER_RUN 件まで。
 */
export async function generateRecurringJournals(
  clientId: string,
  opts: { through?: string } = {}
): Promise<RecurringGenerationResult> {
  await assertClientAccess(clientId);
  const db = await createServerSupabaseClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) throw new Error("認証が必要です");

  const today = todayJst();
  const through = opts.through ?? today;
  if (!DATE_RE.test(through)) throw new Error("作成する範囲の日付が正しくありません");
  // 先の月を作るのは1年先まで（打ち間違いで何年分も下書きができないように）
  const limit = `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`;
  if (through > limit) throw new Error("作成する範囲は1年先までにしてください");

  const { data, error } = await db
    .from("recurring_journals")
    .select("*")
    .eq("client_id", clientId)
    .eq("is_active", true)
    .order("created_at");
  if (error) throw new Error(error.message);
  const rows = data ?? [];

  const result: RecurringGenerationResult = { through, created: [], skipped: [], failed: [], remaining: 0 };
  if (rows.length === 0) return result;

  const [createdMonths, locked] = await Promise.all([
    loadCreatedMonths(db, clientId, rows.map((r) => r.id)),
    loadLockedRanges(db, clientId),
  ]);

  let budget = MAX_CREATE_PER_RUN;
  for (const r of rows) {
    const schedule = scheduleOf(r);
    const done = createdMonths.get(r.id) ?? [];
    const doneSet = new Set(done);
    for (const m of scheduledMonths(schedule, through)) {
      if (doneSet.has(m)) result.skipped.push({ recurringId: r.id, name: r.name, month: m, reason: "already" });
    }
    const pending = pendingMonths(schedule, through, done);
    if (pending.length === 0) continue;

    // 作る直前にも科目・税区分を確かめ直す（登録した後に科目が消された・変えられたことがある）
    let lines: RecurringLine[];
    try {
      lines = await cleanLines(db, clientId, parseLines(r.lines));
      const balance = checkBalance(lines);
      if (!balance.ok) throw new Error(balance.message);
    } catch (e) {
      result.failed.push({ recurringId: r.id, name: r.name, month: null, message: e instanceof Error ? e.message : "明細を読み取れません" });
      continue;
    }
    const amount = lines.reduce((s, l) => s + l.debit_amount, 0);

    const madeNow: string[] = [];
    for (const month of pending) {
      const date = postingDateOf(month, r.day_of_month);
      if (inLocked(date, locked)) {
        result.skipped.push({ recurringId: r.id, name: r.name, month, reason: "locked" });
        continue;
      }
      if (budget <= 0) {
        result.remaining++;
        continue;
      }

      const { data: entry, error: entryErr } = await db
        .from("journal_entries")
        .insert({
          client_id: clientId,
          entry_date: date,
          description: r.description || r.name,
          status: "draft",
          source: "recurring",
          created_by: user.id,
          needs_review: false,
          recurring_journal_id: r.id,
          recurring_month: month,
        })
        .select("id")
        .single();
      if (entryErr || !entry) {
        // 同時に押された別の画面が先に作った（一意制約）→ 作成済み
        if (entryErr?.code === "23505") {
          result.skipped.push({ recurringId: r.id, name: r.name, month, reason: "already" });
        } else {
          result.failed.push({ recurringId: r.id, name: r.name, month, message: entryErr?.message ?? "仕訳を作れませんでした" });
        }
        continue;
      }

      const { error: linesErr } = await db.from("journal_entry_lines").insert(
        lines.map((l, i) => ({
          journal_entry_id: entry.id,
          account_id: l.account_id,
          sub_account_id: l.sub_account_id,
          debit_amount: l.debit_amount,
          credit_amount: l.credit_amount,
          tax_category: l.tax_category,
          tax_rate: l.tax_category ? taxCategoryInfo(l.tax_category)?.rate ?? null : null,
          purchase_use: l.purchase_use ?? null,
          business_type: l.business_type ?? null,
          sort_order: i,
        }))
      );
      if (linesErr) {
        // 明細を作れなかったら見出しを残さない（残すと、その月が作成済みに見えてしまう）
        await db.from("journal_entries").delete().eq("id", entry.id);
        result.failed.push({ recurringId: r.id, name: r.name, month, message: `仕訳明細を作れませんでした: ${linesErr.message}` });
        continue;
      }

      budget--;
      madeNow.push(month);
      result.created.push({ recurringId: r.id, name: r.name, month, date, entryId: entry.id, amount });
    }

    if (madeNow.length) {
      const last = [r.last_generated_month, ...madeNow].filter((m): m is string => !!m).sort().pop() ?? null;
      if (last !== r.last_generated_month) {
        const { error: uErr } = await db.from("recurring_journals").update({ last_generated_month: last }).eq("id", r.id);
        if (uErr) console.error("[recurring-journals] 最後に作った月の更新に失敗:", uErr.message);
      }
    }
  }

  // 科目と摘要から税区分を補う・直す（ほかの自動作成の処理と同じ）
  const ids = result.created.map((c) => c.entryId);
  await classifyEntryLines(db, ids).catch((e) => console.error("[recurring-journals] 税区分の判別に失敗:", e));

  return result;
}
