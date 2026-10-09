"use client";

/**
 * 仕訳の詳細と修正（画面右から出るパネル）。
 * 帳簿閲覧の仕訳帳・総勘定元帳・補助元帳・税区分別のどこから開いても同じものを使う。
 * 各行の勘定科目・補助科目・税区分・税率・金額と、取引先・品目明細を表示し、その場で修正できる。
 */

import { useEffect, useState } from "react";
import { X, Pen, Plus, Trash2, Loader2, Check, AlertTriangle, ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AccountLookup, type AccountOption } from "@/components/ui/account-lookup";
import { AmountInput } from "@/components/ui/amount-input";
import { DateInput } from "@/components/ui/date-input";
import { SubAccountInput, TaxCategorySelect, EMPTY_SUB, type LineSub } from "@/components/journal/line-fields";
import { getJournalEntry, updateJournalEntryWithLines } from "@/actions/journals";
import { getJournalEntryDetail, type JournalEntryDetail } from "@/actions/ledgers";
import { ensureSubAccounts, type SubAccount } from "@/actions/sub-accounts";
import { defaultTaxCategory, taxCategoryInfo } from "@/lib/tax-category";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { TaxBadge } from "@/components/journal/tax-badge";
import { useClientRole } from "@/lib/use-client-role";

type EntryLine = {
  accountId: string;
  debit: string;
  credit: string;
  sub: LineSub;
  tax: string;
  departmentId: string | null;
};

type Entry = {
  id: string;
  date: string;
  description: string;
  needsReview: boolean;
  receiptId: string | null;
  lines: EntryLine[];
};

const SOURCE_LABEL: Record<string, string> = {
  manual: "手入力",
  ai: "AI",
  import: "取込",
  raqto: "Raqto受発注",
  bank: "銀行",
  card: "カード",
  payment: "入金消込",
  closing: "決算",
};

