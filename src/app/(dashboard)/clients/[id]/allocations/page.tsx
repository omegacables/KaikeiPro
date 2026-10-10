"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { Home, Loader2, Plus, FileSpreadsheet, FileText, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AmountInput } from "@/components/ui/amount-input";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency } from "@/lib/utils";
import { downloadCSV, printPage } from "@/lib/export";
import { useFiscalPeriods } from "@/lib/use-fiscal-periods";
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
  getPrivateUseSetup,
  type AllocatableAccount,
  type AllocationRate,
  type BatchAllocationPreview,
  type AllocationReportRow,
} from "@/actions/allocations";
import { DateInput } from "@/components/ui/date-input";
import { useClientRole } from "@/lib/use-client-role";

interface Draft {
  ratio: string;
  note: string;
}

export default function AllocationsPage() {
  const { id } = useParams<{ id: string }>();
  // 按分率は、閲覧専用以外なら誰でも設定できる（税理士・スタッフ・社長・社員）
  const clientRole = useClientRole(id);
  const isStaff = clientRole?.canWrite ?? false;

  // 会計年度（クライアントの決算月基準）
  // 期の選択肢（決算月を変えた年の変則期間も記録どおり）。期は期首日で指定する
  const { options: fiscalOptions, current: currentPeriod } = useFiscalPeriods(id, { past: 4, future: 1 });
  const [periodKey, setPeriodKey] = useState("");
  const selectedPeriod = fiscalOptions.find((o) => o.key === periodKey) ?? currentPeriod;
  const fiscalYear = selectedPeriod?.key ?? "";
  const fyLabel = selectedPeriod ? `${selectedPeriod.startDate.slice(0, 4)}年度${selectedPeriod.short ? "（変則期間）" : ""}` : "";

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
  // 私用分の振替先（個人: 事業主貸、法人: 役員貸付金など）
  const [destinations, setDestinations] = useState<AllocatableAccount[]>([]);
  const [destId, setDestId] = useState("");
  const destName = destinations.find((d) => d.id === destId)?.name ?? (isCorporation ? "役員貸付金" : "事業主貸");
  const term = isCorporation
    ? { title: "役員の私的利用分の按分", ratio: "業務割合", business: "業務分", private: "私的利用分", doc: "役員の私的利用分" }
    : { title: "家事按分設定", ratio: "按分率", business: "事業分", private: "私用分", doc: "家事按分" };

  useEffect(() => {
    getPrivateUseSetup(id)
      .then((s) => {
        setDestinations(s.destinations);
        setDestId(s.defaultDestinationId ?? s.destinations[0]?.id ?? "");
      })
      .catch(() => setDestinations([]));
  }, [id, entityType]);

  const load = useCallback(async () => {
    if (!fiscalYear) return;
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
  const [batchPreview, setBatchPreview] = useState<BatchAllocationPreview | null>(null);
  const batchRows = batchPreview?.rows ?? null;
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);

  // 年度変更時はプレビューをリセット
  useEffect(() => {
    setBatchPreview(null);
  }, [fiscalYear, entityType]);

  async function loadBatchPreview() {
    setBatchLoading(true);
    try {
      setBatchPreview(await getBatchAllocationPreview(id, fiscalYear));
    } catch (e) {
      alert(e instanceof Error ? e.message : "集計に失敗しました");
    } finally {
      setBatchLoading(false);
    }
  }

  async function runBatch() {
    if (!confirm(`${fyLabel}の期末一括按分仕訳を作成しますか？`)) return;
    setBatchRunning(true);
    try {
      const { count } = await runBatchAllocation(id, fiscalYear, destId || null);
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
      `${term.doc}実績_${fiscalYear}.csv`,
      ["コード", "勘定科目", `${term.ratio}(%)`, "総額", term.business, term.private, "按分根拠"],
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
        destinationAccountId: destId || null,
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
      `${term.doc}設定_${fiscalYear}.csv`,
      ["コード", "勘定科目", `${term.ratio}(%)`, "按分根拠"],
      rows
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Home className="size-6 text-primary" />
            {term.title}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {isCorporation
              ? "社宅・車両・携帯電話など、役員が私的にも使う費用を、業務に使う割合で分けます。私的に使った分は経費から外し、役員貸付金などへ振り替えます。"
              : "自宅兼事務所の経費を事業使用割合で按分するための、科目ごとの按分率を設定します。"}
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
              onChange={(e) => setPeriodKey(e.target.value)}
              className="px-2 py-1 rounded-lg border border-border bg-card text-foreground text-sm"
            >
              {fiscalOptions.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
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

      {/* 法人: 役員の私的利用分の説明と振替先 */}
      {!loading && (
        <Card className="mb-4">
          <CardContent className="py-3 px-4 space-y-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs text-muted-foreground font-bold">{term.private}の振替先:</label>
              <select
                value={destId}
                onChange={(e) => setDestId(e.target.value)}
                disabled={!isStaff || destinations.length <= 1}
                className="px-2 py-1 rounded-lg border border-border bg-card text-foreground text-sm"
              >
                {destinations.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.code} {d.name}
                  </option>
                ))}
              </select>
            </div>
            {isCorporation && (
              <p className="text-xs text-muted-foreground">
                役員貸付金は「会社が役員にお金を貸している」扱いで、役員が会社に返します。返さないままにすると、役員の給与（役員報酬）とみなされ、
                毎月同じ額でない場合は会社の経費にならず、源泉所得税もかかることがあります。社宅は、役員から家賃相当額を受け取る形（借上社宅）も検討してください。
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {clientRole && !clientRole.canWrite && (
        <p className="mb-3 text-xs text-muted-foreground">
          ※ このアカウントは閲覧専用のため、按分率は変更できません。
        </p>
      )}

      {isStaff && !loading && (
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
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/20 border-b border-border">
                <th className="text-left px-3 py-2 text-xs font-bold text-muted-foreground">勘定科目</th>
                <th className="text-right px-3 py-2 text-xs font-bold text-muted-foreground w-36">{term.ratio}（%）</th>
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

      <p className="mt-3 text-xs text-muted-foreground">
        ※ {term.ratio}は{isCorporation ? "業務に使う" : "事業に使う"}割合です（例: 40% → 経費40%・{term.private}60%）。{term.private}は「{destName}」へ振り替わります。
        私用分を経費から外す行には元の仕訳と同じ税区分を付けるので、私用分は消費税の控除（仕入税額控除）からも外れます。
      </p>

      {/* 按分仕訳の作成（税理士のみ） */}
      {isStaff && !loading && (
        <Card className="mt-6 print:hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Plus className="size-5 text-primary" />
              {isCorporation ? "按分仕訳の作成（1件ずつ）" : "家事按分仕訳の作成"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-muted-foreground mb-1">日付</label>
                <DateInput allowEmpty value={jDate} onChange={(v) => setJDate(v)} className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm" />
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
                <label className="block text-xs font-bold text-muted-foreground mb-1">{term.ratio}（%）</label>
                <input type="number" min={0} max={100} value={jRatio} onChange={(e) => setJRatio(e.target.value)} placeholder="40" className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm no-spinner" />
              </div>
              <div>
                <label className="block text-xs font-bold text-muted-foreground mb-1">取引金額（税込）</label>
                <AmountInput value={jAmount} onChange={setJAmount} placeholder="11000" className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm text-right" />
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
                <span>{term.business}（経費）: <span className="font-mono font-bold text-foreground">{formatCurrency(jBusiness)}</span></span>
                <span>{term.private}（{destName}）: <span className="font-mono font-bold text-foreground">{formatCurrency(jPrivate)}</span></span>
                <span className="text-muted-foreground">合計: <span className="font-mono">{formatCurrency(jTotal)}</span></span>
              </div>
              <p className={cn("mt-2 text-xs text-muted-foreground")}>
                仕訳: （借）費用 {formatCurrency(jBusiness)} ／（借）{destName} {formatCurrency(jPrivate)} ／（貸）支払元 {formatCurrency(jTotal)}
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
      {isStaff && !loading && (
        <Card className="mt-6 print:hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Home className="size-5 text-primary" />
              期末一括按分（{fyLabel}）
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-3">
              期中は全額を経費計上しておき、期末にまとめて按分する運用です。対象年度の科目別合計を集計し、
              {term.private}を「{destName}」へ一括振替する調整仕訳（期末日付）を作成します。
              期中に1件ずつ按分仕訳を作った科目は、二重に按分しないよう{term.ratio}を空にしてください。
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
                          <th className="text-right px-3 py-2 text-xs font-bold text-muted-foreground">{term.ratio}</th>
                          <th className="text-right px-3 py-2 text-xs font-bold text-muted-foreground">{term.business}</th>
                          <th className="text-right px-3 py-2 text-xs font-bold text-muted-foreground">{term.private}→{destName}</th>
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
                          <td className="px-3 py-2">合計（{destName}へ振替）</td>
                          <td className="px-3 py-2 text-right font-mono">{formatCurrency(batchRows.reduce((s, r) => s + r.total, 0))}</td>
                          <td />
                          <td className="px-3 py-2 text-right font-mono">{formatCurrency(batchRows.reduce((s, r) => s + r.business, 0))}</td>
                          <td className="px-3 py-2 text-right font-mono">{formatCurrency(batchRows.reduce((s, r) => s + r.private, 0))}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  {batchPreview && batchPreview.inputTax > 0 && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      税抜経理の仕訳から来た{term.private}の消費税 {formatCurrency(batchPreview.inputTax)} も仮払消費税から減らし、
                      「{destName}」へは税込の {formatCurrency(batchPreview.transfer)} を振り替えます。
                    </p>
                  )}
                  {batchPreview?.posted && (
                    <p className="mt-2 text-sm text-success">この年度の一括按分仕訳は作成済みです（帳簿で確認できます）。</p>
                  )}
                  <div className="mt-4 flex justify-end">
                    <Button onClick={runBatch} disabled={batchRunning || Boolean(batchPreview?.posted)}>
                      {batchRunning ? <><Loader2 className="size-4 animate-spin" />作成中...</> : <><Plus className="size-4" />一括按分仕訳を作成</>}
                    </Button>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    ※ 期末日（{batchPreview?.period.endDate}）付の下書き仕訳を作成します。同年度で重複作成はできません（二重按分防止）。
                  </p>
                </>
              )
            )}
          </CardContent>
        </Card>
      )}

      {/* 実績集計レポート */}
      <Card className="mt-6">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="size-5 text-primary" />
              {term.doc}の実績レポート（{fyLabel}）
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
            対象年度の実際の仕訳から、科目別に総額・{term.business}・{term.private}を集計します（{isCorporation ? "決算・税務調査" : "確定申告・税務調査"}の説明資料）。
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
                    <th className="text-right px-3 py-2 text-xs font-bold text-muted-foreground">{term.ratio}</th>
                    <th className="text-right px-3 py-2 text-xs font-bold text-muted-foreground">総額</th>
                    <th className="text-right px-3 py-2 text-xs font-bold text-muted-foreground">{term.business}</th>
                    <th className="text-right px-3 py-2 text-xs font-bold text-muted-foreground">{term.private}</th>
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
    </>
  );
}
