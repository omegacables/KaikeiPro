"use client";

/**
 * 定期仕訳（毎月くり返す仕訳）。
 * 家賃・リース料・顧問料・保険料・役員報酬・ローン返済・サブスク料金・家賃収入など、
 * 毎月同じ形の取引を一度登録しておき、まだ作っていない月の仕訳をまとめて下書きで作る。
 * どの月を作るか・計上日は src/lib/recurring-journals.ts（画面とサーバーで同じ計算を使う）。
 */

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Repeat, Plus, Trash2, Loader2, Pencil, X, Search, Check, Pause, AlertTriangle, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AccountLookup, type AccountOption } from "@/components/ui/account-lookup";
import { AmountInput } from "@/components/ui/amount-input";
import { DateInput } from "@/components/ui/date-input";
import { MonthInput } from "@/components/ui/month-input";
import { SubAccountInput, TaxCategorySelect, EMPTY_SUB, type LineSub } from "@/components/journal/line-fields";
import { cn, formatCurrency } from "@/lib/utils";
import { useData } from "@/lib/use-data";
import { useClientRole } from "@/lib/use-client-role";
import { handleBarKeyNav } from "@/lib/key-nav";
import { toJstDate } from "@/lib/fiscal";
import { defaultTaxCategory } from "@/lib/tax-category";
import {
  END_OF_MONTH,
  INTERVAL_OPTIONS,
  dayOfMonthLabel,
  intervalLabel,
  monthLabel,
  nextMonthToCreate,
  pendingMonths,
  postingDateOf,
  validateRecurringInput,
  type RecurringJournalInput,
  type RecurringLine,
  type RecurringSchedule,
} from "@/lib/recurring-journals";
import {
  listRecurringJournals,
  saveRecurringJournal,
  deleteRecurringJournal,
  setRecurringJournalActive,
  generateRecurringJournals,
  searchJournalsForRecurring,
  recurringDraftFromJournal,
  type RecurringJournal,
  type RecurringGenerationResult,
  type JournalForRecurring,
} from "@/actions/recurring-journals";
import { getAccounts } from "@/actions/accounts";
import { getSubAccounts, ensureSubAccounts, type SubAccount } from "@/actions/sub-accounts";

// ---------------------------------------------------------------------------
// 入力欄の形
// ---------------------------------------------------------------------------

/** 明細の1行（金額は入力途中の値を保つため文字列）。sub は補助科目、tax は税区分 */
type FormLine = {
  key: number;
  account: string;
  amount: string;
  sub: LineSub;
  tax: string;
  /** 既存の仕訳から写した用途区分・事業区分（科目を変えたら外す） */
  purchase_use?: RecurringLine["purchase_use"];
  business_type?: number | null;
};

type FormState = {
  /** 編集中の定期仕訳。新規は null */
  id: string | null;
  name: string;
  description: string;
  dayOfMonth: number;
  startMonth: string;
  endMonth: string;
  intervalMonths: number;
  debit: FormLine[];
  credit: FormLine[];
};

let lineSeq = 0;
const newLine = (over: Partial<FormLine> = {}): FormLine => ({
  key: ++lineSeq,
  account: "",
  amount: "",
  sub: EMPTY_SUB,
  tax: "",
  ...over,
});

const today = () => toJstDate(new Date().toISOString());

function emptyForm(): FormState {
  return {
    id: null,
    name: "",
    description: "",
    dayOfMonth: END_OF_MONTH,
    startMonth: today().slice(0, 7),
    endMonth: "",
    intervalMonths: 1,
    debit: [newLine()],
    credit: [newLine()],
  };
}

/** 保存済みの明細・下書きから入力欄へ */
function formFromInput(
  input: RecurringJournalInput,
  id: string | null,
  subName: (subId: string) => string
): FormState {
  const toLine = (l: RecurringLine, side: "debit" | "credit"): FormLine =>
    newLine({
      account: l.account_id,
      amount: String(side === "debit" ? l.debit_amount : l.credit_amount),
      sub: l.sub_account_id ? { id: l.sub_account_id, name: subName(l.sub_account_id) } : EMPTY_SUB,
      tax: l.tax_category ?? "",
      ...(l.purchase_use !== undefined ? { purchase_use: l.purchase_use } : {}),
      ...(l.business_type !== undefined ? { business_type: l.business_type } : {}),
    });
  const debit = input.lines.filter((l) => l.debit_amount > 0).map((l) => toLine(l, "debit"));
  const credit = input.lines.filter((l) => l.credit_amount > 0).map((l) => toLine(l, "credit"));
  return {
    id,
    name: input.name,
    description: input.description ?? "",
    dayOfMonth: input.dayOfMonth,
    startMonth: input.startMonth,
    endMonth: input.endMonth ?? "",
    intervalMonths: input.intervalMonths,
    debit: debit.length ? debit : [newLine()],
    credit: credit.length ? credit : [newLine()],
  };
}

