"use server";

/**
 * 貸倒れの処理と貸倒引当金の計上。計算は src/lib/bad-debt.ts（テストあり）。
 */

import { createServerSupabaseClient } from "@/lib/supabase";
import { assertClientAccess } from "@/lib/authz";
import { fetchAllRows } from "@/lib/fetch-all";
import {
  resolveFiscalPeriodByKey,
  adjacentFiscalPeriodKeys,
  currentFiscalStartYear,
  type FiscalPeriodRow,
} from "@/lib/fiscal";
import { calcAllowance, writeOffLines, STATUTORY_RATES, type AllowanceResult } from "@/lib/bad-debt";
import { taxCategoryInfo } from "@/lib/tax-category";
import { getTrialBalance } from "@/actions/statements";
import { getSubAccountSummary } from "@/actions/ledger-books";

/** 一括評価金銭債権になる科目（売掛金・受取手形・貸付金・未収入金など） */
const RECEIVABLE = /売掛金|受取手形|貸付金|未収入金|未収金|立替金/;

const ACCOUNT_NAMES = {
  loss: "貸倒損失",
  allowance: "貸倒引当金",
  provision: "貸倒引当金繰入額",
  reversal: "貸倒引当金戻入益",
  outputTax: "仮受消費税",
} as const;

type Db = Awaited<ReturnType<typeof createServerSupabaseClient>>;

async function accountIds(db: Db, clientId: string): Promise<Record<keyof typeof ACCOUNT_NAMES, string | null>> {
  const { data } = await db
    .from("accounts")
    .select("id, name, client_id")
    .or(`client_id.eq.${clientId},client_id.is.null`)
    .in("name", Object.values(ACCOUNT_NAMES))
    .eq("is_active", true);
  // 顧問先の科目を共有の基本科目より優先する
  const rows = (data ?? []).sort((a, b) => (a.client_id ? 0 : 1) - (b.client_id ? 0 : 1));
  const find = (name: string) => rows.find((r) => r.name === name)?.id ?? null;
  return {
    loss: find(ACCOUNT_NAMES.loss),
    allowance: find(ACCOUNT_NAMES.allowance),
    provision: find(ACCOUNT_NAMES.provision),
    reversal: find(ACCOUNT_NAMES.reversal),
    outputTax: find(ACCOUNT_NAMES.outputTax),
  };
}

export type BadDebtPeriod = { startDate: string; endDate: string; key: string; prevKey: string; nextKey: string };

export type BadDebtContext = {
  period: BadDebtPeriod;
  /** 一括評価金銭債権になる科目と期末残高 */
  receivables: { id: string; code: string; name: string; balance: number }[];
  /** 貸倒引当金の残高（期末時点。当期にこの画面で計上した戻入・繰入は含めない＝計上前） */
  allowanceBalance: number;
  /** 税抜経理か（期間内に仮受消費税の仕訳がある） */
  exclusive: boolean;
  /** 免税事業者は消費税の控除が無い */
  taxExempt: boolean;
  missingAccounts: string[];
  industries: typeof STATUTORY_RATES;
};

