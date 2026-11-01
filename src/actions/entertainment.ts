"use server";

/**
 * 交際費の設定（顧問先ごと）と、当期の交際費の明細・損金算入限度額の試算。
 * 決まりは src/lib/entertainment.ts（テストあり）。
 */

import { createServerSupabaseClient } from "@/lib/supabase";
import { assertClientAccess } from "@/lib/authz";
import { fetchAllRows } from "@/lib/fetch-all";
import {
  capitalClass,
  entertainmentLimit,
  guessIndustry,
  isEntertainmentAccount,
  isEntertainmentKind,
  isIndustryCode,
  judgeDining,
  parseEntertainmentSettings,
  perPersonLimit,
  type CapitalClass,
  type EntertainmentKind,
  type EntertainmentLimit,
  type EntertainmentSettings,
  type IndustryCode,
} from "@/lib/entertainment";

export type EntertainmentConfig = {
  industry: IndustryCode;
  /** 業種を設定していないので、業種欄から推し量った */
  industryGuessed: boolean;
  businessType: string | null;
  settings: EntertainmentSettings;
  entityType: "individual" | "corporation" | null;
  capital: number | null;
};

/** 顧問先の交際費の設定（AIの仕訳・質問からも使う） */
export async function getEntertainmentConfig(clientId: string): Promise<EntertainmentConfig> {
  await assertClientAccess(clientId);
  const db = await createServerSupabaseClient();
  const { data, error } = await db
    .from("clients")
    .select("business_type, industry, entertainment_settings, entity_type, capital_amount")
    .eq("id", clientId)
    .single();
  if (error) throw new Error(error.message);
  const row = data as {
    business_type: string | null;
    industry: string | null;
    entertainment_settings: unknown;
    entity_type: "individual" | "corporation" | null;
    capital_amount: number | null;
  };
  const set = isIndustryCode(row.industry);
  return {
    industry: set ? (row.industry as IndustryCode) : guessIndustry(row.business_type),
    industryGuessed: !set,
    businessType: row.business_type,
    settings: parseEntertainmentSettings(row.entertainment_settings),
    entityType: row.entity_type,
    capital: row.capital_amount === null ? null : Number(row.capital_amount),
  };
}

export async function saveEntertainmentConfig(
  clientId: string,
  input: { industry: IndustryCode; settings: EntertainmentSettings }
): Promise<void> {
  await assertClientAccess(clientId);
  if (!isIndustryCode(input.industry)) throw new Error("業種が正しくありません");
  const s = parseEntertainmentSettings(input.settings);
  if (s.perPersonLimit !== null && s.perPersonLimit > 1_000_000) throw new Error("1人当たりの基準額が大きすぎます");
  const db = await createServerSupabaseClient();
  const { error } = await db
    .from("clients")
    .update({ industry: input.industry, entertainment_settings: s })
    .eq("id", clientId);
  if (error) throw new Error(error.message);
}

export type EntertainmentLine = {
  lineId: string;
  entryId: string;
  entryDate: string;
  description: string | null;
  accountName: string;
  amount: number;
  kind: EntertainmentKind | null;
  attendees: number | null;
  attendeeNote: string | null;
  /** 飲食の行で、1人当たりの額と基準額の比べた結果（人数が無ければ null） */
  perPerson: number | null;
  limit: number;
  /** 人数・区分が足りず、別表十五の集計に入れられない */
  missing: ("kind" | "attendees")[];
};

export type EntertainmentReport = {
  lines: EntertainmentLine[];
  /** 交際費の科目の合計（帳簿の額） */
  bookTotal: number;
  /** うち1人当たり基準額以下の飲食として除く額 */
  underLimit: number;
  /** 支出交際費等の額（帳簿の額 − 除く額） */
  total: number;
  /** うち接待飲食費（区分を付けた行の合計） */
  dining: number;
  cls: CapitalClass | null;
  months: number;
  limit: EntertainmentLimit | null;
  config: EntertainmentConfig;
};

type LineRow = {
  id: string;
  debit_amount: number;
  credit_amount: number;
  entertainment_kind: string | null;
  attendees: number | null;
  attendee_note: string | null;
  accounts: { name: string; account_categories: { type: string } | null } | null;
  journal_entries: { id: string; entry_date: string; description: string | null; client_id: string };
};

/** 期間内の交際費の科目の行（基準額以下の飲食を移した先の科目の、区分を付けた行も含める） */
async function loadLines(clientId: string, startDate: string, endDate: string, underLimitAccount: string): Promise<LineRow[]> {
  const db = await createServerSupabaseClient();
  return fetchAllRows<LineRow>((from, to) =>
    db
      .from("journal_entry_lines")
      .select(
        "id, debit_amount, credit_amount, entertainment_kind, attendees, attendee_note, accounts!inner ( name, account_categories ( type ) ), journal_entries!inner ( id, entry_date, description, client_id )"
      )
      .eq("journal_entries.client_id", clientId)
      .gte("journal_entries.entry_date", startDate)
      .lte("journal_entries.entry_date", endDate)
      .or(`name.ilike.*交際費*,name.eq."${underLimitAccount.replace(/"/g, "")}"`, { referencedTable: "accounts" })
      .order("id")
      .range(from, to) as unknown as PromiseLike<{ data: LineRow[] | null; error: { message: string } | null }>
  );
}

