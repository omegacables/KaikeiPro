"use server";

import { createAdminSupabaseClient } from "@/lib/supabase";
import { assertClientAccess } from "@/lib/authz";
import { getTrialBalance } from "@/actions/statements";
import { fiscalRangeFromStartYear } from "@/lib/fiscal";

type DbRow = Record<string, unknown>;

// 期首残高仕訳を識別するための固定値（決算仕訳=期末日 と衝突しないよう期首日に作成）
const OPENING_DESCRIPTION = "期首残高（前期繰越）";

export type BsCategory = "asset" | "liability" | "equity";

export interface OpeningBalanceRow {
  account_id: string;
  code: string;
  name: string;
  category: BsCategory;
  balance: number; // 科目の性質に応じた正の値（資産=借方残, 負債・純資産=貸方残）
}

const categoryMap: Record<string, BsCategory | undefined> = {
  assets: "asset",
  liabilities: "liability",
  equity: "equity",
};

/**
 * 貸借対照表科目（資産・負債・純資産）と、現在登録済みの期首残高を返す。
 * 期首残高は source='closing'・entry_date=fiscalYearStart・description=OPENING_DESCRIPTION の
 * 仕訳から読み取る（無ければ 0）。
 */
export async function getOpeningBalances(
  clientId: string,
  fiscalYearStart: string
): Promise<OpeningBalanceRow[]> {
  await assertClientAccess(clientId);
  const supabase = createAdminSupabaseClient();

  // BS科目を取得（顧問先固有 + デフォルト）
  const { data: acctData, error: acctErr } = await supabase
    .from("accounts")
    .select(`id, code, name, account_categories!inner ( type )`)
    .or(`client_id.eq.${clientId},is_default.eq.true`)
    .eq("is_active", true)
    .order("code");
  if (acctErr) throw new Error(acctErr.message);

  // 既存の期首残高仕訳の明細を取得
  const { data: entry } = await supabase
    .from("journal_entries")
    .select("id")
    .eq("client_id", clientId)
    .eq("entry_date", fiscalYearStart)
    .eq("description", OPENING_DESCRIPTION)
    .maybeSingle();

  const lineMap = new Map<string, { debit: number; credit: number }>();
  const entryId = (entry as DbRow | null)?.id as string | undefined;
  if (entryId) {
    const { data: lines } = await supabase
      .from("journal_entry_lines")
      .select("account_id, debit_amount, credit_amount")
      .eq("journal_entry_id", entryId);
    for (const l of lines ?? []) {
      const row = l as DbRow;
      const aid = row.account_id as string;
      const cur = lineMap.get(aid) ?? { debit: 0, credit: 0 };
      cur.debit += (row.debit_amount as number) ?? 0;
      cur.credit += (row.credit_amount as number) ?? 0;
      lineMap.set(aid, cur);
    }
  }

  const rows: OpeningBalanceRow[] = [];
  for (const a of acctData ?? []) {
    const acct = a as DbRow;
    const catType = (acct.account_categories as { type: string } | null)?.type;
    const category = catType ? categoryMap[catType] : undefined;
    if (!category) continue; // BS科目（資産・負債・純資産）のみ
    const id = acct.id as string;
    const amt = lineMap.get(id) ?? { debit: 0, credit: 0 };
    const balance =
      category === "asset"
        ? amt.debit - amt.credit
        : amt.credit - amt.debit;
    rows.push({
      account_id: id,
      code: acct.code as string,
      name: acct.name as string,
      category,
      balance,
    });
  }
  return rows;
}

export interface OpeningBalanceInput {
  account_id: string;
  category: BsCategory;
  balance: number;
}

/**
 * 期首残高を保存する。既存の期首残高仕訳を置き換える。
 *   資産: 借方 ／ 負債・純資産: 貸方（マイナス値は反対側に計上）
 * 借方合計＝貸方合計でなければエラー（差額を提示）。
 */
export async function saveOpeningBalances(
  clientId: string,
  fiscalYearStart: string,
  items: OpeningBalanceInput[]
): Promise<{ entryId: string | null }> {
  await assertClientAccess(clientId);
  const admin = createAdminSupabaseClient();

  type LineInsert = {
    account_id: string;
    debit_amount: number;
    credit_amount: number;
    sort_order: number;
  };
  const lines: LineInsert[] = [];
  let totalDebit = 0;
  let totalCredit = 0;
  let sort = 0;
  for (const it of items) {
    const v = Math.round(it.balance || 0);
    if (v === 0) continue;
    let debit = 0;
    let credit = 0;
    if (it.category === "asset") {
      if (v >= 0) debit = v;
      else credit = -v;
    } else {
      if (v >= 0) credit = v;
      else debit = -v;
    }
    totalDebit += debit;
    totalCredit += credit;
    lines.push({
      account_id: it.account_id,
      debit_amount: debit,
      credit_amount: credit,
      sort_order: sort++,
    });
  }

  if (totalDebit !== totalCredit) {
    const diff = totalDebit - totalCredit;
    throw new Error(
      `借方合計（${totalDebit.toLocaleString()}）と貸方合計（${totalCredit.toLocaleString()}）が一致しません。` +
        `差額 ${Math.abs(diff).toLocaleString()} 円。利益剰余金等で調整してください。`
    );
  }

  // 既存の期首残高仕訳を削除（明細は ON DELETE CASCADE）
  const { data: existing } = await admin
    .from("journal_entries")
    .select("id")
    .eq("client_id", clientId)
    .eq("entry_date", fiscalYearStart)
    .eq("description", OPENING_DESCRIPTION);
  const existingIds = (existing ?? []).map((e) => (e as DbRow).id as string);
  if (existingIds.length > 0) {
    await admin.from("journal_entries").delete().in("id", existingIds);
  }

  if (lines.length === 0) {
    return { entryId: null };
  }

  const { data: entry, error: entryErr } = await admin
    .from("journal_entries")
    .insert({
      client_id: clientId,
      entry_date: fiscalYearStart,
      description: OPENING_DESCRIPTION,
      status: "confirmed",
      source: "closing",
      created_by: clientId,
      needs_review: false,
      metadata: { kind: "opening_balance" },
    })
    .select()
    .single();
  if (entryErr) throw new Error(`期首残高仕訳の作成に失敗しました: ${entryErr.message}`);

  const withEntry = lines.map((l) => ({ ...l, journal_entry_id: entry.id }));
  const { error: linesErr } = await admin
    .from("journal_entry_lines")
    .insert(withEntry);
  if (linesErr) throw new Error(`期首残高明細の作成に失敗しました: ${linesErr.message}`);

  return { entryId: entry.id as string };
}