/** 画面に出す前提（期間・債権の残高・引当金の残高など） */
export async function getBadDebtContext(clientId: string, periodKey?: string): Promise<BadDebtContext> {
  await assertClientAccess(clientId);
  const db = await createServerSupabaseClient();
  const [{ data: client }, { data: fyRows }] = await Promise.all([
    db.from("clients").select("fiscal_year_start_month, consumption_tax_status").eq("id", clientId).single(),
    db.from("fiscal_years").select("start_date, end_date").eq("client_id", clientId),
  ]);
  const sm = (client?.fiscal_year_start_month as number | null) ?? null;
  const rows = (fyRows ?? []) as FiscalPeriodRow[];
  const p = resolveFiscalPeriodByKey(rows, sm, periodKey ?? String(currentFiscalStartYear(sm)));
  const adj = adjacentFiscalPeriodKeys(rows, p);

  const tb = await getTrialBalance(clientId, p.startDate, p.endDate);
  const receivables = tb
    .filter((r) => r.category === "asset" && RECEIVABLE.test(r.name) && r.currentBalance !== 0)
    .map((r) => ({ id: r.id, code: r.code, name: r.name, balance: r.currentBalance }));
  const allowanceRow = tb.find((r) => r.name === ACCOUNT_NAMES.allowance);

  // 期間内に仮受消費税の仕訳があれば税抜経理とみなす
  const { count } = await db
    .from("journal_entry_lines")
    .select("id, accounts!inner ( name ), journal_entries!inner ( client_id, entry_date )", { count: "exact", head: true })
    .eq("journal_entries.client_id", clientId)
    .gte("journal_entries.entry_date", p.startDate)
    .lte("journal_entries.entry_date", p.endDate)
    .eq("accounts.name", ACCOUNT_NAMES.outputTax);

  const ids = await accountIds(db, clientId);

  // この画面で当期に計上した戻入・繰入は「計上前の残高」から除く
  // （除かないと、計上した直後にもう一度同じ仕訳を勧めてしまう）
  let postedThisPeriod = 0;
  if (ids.allowance) {
    type L = { debit_amount: number; credit_amount: number };
    const posted = await fetchAllRows<L>((from, to) =>
      db
        .from("journal_entry_lines")
        .select("debit_amount, credit_amount, journal_entries!inner ( client_id, entry_date, description )")
        .eq("account_id", ids.allowance!)
        .eq("journal_entries.client_id", clientId)
        .gte("journal_entries.entry_date", p.startDate)
        .lte("journal_entries.entry_date", p.endDate)
        .like("journal_entries.description", "貸倒引当金の%")
        .range(from, to) as unknown as PromiseLike<{ data: L[] | null; error: { message: string } | null }>
    );
    postedThisPeriod = posted.reduce((sum, l) => sum + (Number(l.credit_amount) || 0) - (Number(l.debit_amount) || 0), 0);
  }

  const missingAccounts = (Object.keys(ACCOUNT_NAMES) as (keyof typeof ACCOUNT_NAMES)[])
    .filter((k) => k !== "outputTax" && !ids[k])
    .map((k) => ACCOUNT_NAMES[k]);

  return {
    period: { startDate: p.startDate, endDate: p.endDate, key: p.startDate, prevKey: adj.prevKey, nextKey: adj.nextKey },
    receivables,
    // 貸倒引当金は貸方残高（試算表では借方プラスの符号付き）。当期にこの画面で計上した分は除く
    allowanceBalance: (allowanceRow ? -allowanceRow.currentBalance : 0) - postedThisPeriod,
    exclusive: (count ?? 0) > 0,
    taxExempt: client?.consumption_tax_status === "exempt",
    missingAccounts,
    industries: STATUTORY_RATES,
  };
}

/** 債権の科目の、相手先（補助科目）ごとの残高 */
export async function getReceivablePartners(
  clientId: string,
  accountId: string,
  startDate: string,
  asOf: string
): Promise<{ subAccountId: string | null; name: string; balance: number }[]> {
  const { rows } = await getSubAccountSummary(clientId, accountId, startDate, asOf);
  return rows.filter((r) => r.closing > 0).map((r) => ({ subAccountId: r.subAccountId, name: r.name, balance: r.closing }));
}

async function insertEntry(
  db: Db,
  clientId: string,
  date: string,
  description: string,
  lines: {
    account_id: string;
    debit_amount: number;
    credit_amount: number;
    sub_account_id?: string | null;
    tax_category?: string | null;
    tax_rate?: number | null;
  }[]
) {
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) throw new Error("ログインが必要です");
  const { data: entry, error } = await db
    .from("journal_entries")
    .insert({
      client_id: clientId,
      entry_date: date,
      description,
      status: "confirmed",
      source: "manual",
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !entry) throw new Error(error?.message ?? "仕訳の作成に失敗しました");
  const { error: lErr } = await db
    .from("journal_entry_lines")
    .insert(lines.map((l, i) => ({ ...l, journal_entry_id: entry.id, sort_order: i })));
  if (lErr) {
    await db.from("journal_entries").delete().eq("id", entry.id);
    throw new Error(lErr.message);
  }
  return entry.id as string;
}

export type WriteOffRequest = {
  date: string;
  /** 貸し倒れた債権の科目（売掛金など） */
  accountId: string;
  /** 相手先（補助科目）。補助科目の無い残高なら null */
  subAccountId: string | null;
  partnerName: string;
  amount: number;
  /** 元の売上の税率（課税売上でなければ null） */
  rate: 0.1 | 0.08 | null;
  /** 個別に引き当てていた貸倒引当金を取り崩す額 */
  useAllowance: number;
  /** 法律上・事実上・形式上の貸倒れ など */
  reason: string;
};