/** 入力欄から保存する形へ */
function inputFromForm(f: FormState): RecurringJournalInput {
  const toLine = (l: FormLine, side: "debit" | "credit"): RecurringLine => {
    const amount = Number(l.amount) || 0;
    return {
      account_id: l.account,
      sub_account_id: l.sub.id,
      debit_amount: side === "debit" ? amount : 0,
      credit_amount: side === "credit" ? amount : 0,
      tax_category: l.tax || null,
      ...(l.purchase_use !== undefined ? { purchase_use: l.purchase_use } : {}),
      ...(l.business_type !== undefined ? { business_type: l.business_type } : {}),
    };
  };
  return {
    name: f.name,
    description: f.description,
    dayOfMonth: f.dayOfMonth,
    startMonth: f.startMonth,
    endMonth: f.endMonth || null,
    intervalMonths: f.intervalMonths,
    lines: [...f.debit.map((l) => toLine(l, "debit")), ...f.credit.map((l) => toLine(l, "credit"))],
  };
}

const scheduleOf = (r: Pick<RecurringJournal, "dayOfMonth" | "startMonth" | "endMonth" | "intervalMonths" | "isActive">): RecurringSchedule => ({
  dayOfMonth: r.dayOfMonth,
  startMonth: r.startMonth,
  endMonth: r.endMonth,
  intervalMonths: r.intervalMonths,
  isActive: r.isActive,
});

/** 月の並びを「2026年4月〜2026年10月」のように短く */
function monthsRange(months: string[]): string {
  if (months.length === 0) return "";
  const sorted = [...months].sort();
  return sorted.length === 1
    ? monthLabel(sorted[0])
    : `${monthLabel(sorted[0])}〜${monthLabel(sorted[sorted.length - 1])}`;
}

/** 結果の月を定期仕訳ごとにまとめる */
function groupByRecurring<T extends { recurringId: string; name: string; month: string }>(items: T[]) {
  const map = new Map<string, { recurringId: string; name: string; months: string[] }>();
  for (const it of items) {
    const g = map.get(it.recurringId) ?? { recurringId: it.recurringId, name: it.name, months: [] };
    g.months.push(it.month);
    map.set(it.recurringId, g);
  }
  return [...map.values()];
}

const inputClass = "w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm";

// ---------------------------------------------------------------------------
// 画面
// ---------------------------------------------------------------------------

