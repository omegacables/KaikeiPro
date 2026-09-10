"use client";

import * as React from "react";
import { useState, useEffect, useCallback, use, useMemo, useRef } from "react";
import {
  Landmark,
  Plus,
  Loader2,
  X,
  Pencil,
  Trash2,
  CheckCircle,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Sparkles,
  Paperclip,
  FileText,
  CalendarClock,
  Scale,
  Printer,
  Search,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useFieldNav } from "@/components/ui/use-field-nav";
import { AmountInput } from "@/components/ui/amount-input";
import { IconButton } from "@/components/ui/icon-button";
import { AccountLookup, type AccountOption } from "@/components/ui/account-lookup";
import {
  getLoanLedgers,
  createLoan,
  updateLoan,
  deleteLoan,
  createLoanEntry,
  updateLoanEntry,
  deleteLoanEntry,
  journalizeLoanEntry,
  unjournalizeLoanEntry,
  attachReceiptToEntry,
  detachReceiptFromEntry,
  getEntryReceipts,
  addLoanAlias,
  getRepaymentSchedules,
  generateSchedules,
  deleteSchedule,
  applySchedule,
  reconcileLoan,
} from "@/actions/loans";
import {
  draftLoanEntriesFromText,
  draftLoanEntriesFromReceipt,
  classifyOfficerPayment,
  commitLoanAiDrafts,
} from "@/actions/loan-ai";
import { loadClients, loadStatutoryRates } from "@/lib/client-cache";
import { getAccounts } from "@/actions/accounts";
import { getReceipts } from "@/actions/receipts";
import {
  runningBalances,
  netByCounterparty,
  imputedInterestAlert,
  entryTypeLabel,
  interestTotals,
  type ImputedInterestAlert,
  type ReconcileResult,
} from "@/lib/loan-ledger";
import type {
  LoanLedger,
  LoanEntry,
  LoanEntryType,
  LoanDirection,
  CounterpartyKind,
  LoanAiDraft,
  LoanEntryReceipt,
  OfficerPaymentClassification,
  LoanRepaymentSchedule,
} from "@/types/index";
import { currentFiscalStartYear } from "@/lib/fiscal";
import { useRouter } from "next/navigation";
import { toHalfWidth } from "@/lib/account-reading";
import { formatCurrency } from "@/lib/utils";
import { DateInput } from "@/components/ui/date-input";

const num = (s: string) => Math.round(Number(s) || 0);

const inputCls =
  "w-full px-3 py-2 rounded-lg border border-border bg-background text-[17px] focus:outline-none focus:ring-2 focus:ring-primary/40";

// 日本語は英字より字画が多く、同じサイズ・濃度でも視認性が落ちる。
// 本文は17px以上、説明文に薄いグレー（muted-foreground）を使わない。
const labelCls = "block text-[15px] font-medium text-foreground mb-1";
const bodyCls = "text-[17px] text-foreground";

function today(): string {
  return new Date().toISOString().split("T")[0];
}

const ENTRY_TYPES: LoanEntryType[] = ["borrow", "advance", "repay", "interest"];

/**
 * 区分ごとのバッジの色。残高を増やすものと減らすものを色で分ける。
 * 調整は移行時の差額など内容の確認が要るので警告色にする。
 */
const ENTRY_TYPE_TONE: Record<LoanEntryType, "default" | "success" | "info" | "warning" | "muted"> = {
  borrow: "info",     // 元本の発生
  advance: "info",    // 立替も残高を増やす
  interest: "muted",  // 利息
  repay: "success",   // 返済＝残高が減る
  adjust: "warning",  // 要確認
};

// ---------------------------------------------------------------------------
// フォームの状態
// ---------------------------------------------------------------------------

type LoanFormState = {
  lender_name: string;
  direction: LoanDirection;
  counterparty_kind: CounterpartyKind;
  interest_rate: string;
  repayment_terms: string;
  purpose: string;
  memo: string;
  /** 通帳での表記。カンマ区切りで複数 */
  aliases: string;
};

const emptyLoanForm: LoanFormState = {
  lender_name: "",
  direction: "borrow",
  counterparty_kind: "institution",
  interest_rate: "",
  repayment_terms: "",
  purpose: "",
  memo: "",
  aliases: "",
};

type EntryFormState = {
  entry_date: string;
  entry_type: LoanEntryType;
  amount: string;
  /** 返済と同時に支払う利息。残高は動かさず仕訳にだけ載る */
  interest_amount: string;
  expense_account_id: string;
  memo: string;
};

function emptyEntryForm(): EntryFormState {
  return {
    entry_date: today(),
    entry_type: "borrow",
    amount: "",
    interest_amount: "",
    expense_account_id: "",
    memo: "",
  };
}

type EditableDraft = LoanAiDraft & {
  selected: boolean;
  /** 役員個人への送金の判別結果。押されるまでは未取得 */
  classification?: OfficerPaymentClassification | null;
  classifying?: boolean;
  /** 台帳を選んだ直後に、この読み取り名を別名として登録するか尋ねる */
  aliasSuggestion?: string | null;
};

/** 判別の選択肢の表示名 */
const OPTION_LABELS: Record<string, string> = {
  loan_repayment: "役員借入金の返済",
  officer_salary: "役員報酬",
  expense_settlement: "立替経費の精算",
  other: "その他",
};

// ---------------------------------------------------------------------------