/** 貸倒れの仕訳を作る */
export async function createBadDebtWriteOff(clientId: string, req: WriteOffRequest): Promise<string> {
  await assertClientAccess(clientId);
  if (!(req.amount > 0)) throw new Error("貸倒れの金額を入力してください");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(req.date)) throw new Error("日付が正しくありません");
  const db = await createServerSupabaseClient();
  const ids = await accountIds(db, clientId);
  if (!ids.loss) throw new Error("勘定科目「貸倒損失」がありません");

  const { data: client } = await db.from("clients").select("consumption_tax_status").eq("id", clientId).single();
  const taxExempt = client?.consumption_tax_status === "exempt";
  // 期間内に仮受消費税の仕訳があれば税抜経理
  const { count } = await db
    .from("journal_entry_lines")
    .select("id, accounts!inner ( name ), journal_entries!inner ( client_id )", { count: "exact", head: true })
    .eq("journal_entries.client_id", clientId)
    .eq("accounts.name", ACCOUNT_NAMES.outputTax);
  const exclusive = (count ?? 0) > 0;

  // 補助科目がこの科目・この顧問先のものかを確かめる
  if (req.subAccountId) {
    const { data: sub } = await db.from("sub_accounts").select("account_id, client_id").eq("id", req.subAccountId).maybeSingle();
    if (!sub || sub.client_id !== clientId || sub.account_id !== req.accountId) throw new Error("相手先が科目と合っていません");
  }

  const lines = writeOffLines({
    amount: Math.round(req.amount),
    rate: taxExempt ? null : req.rate,
    exclusive,
    useAllowance: Math.round(req.useAllowance || 0),
  });
  if (lines.some((l) => l.role === "allowance") && !ids.allowance) throw new Error("勘定科目「貸倒引当金」がありません");
  if (lines.some((l) => l.role === "output_tax") && !ids.outputTax) throw new Error("勘定科目「仮受消費税」がありません");

  const accountOf = { loss: ids.loss, allowance: ids.allowance, output_tax: ids.outputTax, receivable: req.accountId } as const;
  return insertEntry(
    db,
    clientId,
    req.date,
    `貸倒れ: ${req.partnerName}${req.reason ? `（${req.reason}）` : ""}`,
    lines.map((l) => ({
      account_id: accountOf[l.role]!,
      debit_amount: l.debit,
      credit_amount: l.credit,
      sub_account_id: l.role === "receivable" ? req.subAccountId : null,
      tax_category: l.taxCategory,
      tax_rate: l.taxCategory ? taxCategoryInfo(l.taxCategory)?.rate ?? null : null,
    }))
  );
}

export type AllowanceRequest = {
  periodKey: string;
  /** 対象にする債権の科目 */
  accountIds: string[];
  deduction: number;
  rate: number;
  method: "reversal" | "difference";
};

/** 貸倒引当金の計算（保存しない。画面の確認用） */
export async function previewAllowance(clientId: string, req: AllowanceRequest): Promise<AllowanceResult & { receivables: number; priorBalance: number; date: string }> {
  const ctx = await getBadDebtContext(clientId, req.periodKey);
  const receivables = ctx.receivables.filter((r) => req.accountIds.includes(r.id)).reduce((s, r) => s + r.balance, 0);
  const r = calcAllowance({
    receivables,
    deduction: Math.max(0, Math.round(req.deduction || 0)),
    rate: req.rate,
    priorBalance: ctx.allowanceBalance,
    method: req.method,
  });
  return { ...r, receivables, priorBalance: ctx.allowanceBalance, date: ctx.period.endDate };
}

/** 貸倒引当金の仕訳を期末日で作る（洗替法は戻入と繰入の2本） */
export async function createAllowanceEntries(clientId: string, req: AllowanceRequest): Promise<string[]> {
  const p = await previewAllowance(clientId, req);
  const db = await createServerSupabaseClient();
  const ids = await accountIds(db, clientId);
  if (!ids.allowance || !ids.provision || !ids.reversal) {
    throw new Error("勘定科目（貸倒引当金・貸倒引当金繰入額・貸倒引当金戻入益）がそろっていません");
  }
  const created: string[] = [];
  for (const e of p.entries) {
    if (e.kind === "reverse") {
      created.push(
        await insertEntry(db, clientId, p.date, "貸倒引当金の戻入", [
          { account_id: ids.allowance, debit_amount: e.amount, credit_amount: 0 },
          { account_id: ids.reversal, debit_amount: 0, credit_amount: e.amount, tax_category: "sales_out_of_scope", tax_rate: 0 },
        ])
      );
    } else {
      created.push(
        await insertEntry(db, clientId, p.date, "貸倒引当金の繰入", [
          { account_id: ids.provision, debit_amount: e.amount, credit_amount: 0, tax_category: "purchase_out_of_scope", tax_rate: 0 },
          { account_id: ids.allowance, debit_amount: 0, credit_amount: e.amount },
        ])
      );
    }
  }
  return created;
}

/** 期間内に作った貸倒引当金の仕訳（二重に計上していないかの確認用） */
export async function getAllowanceEntries(clientId: string, startDate: string, endDate: string) {
  await assertClientAccess(clientId);
  const db = await createServerSupabaseClient();
  type Row = { id: string; entry_date: string; description: string | null };
  return fetchAllRows<Row>((from, to) =>
    db
      .from("journal_entries")
      .select("id, entry_date, description")
      .eq("client_id", clientId)
      .gte("entry_date", startDate)
      .lte("entry_date", endDate)
      .like("description", "貸倒引当金の%")
      .range(from, to) as unknown as PromiseLike<{ data: Row[] | null; error: { message: string } | null }>
  );
}
