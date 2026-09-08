"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import { Home, Loader2, Plus, FileSpreadsheet, FileText, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency } from "@/lib/utils";
import { downloadCSV, printPage } from "@/lib/export";
import { currentFiscalStartYear, fiscalRangeFromStartYear } from "@/lib/fiscal";
import { useAuth } from "@/components/providers/auth-provider";
import { AlertTriangle } from "lucide-react";
import { getClient, updateClient } from "@/actions/clients";
import {
  getAllocatableAccounts,
  getPaymentAccounts,
  getAllocationRates,
  upsertAllocationRate,
  createAllocationJournal,
  getBatchAllocationPreview,
  runBatchAllocation,
  getAllocationReport,
  suggestAllocationRatios,
  type AllocatableAccount,
  type AllocationRate,
  type BatchAllocationRow,
  type AllocationReportRow,
} from "@/actions/allocations";
import { DateInput } from "@/components/ui/date-input";

interface Draft {
  ratio: string;
  note: string;
}

export default function AllocationsPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const isStaff =
    user?.role === "super_admin" || user?.role === "admin" || user?.role === "staff";

  // 会計年度（クライアントの決算月基準）
  const [fiscalStartMonth, setFiscalStartMonth] = useState(4);
  const currentFy = currentFiscalStartYear(fiscalStartMonth);
  const [fiscalYear, setFiscalYear] = useState(currentFy);
  // 決算月の読込後に対象年度を当年度へ合わせる（初回のみ）
  const fyInitedRef = useRef(false);

  const [accounts, setAccounts] = useState<AllocatableAccount[]>([]);
  const [paymentAccounts, setPaymentAccounts] = useState<AllocatableAccount[]>([]);
  const [rates, setRates] = useState<Record<string, AllocationRate>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  // 事業者区分（個人/法人）
  const [entityType, setEntityType] = useState<"individual" | "corporation" | null>(null);
  const [entitySaving, setEntitySaving] = useState(false);
  const isCorporation = entityType === "corporation";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [accs, payAccs, rateMap, client] = await Promise.all([
        getAllocatableAccounts(id),
        getPaymentAccounts(id),
        getAllocationRates(id, fiscalYear),
        getClient(id).catch(() => null),
      ]);
      setAccounts(accs);
      setPaymentAccounts(payAccs);
      setRates(rateMap);
      setEntityType((client as { entity_type?: "individual" | "corporation" | null } | null)?.entity_type ?? null);
      const sm = (client as { fiscal_year_start_month?: number } | null)?.fiscal_year_start_month ?? 4;
      setFiscalStartMonth(sm);
      // 初回のみ、対象年度を決算月基準の当年度へ補正
      if (!fyInitedRef.current) {
        fyInitedRef.current = true;
        setFiscalYear(currentFiscalStartYear(sm));
      }
      setDrafts({});
    } catch (e) {
      console.error("家事按分設定の取得に失敗:", e);
      setAccounts([]);
      setRates({});
    } finally {
      setLoading(false);
    }
  }, [id, fiscalYear]);

  async function handleEntityChange(value: string) {
    const next = value === "" ? null : (value as "individual" | "corporation");
    setEntityType(next);
    setEntitySaving(true);
    try {
      await updateClient(id, { entity_type: next });
    } catch (e) {
      alert(e instanceof Error ? e.message : "事業者区分の更新に失敗しました");
    } finally {
      setEntitySaving(false);
    }
  }

  // ---- 按分仕訳の作成フォーム ----
  const [jDate, setJDate] = useState(new Date().toISOString().slice(0, 10));
  const [jExpenseId, setJExpenseId] = useState("");
  const [jRatio, setJRatio] = useState("");
  const [jAmount, setJAmount] = useState("");
  const [jPaymentId, setJPaymentId] = useState("");
  const [jMemo, setJMemo] = useState("");
  const [jSaving, setJSaving] = useState(false);

  // 費用科目を選んだら設定済みの按分率を初期表示
  const onSelectExpense = (accountId: string) => {
    setJExpenseId(accountId);
    const r = rates[accountId];
    setJRatio(r ? String(r.business_ratio) : "");
  };

  const jTotal = Number(jAmount) || 0;
  const jRatioNum = jRatio === "" ? 0 : Number(jRatio);
  const jBusiness = Math.round((jTotal * jRatioNum) / 100);
  const jPrivate = jTotal - jBusiness;

  // ---- 期末一括按分 ----
  const [batchRows, setBatchRows] = useState<BatchAllocationRow[] | null>(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);

  // 年度変更時はプレビューをリセット
  useEffect(() => {
    setBatchRows(null);
  }, [fiscalYear]);

  async function loadBatchPreview() {
    setBatchLoading(true);
    try {
      setBatchRows(await getBatchAllocationPreview(id, fiscalYear));
    } catch (e) {
      alert(e instanceof Error ? e.message : "集計に失敗しました");
    } finally {
      setBatchLoading(false);
    }
  }

  async function runBatch() {
    if (!confirm(`${fiscalYear}年度の期末一括按分仕訳を作成しますか？`)) return;
    setBatchRunning(true);
    try {
      const { count } = await runBatchAllocation(id, fiscalYear);
      alert(`期末一括按分仕訳を作成しました（対象${count}科目・下書き）。帳簿で確認できます。`);
      await loadBatchPreview();
    } catch (e) {
      alert(e instanceof Error ? e.message : "作成に失敗しました");
    } finally {
      setBatchRunning(false);
    }
  }

  // ---- 実績集計レポート（B案） ----
  const [reportRows, setReportRows] = useState<AllocationReportRow[] | null>(null);
  const [reportLoading, setReportLoading] = useState(false);

  useEffect(() => {
    setReportRows(null);
  }, [fiscalYear]);

  async function loadReport() {
    setReportLoading(true);
    try {
      setReportRows(await getAllocationReport(id, fiscalYear));
    } catch (e) {
      alert(e instanceof Error ? e.message : "集計に失敗しました");
    } finally {
      setReportLoading(false);
    }
  }

  function handleReportCsv() {
    if (!reportRows || reportRows.length === 0) {
      alert("出力するデータがありません");
      return;
    }
    downloadCSV(
      `家事按分実績_${fiscalYear}年度.csv`,
      ["コード", "勘定科目", "按分率(%)", "総額", "事業分", "私用分", "按分根拠"],
      reportRows.map((r) => [r.code, r.name, r.ratio, r.total, r.business, r.private, r.note ?? ""])
    );
  }

  async function createJournal() {
    if (!jExpenseId) { alert("費用科目を選択してください"); return; }
    if (!jPaymentId) { alert("支払元の科目を選択してください"); return; }
    if (!(jTotal > 0)) { alert("取引金額を入力してください"); return; }
    if (jRatioNum < 0 || jRatioNum > 100) { alert("按分率は0〜100で入力してください"); return; }
    setJSaving(true);
    try {
      await createAllocationJournal(id, {
        date: jDate,
        expenseAccountId: jExpenseId,
        paymentAccountId: jPaymentId,
        totalAmount: jTotal,
        businessRatio: jRatioNum,
        memo: jMemo,
      });
      alert("按分仕訳を作成しました（下書き）。仕訳入力・帳簿で確認できます。");
      setJAmount("");
      setJMemo("");
    } catch (e) {
      alert(e instanceof Error ? e.message : "仕訳の作成に失敗しました");
    } finally {
      setJSaving(false);
    }
  }

  useEffect(() => {
    load();
  }, [load]);

  const ratioValue = (accountId: string) =>
    drafts[accountId]?.ratio !== undefined
      ? drafts[accountId].ratio
      : rates[accountId] && rates[accountId].business_ratio > 0
        ? String(rates[accountId].business_ratio)
        : ""; // 0%は未設定と同じ扱い（薄いプレースホルダー表示）
  const noteValue = (accountId: string) =>
    drafts[accountId]?.note !== undefined
      ? drafts[accountId].note
      : rates[accountId]?.basis_note ?? "";

  const setDraft = (accountId: string, patch: Partial<Draft>) =>
    setDrafts((p) => ({
      ...p,
      [accountId]: {
        ratio: p[accountId]?.ratio ?? (rates[accountId] ? String(rates[accountId].business_ratio) : ""),
        note: p[accountId]?.note ?? (rates[accountId]?.basis_note ?? ""),
        ...patch,
      },
    }));

  async function saveRow(accountId: string) {
    // 未編集（下書きが無い）なら何もしない（blur時の無駄な保存を防ぐ）
    if (drafts[accountId] === undefined) return;
    const ratioStr = ratioValue(accountId).trim();
    const note = noteValue(accountId).trim();
    const ratio = ratioStr === "" ? 0 : Number(ratioStr);
    if (Number.isNaN(ratio) || ratio < 0 || ratio > 100) {
      alert("按分率は0〜100の数値で入力してください");
      return;
    }
    setSavingId(accountId);
    try {
      await upsertAllocationRate(id, fiscalYear, accountId, ratio, note || null);
      setRates((p) => ({
        ...p,
        [accountId]: { account_id: accountId, business_ratio: ratio, basis_note: note || null },
      }));
      setDrafts((p) => {
        const n = { ...p };
        delete n[accountId];
        return n;
      });
    } catch (e) {
      alert(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSavingId(null);
    }
  }

  const years = Array.from({ length: 5 }, (_, i) => currentFy - i);

  // ---- AI按分提案 ----
  const [aiSuggesting, setAiSuggesting] = useState(false);
  async function handleAiSuggest() {
    if (!confirm("AIが業種・科目名から按分率の目安を提案し、各科目の按分率・根拠を上書きします。よろしいですか？（あくまで参考値です。税務判断は税理士が確認してください）")) return;
    setAiSuggesting(true);
    try {
      const suggestions = await suggestAllocationRatios(id);
      if (suggestions.length === 0) {
        alert("提案が得られませんでした");
        return;
      }
      await Promise.all(
        suggestions.map((s) => upsertAllocationRate(id, fiscalYear, s.account_id, s.ratio, s.reason))
      );
      await load();
      alert(`AI提案を反映しました（${suggestions.length}科目）。内容を確認・調整してください。`);
    } catch (e) {
      alert(e instanceof Error ? e.message : "AI提案に失敗しました");
    } finally {
      setAiSuggesting(false);
    }
  }

  function handleCsvExport() {
    const rows = accounts
      .filter((a) => rates[a.id])
      .map((a) => [a.code, a.name, rates[a.id].business_ratio, rates[a.id].basis_note ?? ""]);
    if (rows.length === 0) {
      alert("出力する按分設定がありません");
      return;
    }
    downloadCSV(
      `家事按分設定_${fiscalYear}年度.csv`,
      ["コード", "勘定科目", "按分率(%)", "按分根拠"],
      rows
    );
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Home className="size-6 text-primary" />
            家事按分設定
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            自宅兼事務所の経費を事業使用割合で按分するための、科目ごとの按分率を設定します。
          </p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <Button variant="outline" size="sm" onClick={handleCsvExport}>
            <FileSpreadsheet className="size-4" />
            CSV出力
          </Button>
          <Button variant="outline" size="sm" onClick={() => printPage()}>
            <FileText className="size-4" />
            PDF出力
          </Button>
        </div>
      </div>

      {/* 年度選択 */}
      <Card className="mb-4 w-fit">
        <CardContent className="py-2.5 px-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground font-bold">対象年度:</label>
            <select
              value={fiscalYear}
              onChange={(e) => setFiscalYear(Number(e.target.value))}
              className="px-2 py-1 rounded-lg border border-border bg-card text-foreground text-sm"
            >
              {years.map((y) => {
                const { startDate, endDate } = fiscalRangeFromStartYear(fiscalStartMonth, y);
                return (
                  <option key={y} value={y}>
                    {y}年度（{startDate.slice(0, 7).replace("-", "/")}〜{endDate.slice(0, 7).replace("-", "/")}）
                  </option>
                );
              })}
            </select>
          </div>
        </CardContent>
      </Card>

      {/* 事業者区分 */}
      {!loading && (
        <Card className="mb-4 w-fit">
          <CardContent className="py-2.5 px-3">
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground font-bold">事業者区分:</label>
              {isStaff ? (
                <select
                  value={entityType ?? ""}
                  onChange={(e) => handleEntityChange(e.target.value)}
                  disabled={entitySaving}
                  className="px-2 py-1 rounded-lg border border-border bg-card text-foreground text-sm"
                >
                  <option value="">未設定（個人事業主として扱う）</option>
                  <option value="individual">個人事業主</option>
                  <option value="corporation">法人</option>
                </select>
              ) : (
                <span className="text-sm">{isCorporation ? "法人" : "個人事業主"}</span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 法人は家事按分の対象外（注意喚起） */}
      {!loading && isCorporation && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="py-4">
            <div className="flex items-start gap-2">
              <AlertTriangle className="size-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-bold text-foreground mb-1">法人では家事按分は使用できません</p>
                <p className="text-muted-foreground">
                  家事按分は個人事業主向けの制度です。法人は「自宅の一部を会社に賃貸借」「業務使用分の精算」など
                  契約・精算ベースで処理します（役員の自宅費用を安易に会社負担とすると役員給与認定のリスク）。
                  個人事業主の場合は、上の事業者区分を「個人事業主」に変更してください。
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {!isStaff && !isCorporation && (
        <p className="mb-3 text-xs text-muted-foreground">
          ※ 按分率の設定は税理士が行います（閲覧のみ）。
        </p>
      )}

      {isStaff && !loading && !isCorporation && (
        <div className="mb-3 flex items-center gap-3 print:hidden">
          <Button variant="outline" size="sm" onClick={handleAiSuggest} disabled={aiSuggesting}>
            {aiSuggesting ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            AIに按分率を提案させる
          </Button>
          <span className="text-xs text-muted-foreground">※ 提案は参考値です。税務判断は税理士がご確認ください。</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-border p-12 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          <span className="text-sm">読み込み中...</span>
        </div>
      ) : isCorporation ? null : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/20 border-b border-border">
                <th className="text-left px-3 py-2 text-xs font-bold text-muted-foreground">勘定科目</th>
                <th className="text-right px-3 py-2 text-xs font-bold text-muted-foreground w-36">按分率（%）</th>
                <th className="text-left px-3 py-2 text-xs font-bold text-muted-foreground">按分根拠メモ</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.id} className="border-b border-border/50 hover:bg-muted/10">
                  <td className="px-3 py-1.5 text-foreground">
                    <span className="font-mono text-xs text-muted-foreground mr-2">{a.code}</span>
                    {a.name}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {isStaff ? (
                      <span className="inline-flex items-center justify-end gap-1.5">
                        {savingId === a.id && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={ratioValue(a.id)}
                          onChange={(e) => setDraft(a.id, { ratio: e.target.value })}
                          onBlur={() => saveRow(a.id)}
                          placeholder="0"
                          className="w-24 px-2 py-1 rounded border border-border bg-card text-foreground text-sm text-right no-spinner"
                        />
                      </span>
                    ) : (
                      <span className="font-mono">{rates[a.id] && rates[a.id].business_ratio > 0 ? `${rates[a.id].business_ratio}%` : "-"}</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    {isStaff ? (
                      <input
                        type="text"
                        value={noteValue(a.id)}
                        onChange={(e) => setDraft(a.id, { note: e.target.value })}
                        onBlur={() => saveRow(a.id)}
                        placeholder="例: 床面積20㎡中8㎡を事業利用"
                        className="w-full px-2 py-1 rounded border border-border bg-card text-foreground text-sm"
                      />
                    ) : (
                      <span className="text-muted-foreground">{rates[a.id]?.basis_note ?? "-"}</span>
                    )}
                  </td>
                </tr>
              ))}
              {accounts.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-12 text-center text-muted-foreground">
                    費用科目がありません
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {!isCorporation && (
        <p className="mt-3 text-xs text-muted-foreground">
          ※ 按分率は事業使用割合です（例: 40% → 経費40%・私用60%）。私用分は「事業主貸」へ振り替わります。
        </p>
      )}

      {/* 按分仕訳の作成（税理士のみ） */}
      {isStaff && !loading && !isCorporation && (
        <Card className="mt-6 print:hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Plus className="size-5 text-primary" />
              家事按分仕訳の作成
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-muted-foreground mb-1">日付</label>
                <DateInput allowEmpty value={jDate} onChange={(v) => setJDate(v)} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm pr-7" />
              </div>
              <div>
                <label className="block text-xs font-bold text-muted-foreground mb-1">費用科目</label>
                <select value={jExpenseId} onChange={(e) => onSelectExpense(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm">
                  <option value="">選択してください</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.code} {a.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-muted-foreground mb-1">按分率（%）</label>
                <input type="number" min={0} max={100} value={jRatio} onChange={(e) => setJRatio(e.target.value)} placeholder="40" className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm no-spinner" />
              </div>
              <div>
                <label className="block text-xs font-bold text-muted-foreground mb-1">取引金額（税込）</label>
                <input type="number" min={0} value={jAmount} onChange={(e) => setJAmount(e.target.value)} placeholder="11000" className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm text-right no-spinner" />
              </div>
              <div>
                <label className="block text-xs font-bold text-muted-foreground mb-1">支払元（貸方）</label>
                <select value={jPaymentId} onChange={(e) => setJPaymentId(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm">
                  <option value="">選択してください</option>
                  {paymentAccounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.code} {a.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-muted-foreground mb-1">摘要（任意）</label>
                <input type="text" value={jMemo} onChange={(e) => setJMemo(e.target.value)} placeholder="例: 電気代 6月分" className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm" />
              </div>
            </div>

            {/* プレビュー */}
            <div className="mt-4 rounded-lg border border-border bg-muted/10 p-3 text-sm">
              <div className="flex flex-wrap gap-x-8 gap-y-1">
                <span>事業分（経費）: <span className="font-mono font-bold text-foreground">{formatCurrency(jBusiness)}</span></span>
                <span>私用分（事業主貸）: <span className="font-mono font-bold text-foreground">{formatCurrency(jPrivate)}</span></span>
                <span className="text-muted-foreground">合計: <span className="font-mono">{formatCurrency(jTotal)}</span></span>
              </div>
              <p className={cn("mt-2 text-xs text-muted-foreground")}>
                仕訳: （借）費用 {formatCurrency(jBusiness)} ／（借）事業主貸 {formatCurrency(jPrivate)} ／（貸）支払元 {formatCurrency(jTotal)}
              </p>
            </div>

            <div className="mt-4 flex justify-end">
              <Button onClick={createJournal} disabled={jSaving}>
                {jSaving ? <><Loader2 className="size-4 animate-spin" />作成中...</> : <><Plus className="size-4" />按分仕訳を作成</>}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 期末一括按分（税理士のみ） */}
      {isStaff && !loading && !isCorporation && (
        <Card className="mt-6 print:hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Home className="size-5 text-primary" />
              期末一括按分（{fiscalYear}年度）
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-3">
              期中は全額を経費計上しておき、期末にまとめて按分する運用です。対象年度の科目別合計を集計し、
              私用分を「事業主貸」へ一括振替する調整仕訳（期末日付）を作成します。
            </p>
            <div className="mb-4">
              <Button variant="outline" size="sm" onClick={loadBatchPreview} disabled={batchLoading}>
                {batchLoading ? <Loader2 className="size-4 animate-spin" /> : null}
                集計を表示
              </Button>
            </div>

            {batchRows !== null && (
              batchRows.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">按分対象の実績がありません（按分率の設定と期中の取引をご確認ください）。</p>
              ) : (
                <>
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/20 border-b border-border">
                          <th className="text-left px-3 py-2 text-xs font-bold text-muted-foreground">勘定科目</th>
                          <th className="text-right px-3 py-2 text-xs font-bold text-muted-foreground">期中合計</th>
                          <th className="text-right px-3 py-2 text-xs font-bold text-muted-foreground">按分率</th>
                          <th className="text-right px-3 py-2 text-xs font-bold text-muted-foreground">事業分</th>
                          <th className="text-right px-3 py-2 text-xs font-bold text-muted-foreground">私用分→事業主貸</th>
                        </tr>
                      </thead>
                      <tbody>
                        {batchRows.map((r) => (
                          <tr key={r.account_id} className="border-b border-border/50">
                            <td className="px-3 py-1.5 text-foreground">
                              <span className="font-mono text-xs text-muted-foreground mr-2">{r.code}</span>{r.name}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono">{formatCurrency(r.total)}</td>
                            <td className="px-3 py-1.5 text-right font-mono">{r.ratio}%</td>
                            <td className="px-3 py-1.5 text-right font-mono">{formatCurrency(r.business)}</td>
                            <td className="px-3 py-1.5 text-right font-mono font-bold">{formatCurrency(r.private)}</td>
                          </tr>
                        ))}
                        <tr className="bg-muted/20 border-t border-border font-bold">
                          <td className="px-3 py-2">合計（事業主貸へ振替）</td>
                          <td className="px-3 py-2 text-right font-mono">{formatCurrency(batchRows.reduce((s, r) => s + r.total, 0))}</td>
                          <td />
                          <td className="px-3 py-2 text-right font-mono">{formatCurrency(batchRows.reduce((s, r) => s + r.business, 0))}</td>
                          <td className="px-3 py-2 text-right font-mono">{formatCurrency(batchRows.reduce((s, r) => s + r.private, 0))}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-4 flex justify-end">
                    <Button onClick={runBatch} disabled={batchRunning}>
                      {batchRunning ? <><Loader2 className="size-4 animate-spin" />作成中...</> : <><Plus className="size-4" />一括按分仕訳を作成</>}
                    </Button>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    ※ 期末日（{fiscalRangeFromStartYear(fiscalStartMonth, fiscalYear).endDate}）付の下書き仕訳を作成します。同年度で重複作成はできません（二重按分防止）。
                  </p>
                </>
              )
            )}
          </CardContent>
        </Card>
      )}

      {/* 実績集計レポート */}
      {!isCorporation && (
      <Card className="mt-6">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="size-5 text-primary" />
              按分実績レポート（{fiscalYear}年度）
            </CardTitle>
            <div className="flex items-center gap-2 print:hidden">
              <Button variant="outline" size="sm" onClick={loadReport} disabled={reportLoading}>
                {reportLoading ? <Loader2 className="size-4 animate-spin" /> : null}
                集計
              </Button>
              {reportRows && reportRows.length > 0 && (
                <Button variant="outline" size="sm" onClick={handleReportCsv}>
                  <FileSpreadsheet className="size-4" />
                  CSV出力
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-3">
            対象年度の実際の仕訳から、科目別に総額・事業分・私用分を集計します（確定申告・税務調査の説明資料）。
          </p>
          {reportRows === null ? (
            <p className="text-sm text-muted-foreground py-2">「集計」を押すと実績を表示します。</p>
          ) : reportRows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">対象の実績がありません（按分率の設定と期中の取引をご確認ください）。</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/20 border-b border-border">
                    <th className="text-left px-3 py-2 text-xs font-bold text-muted-foreground">勘定科目</th>
                    <th className="text-right px-3 py-2 text-xs font-bold text-muted-foreground">按分率</th>
                    <th className="text-right px-3 py-2 text-xs font-bold text-muted-foreground">総額</th>
                    <th className="text-right px-3 py-2 text-xs font-bold text-muted-foreground">事業分</th>
                    <th className="text-right px-3 py-2 text-xs font-bold text-muted-foreground">私用分</th>
                    <th className="text-left px-3 py-2 text-xs font-bold text-muted-foreground">按分根拠</th>
                  </tr>
                </thead>
                <tbody>
                  {reportRows.map((r) => (
                    <tr key={r.account_id} className="border-b border-border/50">
                      <td className="px-3 py-1.5 text-foreground">
                        <span className="font-mono text-xs text-muted-foreground mr-2">{r.code}</span>{r.name}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono">{r.ratio}%</td>
                      <td className="px-3 py-1.5 text-right font-mono">{formatCurrency(r.total)}</td>
                      <td className="px-3 py-1.5 text-right font-mono">{formatCurrency(r.business)}</td>
                      <td className="px-3 py-1.5 text-right font-mono font-bold">{formatCurrency(r.private)}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{r.note ?? "-"}</td>
                    </tr>
                  ))}
                  <tr className="bg-muted/20 border-t border-border font-bold">
                    <td className="px-3 py-2">合計</td>
                    <td />
                    <td className="px-3 py-2 text-right font-mono">{formatCurrency(reportRows.reduce((s, r) => s + r.total, 0))}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatCurrency(reportRows.reduce((s, r) => s + r.business, 0))}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatCurrency(reportRows.reduce((s, r) => s + r.private, 0))}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      )}
    </>
  );
}