export interface CarryForwardResult {
  entryId: string | null;
  netIncome: number;          // 前期純損益（利益=正）
  retainedAccountName: string | null; // 繰越先の純資産科目名
  carriedCount: number;       // 繰り越したBS科目数
  priorStart: string;
  priorEnd: string;
}

/**
 * 前年度の決算残高から当期の期首残高を自動生成（繰越処理）する。
 *   - 前期末時点のBS科目残高（資産・負債・純資産）をそのまま繰り越す。
 *   - 前期のP/L純損益（収益−費用）を「繰越利益剰余金（利益剰余金）」に振り替える。
 *     → これにより 資産 ＝ 負債＋純資産 が成立し、期首残高仕訳が貸借一致する。
 * 既存の期首残高仕訳は置き換える（saveOpeningBalances 経由）。
 */
export async function carryForwardOpeningBalances(
  clientId: string,
  fiscalYearStart: string
): Promise<CarryForwardResult> {
  await assertClientAccess(clientId);
  // 前年度の期間を算出（当期首=fiscalYearStart の前年度）
  const [y, m] = fiscalYearStart.split("-").map(Number);
  const { startDate: priorStart, endDate: priorEnd } = fiscalRangeFromStartYear(
    m,
    y - 1
  );

  // 前期末時点の各科目残高（currentBalance は借方プラスの累計残高）
  const trial = await getTrialBalance(clientId, priorStart, priorEnd);
  if (trial.length === 0) {
    throw new Error(
      `前年度（${priorStart} 〜 ${priorEnd}）の仕訳データが見つかりません。手動で入力してください。`
    );
  }

  // 借方プラス（debit-positive）でBS残高を集計しつつ、P/L純額を算出
  const bsBalance = new Map<string, number>(); // account_id -> 借方プラス残高
  const bsCategory = new Map<string, BsCategory>();
  let plNetDebitPositive = 0; // 収益・費用の借方プラス合計（=−純利益）

  for (const r of trial) {
    if (r.category === "asset" || r.category === "liability" || r.category === "equity") {
      bsBalance.set(r.id, r.currentBalance);
      bsCategory.set(r.id, r.category);
    } else {
      // revenue / expense
      plNetDebitPositive += r.currentBalance;
    }
  }

  const netIncome = -plNetDebitPositive; // 利益=正

  // 純損益を繰越利益剰余金（利益剰余金）に振り替える
  let retainedAccountName: string | null = null;
  if (netIncome !== 0) {
    const admin = createAdminSupabaseClient();
    const { data: eqAccts } = await admin
      .from("accounts")
      .select(`id, name, account_categories!inner ( type )`)
      .or(`client_id.eq.${clientId},is_default.eq.true`)
      .eq("is_active", true)
      .order("code");
    const keywords = ["繰越利益剰余金", "利益剰余金", "繰越利益", "別途積立金"];
    let reId: string | null = null;
    for (const kw of keywords) {
      const hit = (eqAccts ?? []).find((a) => {
        const row = a as DbRow;
        const cat = (row.account_categories as { type: string } | null)?.type;
        return cat === "equity" && ((row.name as string) ?? "").includes(kw);
      });
      if (hit) {
        reId = (hit as DbRow).id as string;
        retainedAccountName = (hit as DbRow).name as string;
        break;
      }
    }
    if (!reId) {
      throw new Error(
        "「繰越利益剰余金（利益剰余金）」科目が見つかりません。勘定科目に登録してから再実行してください。"
      );
    }
    // RE 残高 += P/L純額（借方プラス）。これでBS全体の借方プラス合計が0になり貸借一致。
    bsBalance.set(reId, (bsBalance.get(reId) ?? 0) + plNetDebitPositive);
    if (!bsCategory.has(reId)) bsCategory.set(reId, "equity");
  }

  // OpeningBalanceInput に変換（資産=借方プラス, 負債・純資産=貸方プラス）
  const items: OpeningBalanceInput[] = [];
  for (const [accountId, debitPositive] of bsBalance) {
    const category = bsCategory.get(accountId) ?? "equity";
    const balance = category === "asset" ? debitPositive : -debitPositive;
    items.push({ account_id: accountId, category, balance });
  }

  const { entryId } = await saveOpeningBalances(clientId, fiscalYearStart, items);

  return {
    entryId,
    netIncome,
    retainedAccountName,
    carriedCount: items.filter((i) => Math.round(i.balance) !== 0).length,
    priorStart,
    priorEnd,
  };
}