export default function RecurringJournalsPage() {
  const { id } = useParams<{ id: string }>();
  // 閲覧専用のアカウントには登録・変更・作成を出さない（書き込みはデータベースでも止めている）。
  // 役割が分かるまでは出さない（閲覧専用の人に一瞬だけ操作が見えないように）
  const clientRole = useClientRole(id);
  const canWrite = clientRole?.canWrite ?? false;

  const { data: list, error: listError, refetch } = useData(
    () => listRecurringJournals(id),
    null as RecurringJournal[] | null,
    [id]
  );

  // 科目・補助科目（入力欄の候補）
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [subAccounts, setSubAccounts] = useState<SubAccount[]>([]);
  const loadSubAccounts = useCallback(() => {
    getSubAccounts(id).then(setSubAccounts).catch(() => setSubAccounts([]));
  }, [id]);
  useEffect(() => {
    if (!canWrite) return;
    getAccounts(id)
      .then((data) =>
        setAccounts(
          (data ?? []).map((a) => {
            const cat = a.account_categories as unknown as { type: string; name: string } | null;
            return { id: a.id, code: a.code, name: a.name, categoryType: cat?.type ?? "", categoryName: cat?.name ?? "" };
          })
        )
      )
      .catch(console.error);
    loadSubAccounts();
  }, [id, canWrite, loadSubAccounts]);

  // 保存・削除などが済んだことの知らせ（何も出ないと、もう一度押したくなる）
  const [notice, setNotice] = useState<string | null>(null);

  // ---- まとめて作成 ----
  const [through, setThrough] = useState(today);
  const pendingByRow = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const r of list ?? []) map.set(r.id, pendingMonths(scheduleOf(r), through, r.createdMonths));
    return map;
  }, [list, through]);
  const totalPending = [...pendingByRow.values()].reduce((s, m) => s + m.length, 0);
  const pendingRows = (list ?? []).filter((r) => (pendingByRow.get(r.id) ?? []).length > 0);

  const [generating, setGenerating] = useState(false);
  const generatingRef = useRef(false);
  const [genResult, setGenResult] = useState<RecurringGenerationResult | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  async function runGenerate() {
    // 連打は state では止まらない（反映が遅れる）ので ref で蓋をする
    if (generatingRef.current) return;
    const detail = pendingRows
      .map((r) => {
        const months = pendingByRow.get(r.id) ?? [];
        return `・${r.name}: ${monthsRange(months)}（${months.length}件）`;
      })
      .join("\n");
    if (!confirm(`まだ作っていない月の仕訳 ${totalPending}件を下書きで作ります。\n\n${detail}\n\nよろしいですか？`)) return;
    generatingRef.current = true;
    setGenerating(true);
    setGenError(null);
    setGenResult(null);
    try {
      setGenResult(await generateRecurringJournals(id, { through }));
      refetch();
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "仕訳の作成に失敗しました");
    } finally {
      generatingRef.current = false;
      setGenerating(false);
    }
  }

  // ---- 新規・編集 ----
  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const formRef = useRef<HTMLDivElement>(null);
  // 入力欄を開いたら画面に出す（一覧の下で開いたことに気づかないことがある）。描画の後に動かすため回数で知らせる
  const [formOpened, setFormOpened] = useState(0);
  useEffect(() => {
    if (formOpened) formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [formOpened]);

  const subNameOf = useCallback(
    (subId: string) => subAccounts.find((s) => s.id === subId)?.name ?? "",
    [subAccounts]
  );

  function openForm(next: FormState) {
    setForm(next);
    setFormError(null);
    setNotice(null);
    setPickerOpen(false);
    setFormOpened((n) => n + 1);
  }

  function openEdit(r: RecurringJournal) {
    openForm(
      formFromInput(
        {
          name: r.name,
          description: r.description,
          lines: r.lines,
          dayOfMonth: r.dayOfMonth,
          startMonth: r.startMonth,
          endMonth: r.endMonth,
          intervalMonths: r.intervalMonths,
        },
        r.id,
        (subId) => r.lines.find((l) => l.sub_account_id === subId)?.subAccountName ?? subNameOf(subId)
      )
    );
  }

  const updateForm = (patch: Partial<FormState>) => setForm((f) => (f ? { ...f, ...patch } : f));

  /** 明細の1行を変える。科目を変えたら、補助科目は外し、税区分はその科目の初期値にする（仕訳入力と同じ） */
  function updateLine(side: "debit" | "credit", key: number, patch: Partial<FormLine>) {
    setForm((f) => {
      if (!f) return f;
      const lines = f[side].map((l) => {
        if (l.key !== key) return l;
        if (patch.account === undefined || patch.account === l.account) return { ...l, ...patch };
        const acc = accounts.find((a) => a.id === patch.account);
        return {
          key: l.key,
          account: patch.account,
          amount: l.amount,
          sub: EMPTY_SUB,
          tax: acc ? defaultTaxCategory(acc.categoryType, acc.name) ?? "" : "",
        };
      });
      return { ...f, [side]: lines };
    });
  }
  const addLine = (side: "debit" | "credit") => setForm((f) => (f ? { ...f, [side]: [...f[side], newLine()] } : f));
  const removeLine = (side: "debit" | "credit", key: number) =>
    setForm((f) => (f ? { ...f, [side]: f[side].filter((l) => l.key !== key) } : f));

  async function save() {
    if (!form || savingRef.current) return;
    const input = inputFromForm(form);
    // サーバーでも同じ検査をするが、先に画面で止めて理由を出す
    const v = validateRecurringInput(input);
    if (!v.ok) {
      setFormError(v.message);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setFormError(null);
    try {
      // 手入力された補助科目名は、ここで補助科目として登録してIDにする（仕訳入力と同じ）。
      // 作ったIDは入力欄にも戻す。保存に失敗してやり直したとき、同じ名前で作り直そうとして止まらないように
      const all = [...form.debit, ...form.credit];
      // 金額の無い行（保存で落ちる行）の補助科目は作らない
      const toEnsure = all.map((l) => ({
        accountId: l.account,
        name: l.sub.id || !l.account || !(Number(l.amount) > 0) ? "" : l.sub.name,
      }));
      let current = form;
      if (toEnsure.some((t) => t.name.trim())) {
        const ids = await ensureSubAccounts(id, toEnsure);
        const withId = (l: FormLine, i: number): FormLine =>
          ids[i] ? { ...l, sub: { id: ids[i], name: l.sub.name.trim() } } : l;
        current = {
          ...form,
          debit: form.debit.map((l, i) => withId(l, i)),
          credit: form.credit.map((l, i) => withId(l, form.debit.length + i)),
        };
        setForm(current);
        loadSubAccounts();
      }
      const saved = inputFromForm(current);
      await saveRecurringJournal(id, saved, current.id);
      setNotice(`「${saved.name.trim()}」を保存しました。${current.id ? "すでに作った仕訳は変わりません。" : ""}`);
      setForm(null);
      refetch();
    } catch (e) {
      // 失敗しても入力内容は消さない（直してやり直せるように）
      setFormError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  // ---- 停止・再開・削除 ----
  const [busyId, setBusyId] = useState<string | null>(null);
  const busyRef = useRef(false);

  async function setActive(r: RecurringJournal, isActive: boolean) {
    if (r.isActive === isActive || busyRef.current) return;
    busyRef.current = true;
    setBusyId(r.id);
    try {
      await setRecurringJournalActive(id, r.id, isActive);
      setNotice(`「${r.name}」を${isActive ? "有効にしました" : "停止しました（まとめて作成の対象から外れます）"}`);
      refetch();
    } catch (e) {
      alert(e instanceof Error ? e.message : "変更に失敗しました");
    } finally {
      busyRef.current = false;
      setBusyId(null);
    }
  }

  async function remove(r: RecurringJournal) {
    if (busyRef.current) return;
    if (!confirm(`「${r.name}」を削除しますか？\n作った仕訳は残ります（定期仕訳とのつながりだけが外れます）。`)) return;
    busyRef.current = true;
    setBusyId(r.id);
    try {
      await deleteRecurringJournal(id, r.id);
      if (form?.id === r.id) setForm(null);
      setNotice(`「${r.name}」を削除しました`);
      refetch();
    } catch (e) {
      alert(e instanceof Error ? e.message : "削除に失敗しました");
    } finally {
      busyRef.current = false;
      setBusyId(null);
    }
  }

  // ---- 既存の仕訳から作る ----
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickQuery, setPickQuery] = useState("");
  const [pickResults, setPickResults] = useState<JournalForRecurring[] | null>(null);
  const [pickLoading, setPickLoading] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  const [pickingId, setPickingId] = useState<string | null>(null);
  const pickSeq = useRef(0);

  const searchPick = useCallback(
    async (q: string) => {
      const seq = ++pickSeq.current;
      setPickLoading(true);
      setPickError(null);
      try {
        const rows = await searchJournalsForRecurring(id, q);
        // 打ち替えが続いたとき、古い結果で上書きしない
        if (seq === pickSeq.current) setPickResults(rows);
      } catch (e) {
        if (seq === pickSeq.current) setPickError(e instanceof Error ? e.message : "仕訳を探せませんでした");
      } finally {
        if (seq === pickSeq.current) setPickLoading(false);
      }
    },
    [id]
  );

  function openPicker() {
    setPickerOpen(true);
    setForm(null);
    setNotice(null);
    setPickQuery("");
    searchPick("");
  }

  async function pick(j: JournalForRecurring) {
    if (pickingId) return;
    setPickingId(j.id);
    try {
      const draft = await recurringDraftFromJournal(id, j.id);
      openForm(formFromInput(draft, null, subNameOf));
    } catch (e) {
      setPickError(e instanceof Error ? e.message : "仕訳を読み込めませんでした");
    } finally {
      setPickingId(null);
    }
  }

  // ---- 表示 ----
  const isViewer = clientRole !== null && !clientRole.canWrite;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Repeat className="size-6 text-primary" />
            定期仕訳
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            家賃・リース料・顧問料・保険料・役員報酬など、毎月同じ形の仕訳を登録しておき、まだ作っていない月の分をまとめて下書きで作ります。
          </p>
        </div>
        {canWrite && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={openPicker}>
              <Search className="size-4" />
              既存の仕訳から作る
            </Button>
            <Button onClick={() => openForm(emptyForm())}>
              <Plus className="size-4" />
              新しい定期仕訳
            </Button>
          </div>
        )}
      </div>

      {isViewer && (
        <div className="mb-6 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          このアカウントは閲覧専用のため、定期仕訳の登録・変更と仕訳の作成はできません。作った仕訳は
          <Link href={`/clients/${id}/ledgers?tab=journal`} className="underline mx-1">
            帳簿閲覧
          </Link>
          で確認できます。
        </div>
      )}

      {notice && (
        <div className="mb-6 flex flex-wrap items-start justify-between gap-2 rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
          <span className="flex items-start gap-2">
            <Check className="size-4 shrink-0 mt-0.5" />
            {notice}
          </span>
          <button onClick={() => setNotice(null)} className="text-success hover:opacity-80" title="閉じる">
            <X className="size-4" />
          </button>
        </div>
      )}

      {/* 既存の仕訳から作る */}
      {canWrite && pickerOpen && (
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Search className="size-5 text-primary" />
                既存の仕訳から作る
              </CardTitle>
              <button onClick={() => setPickerOpen(false)} className="text-muted-foreground hover:text-foreground" title="閉じる">
                <X className="size-5" />
              </button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              元にする仕訳を選ぶと、科目・金額・税区分を写した入力欄が開きます（まだ保存はされません）。開始月はその仕訳の翌月になります。
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={pickQuery}
                onChange={(e) => setPickQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    searchPick(pickQuery);
                  }
                }}
                placeholder="摘要で探す（例: 家賃）"
                className={cn(inputClass, "flex-1 min-w-[12rem]")}
              />
              <Button variant="outline" onClick={() => searchPick(pickQuery)} disabled={pickLoading}>
                {pickLoading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                探す
              </Button>
            </div>
            {pickError && <p className="text-sm text-destructive">{pickError}</p>}
            {pickResults === null ? (
              <div className="flex items-center justify-center py-6 text-muted-foreground">
                <Loader2 className="size-5 animate-spin" />
              </div>
            ) : pickResults.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {pickQuery.trim() ? `「${pickQuery.trim()}」を含む仕訳はありません。` : "仕訳がまだありません。"}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/20 border-b border-border">
                      <th className="text-left px-3 py-2 text-xs font-bold text-muted-foreground whitespace-nowrap">日付</th>
                      <th className="text-left px-3 py-2 text-xs font-bold text-muted-foreground">摘要</th>
                      <th className="text-right px-3 py-2 text-xs font-bold text-muted-foreground">金額</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {pickResults.map((j) => (
                      <tr key={j.id} className="border-b border-border/50 last:border-0 hover:bg-muted/10">
                        <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{j.date.replace(/-/g, "/")}</td>
                        <td className="px-3 py-2 text-foreground">{j.description || "（摘要なし）"}</td>
                        <td className="px-3 py-2 text-right font-mono whitespace-nowrap">{formatCurrency(j.amount)}</td>
                        <td className="px-3 py-2 text-right">
                          <Button size="sm" variant="outline" onClick={() => pick(j)} disabled={pickingId !== null}>
                            {pickingId === j.id && <Loader2 className="size-3.5 animate-spin" />}
                            これを元にする
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 新規・編集 */}
      {canWrite && form && (
        <div ref={formRef} className="scroll-mt-4">
          <RecurringForm
            form={form}
            accounts={accounts}
            subAccounts={subAccounts}
            createdMonths={list?.find((r) => r.id === form.id)?.createdMonths ?? []}
            error={formError}
            saving={saving}
            onChange={updateForm}
            onLineChange={updateLine}
            onAddLine={addLine}
            onRemoveLine={removeLine}
            onSave={save}
            onCancel={() => setForm(null)}
          />
        </div>
      )}

      {/* まとめて作成 */}
      {canWrite && list && list.length > 0 && (
        <Card className="mb-6 p-4 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-44">
              <label className="block text-xs font-bold text-muted-foreground mb-1">この日までの分を作る</label>
              <DateInput value={through} onChange={setThrough} className={cn(inputClass, "pr-7")} />
            </div>
            <div className="text-sm pb-2">
              {totalPending > 0 ? (
                <>
                  まだ作っていない月: <span className="font-bold text-foreground">{totalPending}件</span>
                  <span className="text-muted-foreground">（定期仕訳 {pendingRows.length}件分）</span>
                </>
              ) : (
                <span className="text-muted-foreground">この日までの分はすべて作成済みです。</span>
              )}
            </div>
            <Button onClick={runGenerate} disabled={generating || totalPending === 0}>
              {generating ? <Loader2 className="size-4 animate-spin" /> : <Repeat className="size-4" />}
              {generating ? "作成中..." : "未作成の月をまとめて作成"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            計上日がこの日までに来ている月のうち、まだ作っていない月の仕訳を下書きで作ります。停止中の定期仕訳と、締めた会計年度の月は作りません。
            作った仕訳は
            <Link href={`/clients/${id}/ledgers?tab=journal`} className="underline mx-1">
              帳簿閲覧（仕訳帳）
            </Link>
            で確認・修正できます。
          </p>
          {genError && (
            <p className="flex items-start gap-2 text-sm text-destructive">
              <AlertTriangle className="size-4 shrink-0 mt-0.5" />
              {genError}
            </p>
          )}
          {genResult && <GenerationResult result={genResult} clientId={id} />}
        </Card>
      )}

      {/* 一覧 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            登録した定期仕訳
            {list && <Badge variant="default">{list.length}件</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {list === null ? (
            listError ? (
              <p className="py-10 text-center text-sm text-destructive">定期仕訳を読み込めませんでした（{listError}）</p>
            ) : (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="size-5 animate-spin" />
              </div>
            )
          ) : list.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              まだ定期仕訳はありません。
              {canWrite && "「新しい定期仕訳」か「既存の仕訳から作る」で登録してください。"}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/20 border-b border-border">
                    <th className="text-left px-3 py-2 text-xs font-bold text-muted-foreground">名前・仕訳</th>
                    <th className="text-left px-3 py-2 text-xs font-bold text-muted-foreground whitespace-nowrap">くり返し</th>
                    <th className="text-right px-3 py-2 text-xs font-bold text-muted-foreground">金額</th>
                    <th className="text-left px-3 py-2 text-xs font-bold text-muted-foreground whitespace-nowrap">最後に作った月</th>
                    <th className="text-left px-3 py-2 text-xs font-bold text-muted-foreground whitespace-nowrap">次に作る月</th>
                    <th className="text-left px-3 py-2 text-xs font-bold text-muted-foreground">状態</th>
                    {canWrite && <th className="px-3 py-2" />}
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => {
                    const pending = pendingByRow.get(r.id) ?? [];
                    const next = nextMonthToCreate(scheduleOf(r), through, r.createdMonths);
                    return (
                      <tr key={r.id} className={cn("border-b border-border last:border-0 align-top", !r.isActive && "bg-muted/10")}>
                        <td className="px-3 py-2.5">
                          <div className="font-medium text-foreground">{r.name}</div>
                          {r.description && r.description !== r.name && (
                            <div className="text-xs text-muted-foreground">摘要: {r.description}</div>
                          )}
                          <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                            {r.lines.map((l, i) => (
                              <div key={i}>
                                （{l.debit_amount > 0 ? "借" : "貸"}）{l.accountName}
                                {l.subAccountName && `・${l.subAccountName}`}{" "}
                                <span className="font-mono">{formatCurrency(l.debit_amount || l.credit_amount)}</span>
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <div>
                            {intervalLabel(r.intervalMonths)}・{dayOfMonthLabel(r.dayOfMonth)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {monthLabel(r.startMonth)}〜{r.endMonth ? monthLabel(r.endMonth) : ""}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono whitespace-nowrap">{formatCurrency(r.amount)}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          {r.lastGeneratedMonth ? monthLabel(r.lastGeneratedMonth) : <span className="text-muted-foreground">まだ作っていません</span>}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          {next ? (
                            <>
                              <div>{monthLabel(next)}</div>
                              <div className="text-xs text-muted-foreground">計上日 {postingDateOf(next, r.dayOfMonth).replace(/-/g, "/")}</div>
                            </>
                          ) : (
                            <span className="text-muted-foreground">{r.isActive ? "予定なし（終了月まで作成済み）" : "停止中"}</span>
                          )}
                          {pending.length > 0 && (
                            <Badge variant="warning" className="mt-1">
                              未作成 {pending.length}件
                            </Badge>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          {canWrite ? (
                            // 「有効」「停止」を両方並べ、選ばれている方を塗る（ボタン1つだと今の状態か押した後か分からない）
                            <div
                              role="radiogroup"
                              aria-label={`${r.name}の状態`}
                              className="inline-flex rounded-lg border border-border bg-muted/30 p-0.5"
                            >
                              {([true, false] as const).map((v) => {
                                const selected = r.isActive === v;
                                return (
                                  <button
                                    key={String(v)}
                                    role="radio"
                                    aria-checked={selected}
                                    disabled={busyId === r.id}
                                    onClick={() => setActive(r, v)}
                                    className={cn(
                                      "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-bold whitespace-nowrap transition-colors",
                                      selected
                                        ? v
                                          ? "bg-success text-success-foreground shadow-sm"
                                          : "bg-foreground/80 text-background shadow-sm"
                                        : "text-muted-foreground hover:text-foreground"
                                    )}
                                  >
                                    {selected && busyId === r.id ? (
                                      <Loader2 className="size-3 animate-spin" />
                                    ) : v ? (
                                      <Check className="size-3" />
                                    ) : (
                                      <Pause className="size-3" />
                                    )}
                                    {v ? "有効" : "停止"}
                                  </button>
                                );
                              })}
                            </div>
                          ) : (
                            <Badge variant={r.isActive ? "success" : "muted"}>{r.isActive ? "有効" : "停止中"}</Badge>
                          )}
                        </td>
                        {canWrite && (
                          <td className="px-3 py-2.5">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => openEdit(r)}
                                className="text-muted-foreground hover:text-foreground"
                                title="編集"
                              >
                                <Pencil className="size-4" />
                              </button>
                              <button
                                onClick={() => remove(r)}
                                disabled={busyId === r.id}
                                className="text-destructive hover:text-destructive/80 disabled:opacity-50"
                                title="削除"
                              >
                                <Trash2 className="size-4" />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// 入力欄
// ---------------------------------------------------------------------------

function RecurringForm({
  form,
  accounts,
  subAccounts,
  createdMonths,
  error,
  saving,
  onChange,
  onLineChange,
  onAddLine,
  onRemoveLine,
  onSave,
  onCancel,
}: {
  form: FormState;
  accounts: AccountOption[];
  subAccounts: SubAccount[];
  /** 編集中の定期仕訳で作成済みの月（新規は空） */
  createdMonths: string[];
  error: string | null;
  saving: boolean;
  onChange: (patch: Partial<FormState>) => void;
  onLineChange: (side: "debit" | "credit", key: number, patch: Partial<FormLine>) => void;
  onAddLine: (side: "debit" | "credit") => void;
  onRemoveLine: (side: "debit" | "credit", key: number) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const sum = (lines: FormLine[]) => lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const debitTotal = sum(form.debit);
  const creditTotal = sum(form.credit);
  const balanced = debitTotal > 0 && debitTotal === creditTotal;

  // この設定で、今日までに作られる月（開始月を過去にすると、まとめて作成で過去の月も作られる）
  const now = today();
  const schedule: RecurringSchedule = {
    dayOfMonth: form.dayOfMonth,
    startMonth: form.startMonth,
    endMonth: form.endMonth || null,
    intervalMonths: form.intervalMonths,
    isActive: true,
  };
  const pastPending = pendingMonths(schedule, now, createdMonths);
  const next = nextMonthToCreate(schedule, now, createdMonths);

  return (
    <Card className="mb-6">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Repeat className="size-5 text-primary" />
            {form.id ? "定期仕訳を編集" : "新しい定期仕訳"}
          </CardTitle>
          <button onClick={onCancel} className="text-muted-foreground hover:text-foreground" title="閉じる">
            <X className="size-5" />
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4" onKeyDown={handleBarKeyNav}>
          <div>
            <label className="block text-xs font-bold text-muted-foreground mb-1">名前</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => onChange({ name: e.target.value })}
              placeholder="例: 事務所家賃"
              maxLength={100}
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-muted-foreground mb-1">摘要（作る仕訳に入る。空なら名前）</label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => onChange({ description: e.target.value })}
              placeholder="例: 事務所家賃 ○○不動産"
              className={inputClass}
            />
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-bold text-muted-foreground">くり返し</p>
          {/* 周期は選択肢を並べて、選ばれている方を塗る */}
          <div role="radiogroup" aria-label="周期" className="flex flex-wrap gap-1 rounded-lg border border-border bg-muted/30 p-0.5 w-fit max-w-full">
            {INTERVAL_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={form.intervalMonths === o.value}
                onClick={() => onChange({ intervalMonths: o.value })}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-bold transition-colors",
                  form.intervalMonths === o.value
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4" onKeyDown={handleBarKeyNav}>
            <div>
              <label className="block text-xs font-bold text-muted-foreground mb-1">計上日</label>
              <select
                value={form.dayOfMonth}
                onChange={(e) => onChange({ dayOfMonth: Number(e.target.value) })}
                className={inputClass}
              >
                <option value={END_OF_MONTH}>末日</option>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>
                    {d}日
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-muted-foreground mb-1">開始月</label>
              <MonthInput
                value={form.startMonth}
                onChange={(v) => onChange({ startMonth: v })}
                className={cn(inputClass, "pr-7")}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-muted-foreground mb-1">終了月（空欄＝終わりなし）</label>
              <MonthInput
                allowEmpty
                value={form.endMonth}
                onChange={(v) => onChange({ endMonth: v })}
                placeholder="終わりなし"
                className={cn(inputClass, "pr-7")}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            31日など、その月に無い日を選んだときは月末の日付で作ります。
            {form.intervalMonths > 1 && `開始月から${intervalLabel(form.intervalMonths)}に作ります。`}
          </p>
        </div>

        {/* 明細（借方・貸方） */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <LinePanel
            side="debit"
            lines={form.debit}
            accounts={accounts}
            subAccounts={subAccounts}
            onChange={onLineChange}
            onAdd={onAddLine}
            onRemove={onRemoveLine}
          />
          <LinePanel
            side="credit"
            lines={form.credit}
            accounts={accounts}
            subAccounts={subAccounts}
            onChange={onLineChange}
            onAdd={onAddLine}
            onRemove={onRemoveLine}
          />
        </div>
        <div
          className={cn(
            "flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border px-3 py-2 text-sm",
            balanced ? "border-success/30 bg-success/10 text-success" : "border-warning/30 bg-warning/10 text-warning"
          )}
        >
          <span>
            借方合計 <span className="font-mono font-bold">{formatCurrency(debitTotal)}</span>
          </span>
          <span>
            貸方合計 <span className="font-mono font-bold">{formatCurrency(creditTotal)}</span>
          </span>
          <span className="font-bold">
            {balanced ? "貸借が一致しています" : debitTotal === 0 && creditTotal === 0 ? "金額を入力してください" : `差額 ${formatCurrency(Math.abs(debitTotal - creditTotal))}`}
          </span>
        </div>

        {/* この設定で作られる月 */}
        {form.startMonth &&
          (pastPending.length > 0 ? (
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
              <AlertTriangle className="size-4 shrink-0 mt-0.5" />
              <span>
                保存して「未作成の月をまとめて作成」を押すと、{monthsRange(pastPending)}の{pastPending.length}件がまとめて作られます。
                すでに手入力した月があるときは、開始月をその次の月にしてください（二重計上になります）。
              </span>
            </div>
          ) : next ? (
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <Info className="size-4 shrink-0 mt-0.5" />
              最初に作るのは{monthLabel(next)}分（計上日 {postingDateOf(next, form.dayOfMonth).replace(/-/g, "/")}）です。計上日が来たら「まとめて作成」で作れます。
            </p>
          ) : null)}

        {error && (
          <p className="flex items-start gap-2 text-sm text-destructive">
            <AlertTriangle className="size-4 shrink-0 mt-0.5" />
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            キャンセル
          </Button>
          <Button onClick={onSave} disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            保存
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** 借方・貸方の明細（科目・金額、科目の下に補助科目と税区分。仕訳入力と同じ部品） */
function LinePanel({
  side,
  lines,
  accounts,
  subAccounts,
  onChange,
  onAdd,
  onRemove,
}: {
  side: "debit" | "credit";
  lines: FormLine[];
  accounts: AccountOption[];
  subAccounts: SubAccount[];
  onChange: (side: "debit" | "credit", key: number, patch: Partial<FormLine>) => void;
  onAdd: (side: "debit" | "credit") => void;
  onRemove: (side: "debit" | "credit", key: number) => void;
}) {
  const isDebit = side === "debit";
  return (
    <div className="rounded-lg border border-border p-3 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={cn("text-sm font-bold", isDebit ? "text-info" : "text-destructive")}>{isDebit ? "借方" : "貸方"}</span>
        <span className="text-xs text-muted-foreground">科目・金額</span>
      </div>
      {lines.map((l) => {
        const acc = accounts.find((a) => a.id === l.account);
        return (
          <div key={l.key} className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <AccountLookup accounts={accounts} value={l.account} onChange={(v) => onChange(side, l.key, { account: v })} />
              </div>
              <div className="w-32">
                <AmountInput
                  value={l.amount}
                  onChange={(v) => onChange(side, l.key, { amount: v })}
                  placeholder="0"
                  className="w-full bg-card border border-border rounded px-2 py-1.5 text-sm text-right font-mono"
                />
              </div>
              {lines.length > 1 && (
                <button
                  type="button"
                  onClick={() => onRemove(side, l.key)}
                  className="text-destructive hover:text-destructive/80"
                  title="行を削除"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
            {l.account && (
              <div className="flex flex-wrap items-center gap-1">
                <div className="flex-1 min-w-[8rem]">
                  <SubAccountInput
                    accountId={l.account}
                    subAccounts={subAccounts}
                    value={l.sub}
                    onChange={(v) => onChange(side, l.key, { sub: v })}
                  />
                </div>
                {acc && (
                  <div className="w-40">
                    <TaxCategorySelect
                      accountType={acc.categoryType}
                      accountName={acc.name}
                      value={l.tax}
                      onChange={(v) => onChange(side, l.key, { tax: v })}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => onAdd(side)}
        className={cn(
          "inline-flex items-center gap-1 text-xs font-bold",
          isDebit ? "text-info hover:opacity-80" : "text-destructive hover:opacity-80"
        )}
      >
        <Plus className="size-3.5" />
        {isDebit ? "借方の行を追加" : "貸方の行を追加"}
      </button>
    </div>
  );
}

/** まとめて作成の結果 */
function GenerationResult({ result, clientId }: { result: RecurringGenerationResult; clientId: string }) {
  const already = groupByRecurring(result.skipped.filter((s) => s.reason === "already"));
  const locked = groupByRecurring(result.skipped.filter((s) => s.reason === "locked"));
  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/10 p-3 text-sm">
      {result.created.length > 0 ? (
        <div className="space-y-2">
          <p className="flex flex-wrap items-center gap-2 font-bold text-success">
            <Check className="size-4" />
            {result.created.length}件の仕訳を下書きで作りました（{result.through.replace(/-/g, "/")}までの分）。
            <Link href={`/clients/${clientId}/ledgers?tab=journal`} className="font-normal underline">
              仕訳帳で確認する
            </Link>
          </p>
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/20 border-b border-border">
                  <th className="text-left px-3 py-1.5 text-xs font-bold text-muted-foreground">定期仕訳</th>
                  <th className="text-left px-3 py-1.5 text-xs font-bold text-muted-foreground whitespace-nowrap">対象月</th>
                  <th className="text-left px-3 py-1.5 text-xs font-bold text-muted-foreground whitespace-nowrap">計上日</th>
                  <th className="text-right px-3 py-1.5 text-xs font-bold text-muted-foreground">金額</th>
                </tr>
              </thead>
              <tbody>
                {result.created.map((c) => (
                  <tr key={c.entryId} className="border-b border-border/50 last:border-0">
                    <td className="px-3 py-1.5 text-foreground">{c.name}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{monthLabel(c.month)}</td>
                    <td className="px-3 py-1.5 font-mono text-xs whitespace-nowrap">{c.date.replace(/-/g, "/")}</td>
                    <td className="px-3 py-1.5 text-right font-mono whitespace-nowrap">{formatCurrency(c.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <p className="font-bold text-foreground">作った仕訳はありません。</p>
      )}
      {already.length > 0 && (
        <div>
          <p className="text-xs font-bold text-muted-foreground">作成済みのため作らなかった月</p>
          <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
            {already.map((g) => (
              <li key={g.recurringId}>
                ・{g.name}: {monthsRange(g.months)}（{g.months.length}件）
              </li>
            ))}
          </ul>
        </div>
      )}
      {locked.length > 0 && (
        <div>
          <p className="text-xs font-bold text-warning">締めた会計年度のため作らなかった月</p>
          <ul className="mt-1 space-y-0.5 text-xs text-warning">
            {locked.map((g) => (
              <li key={g.recurringId}>
                ・{g.name}: {monthsRange(g.months)}（{g.months.length}件）
              </li>
            ))}
          </ul>
        </div>
      )}
      {result.failed.length > 0 && (
        <div>
          <p className="text-xs font-bold text-destructive">作れなかったもの（{result.failed.length}件）</p>
          <ul className="mt-1 space-y-0.5 text-xs text-destructive">
            {result.failed.map((f, i) => (
              <li key={i}>
                ・{f.name}
                {f.month ? `（${monthLabel(f.month)}）` : ""}: {f.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {result.remaining > 0 && (
        <p className="flex items-start gap-2 text-xs text-warning">
          <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
          1回に作れる上限に達したため、残り{result.remaining}件はまだ作っていません。もう一度「未作成の月をまとめて作成」を押すと続きを作ります。
        </p>
      )}
    </div>
  );
}

