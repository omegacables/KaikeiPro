"use client";

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
  MessageCircleQuestion,
  Printer,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DateInput } from "@/components/ui/date-input";
import { AccountLookup, type AccountOption } from "@/components/ui/account-lookup";
import {
  getLoanLedgers,
  getStatutoryInterestRates,
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
  askLoanLedger,
} from "@/actions/loan-ai";
import { getClient } from "@/actions/clients";
import { getAccounts } from "@/actions/accounts";
import { getReceipts } from "@/actions/receipts";
import {
  runningBalances,
  netByCounterparty,
  imputedInterestAlert,
  entryTypeLabel,
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
  LedgerAnswer,
} from "@/types/index";
import { currentFiscalStartYear } from "@/lib/fiscal";
import { useRouter } from "next/navigation";
import { formatCurrency } from "@/lib/utils";

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

// ---------------------------------------------------------------------------
// フォームの状態
// ---------------------------------------------------------------------------

type LoanFormState = {
  lender_name: string;
  direction: LoanDirection;
  counterparty_kind: CounterpartyKind;
  interest_rate: string;
  borrowed_date: string;
  repayment_terms: string;
  purpose: string;
  memo: string;
};

const emptyLoanForm: LoanFormState = {
  lender_name: "",
  direction: "borrow",
  counterparty_kind: "institution",
  interest_rate: "",
  borrowed_date: "",
  repayment_terms: "",
  purpose: "",
  memo: "",
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

type EditableDraft = LoanAiDraft & { selected: boolean };

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

  // 追加できたことを短く知らせる（画面が下に伸びるため、成功したか分かりにくい）
  const [notice, setNotice] = useState<string | null>(null);
  // 二重送信の防止。setBusy は反映が非同期なので、連打には ref で即座に蓋をする
  const submittingRef = useRef(false);

  // AI
  const [aiText, setAiText] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [drafts, setDrafts] = useState<EditableDraft[]>([]);
  const [excluded, setExcluded] = useState<{ line: string; reason: string }[]>([]);
  const [aiWarnings, setAiWarnings] = useState<string[]>([]);

  // --- データ取得 ----------------------------------------------------------

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [ls, client, accounts, rateRows] = await Promise.all([
        getLoanLedgers(id),
        getClient(id).catch(() => null),
        getAccounts(id).catch(() => []),
        getStatutoryInterestRates().catch(() => []),
      ]);
      setLedgers(ls);
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
      setRates(Object.fromEntries(rateRows.map((r) => [r.loan_year, r.rate])));
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
    setLoanForm({ ...emptyLoanForm, borrowed_date: today() });
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
      borrowed_date: l.loan.borrowed_date ?? "",
      repayment_terms: l.loan.repayment_terms ?? "",
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
        borrowed_date: loanForm.borrowed_date || null,
        liability_account_id: null,
        business_partner_id: null,
        repayment_terms: loanForm.repayment_terms.trim() || null,
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
    setAiBusy(true);
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
      setAiBusy(false);
    }
  }

  async function handleAiDocument(receiptId: string) {
    setAiBusy(true);
    setError(null);
    try {
      const result = await draftLoanEntriesFromReceipt(id, receiptId);
      setDrafts(result.candidates.map((d) => ({ ...d, selected: d.evidence.confidence >= 0.5 })));
      setExcluded(result.excluded);
      setAiWarnings(result.warnings);
    } catch (e) {
      setError(e instanceof Error ? e.message : "証憑の読み取りに失敗しました");
    } finally {
      setAiBusy(false);
    }
  }

  async function handleCommitDrafts() {
    const chosen = drafts.filter((d) => d.selected);
    if (chosen.length === 0) return;
    setAiBusy(true);
    setError(null);
    try {
      const { created, errors } = await commitLoanAiDrafts(id, chosen);
      if (errors.length > 0) {
        setError(
          `${created}件を登録しました。${errors.length}件は登録できませんでした: ` +
            errors.map((e) => e.message).join(" / ")
        );
      }
      setDrafts([]);
      setExcluded([]);
      setAiText("");
      await fetchAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "登録に失敗しました");
    } finally {
      setAiBusy(false);
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
        <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-[17px] text-destructive">
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
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="借入金残高合計" value={summary.total} />
        <SummaryCard label="うち金融機関等" value={summary.institution} />
        <SummaryCard label="うち役員借入金" value={summary.officer} />
        <SummaryCard
          label="うち役員貸付金"
          value={summary.lend}
          // 役員貸付金は残高があること自体が税務リスクなので警告色にする
          warn={summary.lend > 0}
          note={
            summary.lend > 0 && worstAlert
              ? worstAlert.level === "required"
                ? "認定利息の計上が必要"
                : `決算日まで${worstAlert.daysUntilFiscalYearEnd}日`
              : null
          }
        />
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
      />

      {/* 一覧 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">相手先一覧（{ledgers.length}件）</CardTitle>
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
// サマリーカード
// ---------------------------------------------------------------------------

function SummaryCard({
  label,
  value,
  warn = false,
  note = null,
}: {
  label: string;
  value: number;
  warn?: boolean;
  note?: string | null;
}) {
  return (
    <Card className={warn ? "border-destructive/40 bg-destructive/5" : undefined}>
      <CardContent className="py-4">
        <p className={`text-[17px] font-medium ${warn ? "text-destructive" : "text-foreground"}`}>
          {label}
        </p>
        <p
          className={`text-2xl font-bold tabular-nums ${warn ? "text-destructive" : "text-foreground"}`}
        >
          {formatCurrency(value)}
        </p>
        {note && <p className="mt-1 text-[15px] font-medium text-destructive">{note}</p>}
      </CardContent>
    </Card>
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
}) {
  const { ledger, expanded, busy, entryForm, setEntryForm, expenseAccounts } = props;
  const { loan } = ledger;
  const isLend = loan.direction === "lend";
  const rows = runningBalances(ledger.entries);

  // --- キーボードでの入力移動（仕訳入力と同じ流儀にそろえる） -----------------
  // 欄の並び: 0=日付 1=区分 2=金額 3=費用科目（立替のときだけ表示） 4=摘要
  // Enter / → で次へ、← で前へ、最後の欄からは「追加」ボタンへ移る。
  // 表示されていない欄（立替以外のときの費用科目）は自動で読み飛ばす。
  const cellRefs = useRef<(HTMLElement | null)[]>([]);
  const submitRef = useRef<HTMLButtonElement | null>(null);
  const LAST_CELL = 4;

  const setCellRef = useCallback((col: number, el: HTMLElement | null) => {
    cellRefs.current[col] = el;
  }, []);

  /** dir 方向にある、実際に表示されている欄へ移る。無ければ false を返す */
  const focusCell = useCallback((from: number, dir: 1 | -1): boolean => {
    for (let c = from + dir; c >= 0 && c <= LAST_CELL; c += dir) {
      const el = cellRefs.current[c];
      if (el) {
        el.focus();
        return true;
      }
    }
    return false;
  }, []);

  const handleCellKeyDown = useCallback(
    (col: number, e: React.KeyboardEvent) => {
      // IME変換中のEnterは「確定」の意味なので移動しない
      if ((e.nativeEvent as KeyboardEvent).isComposing) return;
      // 上下キーは各欄の本来の動作（日付の増減・プルダウンの選択）に任せる
      if (e.key === "ArrowUp" || e.key === "ArrowDown") return;

      if (e.key === "Enter" || e.key === "ArrowRight") {
        // 金額欄で右キーはカーソル移動に使いたいので、Enterのときだけ進む
        if (e.key === "ArrowRight" && col === 2) return;
        e.preventDefault();
        if (!focusCell(col, 1)) submitRef.current?.focus();
        return;
      }
      if (e.key === "ArrowLeft") {
        if (col === 2) return; // 金額欄の左キーはカーソル移動
        e.preventDefault();
        focusCell(col, -1);
      }
    },
    [focusCell]
  );

  /** 「追加」ボタン上での ← は最後の入力欄へ戻す（Enter/Spaceでの実行は標準動作のまま） */
  const handleSubmitKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== "ArrowLeft") return;
      e.preventDefault();
      focusCell(LAST_CELL + 1, -1);
    },
    [focusCell]
  );

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 bg-muted/20">
        <button
          onClick={props.onToggle}
          className="p-1 rounded hover:bg-muted text-foreground"
          title="増減明細を表示"
        >
          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[17px] font-medium truncate">{loan.lender_name}</span>
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
          <p className="text-[15px] text-foreground mt-0.5">
            明細 {ledger.entries.length}件
            {loan.interest_rate != null && ` ／ 年利 ${loan.interest_rate}%`}
            {loan.repayment_terms && ` ／ 返済条件 ${loan.repayment_terms}`}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[15px] font-medium text-foreground">現在残高</p>
          <p
            className={`text-[17px] font-bold tabular-nums ${isLend && ledger.balance > 0 ? "text-destructive" : ""}`}
          >
            {formatCurrency(ledger.balance)}
          </p>
        </div>
        <div className="flex items-center gap-1 ml-2">
          <button
            onClick={props.onEditLoan}
            className="p-1.5 rounded hover:bg-muted text-foreground"
            title="編集"
          >
            <Pencil className="size-4" />
          </button>
          <button
            onClick={props.onDeleteLoan}
            disabled={busy === loan.id}
            className="p-1.5 rounded hover:bg-muted text-destructive"
            title="削除"
          >
            {busy === loan.id ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Trash2 className="size-4" />
            )}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="px-4 py-3 border-t border-border space-y-4">
          {/* 区分別の内訳 */}
          <div className="flex flex-wrap gap-4 text-[15px] text-foreground">
            <span>
              {isLend ? "貸付" : "借入"}計 {formatCurrency(ledger.byType.borrow)}
            </span>
            {!isLend && <span>立替計 {formatCurrency(ledger.byType.advance)}</span>}
            <span>
              {isLend ? "回収" : "返済"}計 {formatCurrency(ledger.byType.repay)}
            </span>
            <span>利息計 {formatCurrency(ledger.byType.interest)}</span>
          </div>

          <p className="text-[17px] font-bold">明細を追加する</p>

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
                className={inputCls + " pr-7"}
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
              <input
                ref={(el) => setCellRef(2, el)}
                type="number"
                value={entryForm.amount}
                onChange={(e) => setEntryForm({ ...entryForm, amount: e.target.value })}
                onKeyDown={(e) => handleCellKeyDown(2, e)}
                className={inputCls + " text-right"}
                placeholder="0"
              />
            </div>
            {entryForm.entry_type === "repay" && (
              <div className="w-36">
                <label className={labelCls}>同時に払う利息</label>
                <input
                  type="number"
                  value={entryForm.interest_amount}
                  onChange={(e) =>
                    setEntryForm({ ...entryForm, interest_amount: e.target.value })
                  }
                  onKeyDown={(e) => handleCellKeyDown(3, e)}
                  className={inputCls + " text-right"}
                  placeholder="0"
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
            <RepaymentScheduleSection ledger={ledger} />
          )}

          {/* 台帳と仕訳の照合（要件3-5 / 4-6） */}
          <ReconcileSection ledger={ledger} />

          {/* 増減明細と残高推移 */}
          {/* 見出しが無いと、どの表を指しているのか会話で伝わらない */}
          <p className="text-[17px] font-bold">増減明細（{rows.length}件）</p>

          {rows.length === 0 ? (
            <p className={bodyCls}>まだ明細がありません。上のフォームから追加してください。</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[17px]">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="py-2 pr-3 font-medium">日付</th>
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
                      <tr key={entry.id} className="border-b border-border/60">
                        <td className="py-2 pr-3 tabular-nums">{entry.entry_date}</td>
                        <td className="py-2 pr-3">
                          <Badge variant={entry.entry_type === "adjust" ? "warning" : "muted"}>
                            {entryTypeLabel(entry.entry_type, loan.direction)}
                          </Badge>
                          {entry.source === "ai_draft" && (
                            <Badge variant="info" className="ml-1">
                              AI
                            </Badge>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {delta >= 0 ? "+" : "−"}
                          {formatCurrency(Math.abs(delta))}
                        </td>
                        {/* 支払済みの利息。費用として仕訳に載るが残高は動かさない */}
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {entry.interest_amount > 0
                            ? formatCurrency(entry.interest_amount)
                            : ""}
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums font-medium">
                          {formatCurrency(balanceAfter)}
                        </td>
                        <td className="py-2 pr-3 max-w-[20rem] truncate" title={entry.memo ?? ""}>
                          {entry.memo}
                        </td>
                        <td className="py-2 pr-3">
                          <div className="flex items-center gap-1 flex-wrap">
                            {links.map((link) => (
                              <button
                                key={link.id}
                                onClick={() => props.onDetach(link.id)}
                                className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[15px] hover:bg-destructive/10"
                                title="クリックで紐付けを解除"
                              >
                                <FileText className="size-3" />
                                {link.source_line_no != null ? `${link.source_line_no}行目` : "証憑"}
                              </button>
                            ))}
                            <button
                              onClick={() => props.onAttach(entry)}
                              className="p-1 rounded hover:bg-muted text-foreground"
                              title="証憑を添付"
                            >
                              <Paperclip className="size-4" />
                            </button>
                          </div>
                        </td>
                        <td className="py-2 text-right whitespace-nowrap">
                          {busy === entry.id ? (
                            <Loader2 className="size-4 animate-spin inline" />
                          ) : (
                            <>
                              {journalized ? (
                                <button
                                  onClick={() => props.onUnjournalize(entry)}
                                  className="p-1.5 rounded hover:bg-muted text-foreground"
                                  title="仕訳化を取り消す"
                                >
                                  <RotateCcw className="size-4" />
                                </button>
                              ) : (
                                <button
                                  onClick={() => props.onJournalize(entry)}
                                  className="p-1.5 rounded hover:bg-muted text-primary"
                                  title="仕訳化する"
                                >
                                  <CheckCircle className="size-4" />
                                </button>
                              )}
                              <button
                                onClick={() => props.onEditEntry(entry)}
                                className="p-1.5 rounded hover:bg-muted text-foreground"
                                title="編集"
                              >
                                <Pencil className="size-4" />
                              </button>
                              <button
                                onClick={() => props.onDeleteEntry(entry)}
                                className="p-1.5 rounded hover:bg-muted text-destructive"
                                title="削除"
                              >
                                <Trash2 className="size-4" />
                              </button>
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
  busy: boolean;
  drafts: EditableDraft[];
  setDrafts: (d: EditableDraft[]) => void;
  excluded: { line: string; reason: string }[];
  warnings: string[];
  expenseAccounts: AccountOption[];
  onRunText: () => void;
  onRunDocument: (receiptId: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const [receipts, setReceipts] = useState<{ id: string; label: string }[]>([]);
  const [receiptId, setReceiptId] = useState("");

  useEffect(() => {
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
      .catch(() => setReceipts([]));
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
              disabled={props.busy || !props.text.trim()}
            >
              {props.busy && <Loader2 className="size-4 animate-spin" />}
              下書きを作る
            </Button>
          </div>

          <div>
            <label className={labelCls}>証憑から一括起票（通帳・振込明細）</label>
            <select
              value={receiptId}
              onChange={(e) => setReceiptId(e.target.value)}
              className={inputCls}
            >
              <option value="">証憑を選択してください</option>
              {receipts.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
            <Button
              className="mt-2"
              variant="outline"
              onClick={() => receiptId && props.onRunDocument(receiptId)}
              disabled={props.busy || !receiptId}
            >
              {props.busy && <Loader2 className="size-4 animate-spin" />}
              読み取る
            </Button>
          </div>
        </div>

        <AskSection clientId={props.clientId} />

        <ClassifyPaymentSection
          clientId={props.clientId}
          ledgers={props.ledgers}
          onAdopt={(draft) => props.setDrafts([...props.drafts, { ...draft, selected: true }])}
        />

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
                    <th className="py-2 pr-2">採用</th>
                    <th className="py-2 pr-2">日付</th>
                    <th className="py-2 pr-2">相手先</th>
                    <th className="py-2 pr-2">区分</th>
                    <th className="py-2 pr-2 text-right">金額</th>
                    <th className="py-2 pr-2">生成される仕訳</th>
                    <th className="py-2 pr-2 text-right">起票後残高</th>
                    <th className="py-2 pr-2">根拠</th>
                  </tr>
                </thead>
                <tbody>
                  {props.drafts.map((d, i) => (
                    <tr key={i} className="border-b border-border/60 align-top">
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
                      <td className="py-2 pr-2">
                        {d.counterparty_name}
                        {!d.loan_id && (
                          <Badge variant="destructive" className="ml-1">
                            台帳なし
                          </Badge>
                        )}
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
                        <input
                          type="number"
                          value={d.amount}
                          onChange={(e) => {
                            const next = [...props.drafts];
                            next[i] = { ...d, amount: num(e.target.value) };
                            props.setDrafts(next);
                          }}
                          className="w-28 px-2 py-1 rounded border border-border bg-background text-[17px] text-right"
                        />
                      </td>
                      <td className="py-2 pr-2">
                        {d.journal_preview
                          ? `借 ${d.journal_preview.debit} / 貸 ${d.journal_preview.credit}`
                          : "—"}
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums">
                        {d.balance_after != null ? formatCurrency(d.balance_after) : "—"}
                      </td>
                      <td className="py-2 pr-2 max-w-[22rem]">
                        <p>{d.evidence.reasoning}</p>
                        {d.evidence.sourceText && (
                          <p className="mt-1 text-[15px]">読取元: {d.evidence.sourceText}</p>
                        )}
                        <Badge
                          variant={
                            d.evidence.confidence >= 0.8
                              ? "success"
                              : d.evidence.confidence >= 0.5
                                ? "warning"
                                : "destructive"
                          }
                          className="mt-1"
                        >
                          確信度 {Math.round(d.evidence.confidence * 100)}%
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center gap-2">
              <Button onClick={props.onCommit} disabled={props.busy || chosen === 0}>
                {props.busy && <Loader2 className="size-4 animate-spin" />}
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
                className={inputCls}
              >
                <option value="institution">金融機関等</option>
                <option value="officer">役員</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>方向</label>
              <select
                value={form.direction}
                onChange={(e) =>
                  setForm({ ...form, direction: e.target.value as LoanDirection })
                }
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
              value={form.lender_name}
              onChange={(e) => setForm({ ...form, lender_name: e.target.value })}
              className={inputCls}
              // 区分に応じてプレースホルダを切り替える（要件6章）
              placeholder={isOfficer ? "代表取締役 ○○" : "○○銀行"}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* 役員借入金は無利息が原則なので年利欄そのものを出さない */}
            {props.showInterestRate && (
              <div>
                <label className={labelCls}>
                  年利（%）<span className="text-destructive">（必須）</span>
                </label>
                <input
                  type="number"
                  step="0.001"
                  value={form.interest_rate}
                  onChange={(e) => setForm({ ...form, interest_rate: e.target.value })}
                  className={inputCls + " text-right"}
                  placeholder="1.500"
                />
              </div>
            )}
            <div>
              <label className={labelCls}>開始日</label>
              <DateInput
                value={form.borrowed_date}
                onChange={(v) => setForm({ ...form, borrowed_date: v })}
                allowEmpty
                className={inputCls + " pr-7"}
              />
            </div>
          </div>

          <div>
            <label className={labelCls}>返済条件</label>
            <input
              value={form.repayment_terms}
              onChange={(e) => setForm({ ...form, repayment_terms: e.target.value })}
              className={inputCls}
              placeholder={isOfficer ? "定めなし" : "毎月末 元金50,000円"}
            />
          </div>

          <div>
            <label className={labelCls}>借入理由</label>
            <input
              value={form.purpose}
              onChange={(e) => setForm({ ...form, purpose: e.target.value })}
              className={inputCls}
              placeholder="運転資金 など（勘定科目内訳明細書の記載項目）"
            />
          </div>

          <div>
            <label className={labelCls}>メモ</label>
            <input
              value={form.memo}
              onChange={(e) => setForm({ ...form, memo: e.target.value })}
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
          <Button onClick={props.onSave} disabled={props.busy}>
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
            <div>
              <label className={labelCls}>証憑内の行番号</label>
              <input
                type="number"
                value={lineNo}
                onChange={(e) => setLineNo(e.target.value)}
                className={inputCls + " w-32 text-right"}
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
// 曖昧な取引の判別（要件4-5）
//
// 役員個人の口座への送金には 役員報酬 / 借入金の返済 / 立替経費の精算 があり、
// 通帳の摘要だけでは判別できない。役員報酬なら損金＋源泉徴収が必要、
// 借入返済なら課税関係なしと扱いが正反対なので、確信が持てない場合は
// 確定させず必ず確認を求める。
// ---------------------------------------------------------------------------

const OPTION_LABELS: Record<string, string> = {
  loan_repayment: "役員借入金の返済",
  officer_salary: "役員報酬",
  expense_settlement: "立替経費の精算",
  other: "その他",
};

function ClassifyPaymentSection(props: {
  clientId: string;
  ledgers: LoanLedger[];
  onAdopt: (draft: LoanAiDraft) => void;
}) {
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<OfficerPaymentClassification | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 返済先の候補は借入金台帳のみ（貸付金台帳への「返済」はありえない）
  const borrowLedgers = props.ledgers.filter((l) => l.loan.direction === "borrow");
  const [loanId, setLoanId] = useState("");

  async function run() {
    if (num(amount) <= 0 || !description.trim()) {
      setError("金額と摘要を入力してください");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await classifyOfficerPayment(props.clientId, {
        date,
        amount: num(amount),
        description: description.trim(),
      });
      setResult(r);
      // AIが借入返済と判断したときは、その台帳を初期選択にする
      setLoanId(r.draft?.loan_id ?? borrowLedgers[0]?.loan.id ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "判別に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  // 「借入金の返済」として下書きに送る。人間が選んで初めて実行される。
  function adoptAsRepayment() {
    const target = borrowLedgers.find((l) => l.loan.id === loanId);
    if (!target || !result) return;
    props.onAdopt({
      loan_id: target.loan.id,
      counterparty_name: target.loan.lender_name,
      direction: "borrow",
      entry_date: date,
      entry_type: "repay",
      amount: num(amount),
      expense_account_id: null,
      expense_account_name: null,
      memo: description.trim(),
      evidence: {
        reasoning: result.reasoning,
        confidence: result.confidence,
        sourceText: description.trim(),
        candidates: result.options.map((o) => ({ label: o.label, reason: o.reason })),
      },
      balance_after: target.balance - num(amount),
      journal_preview: { debit: "役員借入金", credit: "普通預金", amount: num(amount) },
    });
    setResult(null);
    setAmount("");
    setDescription("");
  }

  return (
    <details className="rounded-lg border border-border p-3">
      <summary className="text-[17px] font-medium cursor-pointer">
        役員個人への送金を判別する（役員報酬 / 借入返済 / 立替精算）
      </summary>

      <div className="mt-3 space-y-3">
        <p className={bodyCls}>
          役員報酬と借入返済では税務上の扱いが正反対になります。摘要だけで判断せず、
          役員報酬の手取額・台帳残高・過去の分類履歴と突き合わせて確認します。
        </p>

        <div className="grid gap-2 sm:grid-cols-[auto_auto_1fr_auto] sm:items-end">
          <div>
            <label className={labelCls}>日付</label>
            <DateInput
              value={date}
              onChange={setDate}
              className={inputCls + " w-44 pr-7"}
            />
          </div>
          <div>
            <label className={labelCls}>金額</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={inputCls + " w-32 text-right"}
              placeholder="100000"
            />
          </div>
          <div>
            <label className={labelCls}>摘要（通帳の記載）</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={inputCls}
              placeholder="振込 ペイペイ アンドウ　レン"
            />
          </div>
          <Button variant="outline" onClick={run} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            判別する
          </Button>
        </div>

        {error && <p className="text-[17px] text-destructive">{error}</p>}

        {result && (
          <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
            <p className="text-[17px] font-bold">{result.question}</p>

            {result.options.length > 0 && (
              <ul className="space-y-1">
                {result.options.map((o) => (
                  <li key={o.key} className={bodyCls}>
                    <span className="font-medium">
                      {OPTION_LABELS[o.key] ?? o.label}
                    </span>
                    {o.recommended && (
                      <Badge variant="success" className="ml-1">
                        推定
                      </Badge>
                    )}
                    <span> — {o.reason}</span>
                  </li>
                ))}
              </ul>
            )}

            <p className={bodyCls}>{result.reasoning}</p>

            {result.conclusion == null && (
              <p className="text-[17px] font-medium text-warning">
                確信が持てないため確定していません。内容を確認して選んでください。
              </p>
            )}

            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className={labelCls}>返済先の台帳</label>
                <select
                  value={loanId}
                  onChange={(e) => setLoanId(e.target.value)}
                  className={inputCls + " w-auto"}
                >
                  <option value="">選択してください</option>
                  {borrowLedgers.map((l) => (
                    <option key={l.loan.id} value={l.loan.id}>
                      {l.loan.lender_name}（残高 {formatCurrency(l.balance)}）
                    </option>
                  ))}
                </select>
              </div>
              <Button onClick={adoptAsRepayment} disabled={!loanId}>
                借入金の返済として下書きに追加
              </Button>
              <Button variant="outline" onClick={() => setResult(null)}>
                台帳の対象外にする
              </Button>
            </div>

            <p className={bodyCls}>
              役員報酬・立替経費の精算にあたる場合は、この台帳ではなく給与または
              経費の機能で処理してください。
            </p>
          </div>
        )}
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// 返済予定表（要件3-7）
//
// 金融機関等からの借入は返済日ごとに元金と利息の内訳が決まっている。
// 予定を持っておくと、期日が来たら1クリックで増減明細に落とせる。
// 役員借入金は返済条件を定めないのが通常なので、この節は表示しない。
// ---------------------------------------------------------------------------

function RepaymentScheduleSection({ ledger }: { ledger: LoanLedger }) {
  const [rows, setRows] = useState<LoanRepaymentSchedule[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({
    principal: "",
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
            <input
              type="number"
              value={form.principal}
              onChange={(e) => setForm({ ...form, principal: e.target.value })}
              className={inputCls + " text-right"}
              placeholder="1200000"
            />
          </div>
          <div className="w-24">
            <label className={labelCls}>年利(%)</label>
            <input
              type="number"
              step="0.001"
              value={form.rate}
              onChange={(e) => setForm({ ...form, rate: e.target.value })}
              className={inputCls + " text-right"}
            />
          </div>
          <div className="w-24">
            <label className={labelCls}>回数(月)</label>
            <input
              type="number"
              value={form.months}
              onChange={(e) => setForm({ ...form, months: e.target.value })}
              className={inputCls + " text-right"}
            />
          </div>
          <div className="w-44">
            <label className={labelCls}>初回返済日</label>
            <DateInput
              value={form.firstDue}
              onChange={(v) => setForm({ ...form, firstDue: v })}
              className={inputCls + " pr-7"}
            />
          </div>
          <div className="w-32">
            <label className={labelCls}>方式</label>
            <select
              value={form.method}
              onChange={(e) =>
                setForm({ ...form, method: e.target.value as typeof form.method })
              }
              className={inputCls}
            >
              <option value="equal_principal">元金均等</option>
              <option value="equal_payment">元利均等</option>
            </select>
          </div>
          <div className="w-36">
            <label className={labelCls}>返済日</label>
            <select
              value={form.dueDateMode}
              onChange={(e) =>
                setForm({ ...form, dueDateMode: e.target.value as typeof form.dueDateMode })
              }
              className={inputCls}
            >
              <option value="same_day">同じ日にち</option>
              <option value="month_end">毎月末日</option>
            </select>
          </div>
          <Button variant="outline" onClick={handleGenerate} disabled={busy === "gen"}>
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
                        {busy === r.id ? (
                          <Loader2 className="size-4 animate-spin inline" />
                        ) : (
                          <>
                            {!applied && (
                              <button
                                onClick={async () => {
                                  setBusy(r.id);
                                  setError(null);
                                  try {
                                    await applySchedule(r.id);
                                    await load();
                                  } catch (e) {
                                    setError(
                                      e instanceof Error ? e.message : "消し込みに失敗しました"
                                    );
                                  } finally {
                                    setBusy(null);
                                  }
                                }}
                                className="p-1.5 rounded hover:bg-muted text-primary"
                                title="この予定を明細にする"
                              >
                                <CheckCircle className="size-4" />
                              </button>
                            )}
                            <button
                              onClick={async () => {
                                if (!confirm("この予定を削除しますか？")) return;
                                setBusy(r.id);
                                try {
                                  await deleteSchedule(r.id);
                                  await load();
                                } catch (e) {
                                  setError(
                                    e instanceof Error ? e.message : "削除に失敗しました"
                                  );
                                } finally {
                                  setBusy(null);
                                }
                              }}
                              className="p-1.5 rounded hover:bg-muted text-destructive"
                              title="削除"
                            >
                              <Trash2 className="size-4" />
                            </button>
                          </>
                        )}
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

// ---------------------------------------------------------------------------
// 質問応答（要件4-7）
// ---------------------------------------------------------------------------

function AskSection({ clientId }: { clientId: string }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<LedgerAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    if (!question.trim()) return;
    setBusy(true);
    setError(null);
    setAnswer(null);
    try {
      setAnswer(await askLoanLedger(clientId, question));
    } catch (e) {
      setError(e instanceof Error ? e.message : "回答の取得に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="rounded-lg border border-border p-3">
      <summary className="text-[17px] font-medium cursor-pointer flex items-center gap-2">
        <MessageCircleQuestion className="size-4" />
        台帳について質問する
      </summary>

      <div className="mt-3 space-y-3">
        <p className={bodyCls}>
          「いま役員借入金はいくら？」「この10万円は何？」のように聞けます。
          残高の計算はシステム側で確定させてからAIに渡すので、金額が作り話になることはありません。
        </p>

        <div className="flex gap-2">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !(e.nativeEvent as KeyboardEvent).isComposing) ask();
            }}
            className={inputCls}
            placeholder="いま役員借入金はいくら？"
          />
          <Button onClick={ask} disabled={busy || !question.trim()}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            聞く
          </Button>
        </div>

        {error && <p className="text-[17px] text-destructive">{error}</p>}

        {answer && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
            <p className="text-[17px] whitespace-pre-wrap">{answer.answer}</p>

            {answer.outOfScope && (
              <p className="text-[17px] font-medium text-warning">
                この質問は借入金台帳の範囲では答えられません。
              </p>
            )}

            {answer.sources.length > 0 ? (
              <div>
                <p className="text-[15px] font-medium">根拠にした明細</p>
                <ul className="mt-1 space-y-0.5">
                  {answer.sources.map((s) => (
                    <li key={s.entry_id} className={bodyCls}>
                      {s.entry_date} ／ {s.amount != null ? formatCurrency(s.amount) : ""} ／{" "}
                      {s.label}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              !answer.outOfScope && (
                <p className="text-[15px] font-medium text-warning">
                  根拠となる明細を示せていません。回答の内容は必ずご確認ください。
                </p>
              )
            )}
          </div>
        )}
      </div>
    </details>
  );
}