export function JournalEntryPanel({
  clientId,
  entryId,
  accounts,
  subAccounts,
  onClose,
  onSaved,
  onReceiptClick,
  onOpenAccount,
}: {
  clientId: string;
  entryId: string;
  accounts: AccountOption[];
  subAccounts: SubAccount[];
  onClose: () => void;
  /** 保存した後に呼ぶ（一覧の読み直し用） */
  onSaved: () => void;
  onReceiptClick?: (receiptId: string) => void;
  /** 勘定科目をクリックしたとき（総勘定元帳へ移る）。仕訳の日付も渡す */
  onOpenAccount?: (accountId: string, entryDate: string) => void;
}) {
  const [entry, setEntry] = useState<Entry | null>(null);
  const [source, setSource] = useState<string>("");
  const [detail, setDetail] = useState<JournalEntryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Entry | null>(null);
  const [saving, setSaving] = useState(false);
  const role = useClientRole(clientId);

  const subName = (id: string | null) => (id ? subAccounts.find((s) => s.id === id)?.name ?? "" : "");

  useEffect(() => {
    let alive = true;
    setEntry(null);
    setEditing(false);
    setError(null);
    Promise.all([getJournalEntry(entryId), getJournalEntryDetail(entryId).catch(() => null)])
      .then(([e, d]) => {
        if (!alive) return;
        const raw = e as unknown as {
          id: string;
          entry_date: string;
          description: string | null;
          needs_review: boolean | null;
          source: string | null;
          receipt_id: string | null;
          journal_entry_lines: {
            account_id: string;
            debit_amount: number;
            credit_amount: number;
            sub_account_id: string | null;
            tax_category: string | null;
            department_id: string | null;
            sort_order: number | null;
          }[];
        };
        setSource(raw.source ?? "");
        setDetail(d);
        setEntry({
          id: raw.id,
          date: raw.entry_date,
          description: raw.description ?? "",
          needsReview: Boolean(raw.needs_review),
          receiptId: raw.receipt_id,
          lines: [...(raw.journal_entry_lines ?? [])]
            .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
            .map((l) => ({
              accountId: l.account_id,
              debit: l.debit_amount ? String(l.debit_amount) : "",
              credit: l.credit_amount ? String(l.credit_amount) : "",
              sub: l.sub_account_id ? { id: l.sub_account_id, name: subName(l.sub_account_id) } : EMPTY_SUB,
              tax: l.tax_category ?? "",
              departmentId: l.department_id,
            })),
        });
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "読み込みに失敗しました"));
    return () => {
      alive = false;
    };
    // subAccounts は名前の表示にだけ使う
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId]);

  const account = (id: string) => accounts.find((a) => a.id === id);

  const startEdit = () => {
    if (!entry) return;
    // 補助科目の一覧が後から読み込まれた場合に備え、名前をここで埋める
    setDraft({ ...entry, lines: entry.lines.map((l) => ({ ...l, sub: { ...l.sub, name: l.sub.name || subName(l.sub.id) } })) });
    setEditing(true);
  };
  const setLine = (i: number, patch: Partial<EntryLine>) =>
    setDraft((d) => d && { ...d, lines: d.lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)) });
  const setLineAccount = (i: number, accountId: string) => {
    const acc = account(accountId);
    setLine(i, {
      accountId,
      sub: EMPTY_SUB,
      tax: acc ? defaultTaxCategory(acc.categoryType, acc.name) ?? "" : "",
    });
  };

  const num = (v: string) => Number(v.replace(/,/g, "")) || 0;
  const totalD = draft?.lines.reduce((s, l) => s + num(l.debit), 0) ?? 0;
  const totalC = draft?.lines.reduce((s, l) => s + num(l.credit), 0) ?? 0;
  const balanced = totalD > 0 && totalD === totalC;

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const subIds = await ensureSubAccounts(
        clientId,
        draft.lines.map((l) => ({ accountId: l.accountId, name: l.sub.id ? "" : l.sub.name }))
      );
      await updateJournalEntryWithLines(
        draft.id,
        { entry_date: draft.date, description: draft.description },
        draft.lines.map((l, i) => ({
          account_id: l.accountId,
          debit_amount: num(l.debit),
          credit_amount: num(l.credit),
          sub_account_id: l.sub.id ?? subIds[i],
          tax_category: l.tax || null,
          department_id: l.departmentId,
        }))
      );
      setEditing(false);
      onSaved();
      onClose();
    } catch (e) {
      alert(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-card border-l border-border shadow-xl overflow-y-auto">
        <div className="sticky top-0 z-10 bg-card border-b border-border px-5 py-3 flex items-center justify-between">
          <h3 className="text-lg font-bold">{editing ? "仕訳の修正" : "仕訳の詳細"}</h3>
          <div className="flex items-center gap-3">
            {entry && !editing && role?.canWrite !== false && (
              <Button size="sm" variant="outline" onClick={startEdit}>
                <Pen className="size-3.5" />
                修正する
              </Button>
            )}
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground" title="閉じる">
              <X className="size-5" />
            </button>
          </div>
        </div>

        <div className="px-5 py-5 space-y-5">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {!entry && !error && (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="size-5 animate-spin mr-2" />
              読み込み中...
            </div>
          )}

          {entry && !editing && (
            <>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <Info label="日付">{formatDate(entry.date)}</Info>
                <Info label="作成元">
                  <span className="inline-flex items-center gap-2">
                    {SOURCE_LABEL[source] ?? (source || "-")}
                    {entry.needsReview && <Badge variant="warning">要確認</Badge>}
                  </span>
                </Info>
                <Info label="摘要" wide>
                  {entry.description || "-"}
                </Info>
                {detail?.partnerName && <Info label="取引先">{detail.partnerName}</Info>}
                {entry.receiptId && onReceiptClick && (
                  <Info label="証憑">
                    <button
                      onClick={() => onReceiptClick(entry.receiptId!)}
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      <ImageIcon className="size-3.5" />
                      証憑を見る
                    </button>
                  </Info>
                )}
              </div>

              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">勘定科目</th>
                      <th className="px-3 py-2 text-left">補助科目</th>
                      <th className="px-3 py-2 text-left">税区分</th>
                      <th className="px-3 py-2 text-right">借方</th>
                      <th className="px-3 py-2 text-right">貸方</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entry.lines.map((l, i) => {
                      const info = taxCategoryInfo(l.tax);
                      const acc = account(l.accountId);
                      const isPl = acc?.categoryType === "revenue" || acc?.categoryType === "expenses";
                      return (
                        <tr key={i} className="border-t border-border">
                          <td className="px-3 py-2">
                            {acc && onOpenAccount ? (
                              <button
                                onClick={() => onOpenAccount(acc.id, entry.date)}
                                className="text-primary hover:underline text-left"
                                title="この科目の総勘定元帳を開く"
                              >
                                {acc.name}
                              </button>
                            ) : (
                              acc?.name ?? "（不明な科目）"
                            )}
                          </td>
                          <td className="px-3 py-2">{l.sub.name || subName(l.sub.id) || "-"}</td>
                          <td className={cn("px-3 py-2 text-xs", isPl && !info && "text-warning")}>
                            {info ? (
                              <>
                                <TaxBadge code={l.tax} className="mr-1" />
                                {info.name}
                              </>
                            ) : isPl ? (
                              <TaxBadge code={null} missing />
                            ) : (
                              "-"
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">{l.debit ? formatCurrency(num(l.debit)) : ""}</td>
                          <td className="px-3 py-2 text-right font-mono">{l.credit ? formatCurrency(num(l.credit)) : ""}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {detail && detail.items.length > 0 && (
                <div>
                  <h4 className="text-sm font-bold mb-2">品目明細</h4>
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/30 text-muted-foreground">
                        <tr>
                          <th className="px-3 py-1.5 text-left">品名</th>
                          <th className="px-3 py-1.5 text-right">数量</th>
                          <th className="px-3 py-1.5 text-right">単価</th>
                          <th className="px-3 py-1.5 text-right">税率</th>
                          <th className="px-3 py-1.5 text-right">小計</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.items.map((it, i) => (
                          <tr key={i} className="border-t border-border">
                            <td className="px-3 py-1.5">{it.item_name}</td>
                            <td className="px-3 py-1.5 text-right font-mono">{it.quantity}</td>
                            <td className="px-3 py-1.5 text-right font-mono">{formatCurrency(it.unit_price)}</td>
                            <td className="px-3 py-1.5 text-right font-mono">{it.tax_rate != null ? `${it.tax_rate}%` : "-"}</td>
                            <td className="px-3 py-1.5 text-right font-mono">{formatCurrency(it.subtotal)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {editing && draft && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-3">
                <div>
                  <label className="text-xs text-muted-foreground font-bold">日付</label>
                  <DateInput
                    value={draft.date}
                    onChange={(v) => setDraft({ ...draft, date: v })}
                    className="w-full mt-1 px-2 py-1.5 rounded-lg border border-border bg-card text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground font-bold">摘要</label>
                  <input
                    value={draft.description}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    className="w-full mt-1 px-2 py-1.5 rounded-lg border border-border bg-card text-sm"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground font-bold">仕訳明細</span>
                  <button
                    onClick={() =>
                      setDraft({
                        ...draft,
                        lines: [...draft.lines, { accountId: "", debit: "", credit: "", sub: EMPTY_SUB, tax: "", departmentId: null }],
                      })
                    }
                    className="text-xs text-primary inline-flex items-center gap-1 hover:underline"
                  >
                    <Plus className="size-3" />
                    行を追加
                  </button>
                </div>
                {draft.lines.map((l, i) => {
                  const acc = account(l.accountId);
                  return (
                    <div key={i} className="rounded-lg border border-border p-2 space-y-1.5">
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <AccountLookup accounts={accounts} value={l.accountId} onChange={(v) => setLineAccount(i, v)} />
                        </div>
                        {draft.lines.length > 1 && (
                          <button
                            onClick={() => setDraft({ ...draft, lines: draft.lines.filter((_, idx) => idx !== i) })}
                            className="text-destructive mt-2 shrink-0"
                            title="この行を削除"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        )}
                      </div>
                      {l.accountId && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                          <SubAccountInput
                            accountId={l.accountId}
                            subAccounts={subAccounts}
                            value={l.sub}
                            onChange={(v) => setLine(i, { sub: v })}
                          />
                          {acc && (
                            <TaxCategorySelect accountType={acc.categoryType} value={l.tax} onChange={(v) => setLine(i, { tax: v })} />
                          )}
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-1.5">
                        <AmountInput
                          placeholder="借方"
                          value={l.debit}
                          onChange={(v) => setLine(i, { debit: v })}
                          className="px-2 py-1 rounded border border-border bg-card text-sm text-right font-mono"
                        />
                        <AmountInput
                          placeholder="貸方"
                          value={l.credit}
                          onChange={(v) => setLine(i, { credit: v })}
                          className="px-2 py-1 rounded border border-border bg-card text-sm text-right font-mono"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className={cn("text-xs font-mono flex justify-between px-1", balanced ? "text-success" : "text-destructive")}>
                <span>借方 {formatCurrency(totalD)}</span>
                <span>貸方 {formatCurrency(totalC)}</span>
              </div>
              {!balanced && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertTriangle className="size-3.5" />
                  借方と貸方の合計を一致させてください。
                </p>
              )}
              {entry?.needsReview && (
                <p className="text-xs text-muted-foreground">保存すると「要確認」が外れ、試算表などの集計に入ります。</p>
              )}
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                  やめる
                </Button>
                <Button size="sm" onClick={save} disabled={saving || !balanced}>
                  {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                  保存する
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Info({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={wide ? "col-span-2" : ""}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}