export default function LoansPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [ledgers, setLedgers] = useState<LoanLedger[]>([]);
  const [expenseAccounts, setExpenseAccounts] = useState<AccountOption[]>([]);
  const [rates, setRates] = useState<Record<number, number>>({});
  const [fiscalStartMonth, setFiscalStartMonth] = useState<number>(4);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 相手先フォーム
  const [showLoanForm, setShowLoanForm] = useState(false);
  const [editingLoanId, setEditingLoanId] = useState<string | null>(null);
  const [loanForm, setLoanForm] = useState<LoanFormState>(emptyLoanForm);

  // 展開中の台帳と明細フォーム
  const [expanded, setExpanded] = useState<string | null>(null);
  const [entryForm, setEntryForm] = useState<EntryFormState>(emptyEntryForm());
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);

  // 証憑の紐付け
  const [receiptLinks, setReceiptLinks] = useState<Record<string, LoanEntryReceipt[]>>({});
  const [attachTarget, setAttachTarget] = useState<LoanEntry | null>(null);

  // 相手先の検索・絞り込み
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | "borrow" | "lend" | "officer" | "institution">("all");

  // 追加できたことを短く知らせる（画面が下に伸びるため、成功したか分かりにくい）
  const [notice, setNotice] = useState<string | null>(null);
  // 二重送信の防止。setBusy は反映が非同期なので、連打には ref で即座に蓋をする
  const submittingRef = useRef(false);

  // AI
  const [aiText, setAiText] = useState("");
  // 押した操作だけが「処理中」になるよう、AIの操作ごとに状態を分ける
  const [aiBusy, setAiBusy] = useState<null | "text" | "document" | "commit">(null);
  const [drafts, setDrafts] = useState<EditableDraft[]>([]);
  const [excluded, setExcluded] = useState<{ line: string; reason: string }[]>([]);
  const [aiWarnings, setAiWarnings] = useState<string[]>([]);

  // --- データ取得 ----------------------------------------------------------

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [ls, clients, accounts, rateMap] = await Promise.all([
        getLoanLedgers(id),
        // 決算月は顧問先一覧に含まれる。ヘッダーと共有のキャッシュから引き、
        // 台帳を開くたびに顧問先を取りに行かない
        loadClients(),
        getAccounts(id).catch(() => []),
        // 利率は年に一度しか変わらないのでキャッシュから読む
        loadStatutoryRates(),
      ]);
      setLedgers(ls);
      const client = clients.find((c) => c.id === id);
      if (client?.fiscal_year_start_month) setFiscalStartMonth(client.fiscal_year_start_month);
      setExpenseAccounts(
        (accounts ?? [])
          .map((a) => {
            const cat = a.account_categories as unknown as { type: string; name: string };
            return {
              id: a.id as string,
              code: a.code as string,
              name: a.name as string,
              categoryType: cat?.type ?? "",
              categoryName: cat?.name ?? "",
            };
          })
          // 立替の相手科目になるのは費用科目のみ
          .filter((a) => a.categoryType === "expenses")
      );
      setRates(rateMap);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const loadReceiptLinks = useCallback(async (loanId: string) => {
    try {
      const links = await getEntryReceipts(loanId);
      setReceiptLinks((prev) => ({ ...prev, [loanId]: links }));
    } catch {
      // 証憑の読み込み失敗は台帳表示を妨げない
    }
  }, []);

  async function toggleExpand(loanId: string) {
    if (expanded === loanId) {
      setExpanded(null);
      return;
    }
    setExpanded(loanId);
    setEntryForm(emptyEntryForm());
    setEditingEntryId(null);
    if (!receiptLinks[loanId]) await loadReceiptLinks(loanId);
  }

  // --- 集計 ----------------------------------------------------------------

  const summary = useMemo(() => {
    const borrowLedgers = ledgers.filter((l) => l.loan.direction === "borrow");
    const lendLedgers = ledgers.filter((l) => l.loan.direction === "lend");

    const total = borrowLedgers.reduce((s, l) => s + l.balance, 0);
    const officer = borrowLedgers
      .filter((l) => l.loan.counterparty_kind === "officer")
      .reduce((s, l) => s + l.balance, 0);
    const lend = lendLedgers.reduce((s, l) => s + l.balance, 0);

    return { total, officer, institution: total - officer, lend };
  }, [ledgers]);

  // 役員貸付金の認定利息アラート。台帳ごとに判定し、最も重いものを代表として出す。
  const lendAlerts = useMemo(() => {
    return ledgers
      .filter((l) => l.loan.direction === "lend")
      .map((l) => ({
        ledger: l,
        alert: imputedInterestAlert({
          entries: l.entries,
          fiscalStartMonth,
          rateByLoanYear: rates,
        }),
      }))
      .filter((a) => a.alert.level !== "none");
  }, [ledgers, fiscalStartMonth, rates]);

  const worstAlert: ImputedInterestAlert | null = useMemo(() => {
    const required = lendAlerts.find((a) => a.alert.level === "required");
    if (required) return required.alert;
    return lendAlerts[0]?.alert ?? null;
  }, [lendAlerts]);

  // 相手先の絞り込み。名前・メモ・借入理由・返済条件を対象にする。
  // 全角半角と大文字小文字の違いで引っかからないよう揃えてから比べる
  const visibleLedgers = useMemo(() => {
    const q = toHalfWidth(search).trim().toLowerCase();
    return ledgers.filter((l) => {
      const { direction, counterparty_kind } = l.loan;
      if (kindFilter === "borrow" && direction !== "borrow") return false;
      if (kindFilter === "lend" && direction !== "lend") return false;
      if (kindFilter === "officer" && counterparty_kind !== "officer") return false;
      if (kindFilter === "institution" && counterparty_kind !== "institution") return false;
      if (!q) return true;
      const haystack = [
        l.loan.lender_name,
        l.loan.memo,
        l.loan.purpose,
        l.loan.repayment_terms,
      ]
        .filter(Boolean)
        .join(" ");
      return toHalfWidth(haystack).toLowerCase().includes(q);
    });
  }, [ledgers, search, kindFilter]);

  // 同一相手先に借入金と貸付金の両方がある場合のみ差引を出す
  const netPositions = useMemo(() => {
    const entriesByLoanId = Object.fromEntries(ledgers.map((l) => [l.loan.id, l.entries]));
    return netByCounterparty(
      ledgers.map((l) => ({
        id: l.loan.id,
        lender_name: l.loan.lender_name,
        direction: l.loan.direction,
      })),
      entriesByLoanId
    ).filter((p) => p.borrowBalance > 0 && p.lendBalance > 0);
  }, [ledgers]);

  // --- 相手先の操作 --------------------------------------------------------

  function openCreateLoan() {
    setEditingLoanId(null);
    setLoanForm({ ...emptyLoanForm });
    setShowLoanForm(true);
    setError(null);
  }

  function openEditLoan(l: LoanLedger) {
    setEditingLoanId(l.loan.id);
    setLoanForm({
      lender_name: l.loan.lender_name,
      direction: l.loan.direction,
      counterparty_kind: l.loan.counterparty_kind,
      interest_rate: l.loan.interest_rate != null ? String(l.loan.interest_rate) : "",
      repayment_terms: l.loan.repayment_terms ?? "",
      aliases: (l.loan.aliases ?? []).join(", "),
      purpose: l.loan.purpose ?? "",
      memo: l.loan.memo ?? "",
    });
    setShowLoanForm(true);
    setError(null);
  }

  // 役員は無利息が原則なので年利欄を出さない（要件3-7）
  const showInterestRate =
    loanForm.counterparty_kind === "institution" && loanForm.direction === "borrow";

  async function handleSaveLoan() {
    if (!loanForm.lender_name.trim()) {
      setError("相手先を入力してください");
      return;
    }
    setBusy("save-loan");
    setError(null);
    try {
      const payload = {
        client_id: id,
        lender_name: loanForm.lender_name.trim(),
        direction: loanForm.direction,
        counterparty_kind: loanForm.counterparty_kind,
        interest_rate: showInterestRate && loanForm.interest_rate.trim() !== ""
          ? Number(loanForm.interest_rate)
          : null,
        liability_account_id: null,
        business_partner_id: null,
        repayment_terms: loanForm.repayment_terms.trim() || null,
        aliases: loanForm.aliases
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean),
        purpose: loanForm.purpose.trim() || null,
        memo: loanForm.memo.trim() || null,
      };
      if (editingLoanId) await updateLoan(editingLoanId, payload);
      else await createLoan(payload);
      setShowLoanForm(false);
      await fetchAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setBusy(null);
    }
  }

  async function handleDeleteLoan(l: LoanLedger) {
    if (
      !confirm(
        `「${l.loan.lender_name}」の台帳を削除しますか？\n（増減明細と生成済みの仕訳もすべて削除されます）`
      )
    )
      return;
    setBusy(l.loan.id);
    try {
      await deleteLoan(l.loan.id);
      if (expanded === l.loan.id) setExpanded(null);
      await fetchAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除に失敗しました");
    } finally {
      setBusy(null);
    }
  }

  // --- 明細の操作 ----------------------------------------------------------

  function openEditEntry(entry: LoanEntry) {
    setEditingEntryId(entry.id);
    setEntryForm({
      entry_date: entry.entry_date,
      entry_type: entry.entry_type === "adjust" ? "borrow" : entry.entry_type,
      amount: String(entry.amount || ""),
      interest_amount: String(entry.interest_amount || ""),
      expense_account_id: entry.expense_account_id ?? "",
      memo: entry.memo ?? "",
    });
  }

  async function handleSaveEntry(ledger: LoanLedger) {
    // 連打による二重登録を防ぐ。会計データでは同じ明細が2件入ると残高が狂う
    if (submittingRef.current) return;

    const amount = num(entryForm.amount);
    if (amount <= 0) {
      setError("金額を入力してください");
      return;
    }
    if (entryForm.entry_type === "advance" && !entryForm.expense_account_id) {
      setError("立替には費用科目を選んでください");
      return;
    }
    submittingRef.current = true;
    setBusy("entry-" + ledger.loan.id);
    setError(null);
    setNotice(null);
    try {
      const payload = {
        loan_id: ledger.loan.id,
        client_id: id,
        entry_date: entryForm.entry_date || today(),
        entry_type: entryForm.entry_type,
        amount,
        interest_amount:
          entryForm.entry_type === "repay" ? num(entryForm.interest_amount) : 0,
        signed_adjustment: null,
        expense_account_id:
          entryForm.entry_type === "advance" ? entryForm.expense_account_id : null,
        payment_account_id: null,
        ai_evidence: null,
        memo: entryForm.memo.trim() || null,
      };
      if (editingEntryId) await updateLoanEntry(editingEntryId, payload);
      else await createLoanEntry(payload);
      setNotice(
        `${editingEntryId ? "更新" : "追加"}しました: ${entryForm.entry_date} ${entryTypeLabel(
          entryForm.entry_type,
          ledger.loan.direction
        )} ${formatCurrency(amount)}`
      );
      setEntryForm(emptyEntryForm());
      setEditingEntryId(null);
      await fetchAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "登録に失敗しました");
    } finally {
      submittingRef.current = false;
      setBusy(null);
    }
  }

  async function handleDeleteEntry(entry: LoanEntry) {
    if (
      !confirm(
        `この明細を削除しますか？${
          entry.journal_entry_id ? "\n（生成済みの仕訳も削除されます）" : ""
        }\n削除すると以降の残高が再計算されます。`
      )
    )
      return;
    setBusy(entry.id);
    try {
      await deleteLoanEntry(entry.id);
      await fetchAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除に失敗しました");
    } finally {
      setBusy(null);
    }
  }

  async function handleJournalize(entry: LoanEntry) {
    setBusy(entry.id);
    setError(null);
    try {
      await journalizeLoanEntry(entry.id);
      await fetchAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "仕訳化に失敗しました");
    } finally {
      setBusy(null);
    }
  }

  async function handleUnjournalize(entry: LoanEntry) {
    if (!confirm("仕訳化を取り消し、生成済みの仕訳を削除します。よろしいですか？")) return;
    setBusy(entry.id);
    try {
      await unjournalizeLoanEntry(entry.id);
      await fetchAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "取り消しに失敗しました");
    } finally {
      setBusy(null);
    }
  }

  // --- AI ------------------------------------------------------------------

  async function handleAiText() {
    if (!aiText.trim()) return;
    setAiBusy("text");
    setError(null);
    setExcluded([]);
    setAiWarnings([]);
    try {
      const result = await draftLoanEntriesFromText(id, aiText);
      if (result.length === 0) {
        setError("入力から明細を読み取れませんでした。日付・相手先・金額を含めてみてください。");
      }
      // 信頼度0.5以上を既定でチェックON（既存のAI取込UIと同じ基準）
      setDrafts(result.map((d) => ({ ...d, selected: d.evidence.confidence >= 0.5 })));
    } catch (e) {
      setError(e instanceof Error ? e.message : "AIの処理に失敗しました");
    } finally {
      setAiBusy(null);
    }
  }

  async function handleAiDocument(receiptId: string) {
    setAiBusy("document");
    setError(null);
    try {
      const result = await draftLoanEntriesFromReceipt(id, receiptId);
      setDrafts(result.candidates.map((d) => ({ ...d, selected: d.evidence.confidence >= 0.5 })));
      setExcluded(result.excluded);
      setAiWarnings(result.warnings);
    } catch (e) {
      setError(e instanceof Error ? e.message : "証憑の読み取りに失敗しました");
    } finally {
      setAiBusy(null);
    }
  }

  /**
   * 役員個人への送金を判別する。
   * 判別材料（役員報酬の手取額との一致、台帳残高、過去の分類履歴）は
   * サーバー側で確定させてからAIに渡している。
   */
  async function handleClassifyDraft(index: number) {
    const d = drafts[index];
    if (!d) return;
    setDrafts(drafts.map((x, i) => (i === index ? { ...x, classifying: true } : x)));
    setError(null);
    try {
      const result = await classifyOfficerPayment(id, {
        date: d.entry_date,
        amount: d.amount,
        description: d.evidence.sourceText || d.memo || d.counterparty_name,
      });
      setDrafts((prev) =>
        prev.map((x, i) =>
          i === index ? { ...x, classification: result, classifying: false } : x
        )
      );
    } catch (e) {
      setDrafts((prev) =>
        prev.map((x, i) => (i === index ? { ...x, classifying: false } : x))
      );
      setError(e instanceof Error ? e.message : "判別に失敗しました");
    }
  }

  /** 判別の結果を受けて、その行を残す（返済として登録）か、台帳の対象外にする */
  function handleResolveClassify(index: number, action: "keep" | "drop") {
    if (action === "drop") {
      setDrafts(drafts.filter((_, i) => i !== index));
      return;
    }
    setDrafts(
      drafts.map((x, i) =>
        i === index ? { ...x, classification: null, selected: true } : x
      )
    );
  }

  /** 読み取った名前を、選んだ台帳の別名として登録する */
  async function handleLearnAlias(index: number) {
    const d = drafts[index];
    if (!d?.loan_id || !d.aliasSuggestion) return;
    try {
      await addLoanAlias(d.loan_id, d.aliasSuggestion);
      setDrafts((prev) =>
        prev.map((x, i) => (i === index ? { ...x, aliasSuggestion: null } : x))
      );
      setNotice(`「${d.aliasSuggestion}」を ${d.counterparty_name} の通帳での表記として登録しました。`);
      await fetchAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "登録に失敗しました");
    }
  }

  async function handleCommitDrafts() {
    // 元の並びでの位置を覚えておく。失敗した下書きだけを残すために使う
    const chosenIdx = drafts.map((d, i) => (d.selected ? i : -1)).filter((i) => i >= 0);
    if (chosenIdx.length === 0) return;

    setAiBusy("commit");
    setError(null);
    try {
      const { created, errors } = await commitLoanAiDrafts(
        id,
        chosenIdx.map((i) => drafts[i])
      );

      // 登録できたものだけ消し、失敗したものは残す。
      // 全部消すと読み取り結果が失われ、AIを呼び直すことになる
      const failed = new Set(errors.map((e) => chosenIdx[e.index]));
      setDrafts(drafts.filter((d, i) => !d.selected || failed.has(i)));

      if (errors.length > 0) {
        // 同じ理由が並ぶと読みにくいので、まとめて件数で示す
        const counts = new Map<string, number>();
        for (const e of errors) counts.set(e.message, (counts.get(e.message) ?? 0) + 1);
        const summary = [...counts.entries()]
          .map(([msg, n]) => (n > 1 ? `${msg}（${n}件）` : msg))
          .join("\n");
        setError(
          `${created}件を登録しました。${errors.length}件は登録できませんでした。\n` +
            `${summary}\n登録できなかった分は下に残してあります。直して登録し直せます。`
        );
      } else {
        setNotice(`${created}件を登録しました。`);
        setExcluded([]);
        setAiText("");
      }
      await fetchAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "登録に失敗しました");
    } finally {
      setAiBusy(null);
    }
  }

  // -------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Landmark className="size-6 text-primary" />
          <h1 className="text-xl font-bold">借入金台帳</h1>
        </div>
        <div className="flex items-center gap-2">
          {/* 法人税申告に添付する「借入金及び支払利子の内訳書」（要件3-6） */}
          <Button
            variant="outline"
            onClick={() =>
              router.push(
                `/clients/${id}/loans/breakdown/${currentFiscalStartYear(fiscalStartMonth)}`
              )
            }
          >
            <Printer className="size-4" />
            内訳明細書を出力
          </Button>
          <Button onClick={openCreateLoan}>
            <Plus className="size-4" />
            相手先を追加
          </Button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-[17px] text-destructive whitespace-pre-wrap">
          {error}
        </div>
      )}

      {notice && (
        <div className="p-3 rounded-lg bg-primary/10 border border-primary/20 text-[17px] text-foreground">
          {notice}
        </div>
      )}

      {/* 役員貸付金の認定利息アラート（本機能で最も価値が出る部分） */}
      {worstAlert && <ImputedInterestBanner alert={worstAlert} />}

      {/* サマリー */}
      {/* 借入金は「合計」の中に内訳を入れ、貸付金は別枠にする。
          役員借入金と役員貸付金は1文字違いで意味が正反対なので、並べると混同される。 */}
      <div className="grid gap-4 grid-cols-2 max-w-3xl">
        <Card>
          <CardContent className="py-4">
            <p className="text-xl font-bold text-foreground">借入金残高合計</p>
            <p className="text-3xl font-bold tabular-nums text-foreground">
              {formatCurrency(summary.total)}
            </p>
            <div className="mt-3 space-y-1 border-t border-border pt-3">
              <div className="flex items-baseline justify-between">
                <span className="text-[17px] text-foreground">うち金融機関等</span>
                <span className="text-[17px] font-medium tabular-nums">
                  {formatCurrency(summary.institution)}
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-[17px] text-foreground">うち役員借入金</span>
                <span className="text-[17px] font-medium tabular-nums">
                  {formatCurrency(summary.officer)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card
          className={summary.lend > 0 ? "border-destructive/40 bg-destructive/5" : undefined}
        >
          <CardContent className="py-4">
            <p
              className={`text-xl font-bold ${summary.lend > 0 ? "text-destructive" : "text-foreground"}`}
            >
              役員貸付金
            </p>
            <p
              className={`text-3xl font-bold tabular-nums ${summary.lend > 0 ? "text-destructive" : "text-foreground"}`}
            >
              {formatCurrency(summary.lend)}
            </p>
            {summary.lend > 0 && worstAlert && (
              <p className="mt-1 text-[15px] font-medium text-destructive">
                {worstAlert.level === "required"
                  ? "認定利息の計上が必要"
                  : `決算日まで${worstAlert.daysUntilFiscalYearEnd}日`}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 同一相手先の差引（会計上は両建てだが、実態把握のための表示） */}
      {netPositions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">同一相手先の差引</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className={bodyCls}>
              会計上は両建てが原則です。以下は実態を把握するための参考表示です。
            </p>
            {netPositions.map((p) => (
              <div
                key={p.name}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-4 py-3"
              >
                <span className="text-[17px] font-medium">{p.name}</span>
                <span className={bodyCls}>
                  借入金 {formatCurrency(p.borrowBalance)} ／ 貸付金{" "}
                  {formatCurrency(p.lendBalance)}
                </span>
                <span className="text-[17px] font-bold">
                  差引 {formatCurrency(p.net)}
                  <Badge variant={p.netSide === "lend" ? "warning" : "muted"} className="ml-2">
                    {p.netSide === "lend"
                      ? "貸付が超過"
                      : p.netSide === "borrow"
                        ? "借入が超過"
                        : "相殺"}
                  </Badge>
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* AI起票 */}
      <AiPanel
        clientId={id}
        ledgers={ledgers}
        text={aiText}
        setText={setAiText}
        busy={aiBusy}
        drafts={drafts}
        setDrafts={setDrafts}
        excluded={excluded}
        warnings={aiWarnings}
        expenseAccounts={expenseAccounts}
        onRunText={handleAiText}
        onRunDocument={handleAiDocument}
        onCommit={handleCommitDrafts}
        onCancel={() => {
          setDrafts([]);
          setExcluded([]);
          setAiWarnings([]);
        }}
        onClassify={handleClassifyDraft}
        onLearnAlias={handleLearnAlias}
        onResolveClassify={handleResolveClassify}
        onCreateLoan={(name) => {
          setEditingLoanId(null);
          setLoanForm({ ...emptyLoanForm, lender_name: name, counterparty_kind: "officer" });
          setShowLoanForm(true);
        }}
      />

      {/* 一覧 */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-lg">
              相手先一覧
              <span className="ml-2 text-[15px] font-normal text-foreground">
                {visibleLedgers.length === ledgers.length
                  ? `${ledgers.length}件`
                  : `${ledgers.length}件中 ${visibleLedgers.length}件`}
              </span>
            </CardTitle>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-4 text-foreground/60" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="相手先を検索"
                  className={inputCls + " w-56 pl-8"}
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    aria-label="検索をやめる"
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-foreground/60 hover:bg-muted"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>

              {/* よく使う切り口だけをボタンにする。細かい条件は検索欄で足りる */}
              <div className="flex rounded-lg border border-border overflow-hidden">
                {(
                  [
                    ["all", "すべて"],
                    ["borrow", "借入金"],
                    ["lend", "貸付金"],
                    ["officer", "役員"],
                    ["institution", "金融機関"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setKindFilter(key)}
                    className={
                      "px-3 py-2 text-[15px] transition-colors " +
                      (kindFilter === key
                        ? "bg-primary text-primary-foreground font-medium"
                        : "text-foreground hover:bg-muted")
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-10 text-[17px] text-foreground">
              <Loader2 className="size-5 animate-spin mr-2" />
              読み込み中...
            </div>
          ) : ledgers.length === 0 ? (
            <div className="py-10 text-center text-[17px] text-foreground">
              まだ登録がありません。「相手先を追加」から、借入先や役員を登録してください。
            </div>
          ) : (
            <div className="space-y-3">
              {ledgers.map((l) => (
                <LedgerRow
                  key={l.loan.id}
                  ledger={l}
                  expanded={expanded === l.loan.id}
                  busy={busy}
                  entryForm={entryForm}
                  setEntryForm={setEntryForm}
                  editingEntryId={editingEntryId}
                  cancelEdit={() => {
                    setEditingEntryId(null);
                    setEntryForm(emptyEntryForm());
                  }}
                  expenseAccounts={expenseAccounts}
                  receiptLinks={receiptLinks[l.loan.id] ?? []}
                  onToggle={() => toggleExpand(l.loan.id)}
                  onEditLoan={() => openEditLoan(l)}
                  onDeleteLoan={() => handleDeleteLoan(l)}
                  onSaveEntry={() => handleSaveEntry(l)}
                  onEditEntry={openEditEntry}
                  onDeleteEntry={handleDeleteEntry}
                  onJournalize={handleJournalize}
                  onUnjournalize={handleUnjournalize}
                  onAttach={setAttachTarget}
                  onDetach={async (linkId) => {
                    await detachReceiptFromEntry(linkId);
                    await loadReceiptLinks(l.loan.id);
                  }}
                  onRefresh={fetchAll}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {showLoanForm && (
        <LoanFormModal
          form={loanForm}
          setForm={setLoanForm}
          isEditing={Boolean(editingLoanId)}
          showInterestRate={showInterestRate}
          busy={busy === "save-loan"}
          error={error}
          onClose={() => setShowLoanForm(false)}
          onSave={handleSaveLoan}
        />
      )}

      {attachTarget && (
        <AttachReceiptModal
          clientId={id}
          entry={attachTarget}
          onClose={() => setAttachTarget(null)}
          onAttached={async () => {
            const loanId = attachTarget.loan_id;
            setAttachTarget(null);
            await loadReceiptLinks(loanId);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 認定利息アラート
// ---------------------------------------------------------------------------

function ImputedInterestBanner({ alert }: { alert: ImputedInterestAlert }) {
  const required = alert.level === "required";
  // 決算日が近づいたら警告を強める
  const soon = alert.daysUntilFiscalYearEnd <= 60;

  return (
    <div
      className={`rounded-lg border p-4 ${
        required
          ? "border-destructive/40 bg-destructive/10"
          : soon
            ? "border-warning/40 bg-warning/10"
            : "border-border bg-muted/20"
      }`}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle
          className={`size-5 shrink-0 mt-0.5 ${required ? "text-destructive" : "text-warning"}`}
        />
        <div className="space-y-1">
          <p
            className={`text-[17px] font-bold ${required ? "text-destructive" : "text-foreground"}`}
          >
            {required
              ? "認定利息の計上が必要です"
              : `役員貸付金の残高があります（決算日まで${alert.daysUntilFiscalYearEnd}日）`}
          </p>
          <p className={bodyCls}>
            {required ? (
              <>
                前期末（{alert.priorFiscalYearEnd}）時点で{" "}
                {formatCurrency(alert.balanceAtPriorYearEnd)} の役員貸付金が残っています。
                期末をまたいだ役員貸付金には認定利息の計上義務があり、常態化すると
                役員賞与と認定され、法人は損金不算入・個人は源泉徴収漏れとなります。
              </>
            ) : (
              <>
                決算日（{alert.fiscalYearEnd}）をまたいで残高が残ると、認定利息の計上義務が
                発生します。期末までに精算するか、貸付の条件を整えてください。
              </>
            )}
          </p>
          <div className={bodyCls}>
            {alert.estimatedInterest == null ? (
              <span className="font-medium text-destructive">
                {alert.missingRateYears.join("・")}年に行った貸付の利率が未登録のため、
                認定利息を試算できません。利率マスタを設定してください。
              </span>
            ) : (
              <>
                <p>
                  認定利息の試算額:{" "}
                  <span className="font-bold">{formatCurrency(alert.estimatedInterest)}</span>
                </p>
                {/* 利率は貸付を行った年で固定されるため、貸付年ごとに内訳を出す */}
                {alert.breakdown.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {alert.breakdown.map((b, i) => (
                      <li key={i}>
                        {b.loanYear}年の貸付 {formatCurrency(b.outstanding)} × 年利 {b.rate}% ×{" "}
                        {b.days}日 = {formatCurrency(b.interest ?? 0)}
                      </li>
                    ))}
                  </ul>
                )}
                {alert.withinTaxExemptThreshold && (
                  <p className="mt-1">
                    試算額が年5,000円以下です。実際に支払われた利息との差額が年5,000円以下であれば、
                    給与課税の対象外となる例外に該当する可能性があります（要確認）。
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 台帳1件（ヘッダ＋展開時の明細）
// ---------------------------------------------------------------------------

function LedgerRow(props: {
  ledger: LoanLedger;
  expanded: boolean;
  busy: string | null;
  entryForm: EntryFormState;
  setEntryForm: (f: EntryFormState) => void;
  editingEntryId: string | null;
  cancelEdit: () => void;
  expenseAccounts: AccountOption[];
  receiptLinks: LoanEntryReceipt[];
  onToggle: () => void;
  onEditLoan: () => void;
  onDeleteLoan: () => void;
  onSaveEntry: () => void;
  onEditEntry: (e: LoanEntry) => void;
  onDeleteEntry: (e: LoanEntry) => void;
  onJournalize: (e: LoanEntry) => void;
  onUnjournalize: (e: LoanEntry) => void;
  onAttach: (e: LoanEntry) => void;
  onDetach: (linkId: string) => void;
  onRefresh: () => Promise<void> | void;
}) {
  const { ledger, expanded, busy, entryForm, setEntryForm, expenseAccounts } = props;
  const { loan } = ledger;
  const isLend = loan.direction === "lend";
  const rows = runningBalances(ledger.entries);
  const interests = interestTotals(ledger.entries);

  // キーボードでの入力移動（仕訳入力と同じ流儀）。
  // 欄の並び: 0=日付 1=区分 2=金額 3=利息/費用科目 4=摘要
  // 金額と利息は ←→ を文字カーソルの移動に使う
  const { setCellRef, handleKeyDown: handleCellKeyDown, submitRef, handleSubmitKeyDown } =
    useFieldNav(4, [2, 3]);

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      {/* 左端の色帯で、貸付金（要注意）と借入金を一目で分ける */}
      <div
        className={
          "flex items-center gap-2 px-4 py-3 bg-muted/20 border-l-4 " +
          (isLend
            ? "border-l-destructive"
            : loan.counterparty_kind === "officer"
              ? "border-l-primary"
              : "border-l-border")
        }
      >
        <IconButton
          label={expanded ? "明細を閉じる" : "明細を開く"}
          className="p-1"
          onClick={props.onToggle}
        >
          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </IconButton>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xl font-bold">{loan.lender_name}</span>
            <Badge variant={isLend ? "destructive" : loan.counterparty_kind === "officer" ? "default" : "muted"}>
              {isLend
                ? "役員貸付金"
                : loan.counterparty_kind === "officer"
                  ? "役員借入金"
                  : "借入金"}
            </Badge>
            {ledger.needsAttention && (
              <Badge variant="warning">要確認（移行時の差額あり）</Badge>
            )}
          </div>
          <p className="text-[15px] text-foreground/80 mt-0.5">
            明細 {ledger.entries.length}件
            {loan.interest_rate != null && ` ／ 年利 ${loan.interest_rate}%`}
            {loan.repayment_terms && ` ／ 返済条件 ${loan.repayment_terms}`}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[13px] font-medium text-foreground/70">現在残高</p>
          <p
            className={`text-2xl font-bold tabular-nums ${isLend && ledger.balance > 0 ? "text-destructive" : "text-foreground"}`}
          >
            {formatCurrency(ledger.balance)}
          </p>
        </div>
        <div className="flex items-center gap-1 ml-2">
          <IconButton label="相手先を編集" onClick={props.onEditLoan}>
            <Pencil className="size-4" />
          </IconButton>
          <IconButton
            label="相手先を削除"
            tone="destructive"
            busy={busy === loan.id}
            onClick={props.onDeleteLoan}
          >
            <Trash2 className="size-4" />
          </IconButton>
        </div>
      </div>

      {expanded && (
        <div className="px-4 py-3 border-t border-border space-y-4">
          {/* 区分別の内訳 */}
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[15px] text-foreground/80">
            <span>
              {isLend ? "貸付" : "借入"}計 {formatCurrency(ledger.byType.borrow)}
            </span>
            {!isLend && <span>立替計 {formatCurrency(ledger.byType.advance)}</span>}
            <span>
              {isLend ? "回収" : "返済"}計 {formatCurrency(ledger.byType.repay)}
            </span>
            {/* 支払った利息と、元本に積んだ利息は性質が違うので分けて出す */}
            <span>支払利息計 {formatCurrency(interests.paid)}</span>
            {interests.accrued > 0 && (
              <span>元本に加算した利息 {formatCurrency(interests.accrued)}</span>
            )}
          </div>

          <p className="text-[17px] font-bold border-l-4 border-primary pl-2">明細を追加する</p>

          {/* 明細の入力
              仕訳入力と同じキー操作にそろえている:
                Enter / → で次の欄へ、← で前の欄へ、最後の欄からは「追加」ボタンへ
                日付欄の ↑↓ は年月日の増減（DateInput 側で処理）
                IME変換中の Enter では移動しない */}
          <div className="flex flex-wrap items-end gap-2">
            <div className="w-44">
              <label className={labelCls}>日付</label>
              <DateInput
                value={entryForm.entry_date}
                onChange={(v) => setEntryForm({ ...entryForm, entry_date: v })}
                inputRef={(el) => setCellRef(0, el)}
                onKeyDown={(e) => handleCellKeyDown(0, e)}
                className={inputCls}
              />
            </div>
            <div className="w-32">
              <label className={labelCls}>区分</label>
              <select
                ref={(el) => setCellRef(1, el)}
                value={entryForm.entry_type}
                onChange={(e) =>
                  setEntryForm({ ...entryForm, entry_type: e.target.value as LoanEntryType })
                }
                onKeyDown={(e) => handleCellKeyDown(1, e)}
                className={inputCls}
              >
                {ENTRY_TYPES.filter((t) => !(isLend && t === "advance")).map((t) => (
                  <option key={t} value={t}>
                    {entryTypeLabel(t, loan.direction)}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-40">
              <label className={labelCls}>金額</label>
              <AmountInput
                inputRef={(el) => setCellRef(2, el)}
                value={entryForm.amount}
                onChange={(v) => setEntryForm({ ...entryForm, amount: v })}
                onKeyDown={(e) => handleCellKeyDown(2, e)}
                className={inputCls + " text-right"}
              />
            </div>
            {entryForm.entry_type === "repay" && (
              <div className="w-36">
                <label className={labelCls}>同時に払う利息</label>
                <AmountInput
                  value={entryForm.interest_amount}
                  onChange={(v) => setEntryForm({ ...entryForm, interest_amount: v })}
                  onKeyDown={(e) => handleCellKeyDown(3, e)}
                  className={inputCls + " text-right"}
                />
              </div>
            )}
            <div className="min-w-[16rem] flex-1">
              <label className={labelCls}>摘要</label>
              <input
                ref={(el) => setCellRef(4, el)}
                value={entryForm.memo}
                onChange={(e) => setEntryForm({ ...entryForm, memo: e.target.value })}
                onKeyDown={(e) => handleCellKeyDown(4, e)}
                className={inputCls}
                placeholder="（任意）"
              />
            </div>
            <div className="flex gap-2">
              <Button
                ref={submitRef}
                onClick={props.onSaveEntry}
                onKeyDown={handleSubmitKeyDown}
                disabled={busy === "entry-" + loan.id}
              >
                {busy === "entry-" + loan.id && <Loader2 className="size-4 animate-spin" />}
                {props.editingEntryId ? "更新" : "追加"}
              </Button>
              {props.editingEntryId && (
                <Button variant="outline" onClick={props.cancelEdit}>
                  取消
                </Button>
              )}
            </div>
          </div>

          {/* 立替のときだけ費用科目を出す（現金は動かないが債務が増える取引）。
              科目の選び方は仕訳入力と同じ AccountLookup にそろえている（コード・読みで検索できる） */}
          {entryForm.entry_type === "advance" && (
            <div className="max-w-sm">
              <label className={labelCls}>
                費用科目<span className="text-destructive">（必須）</span>
              </label>
              <AccountLookup
                accounts={expenseAccounts}
                value={entryForm.expense_account_id}
                onChange={(v) => setEntryForm({ ...entryForm, expense_account_id: v })}
                inputRef={(el) => setCellRef(3, el)}
                onKeyDown={(e) => handleCellKeyDown(3, e)}
              />
              <p className="mt-1 text-[15px] text-foreground">
                役員が会社の経費を個人資金で負担した取引です。現金は動かず、
                費用の計上と{isLend ? "債権" : "債務"}の計上が同時に行われます。
              </p>
            </div>
          )}

          {/* 返済予定表。金融機関等からの借入のときだけ出す（要件3-7） */}
          {!isLend && loan.counterparty_kind === "institution" && (
            <RepaymentScheduleSection ledger={ledger} onChanged={props.onRefresh} />
          )}

          {/* 台帳と仕訳の照合（要件3-5 / 4-6） */}
          <ReconcileSection ledger={ledger} />

          {/* 増減明細と残高推移 */}
          {/* 見出しが無いと、どの表を指しているのか会話で伝わらない */}
          <p className="text-[17px] font-bold border-l-4 border-primary pl-2">増減明細（{rows.length}件）</p>

          {/* 吹き出しは気づかれないので、逆転がある間は表の上に理由を出す */}
          {rows.some((r) => r.balanceAfter < 0) && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3">
              <AlertTriangle className="size-5 shrink-0 text-destructive mt-0.5" />
              <p className="text-[15px] text-foreground">
                <span className="font-bold text-destructive">残高が逆転している行があります。</span>{" "}
                返した額が借りた額を超えている状態です。多くは
                <span className="font-bold">借入の記録が抜けている</span>か、
                <span className="font-bold">借入の日付が返済より後になっている</span>のが原因です。
                日付を直すか、抜けている借入を登録してください。
              </p>
            </div>
          )}

          {rows.length === 0 ? (
            <p className={bodyCls}>まだ明細がありません。上のフォームから追加してください。</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[17px]">
                <thead>
                  <tr className="border-b-2 border-border text-left bg-muted/30">
                    <th className="py-2 pl-2 pr-3 font-medium">日付</th>
                    <th className="py-2 pr-3 font-medium">区分</th>
                    <th className="py-2 pr-3 font-medium text-right">増減</th>
                    <th className="py-2 pr-3 font-medium text-right">利息</th>
                    <th className="py-2 pr-3 font-medium text-right">残高</th>
                    <th className="py-2 pr-3 font-medium">摘要</th>
                    <th className="py-2 pr-3 font-medium">証憑</th>
                    <th className="py-2 font-medium text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ entry, delta, balanceAfter }) => {
                    const links = props.receiptLinks.filter((r) => r.loan_entry_id === entry.id);
                    const journalized = Boolean(entry.journal_entry_id);
                    return (
                      <tr
                        key={entry.id}
                        className="border-b border-border/60 odd:bg-muted/10 hover:bg-muted/25 transition-colors"
                      >
                        <td className="py-2 pl-2 pr-3 tabular-nums">{entry.entry_date}</td>
                        <td className="py-2 pr-3">
                          <Badge variant={ENTRY_TYPE_TONE[entry.entry_type]}>
                            {entryTypeLabel(entry.entry_type, loan.direction)}
                          </Badge>
                          {entry.source === "ai_draft" && (
                            <Badge variant="info" className="ml-1">
                              AI
                            </Badge>
                          )}
                        </td>
                        {/* 増えたか減ったかを色でも示す。金額だけだと符号を見落とす */}
                        <td
                          className={
                            "py-2 pr-3 text-right tabular-nums font-medium " +
                            (delta >= 0 ? "text-foreground" : "text-destructive")
                          }
                        >
                          {delta >= 0 ? "+" : "−"}
                          {formatCurrency(Math.abs(delta))}
                        </td>
                        {/* 支払済みの利息。費用として仕訳に載るが残高は動かさない */}
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {entry.interest_amount > 0
                            ? formatCurrency(entry.interest_amount)
                            : ""}
                        </td>
                        {/* 帳簿にマイナスは出さない。残高が逆転するのは
                            「返済より前の借入が記録されていない」という誤りなので、
                            数字ではなく警告として見せる */}
                        <td className="py-2 pr-3 text-right tabular-nums font-bold">
                          {balanceAfter < 0 ? (
                            <span
                              className="inline-flex items-center gap-1 text-destructive"
                              title="この時点で残高が逆転しています。返した額が借りた額を超えているため、これより前の借入の記録が抜けている可能性があります。"
                            >
                              <AlertTriangle className="size-4 shrink-0" />
                              {formatCurrency(-balanceAfter)} 超過
                            </span>
                          ) : (
                            formatCurrency(balanceAfter)
                          )}
                        </td>
                        <td className="py-2 pr-3 max-w-[20rem] truncate" title={entry.memo ?? ""}>
                          {entry.memo}
                        </td>
                        <td className="py-2 pr-3">
                          <div className="flex items-center gap-1 flex-wrap">
                            {links.map((link) => (
                              <IconButton
                                key={link.id}
                                label="証憑の紐付けを解除"
                                tone="destructive"
                                className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[15px] text-foreground hover:bg-destructive/10"
                                onClick={() => props.onDetach(link.id)}
                              >
                                <FileText className="size-3" />
                                {link.source_line_no != null ? `${link.source_line_no}行目` : "証憑"}
                              </IconButton>
                            ))}
                            <IconButton
                              label="証憑を添付"
                              className="p-1"
                              onClick={() => props.onAttach(entry)}
                            >
                              <Paperclip className="size-4" />
                            </IconButton>
                          </div>
                        </td>
                        <td className="py-2 text-right whitespace-nowrap">
                          {busy === entry.id ? (
                            <Loader2 className="size-4 animate-spin inline" />
                          ) : (
                            <>
                              {journalized ? (
                                <IconButton
                                  label="仕訳化を取り消す"
                                  onClick={() => props.onUnjournalize(entry)}
                                >
                                  <RotateCcw className="size-4" />
                                </IconButton>
                              ) : (
                                <IconButton
                                  label="仕訳にする"
                                  tone="primary"
                                  onClick={() => props.onJournalize(entry)}
                                >
                                  <CheckCircle className="size-4" />
                                </IconButton>
                              )}
                              <IconButton
                                label="この明細を編集"
                                onClick={() => props.onEditEntry(entry)}
                              >
                                <Pencil className="size-4" />
                              </IconButton>
                              <IconButton
                                label="この明細を削除"
                                tone="destructive"
                                onClick={() => props.onDeleteEntry(entry)}
                              >
                                <Trash2 className="size-4" />
                              </IconButton>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AIパネル（要件4章）
// ---------------------------------------------------------------------------

function AiPanel(props: {
  clientId: string;
  ledgers: LoanLedger[];
  text: string;
  setText: (s: string) => void;
  /** どの操作が処理中か。null なら待機中 */
  busy: null | "text" | "document" | "commit";
  drafts: EditableDraft[];
  setDrafts: React.Dispatch<React.SetStateAction<EditableDraft[]>>;
  excluded: { line: string; reason: string }[];
  warnings: string[];
  expenseAccounts: AccountOption[];
  onRunText: () => void;
  onRunDocument: (receiptId: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  /** 台帳が無い相手先を、その場で登録できるようにする */
  onCreateLoan: (name: string) => void;
  /** 役員個人への送金を判別する */
  onClassify: (index: number) => void;
  /** 判別の結果を受けて、その行を残すか外すか決める */
  onResolveClassify: (index: number, action: "keep" | "drop") => void;
  /** 読み取った名前を、選んだ台帳の別名として覚える */
  onLearnAlias: (index: number) => void;
}) {
  const [receipts, setReceipts] = useState<{ id: string; label: string }[]>([]);
  const [receiptId, setReceiptId] = useState("");
  const [receiptsLoading, setReceiptsLoading] = useState(false);
  const receiptsLoaded = useRef(false);

  // 証憑の一覧は件数が多く結合もあるため、プルダウンを触るまで読まない。
  // AIを使わずに台帳だけ見る場合の読み込みを軽くする
  const loadReceipts = useCallback(() => {
    if (receiptsLoaded.current) return;
    receiptsLoaded.current = true;
    setReceiptsLoading(true);
    getReceipts(props.clientId)
      .then((rs) =>
        setReceipts(
          rs
            .filter((r) => !String(r.image_path).startsWith("raqto://"))
            .slice(0, 100)
            .map((r) => ({
              id: r.id,
              label: `${String(r.uploaded_at).slice(0, 10)} ${r.original_filename ?? r.id.slice(0, 8)}`,
            }))
        )
      )
      .catch(() => setReceipts([]))
      .finally(() => setReceiptsLoading(false));
  }, [props.clientId]);

  const chosen = props.drafts.filter((d) => d.selected).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          AIで起票する
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className={bodyCls}>
          AIは下書きを作るだけです。内容を確認して「登録」を押すまで台帳には反映されません。
        </p>

        <div className="grid gap-3 lg:grid-cols-2">
          <div>
            <label className={labelCls}>文章から起票</label>
            <textarea
              value={props.text}
              onChange={(e) => props.setText(e.target.value)}
              rows={2}
              className={inputCls}
              placeholder="例: 8月24日に社長から6万5千円借りた"
            />
            <Button
              className="mt-2"
              onClick={props.onRunText}
              disabled={props.busy !== null || !props.text.trim()}
            >
              {props.busy === "text" && <Loader2 className="size-4 animate-spin" />}
              下書きを作る
            </Button>
          </div>

          <div>
            <label className={labelCls}>証憑から一括起票（通帳・振込明細）</label>
            <select
              value={receiptId}
              onFocus={loadReceipts}
              onMouseDown={loadReceipts}
              onChange={(e) => setReceiptId(e.target.value)}
              className={inputCls}
            >
              <option value="">
                {receiptsLoading ? "読み込み中..." : "証憑を選択してください"}
              </option>
              {receipts.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
            <Button
              className="mt-2"
              onClick={() => receiptId && props.onRunDocument(receiptId)}
              disabled={props.busy !== null || !receiptId}
            >
              {props.busy === "document" && <Loader2 className="size-4 animate-spin" />}
              {props.busy === "document" ? "読み取り中…" : "読み取る"}
            </Button>
          </div>
        </div>


        {props.warnings.map((w, i) => (
          <p key={i} className="text-[17px] font-medium text-warning">
            {w}
          </p>
        ))}

        {/* 確認パネル */}
        {props.drafts.length > 0 && (
          <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
            <p className="text-[17px] font-bold">
              AIの下書き（{props.drafts.length}件）— 内容を確認して登録してください
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-[17px]">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="py-2 pr-2 whitespace-nowrap">採用</th>
                    <th className="py-2 pr-2 whitespace-nowrap">日付</th>
                    <th className="py-2 pr-2 whitespace-nowrap">相手先</th>
                    <th className="py-2 pr-2 whitespace-nowrap">区分</th>
                    <th className="py-2 pr-2 text-right whitespace-nowrap">金額</th>
                    <th className="py-2 pr-2 text-right whitespace-nowrap">利息</th>
                  </tr>
                </thead>
                <tbody>
                  {props.drafts.map((d, i) => (
                    <React.Fragment key={i}>
                    <tr className="align-top">
                      <td className="py-2 pr-2">
                        <input
                          type="checkbox"
                          checked={d.selected}
                          onChange={(e) => {
                            const next = [...props.drafts];
                            next[i] = { ...d, selected: e.target.checked };
                            props.setDrafts(next);
                          }}
                        />
                      </td>
                      <td className="py-2 pr-2">
                        <DateInput
                          value={d.entry_date}
                          onChange={(v) => {
                            const next = [...props.drafts];
                            next[i] = { ...d, entry_date: v };
                            props.setDrafts(next);
                          }}
                          className="w-36 px-2 py-1 pr-7 rounded border border-border bg-background text-[17px]"
                        />
                      </td>
                      {/* 通帳に載る名前と台帳の名前は普通ちがう（「アンドウ レン」と「代表取締役 ○○」など）。
                          突き合わせに失敗したら、その場で台帳を選べるようにする */}
                      <td className="py-2 pr-2">
                        <div className="flex items-center gap-1">
                          <select
                            value={d.loan_id ?? ""}
                            onChange={(e) => {
                              const next = [...props.drafts];
                              const picked = props.ledgers.find(
                                (l) => l.loan.id === e.target.value
                              );
                              const read = d.counterparty_name;
                              next[i] = picked
                                ? {
                                    ...d,
                                    loan_id: picked.loan.id,
                                    counterparty_name: picked.loan.lender_name,
                                    direction: picked.loan.direction,
                                    balance_after:
                                      picked.balance +
                                      (d.entry_type === "repay" ? -d.amount : d.amount),
                                    // 読み取った名前が台帳に無ければ、覚えるか尋ねる。
                                    // 登録しておけば次回から自動で結び付く
                                    aliasSuggestion:
                                      read &&
                                      read !== picked.loan.lender_name &&
                                      !(picked.loan.aliases ?? []).includes(read)
                                        ? read
                                        : null,
                                  }
                                : { ...d, loan_id: null, balance_after: null, aliasSuggestion: null };
                              props.setDrafts(next);
                            }}
                            className={
                              "max-w-[11rem] px-2 py-1 rounded border bg-background text-[17px] " +
                              (d.loan_id ? "border-border" : "border-destructive")
                            }
                          >
                            <option value="">
                              {/* 読み取った名前だけを出すと選択済みに見える。
                                  未選択であることを言葉で示す */}
                              {d.counterparty_name
                                ? `▼ 台帳を選ぶ（${d.counterparty_name}）`
                                : "▼ 台帳を選ぶ"}
                            </option>
                            {props.ledgers.map((l) => (
                              <option key={l.loan.id} value={l.loan.id}>
                                {l.loan.lender_name}
                                {l.loan.direction === "lend" ? "（貸付）" : "（借入）"}
                              </option>
                            ))}
                          </select>
                          {!d.loan_id && (
                            <Button
                              variant="outline"
                              className="px-2 py-1 text-[15px] whitespace-nowrap"
                              onClick={() => props.onCreateLoan(d.counterparty_name)}
                            >
                              新規
                            </Button>
                          )}
                        </div>
                      </td>
                      <td className="py-2 pr-2">
                        <select
                          value={d.entry_type}
                          onChange={(e) => {
                            const next = [...props.drafts];
                            next[i] = { ...d, entry_type: e.target.value as LoanEntryType };
                            props.setDrafts(next);
                          }}
                          className="px-2 py-1 rounded border border-border bg-background text-[17px]"
                        >
                          {ENTRY_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {entryTypeLabel(t, d.direction)}
                            </option>
                          ))}
                        </select>
                        {d.entry_type === "advance" && (
                          <select
                            value={d.expense_account_id ?? ""}
                            onChange={(e) => {
                              const next = [...props.drafts];
                              const acc = props.expenseAccounts.find(
                                (a) => a.id === e.target.value
                              );
                              next[i] = {
                                ...d,
                                expense_account_id: e.target.value || null,
                                expense_account_name: acc?.name ?? null,
                              };
                              props.setDrafts(next);
                            }}
                            className="mt-1 block px-2 py-1 rounded border border-border bg-background text-[17px]"
                          >
                            <option value="">費用科目を選択</option>
                            {props.expenseAccounts.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="py-2 pr-2 text-right">
                        <AmountInput
                          value={String(d.amount || "")}
                          onChange={(v) => {
                            const next = [...props.drafts];
                            next[i] = { ...d, amount: num(v) };
                            props.setDrafts(next);
                          }}
                          className="w-32 px-2 py-1 rounded border border-border bg-background text-[17px] text-right"
                        />
                      </td>
                      {/* 返済のときだけ利息を出す。元金と利息を同時に払う銀行返済で使う */}
                      <td className="py-2 pr-2 text-right">
                        {d.entry_type === "repay" ? (
                          <AmountInput
                            value={String(d.interest_amount || "")}
                            onChange={(v) => {
                              const next = [...props.drafts];
                              next[i] = { ...d, interest_amount: num(v) };
                              props.setDrafts(next);
                            }}
                            className="w-28 px-2 py-1 rounded border border-border bg-background text-[17px] text-right"
                          />
                        ) : (
                          <span className="text-foreground/50">—</span>
                        )}
                      </td>
                    </tr>
                      {/* 根拠は長文になるため、列にせず行の下に回す。
                          列に入れると表が横に伸び、金額や仕訳が読めなくなる */}
                      <tr className="border-b border-border/60">
                        <td />
                        <td colSpan={5} className="pb-2 pr-2 align-top">
                          {/* 情報を一続きに並べると読めないので、項目ごとに行を分けて
                              見出しを付ける。金額と文章が混ざるとどこを見ればよいか分からない */}
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                              <Badge
                                variant={
                                  d.evidence.confidence >= 0.8
                                    ? "success"
                                    : d.evidence.confidence >= 0.5
                                      ? "warning"
                                      : "destructive"
                                }
                              >
                                確信度 {Math.round(d.evidence.confidence * 100)}%
                              </Badge>

                              {d.balance_after != null && d.balance_after < 0 ? (
                                <span className="text-[15px] font-bold text-destructive">
                                  残高が {formatCurrency(Math.abs(d.balance_after))} 足りません
                                  （借入の記録が抜けている可能性）
                                </span>
                              ) : (
                                <span className="text-[15px] text-foreground whitespace-nowrap">
                                  <span className="text-foreground/70">起票後残高</span>{" "}
                                  <span className="font-bold tabular-nums">
                                    {d.balance_after != null
                                      ? formatCurrency(d.balance_after)
                                      : "—"}
                                  </span>
                                </span>
                              )}
                            </div>

                            <p className="text-[15px] text-foreground">
                              <span className="text-foreground/70">仕訳</span>{" "}
                              {d.journal_preview
                                ? `借 ${d.journal_preview.debit} / 貸 ${d.journal_preview.credit}　${formatCurrency(d.journal_preview.amount)}`
                                : "台帳を選ぶと決まります"}
                            </p>

                            <p className="text-[15px] text-foreground">
                              <span className="text-foreground/70">根拠</span>{" "}
                              {d.evidence.reasoning}
                            </p>

                            {d.evidence.sourceText && (
                              <p className="text-[15px] text-foreground/80">
                                <span className="text-foreground/70">読取元</span>{" "}
                                {d.evidence.sourceText}
                              </p>
                            )}

                            {/* 迷いのある行だけに出す。確信度が高く残高も足りる行に
                                押させても、AIを呼ぶ費用がかかるだけで得るものがない */}
                            {d.entry_type === "repay" &&
                              !d.classification &&
                              (d.evidence.confidence < 0.9 ||
                                (d.balance_after != null && d.balance_after < 0)) && (
                                <Button
                                  variant="outline"
                                  className="mt-1 px-2 py-1 text-[15px]"
                                  disabled={d.classifying}
                                  onClick={() => props.onClassify(i)}
                                >
                                  {d.classifying && <Loader2 className="size-4 animate-spin" />}
                                  {d.classifying ? "判別中…" : "この送金を判別"}
                                </Button>
                              )}
                          </div>

                          {d.aliasSuggestion && d.loan_id && (
                            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 p-2">
                              <span className="text-[15px]">
                                「{d.aliasSuggestion}」を{" "}
                                <span className="font-bold">{d.counterparty_name}</span> の
                                通帳での表記として登録しますか？ 次回から自動で結び付きます。
                              </span>
                              <Button
                                className="px-2 py-1 text-[15px]"
                                onClick={() => props.onLearnAlias(i)}
                              >
                                登録する
                              </Button>
                              <Button
                                variant="outline"
                                className="px-2 py-1 text-[15px]"
                                onClick={() => {
                                  const next = [...props.drafts];
                                  next[i] = { ...d, aliasSuggestion: null };
                                  props.setDrafts(next);
                                }}
                              >
                                今回だけ
                              </Button>
                            </div>
                          )}

                          {d.classification && (
                            <div className="mt-2 rounded-lg border border-warning/40 bg-warning/10 p-2 space-y-1">
                              <p className="text-[15px] font-bold">
                                {d.classification.question}
                              </p>
                              {d.classification.options.map((o) => (
                                <div key={o.key} className="text-[15px]">
                                  <span className="font-medium">
                                    {OPTION_LABELS[o.key] ?? o.label}
                                  </span>
                                  {o.recommended && (
                                    <Badge variant="success" className="ml-1">
                                      推定
                                    </Badge>
                                  )}
                                  <span> — {o.reason}</span>
                                </div>
                              ))}
                              {d.classification.conclusion === null && (
                                <p className="text-[15px] font-medium text-warning">
                                  確信が持てないため確定していません。内容を確認して選んでください。
                                </p>
                              )}
                              <div className="flex flex-wrap gap-2 pt-1">
                                <Button
                                  className="px-2 py-1 text-[15px]"
                                  onClick={() => props.onResolveClassify(i, "keep")}
                                >
                                  返済として登録する
                                </Button>
                                <Button
                                  variant="outline"
                                  className="px-2 py-1 text-[15px]"
                                  onClick={() => props.onResolveClassify(i, "drop")}
                                >
                                  台帳の対象外にする
                                </Button>
                              </div>
                              <p className="text-[15px]">
                                役員報酬・立替経費の精算にあたる場合は、この台帳ではなく
                                給与または経費の機能で処理してください。
                              </p>
                            </div>
                          )}
                        </td>
                      </tr>
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center gap-2">
              <Button onClick={props.onCommit} disabled={props.busy !== null || chosen === 0}>
                {props.busy === "commit" && <Loader2 className="size-4 animate-spin" />}
                選択した{chosen}件を登録
              </Button>
              <Button variant="outline" onClick={props.onCancel}>
                破棄
              </Button>
            </div>
          </div>
        )}

        {/* 対象外と判断した行（拾い漏れの確認用） */}
        {props.excluded.length > 0 && (
          <details className="rounded-lg border border-border p-3">
            <summary className="text-[17px] font-medium cursor-pointer">
              台帳の対象外と判断した行（{props.excluded.length}件）— 拾い漏れがないか確認できます
            </summary>
            <ul className="mt-2 space-y-1">
              {props.excluded.map((x, i) => (
                <li key={i} className={bodyCls}>
                  <span className="font-medium">{x.line}</span> — {x.reason}
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 相手先フォーム
// ---------------------------------------------------------------------------

function LoanFormModal(props: {
  form: LoanFormState;
  setForm: (f: LoanFormState) => void;
  isEditing: boolean;
  showInterestRate: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const { form, setForm } = props;
  const isOfficer = form.counterparty_kind === "officer";
  // 欄の並び: 0=区分 1=方向 2=年利(条件付き) 3=相手先 4=開始日 5=返済条件 6=借入理由 7=メモ
  const { setCellRef, handleKeyDown, submitRef, handleSubmitKeyDown } = useFieldNav(7, [2]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={props.onClose}
    >
      <div
        className="bg-card border border-border rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-bold text-[17px]">
            {props.isEditing ? "相手先を編集" : "相手先を追加"}
          </h2>
          <button onClick={props.onClose} className="p-1 rounded hover:bg-muted">
            <X className="size-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>区分</label>
              <select
                ref={(el) => setCellRef(0, el)}
                value={form.counterparty_kind}
                onChange={(e) =>
                  setForm({
                    ...form,
                    counterparty_kind: e.target.value as CounterpartyKind,
                    // 役員は返済条件「定めなし」を既定にする
                    repayment_terms:
                      e.target.value === "officer" && !form.repayment_terms
                        ? "定めなし"
                        : form.repayment_terms,
                  })
                }
                onKeyDown={(e) => handleKeyDown(0, e)}
                className={inputCls}
              >
                <option value="institution">金融機関等</option>
                <option value="officer">役員</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>方向</label>
              <select
                ref={(el) => setCellRef(1, el)}
                value={form.direction}
                onChange={(e) =>
                  setForm({ ...form, direction: e.target.value as LoanDirection })
                }
                onKeyDown={(e) => handleKeyDown(1, e)}
                className={inputCls}
              >
                <option value="borrow">借入金（会社が借りる）</option>
                <option value="lend">貸付金（会社が貸す）</option>
              </select>
            </div>
          </div>

          {form.direction === "lend" && (
            <p className="rounded-lg bg-destructive/10 p-3 text-[17px] text-destructive">
              役員貸付金は、期末をまたいで残高があると認定利息の計上義務が生じます。
              常態化すると役員賞与と認定されるため、決算日までの精算をおすすめします。
            </p>
          )}

          <div>
            <label className={labelCls}>相手先</label>
            <input
              ref={(el) => setCellRef(3, el)}
              value={form.lender_name}
              onChange={(e) => setForm({ ...form, lender_name: e.target.value })}
              onKeyDown={(e) => handleKeyDown(3, e)}
              className={inputCls}
              // 区分に応じてプレースホルダを切り替える（要件6章）
              placeholder={isOfficer ? "代表取締役 ○○" : "○○銀行"}
            />
          </div>

          <div className="max-w-[12rem]">
            {/* 役員借入金は無利息が原則なので年利欄そのものを出さない。
                金融機関では返済予定表の利息計算と内訳明細書の利率欄に使う */}
            {props.showInterestRate && (
              <div>
                <label className={labelCls}>
                  年利（%）<span className="text-destructive">（必須）</span>
                </label>
                <AmountInput
                  allowDecimal
                  inputRef={(el) => setCellRef(2, el)}
                  value={form.interest_rate}
                  onChange={(v) => setForm({ ...form, interest_rate: v })}
                  onKeyDown={(e) => handleKeyDown(2, e)}
                  className={inputCls + " text-right"}
                  placeholder="%"
                />
              </div>
            )}

          </div>

          <div>
            {/* 通帳に載る名前と台帳の名前は普通ちがう。ここに登録しておくと
                証憑の読み取りで自動的にこの台帳へ結び付く */}
            <label className={labelCls}>通帳での表記</label>
            <input
              ref={(el) => setCellRef(4, el)}
              value={form.aliases}
              onChange={(e) => setForm({ ...form, aliases: e.target.value })}
              onKeyDown={(e) => handleKeyDown(4, e)}
              className={inputCls}
              placeholder="アンドウ レン, ｱﾝﾄﾞｳ ﾚﾝ（カンマ区切り）"
            />
            <p className="mt-1 text-[15px] text-foreground/80">
              通帳や振込明細に出る名前を登録すると、証憑を読み取ったときに
              この相手先だと判断できます。
            </p>
          </div>

          <div>
            <label className={labelCls}>返済条件</label>
            <input
              ref={(el) => setCellRef(5, el)}
              value={form.repayment_terms}
              onChange={(e) => setForm({ ...form, repayment_terms: e.target.value })}
              onKeyDown={(e) => handleKeyDown(5, e)}
              className={inputCls}
              placeholder={isOfficer ? "定めなし" : "毎月末 元金50,000円"}
            />
          </div>

          <div>
            <label className={labelCls}>借入理由</label>
            <input
              ref={(el) => setCellRef(6, el)}
              value={form.purpose}
              onChange={(e) => setForm({ ...form, purpose: e.target.value })}
              onKeyDown={(e) => handleKeyDown(6, e)}
              className={inputCls}
              placeholder="運転資金 など（勘定科目内訳明細書の記載項目）"
            />
          </div>

          <div>
            <label className={labelCls}>メモ</label>
            <input
              ref={(el) => setCellRef(7, el)}
              value={form.memo}
              onChange={(e) => setForm({ ...form, memo: e.target.value })}
              onKeyDown={(e) => handleKeyDown(7, e)}
              className={inputCls}
              placeholder="（任意）"
            />
          </div>

          <p className={bodyCls}>
            残高は増減明細から自動で算出されます。金額の入力欄はありません。
          </p>

          {props.error && <p className="text-[17px] text-destructive">{props.error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
          <Button variant="outline" onClick={props.onClose}>
            キャンセル
          </Button>
          <Button
            ref={submitRef}
            onClick={props.onSave}
            onKeyDown={handleSubmitKeyDown}
            disabled={props.busy}
          >
            {props.busy && <Loader2 className="size-4 animate-spin" />}
            保存
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 証憑の添付
// ---------------------------------------------------------------------------

function AttachReceiptModal(props: {
  clientId: string;
  entry: LoanEntry;
  onClose: () => void;
  onAttached: () => void;
}) {
  const [receipts, setReceipts] = useState<
    { id: string; label: string; date: string; amount: string; vendor: string }[]
  >([]);
  const [query, setQuery] = useState("");
  const [lineNo, setLineNo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getReceipts(props.clientId)
      .then((rs) =>
        setReceipts(
          rs.map((r) => {
            const ocr = (r.ocr_result ?? {}) as Record<string, unknown>;
            return {
              id: r.id,
              label: r.original_filename ?? r.id.slice(0, 8),
              date: String(ocr.date ?? ocr.issued_date ?? String(r.uploaded_at).slice(0, 10)),
              amount: String(ocr.amount_total ?? ocr.total_amount ?? ""),
              vendor: String(ocr.vendor_name ?? ""),
            };
          })
        )
      )
      .catch(() => setReceipts([]));
  }, [props.clientId]);

  // 電子帳簿保存法の検索要件（日付・金額・取引先）で絞り込む
  const filtered = receipts.filter((r) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      r.date.includes(q) ||
      r.amount.includes(q) ||
      r.vendor.toLowerCase().includes(q) ||
      r.label.toLowerCase().includes(q)
    );
  });

  async function attach(receiptId: string) {
    setBusy(true);
    setError(null);
    try {
      await attachReceiptToEntry({
        loanEntryId: props.entry.id,
        receiptId,
        sourceLineNo: lineNo.trim() === "" ? null : num(lineNo),
      });
      props.onAttached();
    } catch (e) {
      setError(e instanceof Error ? e.message : "添付に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={props.onClose}
    >
      <div
        className="bg-card border border-border rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-bold text-[17px]">証憑を添付</h2>
          <button onClick={props.onClose} className="p-1 rounded hover:bg-muted">
            <X className="size-5" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          <p className={bodyCls}>
            {props.entry.entry_date} の明細（{formatCurrency(props.entry.amount)}）に証憑を紐付けます。
          </p>

          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <div>
              <label className={labelCls}>証憑を検索（日付・金額・取引先）</label>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className={inputCls}
                placeholder="2026-08-24 / 65000 / ○○銀行"
              />
            </div>
            <div className="w-32">
              <label className={labelCls}>証憑内の行番号</label>
              <input
                type="number"
                value={lineNo}
                onChange={(e) => setLineNo(e.target.value)}
                className={inputCls + " text-right"}
                placeholder="任意"
              />
            </div>
          </div>
          <p className={bodyCls}>
            1枚の通帳PDFが複数の取引を含む場合、どの行に対応するかを記録できます。
          </p>

          {error && <p className="text-[17px] text-destructive">{error}</p>}

          <div className="max-h-80 overflow-y-auto rounded-lg border border-border">
            {filtered.length === 0 ? (
              <p className="p-4 text-[17px] text-foreground">該当する証憑がありません。</p>
            ) : (
              filtered.slice(0, 100).map((r) => (
                <button
                  key={r.id}
                  onClick={() => attach(r.id)}
                  disabled={busy}
                  className="flex w-full items-center justify-between gap-3 border-b border-border/60 px-4 py-2 text-left hover:bg-muted/40"
                >
                  <span className="text-[17px]">{r.date}</span>
                  <span className="text-[17px] flex-1 truncate">{r.vendor || r.label}</span>
                  <span className="text-[17px] tabular-nums">
                    {r.amount ? formatCurrency(Number(r.amount)) : ""}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 返済予定表（要件3-7）
//
// 金融機関等からの借入は返済日ごとに元金と利息の内訳が決まっている。
// 予定を持っておくと、期日が来たら1クリックで増減明細に落とせる。
// 役員借入金は返済条件を定めないのが通常なので、この節は表示しない。
// ---------------------------------------------------------------------------

function RepaymentScheduleSection({
  ledger,
  onChanged,
}: {
  ledger: LoanLedger;
  /** 明細が増減したときに台帳側も読み直してもらう */
  onChanged: () => Promise<void> | void;
}) {
  const [rows, setRows] = useState<LoanRepaymentSchedule[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 欄の並び: 0=借入額 1=年利 2=回数 3=初回返済日 4=方式 5=返済日
  // 数値欄は ←→ を文字カーソルの移動に使う
  const { setCellRef, handleKeyDown, submitRef, handleSubmitKeyDown } = useFieldNav(5, [0, 1, 2]);

  const [form, setForm] = useState({
    principal: "0",
    rate: ledger.loan.interest_rate != null ? String(ledger.loan.interest_rate) : "",
    months: "12",
    firstDue: today(),
    method: "equal_principal" as "equal_principal" | "equal_payment",
    dueDateMode: "same_day" as "same_day" | "month_end",
  });

  const load = useCallback(async () => {
    try {
      setRows(await getRepaymentSchedules(ledger.loan.id));
    } catch {
      // 予定表が読めなくても台帳表示は妨げない
    }
  }, [ledger.loan.id]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  async function handleGenerate() {
    setBusy("gen");
    setError(null);
    try {
      const n = await generateSchedules({
        loanId: ledger.loan.id,
        principal: num(form.principal),
        annualRatePercent: Number(form.rate) || 0,
        termMonths: num(form.months),
        firstDueDate: form.firstDue,
        method: form.method,
        dueDateMode: form.dueDateMode,
      });
      await load();
      setError(`${n}回分の予定を作成しました。`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "作成に失敗しました");
    } finally {
      setBusy(null);
    }
  }

  const totalPrincipal = rows.reduce((s, r) => s + r.principal_amount, 0);
  const totalInterest = rows.reduce((s, r) => s + r.interest_amount, 0);
  const done = rows.filter((r) => r.principal_entry_id || r.interest_entry_id).length;

  return (
    <details
      className="rounded-lg border border-border p-3"
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="text-[17px] font-medium cursor-pointer flex items-center gap-2">
        <CalendarClock className="size-4" />
        返済予定表{rows.length > 0 && `（${rows.length}回 / 実績 ${done}回）`}
      </summary>

      <div className="mt-3 space-y-3">
        {error && <p className="text-[17px] text-destructive">{error}</p>}

        {/* 欄ごとに必要な幅を与えて折り返す。
            列固定のグリッドだと、欄が増えたときに金額欄が潰れて桁が読めなくなる。 */}
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-44">
            <label className={labelCls}>借入額</label>
            <AmountInput
              inputRef={(el) => setCellRef(0, el)}
              value={form.principal}
              onChange={(v) => setForm({ ...form, principal: v })}
              onKeyDown={(e) => handleKeyDown(0, e)}
              className={inputCls + " text-right"}
            />
          </div>
          <div className="w-24">
            <label className={labelCls}>年利(%)</label>
            <AmountInput
              allowDecimal
              inputRef={(el) => setCellRef(1, el)}
              value={form.rate}
              onChange={(v) => setForm({ ...form, rate: v })}
              onKeyDown={(e) => handleKeyDown(1, e)}
              className={inputCls + " text-right"}
              placeholder="%"
            />
          </div>
          <div className="w-24">
            <label className={labelCls}>回数(月)</label>
            <AmountInput
              inputRef={(el) => setCellRef(2, el)}
              value={form.months}
              onChange={(v) => setForm({ ...form, months: v })}
              onKeyDown={(e) => handleKeyDown(2, e)}
              className={inputCls + " text-right"}
            />
          </div>
          <div className="w-44">
            <label className={labelCls}>初回返済日</label>
            <DateInput
              value={form.firstDue}
              onChange={(v) => setForm({ ...form, firstDue: v })}
              inputRef={(el) => setCellRef(3, el)}
              onKeyDown={(e) => handleKeyDown(3, e)}
              className={inputCls}
            />
          </div>
          <div className="w-32">
            <label className={labelCls}>方式</label>
            <select
              ref={(el) => setCellRef(4, el)}
              value={form.method}
              onChange={(e) =>
                setForm({ ...form, method: e.target.value as typeof form.method })
              }
              onKeyDown={(e) => handleKeyDown(4, e)}
              className={inputCls}
            >
              <option value="equal_principal">元金均等</option>
              <option value="equal_payment">元利均等</option>
            </select>
          </div>
          <div className="w-36">
            <label className={labelCls}>返済日</label>
            <select
              ref={(el) => setCellRef(5, el)}
              value={form.dueDateMode}
              onChange={(e) =>
                setForm({ ...form, dueDateMode: e.target.value as typeof form.dueDateMode })
              }
              onKeyDown={(e) => handleKeyDown(5, e)}
              className={inputCls}
            >
              <option value="same_day">同じ日にち</option>
              <option value="month_end">毎月末日</option>
            </select>
          </div>
          <Button
            ref={submitRef}
            variant="outline"
            onClick={handleGenerate}
            onKeyDown={handleSubmitKeyDown}
            disabled={busy === "gen"}
          >
            {busy === "gen" && <Loader2 className="size-4 animate-spin" />}
            予定表を作る
          </Button>
        </div>

        <p className={bodyCls}>
          元金均等は毎回の元金が一定、元利均等は毎回の支払総額が一定です。
          端数は最終回で調整し、元金の合計が借入額と必ず一致します。
          返済日は「同じ日にち」なら初回の日にちで揃え（4/30 起算なら 5/30, 6/30…）、
          「毎月末日」なら各月の末日にします（5/31, 6/30, 7/31…）。銀行融資は末日の契約が多くあります。
        </p>

        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-[17px]">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="py-2 pr-3 font-medium">返済日</th>
                  <th className="py-2 pr-3 font-medium text-right">元金</th>
                  <th className="py-2 pr-3 font-medium text-right">利息</th>
                  <th className="py-2 pr-3 font-medium text-right">合計</th>
                  <th className="py-2 pr-3 font-medium">状態</th>
                  <th className="py-2 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const applied = Boolean(r.principal_entry_id || r.interest_entry_id);
                  return (
                    <tr key={r.id} className="border-b border-border/60">
                      <td className="py-2 pr-3 tabular-nums">{r.due_date}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {formatCurrency(r.principal_amount)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {formatCurrency(r.interest_amount)}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums font-medium">
                        {formatCurrency(r.principal_amount + r.interest_amount)}
                      </td>
                      <td className="py-2 pr-3">
                        {applied ? (
                          <Badge variant="success">実績あり</Badge>
                        ) : (
                          <Badge variant="muted">予定</Badge>
                        )}
                      </td>
                      <td className="py-2 text-right whitespace-nowrap">
                        {!applied && (
                          <IconButton
                            label="この予定を明細にする"
                            tone="primary"
                            busy={busy === r.id}
                            onClick={async () => {
                              setBusy(r.id);
                              setError(null);
                              try {
                                await applySchedule(r.id);
                                // 明細が1件増えるので、増減明細と残高も読み直す
                                await Promise.all([load(), onChanged()]);
                              } catch (e) {
                                setError(
                                  e instanceof Error ? e.message : "消し込みに失敗しました"
                                );
                              } finally {
                                setBusy(null);
                              }
                            }}
                          >
                            <CheckCircle className="size-4" />
                          </IconButton>
                        )}
                        <IconButton
                          label="この予定を削除"
                          tone="destructive"
                          busy={busy === r.id}
                          onClick={async () => {
                            if (!confirm("この予定を削除しますか？")) return;
                            setBusy(r.id);
                            try {
                              await deleteSchedule(r.id);
                              await load();
                            } catch (e) {
                              setError(e instanceof Error ? e.message : "削除に失敗しました");
                            } finally {
                              setBusy(null);
                            }
                          }}
                        >
                          <Trash2 className="size-4" />
                        </IconButton>
                      </td>
                    </tr>
                  );
                })}
                <tr className="font-bold">
                  <td className="py-2 pr-3">合計</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {formatCurrency(totalPrincipal)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {formatCurrency(totalInterest)}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {formatCurrency(totalPrincipal + totalInterest)}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// 整合性チェック（要件3-5 / 4-6）
// ---------------------------------------------------------------------------

function ReconcileSection({ ledger }: { ledger: LoanLedger }) {
  const [result, setResult] = useState<ReconcileResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setResult(await reconcileLoan(ledger.loan.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "照合に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-border p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <Scale className="size-4" />
        <span className="text-[17px] font-medium">台帳と仕訳の照合</span>
        <Button variant="outline" onClick={run} disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          照合する
        </Button>
      </div>

      <p className={bodyCls}>
        台帳は管理用の記録で、決算書に出るのは仕訳の方です。両者がずれていると
        「台帳では返し終わっているのに決算書に残債がある」といった食い違いが起きます。
      </p>

      {error && <p className="text-[17px] text-destructive">{error}</p>}

      {result && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-4 text-[17px]">
            <span>台帳の残高 {formatCurrency(result.ledgerBalance)}</span>
            <span>仕訳の残高 {formatCurrency(result.journalBalance)}</span>
            {result.matched ? (
              <Badge variant="success">一致しています</Badge>
            ) : (
              <Badge variant="destructive">
                差額 {formatCurrency(result.difference)}（
                {result.largerSide === "ledger" ? "台帳の方が多い" : "仕訳の方が多い"}）
              </Badge>
            )}
          </div>

          {result.suspects.length > 0 && (
            <div>
              <p className="text-[17px] font-medium">原因と思われるもの</p>
              <ul className="mt-1 space-y-1">
                {result.suspects.map((s) => (
                  <li key={s.refId} className={bodyCls}>
                    {s.date} ／ {formatCurrency(s.amount)} ／ {s.label}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.matched && result.suspects.length === 0 && (
            <p className={bodyCls}>食い違いはありません。</p>
          )}
        </div>
      )}
    </div>
  );
}
