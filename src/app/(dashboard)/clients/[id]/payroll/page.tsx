"use client";

import { useState, useEffect, useCallback, use } from "react";
import {
  Users,
  Plus,
  Loader2,
  X,
  Pencil,
  Trash2,
  CheckCircle,
  RotateCcw,
  Banknote,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  getPayrollRecords,
  getPayrollMonths,
  createPayrollRecord,
  updatePayrollRecord,
  deletePayrollRecord,
  journalizePayroll,
  unjournalizePayroll,
} from "@/actions/payroll";
import type { PayrollRecord, EmployeeType } from "@/types/index";
import { formatCurrency } from "@/lib/utils";
import { DateInput } from "@/components/ui/date-input";

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

type FormState = {
  employee_name: string;
  employee_type: EmployeeType;
  pay_month: string;
  pay_date: string;
  gross_salary: string;
  income_tax: string;
  resident_tax: string;
  health_insurance: string;
  pension_insurance: string;
  employment_insurance: string;
  other_deduction: string;
  memo: string;
};

const emptyForm: FormState = {
  employee_name: "",
  employee_type: "employee",
  pay_month: "",
  pay_date: "",
  gross_salary: "",
  income_tax: "",
  resident_tax: "",
  health_insurance: "",
  pension_insurance: "",
  employment_insurance: "",
  other_deduction: "",
  memo: "",
};

const num = (s: string) => Math.round(Number(s) || 0);

const deductionFields: { key: keyof FormState; label: string }[] = [
  { key: "income_tax", label: "源泉所得税" },
  { key: "resident_tax", label: "住民税" },
  { key: "health_insurance", label: "健康保険" },
  { key: "pension_insurance", label: "厚生年金" },
  { key: "employment_insurance", label: "雇用保険" },
  { key: "other_deduction", label: "その他控除" },
];

const inputCls =
  "w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40";