export async function getEntertainmentReport(clientId: string, startDate: string, endDate: string): Promise<EntertainmentReport> {
  const config = await getEntertainmentConfig(clientId);
  const rows = (await loadLines(clientId, startDate, endDate, config.settings.underLimitAccount)).sort((a, b) =>
    a.journal_entries.entry_date.localeCompare(b.journal_entries.entry_date)
  );
  const lines: EntertainmentLine[] = [];
  let bookTotal = 0;
  let underLimit = 0;
  let dining = 0;
  for (const r of rows) {
    const name = r.accounts?.name ?? "";
    const amount = (Number(r.debit_amount) || 0) - (Number(r.credit_amount) || 0);
    const ent = isEntertainmentAccount(name);
    const kind = isEntertainmentKind(r.entertainment_kind) ? r.entertainment_kind : null;
    // 会議費などの行は、飲食として人数を記録したものだけを出す（ふつうの会議費は交際費の明細に混ぜない）
    if (!ent && kind === null && r.attendees === null) continue;
    const date = r.journal_entries.entry_date;
    const limit = perPersonLimit(date, config.settings);
    const isDining = kind === "dining" || kind === "dining_under_limit";
    const judged = isDining || !ent ? judgeDining({ amount, attendees: r.attendees, date }, config.settings) : null;
    const perPerson = judged && (judged.kind === "under_limit" || judged.kind === "over_limit") ? judged.perPerson : null;
    const missing: EntertainmentLine["missing"] = [];
    if (ent && kind === null) missing.push("kind");
    if (isDining && !r.attendees) missing.push("attendees");
    if (ent) {
      bookTotal += amount;
      // 1人当たり基準額以下の飲食は、交際費の科目に付けたままでも交際費等から除く
      if (kind === "dining_under_limit") underLimit += amount;
      else if (kind === "dining") dining += amount;
    }
    lines.push({
      lineId: r.id,
      entryId: r.journal_entries.id,
      entryDate: date,
      description: r.journal_entries.description,
      accountName: name,
      amount,
      kind,
      attendees: r.attendees,
      attendeeNote: r.attendee_note,
      perPerson,
      limit,
      missing,
    });
  }
  const total = bookTotal - underLimit;
  const months = monthsBetween(startDate, endDate);
  const cls = config.entityType === "individual" ? null : capitalClass(config.capital, config.settings.noFixedDeduction);
  const limit = cls ? entertainmentLimit({ total, dining, months, cls }) : null;
  return { lines, bookTotal, underLimit, total, dining, cls, months, limit, config };
}

function monthsBetween(start: string, end: string): number {
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  return Math.max(1, (ey - sy) * 12 + (em - sm) + 1);
}

/** 交際費の行の区分・参加人数・相手を直す（締めた年度の行は DB のトリガーで止まる） */
export async function updateEntertainmentLine(
  clientId: string,
  lineId: string,
  patch: { kind?: EntertainmentKind | null; attendees?: number | null; attendeeNote?: string | null }
): Promise<void> {
  await assertClientAccess(clientId);
  const db = await createServerSupabaseClient();
  // 行がこの顧問先の仕訳のものか
  const { data: line, error: lErr } = await db
    .from("journal_entry_lines")
    .select("id, journal_entries!inner ( client_id )")
    .eq("id", lineId)
    .eq("journal_entries.client_id", clientId)
    .maybeSingle();
  if (lErr) throw new Error(lErr.message);
  if (!line) throw new Error("仕訳の行が見つかりません");

  const update: { entertainment_kind?: EntertainmentKind | null; attendees?: number | null; attendee_note?: string | null } = {};
  if (patch.kind !== undefined) {
    if (patch.kind !== null && !isEntertainmentKind(patch.kind)) throw new Error("交際費の区分が正しくありません");
    update.entertainment_kind = patch.kind;
  }
  if (patch.attendees !== undefined) {
    const n = patch.attendees === null ? null : Math.floor(Number(patch.attendees));
    if (n !== null && (!Number.isFinite(n) || n <= 0 || n > 10_000)) throw new Error("参加人数は1〜10,000で入れてください");
    update.attendees = n;
  }
  if (patch.attendeeNote !== undefined) update.attendee_note = patch.attendeeNote?.trim().slice(0, 500) || null;
  const { error } = await db.from("journal_entry_lines").update(update).eq("id", lineId);
  if (error) throw new Error(error.message);
}

/**
 * 法人税申告書（別表十五）に使う、帳簿の交際費の区分の集計。
 * 区分を1行も付けていなければ dining は null（画面で入れた接待飲食費の額を使う）。
 */
export async function loadEntertainmentForReturn(
  clientId: string,
  startDate: string,
  endDate: string
): Promise<{ underLimit: number; dining: number | null; noFixedDeduction: boolean }> {
  const r = await getEntertainmentReport(clientId, startDate, endDate);
  const tagged = r.lines.some((l) => l.kind === "dining" || l.kind === "dining_under_limit");
  return { underLimit: r.underLimit, dining: tagged ? r.dining : null, noFixedDeduction: r.config.settings.noFixedDeduction };
}
