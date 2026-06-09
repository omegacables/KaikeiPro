"use client";

import { useState, useEffect, useCallback, use } from "react";
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
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  getLoans,
  createLoan,
  updateLoan,
  deleteLoan,
  getRepayments,
  createRepayment,
  deleteRepayment,
  journalizeRepayment,
  unjournalizeRepayment,
} from "@/actions/loans";
import type { Loan, LoanRepayment, LoanType } from "@/types/index";
import { formatCurrency } from "@/lib/utils";

const num = (s: string) => Math.round(Number(s) || 0);

const inputCls =
  "w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40";

function today(): string {
  return new Date().toISOString().split("T")[0];
}

type LoanFormState = {
  lender_name: string;
  loan_type: LoanType;
  principal: string;
  current_balance: string;
  interest_rate: string;
  borrowed_date: string;
  memo: string;
};

const emptyLoanForm: LoanFormState = {
  lender_name: "",
  loan_type: "borrowing",
  principal: "",
  current_balance: "",
  interest_rate: "",
  borrowed_date: "",
  memo: "",
};

type RepayFormState = {
  repayment_date: string;
  principal_amount: string;
  interest_amount: string;
  memo: string;
};

export default function LoansPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 借入フォーム（モーダル）
  const [showLoanForm, setShowLoanForm] = useState(false);
  const [editingLoanId, setEditingLoanId] = useState<string | null>(null);
  const [loanForm, setLoanForm] = useState<LoanFormState>(emptyLoanForm);

  // 展開中の借入とその返済記録
  const [expanded, setExpanded] = useState<string | null>(null);
  const [repayments, setRepayments] = useState<Record<string, LoanRepayment[]>>({});

  // 返済入力フォーム（展開行ごと）
  const [repayForm, setRepayForm] = useState<RepayFormState>({
    repayment_date: today(),
    principal_amount: "",
    interest_amount: "",
    memo: "",
  });

  const fetchLoans = useCallback(async () => {
    setLoading(true);
    try {
      const ls = await getLoans(id);
      setLoans(ls);
    } catch {
      // DB not available
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchLoans();
  }, [fetchLoans]);

  const loadRepayments = useCallback(async (loanId: string) => {
    try {
      const reps = await getRepayments(loanId);
      setRepayments((prev) => ({ ...prev, [loanId]: reps }));
    } catch {
      // ignore
    }
  }, []);

  async function toggleExpand(loanId: string) {
    if (expanded === loanId) {
      setExpanded(null);
      return;
    }
    setExpanded(loanId);
    setRepayForm({
      repayment_date: today(),
      principal_amount: "",
      interest_amount: "",
      memo: "",
    });
    if (!repayments[loanId]) await loadRepayments(loanId);
  }

  // ---- 借入の追加・編集 ----
  function openCreateLoan() {
    setEditingLoanId(null);
    setLoanForm({ ...emptyLoanForm, borrowed_date: today() });
    setShowLoanForm(true);
    setError(null);
  }

  function openEditLoan(l: Loan) {
    setEditingLoanId(l.id);
    setLoanForm({
      lender_name: l.lender_name,
      loan_type: l.loan_type,
      principal: String(l.principal || ""),
      current_balance: String(l.current_balance || ""),
      interest_rate: l.interest_rate != null ? String(l.interest_rate) : "",
      borrowed_date: l.borrowed_date ?? "",
      memo: l.memo ?? "",
    });
    setShowLoanForm(true);
    setError(null);
  }

  async function handleSaveLoan() {
    if (!loanForm.lender_name.trim()) {
      setError("借入先を入力してください");
      return;
    }
    setBusy("save");
    setError(null);
    try {
      const principal = num(loanForm.principal);
      const balanceStr = loanForm.current_balance.trim();
      const payload = {
        client_id: id,
        lender_name: loanForm.lender_name.trim(),
        loan_type: loanForm.loan_type,
        principal,
        current_balance: balanceStr === "" ? principal : num(balanceStr),
        interest_rate:
          loanForm.interest_rate.trim() === ""
            ? null
            : Number(loanForm.interest_rate),
        borrowed_date: loanForm.borrowed_date || null,
        liability_account_id: null,
        memo: loanForm.memo.trim() || null,
      };
      if (editingLoanId) {
        await updateLoan(editingLoanId, payload);
      } else {
        await createLoan(payload);
      }
      setShowLoanForm(false);
      await fetchLoans();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setBusy(null);
    }
  }

  async function handleDeleteLoan(l: Loan) {
    if (
      !confirm(
        `「${l.lender_name}」の借入金台帳を削除しますか？\n（返済記録と生成済みの仕訳もすべて削除されます）`
      )
    )
      return;
    setBusy(l.id);
    try {
      await deleteLoan(l.id);
      if (expanded === l.id) setExpanded(null);
      await fetchLoans();
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除に失敗しました");
    } finally {
      setBusy(null);
    }
  }

  // ---- 返済記録 ----
  async function handleAddRepayment(loan: Loan) {
    const principal = num(repayForm.principal_amount);
    const interest = num(repayForm.interest_amount);
    if (principal + interest <= 0) {
      setError("元金または利息を入力してください");
      return;
    }
    setBusy("repay-" + loan.id);
    setError(null);
    try {
      await createRepayment({
        loan_id: loan.id,
        client_id: id,
        repayment_date: repayForm.repayment_date || today(),
        principal_amount: principal,
        interest_amount: interest,
        payment_account_id: null,
        interest_account_id: null,
        memo: repayForm.memo.trim() || null,
      });
      setRepayForm({
        repayment_date: today(),
        principal_amount: "",
        interest_amount: "",
        memo: "",
      });
      await loadRepayments(loan.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "登録に失敗しました");
    } finally {
      setBusy(null);
    }
  }

  async function handleJournalizeRepayment(rep: LoanRepayment) {
    setBusy(rep.id);
    setError(null);
    try {
      await journalizeRepayment(rep.id);
      await Promise.all([loadRepayments(rep.loan_id), fetchLoans()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "仕訳化に失敗しました");
    } finally {
      setBusy(null);
    }
  }

  async function handleUnjournalizeRepayment(rep: LoanRepayment) {
    if (!confirm("仕訳化を取り消し、生成済みの仕訳を削除します。よろしいですか？"))
      return;
    setBusy(rep.id);
    try {
      await unjournalizeRepayment(rep.id);
      await Promise.all([loadRepayments(rep.loan_id), fetchLoans()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "取り消しに失敗しました");
    } finally {
      setBusy(null);
    }
  }

  async function handleDeleteRepayment(rep: LoanRepayment) {
    if (
      !confirm(
        `この返済記録を削除しますか？${
          rep.status === "journalized" ? "\n（生成済みの仕訳も削除されます）" : ""
        }`
      )
    )
      return;
    setBusy(rep.id);
    try {
      await deleteRepayment(rep.id);
      await Promise.all([loadRepayments(rep.loan_id), fetchLoans()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除に失敗しました");
    } finally {
      setBusy(null);
    }
  }

  // 集計
  const totalBalance = loans
    .filter((l) => l.status === "active")
    .reduce((s, l) => s + l.current_balance, 0);
  const officerBalance = loans
    .filter((l) => l.status === "active" && l.loan_type === "officer")
    .reduce((s, l) => s + l.current_balance, 0);
  const bankBalance = totalBalance - officerBalance;

  return (
    <div className="space-y-6">
      {/* ヘッダー */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Landmark className="size-6 text-primary" />
          <h1 className="text-xl font-bold">借入金台帳</h1>
        </div>
        <Button onClick={openCreateLoan}>
          <Plus className="size-4" />
          借入金を追加
        </Button>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* 集計カード */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground">借入金残高合計</p>
            <p className="text-lg font-bold tabular-nums">{formatCurrency(totalBalance)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground">うち金融機関等</p>
            <p className="text-lg font-bold tabular-nums">{formatCurrency(bankBalance)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground">うち役員借入金</p>
            <p className="text-lg font-bold tabular-nums">{formatCurrency(officerBalance)}</p>
          </CardContent>
        </Card>
      </div>

      {/* 一覧 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">借入一覧（{loans.length}件）</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="size-5 animate-spin mr-2" />
              読み込み中...
            </div>
          ) : loans.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              借入金データはまだありません。「借入金を追加」から登録してください。
            </div>
          ) : (
            <div className="space-y-3">
              {loans.map((l) => {
                const isExpanded = expanded === l.id;
                const reps = repayments[l.id] ?? [];
                const isLoanBusy = busy === l.id;
                return (
                  <div key={l.id} className="rounded-lg border border-border overflow-hidden">
                    {/* 借入ヘッダー行 */}
                    <div className="flex items-center gap-2 px-4 py-3 bg-muted/20">
                      <button
                        onClick={() => toggleExpand(l.id)}
                        className="p-1 rounded hover:bg-muted text-muted-foreground"
                        title="返済記録を表示"
                      >
                        {isExpanded ? (
                          <ChevronDown className="size-4" />
                        ) : (
                          <ChevronRight className="size-4" />
                        )}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium truncate">{l.lender_name}</span>
                          <Badge variant={l.loan_type === "officer" ? "default" : "muted"}>
                            {l.loan_type === "officer" ? "役員借入金" : "借入金"}
                          </Badge>
                          {l.status === "completed" ? (
                            <Badge variant="success">完済</Badge>
                          ) : (
                            <Badge variant="warning">返済中</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          当初 {formatCurrency(l.principal)}
                          {l.interest_rate != null && ` ／ 年利 ${l.interest_rate}%`}
                          {l.borrowed_date && ` ／ 借入日 ${l.borrowed_date}`}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground">現在残高</p>
                        <p className="font-bold tabular-nums">{formatCurrency(l.current_balance)}</p>
                      </div>
                      <div className="flex items-center gap-1 ml-2">
                        <button
                          onClick={() => openEditLoan(l)}
                          className="p-1.5 rounded hover:bg-muted text-muted-foreground"
                          title="編集"
                        >
                          <Pencil className="size-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteLoan(l)}
                          disabled={isLoanBusy}
                          className="p-1.5 rounded hover:bg-muted text-destructive"
                          title="削除"
                        >
                          {isLoanBusy ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Trash2 className="size-4" />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* 展開: 返済記録 */}
                    {isExpanded && (
                      <div className="px-4 py-3 border-t border-border space-y-3">
                        {/* 返済入力 */}
                        <div className="grid gap-2 sm:grid-cols-[auto_1fr_1fr_1fr_auto] sm:items-end">
                          <div>
                            <label className="block text-xs text-muted-foreground mb-1">返済日</label>
                            <input
                              type="date"
                              value={repayForm.repayment_date}
                              onChange={(e) =>
                                setRepayForm({ ...repayForm, repayment_date: e.target.value })
                              }
                              className={inputCls + " w-auto"}
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-muted-foreground mb-1">元金返済</label>
                            <input
                              type="number"
                              value={repayForm.principal_amount}
                              onChange={(e) =>
                                setRepayForm({ ...repayForm, principal_amount: e.target.value })
                              }
                              className={inputCls + " text-right"}
                              placeholder="0"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-muted-foreground mb-1">支払利息</label>
                            <input
                              type="number"
                              value={repayForm.interest_amount}
                              onChange={(e) =>
                                setRepayForm({ ...repayForm, interest_amount: e.target.value })
                              }
                              className={inputCls + " text-right"}
                              placeholder="0"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-muted-foreground mb-1">メモ</label>
                            <input
                              value={repayForm.memo}
                              onChange={(e) =>
                                setRepayForm({ ...repayForm, memo: e.target.value })
                              }
                              className={inputCls}
                              placeholder="（任意）"
                            />
                          </div>
                          <Button
                            size="sm"
                            onClick={() => handleAddRepayment(l)}
                            disabled={busy === "repay-" + l.id}
                          >
                            {busy === "repay-" + l.id ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Plus className="size-4" />
                            )}
                            返済を記録
                          </Button>
                        </div>

                        {/* 返済記録一覧 */}
                        {reps.length === 0 ? (
                          <p className="text-xs text-muted-foreground py-2">
                            返済記録はまだありません。
                          </p>
                        ) : (
                          <div className="overflow-x-auto -mx-2 px-2">
                            <table className="w-full text-sm min-w-[560px]">
                              <thead>
                                <tr className="border-b border-border text-xs text-muted-foreground">
                                  <th className="text-left py-2 px-2">返済日</th>
                                  <th className="text-right py-2 px-2">元金</th>
                                  <th className="text-right py-2 px-2">利息</th>
                                  <th className="text-right py-2 px-2">合計</th>
                                  <th className="text-center py-2 px-2">状態</th>
                                  <th className="text-right py-2 px-2">操作</th>
                                </tr>
                              </thead>
                              <tbody>
                                {reps.map((rep) => {
                                  const isRepBusy = busy === rep.id;
                                  const total = rep.principal_amount + rep.interest_amount;
                                  return (
                                    <tr key={rep.id} className="border-b border-border/50">
                                      <td className="py-2 px-2">{rep.repayment_date}</td>
                                      <td className="py-2 px-2 text-right tabular-nums">
                                        {formatCurrency(rep.principal_amount)}
                                      </td>
                                      <td className="py-2 px-2 text-right tabular-nums">
                                        {formatCurrency(rep.interest_amount)}
                                      </td>
                                      <td className="py-2 px-2 text-right tabular-nums font-medium">
                                        {formatCurrency(total)}
                                      </td>
                                      <td className="py-2 px-2 text-center">
                                        {rep.status === "journalized" ? (
                                          <Badge variant="success">仕訳済</Badge>
                                        ) : (
                                          <Badge variant="warning">未仕訳</Badge>
                                        )}
                                      </td>
                                      <td className="py-2 px-2">
                                        <div className="flex items-center justify-end gap-1">
                                          {rep.status === "pending" ? (
                                            <button
                                              onClick={() => handleJournalizeRepayment(rep)}
                                              disabled={isRepBusy}
                                              title="仕訳化"
                                              className="p-1.5 rounded hover:bg-muted text-primary disabled:opacity-40"
                                            >
                                              {isRepBusy ? (
                                                <Loader2 className="size-4 animate-spin" />
                                              ) : (
                                                <CheckCircle className="size-4" />
                                              )}
                                            </button>
                                          ) : (
                                            <button
                                              onClick={() => handleUnjournalizeRepayment(rep)}
                                              disabled={isRepBusy}
                                              title="仕訳化を取り消す"
                                              className="p-1.5 rounded hover:bg-muted text-muted-foreground"
                                            >
                                              {isRepBusy ? (
                                                <Loader2 className="size-4 animate-spin" />
                                              ) : (
                                                <RotateCcw className="size-4" />
                                              )}
                                            </button>
                                          )}
                                          <button
                                            onClick={() => handleDeleteRepayment(rep)}
                                            disabled={isRepBusy}
                                            className="p-1.5 rounded hover:bg-muted text-destructive"
                                            title="削除"
                                          >
                                            <Trash2 className="size-4" />
                                          </button>
                                        </div>
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
              })}
            </div>
          )}
          <p className="mt-4 text-xs text-muted-foreground">
            返済を仕訳化すると「借方 借入金/役員借入金（元金）・支払利息（利息）／ 貸方 普通預金/現金（返済合計）」の仕訳を生成し、残高を元金分だけ減らします。
          </p>
        </CardContent>
      </Card>

      {/* 借入フォーム（モーダル） */}
      {showLoanForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={() => setShowLoanForm(false)}
        >
          <div
            className="bg-card border border-border rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="font-bold">{editingLoanId ? "借入金を編集" : "借入金を追加"}</h2>
              <button onClick={() => setShowLoanForm(false)} className="p-1 rounded hover:bg-muted">
                <X className="size-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">借入先</label>
                  <input
                    value={loanForm.lender_name}
                    onChange={(e) => setLoanForm({ ...loanForm, lender_name: e.target.value })}
                    className={inputCls}
                    placeholder="○○銀行 / 代表者"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">区分</label>
                  <select
                    value={loanForm.loan_type}
                    onChange={(e) =>
                      setLoanForm({ ...loanForm, loan_type: e.target.value as LoanType })
                    }
                    className={inputCls}
                  >
                    <option value="borrowing">金融機関等（借入金）</option>
                    <option value="officer">役員（役員借入金）</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">当初借入額</label>
                  <input
                    type="number"
                    value={loanForm.principal}
                    onChange={(e) => setLoanForm({ ...loanForm, principal: e.target.value })}
                    className={inputCls + " text-right"}
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    現在残高
                    <span className="text-muted-foreground/70">（空欄なら当初額）</span>
                  </label>
                  <input
                    type="number"
                    value={loanForm.current_balance}
                    onChange={(e) =>
                      setLoanForm({ ...loanForm, current_balance: e.target.value })
                    }
                    className={inputCls + " text-right"}
                    placeholder="0"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">年利（%）</label>
                  <input
                    type="number"
                    step="0.001"
                    value={loanForm.interest_rate}
                    onChange={(e) =>
                      setLoanForm({ ...loanForm, interest_rate: e.target.value })
                    }
                    className={inputCls + " text-right"}
                    placeholder="（任意）"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">借入日</label>
                  <input
                    type="date"
                    value={loanForm.borrowed_date}
                    onChange={(e) =>
                      setLoanForm({ ...loanForm, borrowed_date: e.target.value })
                    }
                    className={inputCls}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">メモ</label>
                <input
                  value={loanForm.memo}
                  onChange={(e) => setLoanForm({ ...loanForm, memo: e.target.value })}
                  className={inputCls}
                  placeholder="（任意）"
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
              <Button variant="outline" onClick={() => setShowLoanForm(false)}>
                キャンセル
              </Button>
              <Button onClick={handleSaveLoan} disabled={busy === "save"}>
                {busy === "save" && <Loader2 className="size-4 animate-spin" />}
                保存
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