export default function PayrollPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [month, setMonth] = useState(currentMonth());
  const [months, setMonths] = useState<string[]>([]);
  const [records, setRecords] = useState<PayrollRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [recs, ms] = await Promise.all([
        getPayrollRecords(id, month),
        getPayrollMonths(id),
      ]);
      setRecords(recs);
      setMonths(ms);
    } catch {
      // DB not available
    } finally {
      setLoading(false);
    }
  }, [id, month]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function openCreate() {
    setEditingId(null);
    setForm({ ...emptyForm, pay_month: month, pay_date: `${month}-25` });
    setShowForm(true);
    setError(null);
  }

  function openEdit(r: PayrollRecord) {
    setEditingId(r.id);
    setForm({
      employee_name: r.employee_name,
      employee_type: r.employee_type,
      pay_month: (r.pay_month ?? "").slice(0, 7),
      pay_date: r.pay_date ?? "",
      gross_salary: String(r.gross_salary || ""),
      income_tax: String(r.income_tax || ""),
      resident_tax: String(r.resident_tax || ""),
      health_insurance: String(r.health_insurance || ""),
      pension_insurance: String(r.pension_insurance || ""),
      employment_insurance: String(r.employment_insurance || ""),
      other_deduction: String(r.other_deduction || ""),
      memo: r.memo ?? "",
    });
    setShowForm(true);
    setError(null);
  }

  const formDeductions =
    num(form.income_tax) +
    num(form.resident_tax) +
    num(form.health_insurance) +
    num(form.pension_insurance) +
    num(form.employment_insurance) +
    num(form.other_deduction);
  const formNet = num(form.gross_salary) - formDeductions;

  async function handleSave() {
    if (!form.employee_name.trim()) {
      setError("氏名を入力してください");
      return;
    }
    setBusy("save");
    setError(null);
    try {
      const payload = {
        client_id: id,
        pay_month: form.pay_month || month,
        pay_date: form.pay_date || null,
        employee_name: form.employee_name.trim(),
        employee_type: form.employee_type,
        gross_salary: num(form.gross_salary),
        income_tax: num(form.income_tax),
        resident_tax: num(form.resident_tax),
        health_insurance: num(form.health_insurance),
        pension_insurance: num(form.pension_insurance),
        employment_insurance: num(form.employment_insurance),
        other_deduction: num(form.other_deduction),
        salary_account_id: null,
        withholding_account_id: null,
        payment_account_id: null,
        memo: form.memo.trim() || null,
      };
      if (editingId) {
        await updatePayrollRecord(editingId, payload);
      } else {
        await createPayrollRecord(payload);
      }
      setShowForm(false);
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete(r: PayrollRecord) {
    if (
      !confirm(
        `${r.employee_name} の給与レコードを削除しますか？${
          r.status === "journalized" ? "\n（生成済みの仕訳も削除されます）" : ""
        }`
      )
    )
      return;
    setBusy(r.id);
    try {
      await deletePayrollRecord(r.id);
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除に失敗しました");
    } finally {
      setBusy(null);
    }
  }

  async function handleJournalize(r: PayrollRecord) {
    setBusy(r.id);
    setError(null);
    try {
      await journalizePayroll(r.id);
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "仕訳化に失敗しました");
    } finally {
      setBusy(null);
    }
  }

  async function handleUnjournalize(r: PayrollRecord) {
    if (!confirm("仕訳化を取り消し、生成済みの仕訳を削除します。よろしいですか？"))
      return;
    setBusy(r.id);
    try {
      await unjournalizePayroll(r.id);
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "取り消しに失敗しました");
    } finally {
      setBusy(null);
    }
  }

  async function handleJournalizeAll() {
    const pending = records.filter((r) => r.status === "pending" && r.gross_salary > 0);
    if (pending.length === 0) return;
    if (!confirm(`未仕訳の ${pending.length} 件を一括で仕訳化しますか？`)) return;
    setBusy("all");
    setError(null);
    const errs: string[] = [];
    for (const r of pending) {
      try {
        await journalizePayroll(r.id);
      } catch (e) {
        errs.push(`${r.employee_name}: ${e instanceof Error ? e.message : "失敗"}`);
      }
    }
    if (errs.length) setError(errs.join(" / "));
    await fetchData();
    setBusy(null);
  }

  // 集計
  const totals = records.reduce(
    (acc, r) => {
      acc.gross += r.gross_salary;
      acc.deductions +=
        r.income_tax +
        r.resident_tax +
        r.health_insurance +
        r.pension_insurance +
        r.employment_insurance +
        r.other_deduction;
      acc.net += r.net_pay;
      return acc;
    },
    { gross: 0, deductions: 0, net: 0 }
  );
  const pendingCount = records.filter((r) => r.status === "pending" && r.gross_salary > 0).length;

  return (
    <div className="space-y-6">
      {/* ヘッダー */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Users className="size-6 text-primary" />
          <h1 className="text-xl font-bold">給与台帳</h1>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 ml-auto">
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className={inputCls + " w-auto shrink-0"}
            list="payroll-months"
          />
          <datalist id="payroll-months">
            {months.map((m) => (
              <option key={m} value={m.slice(0, 7)} />
            ))}
          </datalist>
          <Button onClick={openCreate} className="whitespace-nowrap">
            <Plus className="size-4" />
            給与を追加
          </Button>
        </div>
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
            <p className="text-xs text-muted-foreground">総支給額</p>
            <p className="text-lg font-bold tabular-nums">{formatCurrency(totals.gross)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground">控除合計（預り金）</p>
            <p className="text-lg font-bold tabular-nums">{formatCurrency(totals.deductions)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground">差引支給額</p>
            <p className="text-lg font-bold tabular-nums">{formatCurrency(totals.net)}</p>
          </CardContent>
        </Card>
      </div>

      {/* 一覧 */}
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">
            {month.slice(0, 7)} の給与（{records.length}件）
          </CardTitle>
          {pendingCount > 0 && (
            <Button size="sm" variant="outline" onClick={handleJournalizeAll} disabled={busy === "all"}>
              {busy === "all" ? <Loader2 className="size-4 animate-spin" /> : <Banknote className="size-4" />}
              未仕訳を一括仕訳化（{pendingCount}）
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="size-5 animate-spin mr-2" />
              読み込み中...
            </div>
          ) : records.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              この月の給与データはまだありません。「給与を追加」から登録してください。
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="text-left py-2 px-2">氏名</th>
                    <th className="text-left py-2 px-2">区分</th>
                    <th className="text-right py-2 px-2">総支給</th>
                    <th className="text-right py-2 px-2">控除合計</th>
                    <th className="text-right py-2 px-2">差引支給</th>
                    <th className="text-center py-2 px-2">状態</th>
                    <th className="text-right py-2 px-2">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => {
                    const ded =
                      r.income_tax +
                      r.resident_tax +
                      r.health_insurance +
                      r.pension_insurance +
                      r.employment_insurance +
                      r.other_deduction;
                    const isBusy = busy === r.id;
                    return (
                      <tr key={r.id} className="border-b border-border/50">
                        <td className="py-2 px-2 font-medium">{r.employee_name}</td>
                        <td className="py-2 px-2">
                          <Badge variant={r.employee_type === "officer" ? "default" : "muted"}>
                            {r.employee_type === "officer" ? "役員" : "従業員"}
                          </Badge>
                        </td>
                        <td className="py-2 px-2 text-right tabular-nums">{formatCurrency(r.gross_salary)}</td>
                        <td className="py-2 px-2 text-right tabular-nums">{formatCurrency(ded)}</td>
                        <td className="py-2 px-2 text-right tabular-nums font-medium">{formatCurrency(r.net_pay)}</td>
                        <td className="py-2 px-2 text-center">
                          {r.status === "journalized" ? (
                            <Badge variant="success">仕訳済</Badge>
                          ) : (
                            <Badge variant="warning">未仕訳</Badge>
                          )}
                        </td>
                        <td className="py-2 px-2">
                          <div className="flex items-center justify-end gap-1">
                            {r.status === "pending" ? (
                              <>
                                <button
                                  onClick={() => handleJournalize(r)}
                                  disabled={isBusy || r.gross_salary <= 0}
                                  title="仕訳化"
                                  className="p-1.5 rounded hover:bg-muted text-primary disabled:opacity-40"
                                >
                                  {isBusy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle className="size-4" />}
                                </button>
                                <button
                                  onClick={() => openEdit(r)}
                                  className="p-1.5 rounded hover:bg-muted text-muted-foreground"
                                  title="編集"
                                >
                                  <Pencil className="size-4" />
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => handleUnjournalize(r)}
                                disabled={isBusy}
                                title="仕訳化を取り消す"
                                className="p-1.5 rounded hover:bg-muted text-muted-foreground"
                              >
                                {isBusy ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
                              </button>
                            )}
                            <button
                              onClick={() => handleDelete(r)}
                              disabled={isBusy}
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
          <p className="mt-4 text-xs text-muted-foreground">
            仕訳化すると「借方 給与手当/役員報酬 ／ 貸方 預り金（控除合計）・普通預金（差引支給）」の仕訳を生成します。
            社会保険料の会社負担分（法定福利費）や預り金の納付仕訳は別途、仕訳入力から登録してください。
          </p>
        </CardContent>
      </Card>

      {/* 入力フォーム（モーダル） */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setShowForm(false)}>
          <div
            className="bg-card border border-border rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="font-bold">{editingId ? "給与を編集" : "給与を追加"}（{month.slice(0, 7)}）</h2>
              <button onClick={() => setShowForm(false)} className="p-1 rounded hover:bg-muted">
                <X className="size-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">氏名</label>
                  <input
                    value={form.employee_name}
                    onChange={(e) => setForm({ ...form, employee_name: e.target.value })}
                    className={inputCls}
                    placeholder="山田 太郎"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">区分</label>
                  <select
                    value={form.employee_type}
                    onChange={(e) => setForm({ ...form, employee_type: e.target.value as EmployeeType })}
                    className={inputCls}
                  >
                    <option value="employee">従業員（給与手当）</option>
                    <option value="officer">役員（役員報酬）</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  {/* どの月の給与かはこの欄で決める。
                      以前は画面上部の月選択が暗黙に使われ、登録先の月が分からなかった */}
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    支給月
                  </label>
                  <input
                    type="month"
                    value={form.pay_month}
                    onChange={(e) => setForm({ ...form, pay_month: e.target.value })}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    支給日<span className="text-muted-foreground">（任意）</span>
                  </label>
                  <DateInput allowEmpty value={form.pay_date}
                    onChange={(v) => setForm({ ...form, pay_date: v })}
                    className={inputCls + " pr-7"} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">総支給額</label>
                  <input
                    type="number"
                    value={form.gross_salary}
                    onChange={(e) => setForm({ ...form, gross_salary: e.target.value })}
                    className={inputCls + " text-right"}
                    placeholder="0"
                  />
                </div>
              </div>

              <div>
                <p className="text-xs font-bold text-muted-foreground mb-2">控除（本人負担）</p>
                <div className="grid grid-cols-2 gap-3">
                  {deductionFields.map((f) => (
                    <div key={f.key}>
                      <label className="block text-xs text-muted-foreground mb-1">{f.label}</label>
                      <input
                        type="number"
                        value={form[f.key] as string}
                        onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                        className={inputCls + " text-right"}
                        placeholder="0"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">メモ</label>
                <input
                  value={form.memo}
                  onChange={(e) => setForm({ ...form, memo: e.target.value })}
                  className={inputCls}
                  placeholder="（任意）"
                />
              </div>

              <div className="flex items-center justify-between rounded-lg bg-muted/40 px-4 py-3 text-sm">
                <span className="text-muted-foreground">差引支給額</span>
                <span className={"font-bold tabular-nums " + (formNet < 0 ? "text-destructive" : "")}>
                  {formatCurrency(formNet)}
                </span>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
              <Button variant="outline" onClick={() => setShowForm(false)}>
                キャンセル
              </Button>
              <Button onClick={handleSave} disabled={busy === "save"}>
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
