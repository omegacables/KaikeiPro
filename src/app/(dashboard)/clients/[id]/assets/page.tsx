"use client";

/**
 * 固定資産台帳と減価償却。
 * 計算は src/lib/depreciation.ts（テストあり）、保存と仕訳の作成は src/actions/assets.ts。
 */

import { Fragment, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  Landmark,
  Plus,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertTriangle,
  Info,
  CheckCircle2,
  Pencil,
  Trash2,
  FileText,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { AmountInput } from "@/components/ui/amount-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { cn } from "@/lib/utils";
import { formatYen } from "@/lib/wareki";
import { useClientRole } from "@/lib/use-client-role";
import { ROUNDING_LABELS, straightLineOnlyReason, MIN_USEFUL_LIFE, MAX_USEFUL_LIFE, type DepreciationRounding } from "@/lib/depreciation";
import {
  getDepreciationBook,
  saveAsset,
  deleteAsset,
  disposeAsset,
  saveDepreciationSettings,
  setBookedAmount,
  postDepreciationJournal,
  cancelDepreciationJournal,
  type DepreciationBook,
  type DepreciationAsset,
  type AssetInput,
} from "@/actions/assets";

const fieldCls = "w-full px-2 py-1.5 rounded-lg border border-border bg-card text-foreground text-sm";
const errMsg = (e: unknown) => (e instanceof Error ? e.message : "保存に失敗しました");

export default function AssetsPage() {
  const { id } = useParams<{ id: string }>();
  const role = useClientRole(id);
  const canWrite = role?.canWrite ?? false;
  const [periodKey, setPeriodKey] = useState<string | undefined>(undefined);
  const [book, setBook] = useState<DepreciationBook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState<DepreciationAsset | "new" | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getDepreciationBook(id, periodKey)
      .then((b) => {
        if (!alive) return;
        setBook(b);
        setError(null);
      })
      .catch((e) => alive && setError(errMsg(e)));
    return () => {
      alive = false;
    };
  }, [id, periodKey, reloadKey]);

  const reload = () => setReloadKey((k) => k + 1);
  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const isCorp = book?.entityType !== "individual";
  const journalLocked = Boolean(book?.journal);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Landmark className="size-6 text-primary" />
            固定資産台帳・減価償却
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            資産ごとに、その期に経費にできる上限（償却限度額）を計算し、減価償却の仕訳を作ります。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {book && (
            <>
              <Button variant="outline" size="sm" onClick={() => setPeriodKey(book.period.prevKey)}>
                <ChevronLeft className="size-4" />
                前期
              </Button>
              <span className="text-sm font-medium tabular-nums">
                {book.period.startDate} 〜 {book.period.endDate}
              </span>
              <Button variant="outline" size="sm" onClick={() => setPeriodKey(book.period.nextKey)}>
                翌期
                <ChevronRight className="size-4" />
              </Button>
            </>
          )}
          {canWrite && (
            <Button size="sm" onClick={() => setEditing("new")}>
              <Plus className="size-4" />
              資産を登録
            </Button>
          )}
        </div>
      </div>

      {error && <Note tone="warning">{error}</Note>}
      {!book && !error && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="size-4 animate-spin" />
          読み込み中...
        </div>
      )}

      {book && editing && (
        <AssetForm
          clientId={id}
          book={book}
          asset={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}

      {book && (
        <>
          {book.missingAccounts.length > 0 && (
            <Note tone="warning">
              勘定科目（{book.missingAccounts.join("・")}）が見つかりません。
              <Link href={`/clients/${id}/accounts`} className="underline ml-1">
                勘定科目管理
              </Link>
              で有効にしてください。
            </Note>
          )}

          <Settings clientId={id} book={book} canWrite={canWrite} onSaved={reload} />

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Summary label="取得価額の合計" value={book.totals.cost} note={`${book.assets.length}件`} />
            <Summary label="当期の償却限度額" value={book.totals.limit} note="経費にできる上限" />
            <Summary label="当期の計上額" value={book.totals.booked} note="帳簿に計上する減価償却費" />
            <Summary label="期末の帳簿価額" value={book.totals.closingBook} />
          </div>

          {isCorp && (book.totals.excess > 0 || book.totals.allowed > 0) && (
            <Note tone="info">
              法人税の申告で調整が要ります（別表四・別表十六）。
              {book.totals.excess > 0 && <> 償却超過額 {formatYen(book.totals.excess)} を加算します。</>}
              {book.totals.allowed > 0 && <> 前期までの償却超過額のうち {formatYen(book.totals.allowed)} を減算（認容）します。</>}
            </Note>
          )}

          <JournalBar
            clientId={id}
            book={book}
            canWrite={canWrite}
            busy={busy}
            run={run}
          />

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[960px]">
                <thead>
                  <tr className="bg-muted/20 border-b-2 border-border text-muted-foreground">
                    <th className="text-left px-3 py-2 font-bold">資産名・科目</th>
                    <th className="text-left px-3 py-2 font-bold">使い始めた日</th>
                    <th className="text-right px-3 py-2 font-bold">取得価額</th>
                    <th className="text-left px-3 py-2 font-bold">耐用年数・方法</th>
                    <th className="text-right px-3 py-2 font-bold">期首帳簿価額</th>
                    <th className="text-right px-3 py-2 font-bold">償却限度額</th>
                    <th className="text-right px-3 py-2 font-bold">当期の計上額</th>
                    {isCorp && <th className="text-right px-3 py-2 font-bold">償却超過額</th>}
                    <th className="text-right px-3 py-2 font-bold">期末帳簿価額</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {book.assets.map((a) => {
                    const c = a.current;
                    const open = expanded === a.id;
                    return (
                      <Fragment key={a.id}>
                        <tr
                          className={cn("border-b border-border/50 hover:bg-muted/10 cursor-pointer", a.disposedAt && "opacity-60")}
                          onClick={() => setExpanded(open ? null : a.id)}
                        >
                          <td className="px-3 py-2">
                            <div className="font-medium text-foreground flex items-center gap-1.5">
                              {a.name}
                              {a.warnings.length > 0 && <AlertTriangle className="size-3.5 text-warning" />}
                            </div>
                            <div className="text-muted-foreground">
                              {a.accountName}
                              {a.disposedAt && <Badge variant="muted" className="ml-1">除却 {a.disposedAt}</Badge>}
                            </div>
                          </td>
                          <td className="px-3 py-2 tabular-nums text-muted-foreground">{a.serviceStartDate}</td>
                          <td className="px-3 py-2 text-right font-mono">{formatYen(a.acquisitionCost)}</td>
                          <td className="px-3 py-2">
                            {a.usefulLife}年 <Badge variant={a.kind === "sl" ? "default" : "accent"}>{a.kindLabel}</Badge>
                            {a.specialRate ? <Badge variant="info" className="ml-1">特別償却</Badge> : null}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">{c ? formatYen(c.openingBook) : "—"}</td>
                          <td className="px-3 py-2 text-right font-mono">
                            {c?.limit != null ? formatYen(c.limit) : "—"}
                            {c && c.specialLimit > 0 && (
                              <div className="text-[10px] text-muted-foreground">うち特別 {formatYen(c.specialLimit)}</div>
                            )}
                          </td>
                          <td className={cn("px-3 py-2 text-right font-mono font-bold", c?.overridden && "text-primary")}>
                            {c ? formatYen(c.booked) : "—"}
                          </td>
                          {isCorp && (
                            <td className="px-3 py-2 text-right font-mono">
                              {c && c.excess > 0 ? <span className="text-warning">{formatYen(c.excess)}</span> : ""}
                              {c && c.allowed > 0 ? <span className="text-info">認容 {formatYen(c.allowed)}</span> : ""}
                            </td>
                          )}
                          <td className="px-3 py-2 text-right font-mono font-bold">{formatYen(a.closingBook)}</td>
                          <td className="px-2 py-2 text-center">
                            {open ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
                          </td>
                        </tr>
                        {open && (
                          <tr>
                            <td colSpan={isCorp ? 10 : 9} className="p-0">
                              <AssetDetail
                                clientId={id}
                                book={book}
                                asset={a}
                                canWrite={canWrite}
                                isCorp={isCorp}
                                journalLocked={journalLocked}
                                busy={busy}
                                run={run}
                                onEdit={() => setEditing(a)}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {book.assets.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-3 py-12 text-center text-muted-foreground text-sm">
                        この期の固定資産はありません。「資産を登録」から追加してください。
                      </td>
                    </tr>
                  )}
                  {book.assets.length > 0 && (
                    <tr className="bg-muted/20 border-t-2 border-border font-bold">
                      <td className="px-3 py-2" colSpan={2}>
                        合計
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{formatYen(book.totals.cost)}</td>
                      <td />
                      <td className="px-3 py-2 text-right font-mono">{formatYen(book.totals.openingBook)}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatYen(book.totals.limit)}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatYen(book.totals.booked)}</td>
                      {isCorp && <td className="px-3 py-2 text-right font-mono">{book.totals.excess ? formatYen(book.totals.excess) : ""}</td>}
                      <td className="px-3 py-2 text-right font-mono">{formatYen(book.totals.closingBook)}</td>
                      <td />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <Note tone="info">
            <b>用語</b>：償却限度額は、税金の計算で経費（損金）にできる減価償却費の上限です。
            {isCorp
              ? "法人は、この範囲で帳簿に計上する額を決められます（任意償却）。上限を超えて計上した分は「償却超過額」として、申告で利益に足し戻します。"
              : "個人事業主は、償却限度額どおりに計上します。"}
            特別償却は、国の制度（中小企業投資促進税制など）を使って、使い始めた年に上乗せで償却できるものです。
          </Note>
        </>
      )}
    </div>
  );
}

function Note({ tone, children }: { tone: "info" | "warning" | "success"; children: React.ReactNode }) {
  const cls = {
    info: "border-info/30 bg-info/10 text-info",
    warning: "border-warning/30 bg-warning/10 text-warning",
    success: "border-success/30 bg-success/10 text-success",
  }[tone];
  const Icon = tone === "warning" ? AlertTriangle : tone === "success" ? CheckCircle2 : Info;
  return (
    <div className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 text-sm", cls)}>
      <Icon className="size-4 mt-0.5 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

function Summary({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-bold text-foreground font-mono mt-1">{formatYen(value)}</p>
      {note && <p className="text-[11px] text-muted-foreground mt-0.5">{note}</p>}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 設定（端数処理・記帳方法）
// ---------------------------------------------------------------------------

function Settings({ clientId, book, canWrite, onSaved }: { clientId: string; book: DepreciationBook; canWrite: boolean; onSaved: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (s: Parameters<typeof saveDepreciationSettings>[1]) => {
    setSaving(true);
    setError(null);
    try {
      await saveDepreciationSettings(clientId, s);
      onSaved();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  };
  const disabled = !canWrite || saving;
  return (
    <Card className="p-4 flex flex-wrap items-end gap-x-6 gap-y-3">
      <label className="text-sm">
        <span className="block text-xs font-bold text-muted-foreground mb-1">1円未満の端数</span>
        <select
          value={book.rounding}
          disabled={disabled}
          onChange={(e) => save({ rounding: e.target.value as DepreciationRounding })}
          className={cn(fieldCls, "w-36")}
        >
          {(Object.keys(ROUNDING_LABELS) as DepreciationRounding[]).map((k) => (
            <option key={k} value={k}>
              {ROUNDING_LABELS[k]}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        <span className="block text-xs font-bold text-muted-foreground mb-1">仕訳の書き方</span>
        <select
          value={book.entryMethod}
          disabled={disabled || Boolean(book.journal)}
          onChange={(e) => save({ entryMethod: e.target.value as "direct" | "indirect" })}
          className={cn(fieldCls, "w-60")}
        >
          <option value="direct">直接法（資産の科目を直接減らす）</option>
          <option value="indirect">間接法（減価償却累計額を使う）</option>
        </select>
      </label>
      <p className="text-xs text-muted-foreground flex-1 min-w-[240px]">
        端数は、償却限度額の1円未満をどう扱うかです。中小企業では直接法がよく使われます。
        {book.journal && " 仕訳を作った期は、書き方を変えられません（先に仕訳を取り消してください）。"}
      </p>
      {saving && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      {error && <p className="w-full text-sm text-destructive">{error}</p>}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 減価償却の仕訳
// ---------------------------------------------------------------------------

function JournalBar({
  clientId,
  book,
  canWrite,
  busy,
  run,
}: {
  clientId: string;
  book: DepreciationBook;
  canWrite: boolean;
  busy: string | null;
  run: (key: string, fn: () => Promise<unknown>) => Promise<void>;
}) {
  if (book.journal) {
    return (
      <Card className="p-4 flex flex-wrap items-center gap-3 border-success/30">
        <CheckCircle2 className="size-5 text-success" />
        <span className="text-sm">
          この期の減価償却の仕訳は作成済みです（{book.journal.date}・{formatYen(book.journal.amount)}）。
        </span>
        <Link
          href={`/clients/${clientId}/ledgers?tab=journal&entry=${book.journal.entryIds[0]}&date=${book.journal.date}`}
          className="text-sm text-primary underline flex items-center gap-1"
        >
          <FileText className="size-3.5" />
          仕訳を見る
        </Link>
        {canWrite && (
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            disabled={busy === "cancel"}
            onClick={() => {
              if (!confirm("この期の減価償却の仕訳を削除します。よろしいですか？")) return;
              run("cancel", () => cancelDepreciationJournal(clientId, book.period.key));
            }}
          >
            {busy === "cancel" && <Loader2 className="size-4 animate-spin" />}
            仕訳を取り消す
          </Button>
        )}
      </Card>
    );
  }
  if (book.totals.booked === 0) return null;
  return (
    <Card className="p-4 flex flex-wrap items-center gap-3">
      <span className="text-sm">
        期末日（{book.period.endDate}）付けで、減価償却費 <b className="font-mono">{formatYen(book.totals.booked)}</b> の仕訳を作ります（
        {book.entryMethod === "direct" ? "直接法" : "間接法"}）。
      </span>
      {canWrite && (
        <Button
          size="sm"
          className="ml-auto"
          disabled={busy === "post" || book.missingAccounts.length > 0}
          onClick={() => run("post", () => postDepreciationJournal(clientId, book.period.key))}
        >
          {busy === "post" && <Loader2 className="size-4 animate-spin" />}
          減価償却の仕訳を作る
        </Button>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 資産の詳細（計上額の指定・償却スケジュール）
// ---------------------------------------------------------------------------

function AssetDetail({
  clientId,
  book,
  asset,
  canWrite,
  isCorp,
  journalLocked,
  busy,
  run,
  onEdit,
}: {
  clientId: string;
  book: DepreciationBook;
  asset: DepreciationAsset;
  canWrite: boolean;
  isCorp: boolean;
  journalLocked: boolean;
  busy: string | null;
  run: (key: string, fn: () => Promise<unknown>) => Promise<void>;
  onEdit: () => void;
}) {
  const c = asset.current;
  const [amount, setAmount] = useState(c ? String(c.booked) : "");
  const [disposeDate, setDisposeDate] = useState("");
  const canSetAmount = canWrite && c && !journalLocked && (isCorp || asset.kind === "unsupported");

  return (
    <div className="bg-muted/10 p-4 border-b border-border space-y-4">
      {asset.warnings.map((w) => (
        <Note key={w} tone="warning">
          {w}
        </Note>
      ))}

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
        <span>取得日 {asset.acquisitionDate}</span>
        {asset.rate && (
          <span>
            償却率 {asset.rate.rate.toFixed(3)}
            {asset.rate.revised != null && ` ／ 改定償却率 ${asset.rate.revised.toFixed(3)} ／ 保証率 ${asset.rate.guarantee?.toFixed(5)}`}
          </span>
        )}
        {asset.specialRate ? (
          <span>
            特別償却 {Math.round(asset.specialRate * 1000) / 10}%{asset.specialNote ? `（${asset.specialNote}）` : ""}
          </span>
        ) : null}
        {asset.note && <span>メモ: {asset.note}</span>}
      </div>

      {canSetAmount && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="block text-xs font-bold text-muted-foreground mb-1">
              当期の計上額{asset.kind === "unsupported" ? "（旧定額法・旧定率法で計算した額）" : "（任意償却）"}
            </span>
            <AmountInput value={amount} onChange={setAmount} className={cn(fieldCls, "w-40 text-right")} />
          </label>
          <Button
            size="sm"
            disabled={busy === `amt-${asset.id}` || amount === ""}
            onClick={() => run(`amt-${asset.id}`, () => setBookedAmount(clientId, asset.id, book.period, Number(amount)))}
          >
            この額にする
          </Button>
          {c?.overridden && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy === `amt-${asset.id}`}
              onClick={() => run(`amt-${asset.id}`, () => setBookedAmount(clientId, asset.id, book.period, null))}
            >
              償却限度額どおりに戻す
            </Button>
          )}
          <span className="text-xs text-muted-foreground">
            {c?.limit != null && `償却限度額は ${formatYen(c.limit)} です。下回っても構いませんが、超えた分は損金になりません。`}
          </span>
        </div>
      )}

      <div>
        <h4 className="text-sm font-bold text-foreground mb-2">償却スケジュール</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[640px]">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left px-2 py-1.5">事業年度</th>
                <th className="text-right px-2 py-1.5">月数</th>
                <th className="text-right px-2 py-1.5">期首帳簿価額</th>
                <th className="text-right px-2 py-1.5">償却限度額</th>
                <th className="text-right px-2 py-1.5">計上額</th>
                {isCorp && <th className="text-right px-2 py-1.5">償却超過額の残り</th>}
                <th className="text-right px-2 py-1.5">期末帳簿価額</th>
              </tr>
            </thead>
            <tbody>
              {asset.schedule.map((r) => {
                const current = r.start === book.period.startDate;
                const future = r.start > book.period.startDate;
                return (
                  <tr
                    key={r.start}
                    className={cn("border-b border-border/40 last:border-0", current && "bg-primary/5 font-medium", future && "text-muted-foreground")}
                  >
                    <td className="px-2 py-1 tabular-nums">
                      {r.start} 〜 {r.end}
                      {current && <Badge className="ml-2 text-[10px]">当期</Badge>}
                      {future && <span className="ml-2 text-[10px]">見込み</span>}
                      {r.revised && <span className="ml-2 text-[10px] text-accent">改定償却率</span>}
                    </td>
                    <td className="px-2 py-1 text-right">{r.months}</td>
                    <td className="px-2 py-1 text-right font-mono">{formatYen(r.openingBook)}</td>
                    <td className="px-2 py-1 text-right font-mono">{r.limit != null ? formatYen(r.limit) : "—"}</td>
                    <td className={cn("px-2 py-1 text-right font-mono", r.overridden && "text-primary")}>{formatYen(r.booked)}</td>
                    {isCorp && <td className="px-2 py-1 text-right font-mono">{r.closingExcess ? formatYen(r.closingExcess) : ""}</td>}
                    <td className="px-2 py-1 text-right font-mono">{formatYen(r.closingBook)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">
          青い数字は、計上額を決めた期（任意償却で指定した、または仕訳を作った）です。それ以外の期は償却限度額どおりに計上したものとして計算しています。
        </p>
      </div>

      {canWrite && (
        <div className="flex flex-wrap items-end gap-2 pt-2 border-t border-border">
          <Button size="sm" variant="outline" onClick={onEdit}>
            <Pencil className="size-3.5" />
            資産を編集
          </Button>
          {asset.disposedAt ? (
            <Button size="sm" variant="outline" onClick={() => run(`disp-${asset.id}`, () => disposeAsset(clientId, asset.id, null))}>
              除却を取り消す
            </Button>
          ) : (
            <>
              <label className="text-sm">
                <span className="block text-xs font-bold text-muted-foreground mb-1">売却・除却した日</span>
                <DateInput allowEmpty value={disposeDate} onChange={setDisposeDate} className={cn(fieldCls, "w-36")} />
              </label>
              <Button
                size="sm"
                variant="outline"
                disabled={!disposeDate || busy === `disp-${asset.id}`}
                onClick={() => run(`disp-${asset.id}`, () => disposeAsset(clientId, asset.id, disposeDate))}
              >
                売却・除却として登録
              </Button>
            </>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto text-destructive"
            disabled={busy === `del-${asset.id}`}
            onClick={() => {
              if (!confirm(`「${asset.name}」を固定資産台帳から削除します。よろしいですか？`)) return;
              run(`del-${asset.id}`, () => deleteAsset(clientId, asset.id));
            }}
          >
            <Trash2 className="size-3.5" />
            削除
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 資産の登録・編集
// ---------------------------------------------------------------------------

function AssetForm({
  clientId,
  book,
  asset,
  onClose,
  onSaved,
}: {
  clientId: string;
  book: DepreciationBook;
  asset: DepreciationAsset | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState({
    name: asset?.name ?? "",
    accountId: asset?.accountId ?? book.assetAccounts.find((a) => a.name === "器具備品")?.id ?? book.assetAccounts[0]?.id ?? "",
    acquisitionDate: asset?.acquisitionDate ?? "",
    serviceStartDate: asset && asset.serviceStartDate !== asset.acquisitionDate ? asset.serviceStartDate : "",
    acquisitionCost: asset ? String(asset.acquisitionCost) : "",
    usefulLife: asset ? String(asset.usefulLife) : "",
    method: asset?.method ?? ("straight_line" as AssetInput["method"]),
    special: asset?.specialRate ? String(Math.round(asset.specialRate * 1000) / 10) : "",
    specialNote: asset?.specialNote ?? "",
    note: asset?.note ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accountName = book.assetAccounts.find((a) => a.id === f.accountId)?.name ?? "";
  const slOnly = f.acquisitionDate ? straightLineOnlyReason(accountName, f.acquisitionDate) : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await saveAsset(
        clientId,
        {
          name: f.name,
          accountId: f.accountId,
          acquisitionDate: f.acquisitionDate,
          serviceStartDate: f.serviceStartDate || null,
          acquisitionCost: Number(f.acquisitionCost),
          usefulLife: Number(f.usefulLife),
          method: slOnly ? "straight_line" : f.method,
          specialRatePercent: f.special ? Number(f.special) : null,
          specialNote: f.specialNote,
          note: f.note,
        },
        asset?.id
      );
      onSaved();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  const label = (text: string, hint?: string) => (
    <span className="block text-xs font-bold text-muted-foreground mb-1">
      {text}
      {hint && <span className="font-normal ml-1">{hint}</span>}
    </span>
  );

  return (
    <Card className="p-5">
      <h3 className="text-sm font-bold text-foreground mb-4">{asset ? "資産を編集" : "資産を登録"}</h3>
      <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <label>
          {label("資産名 *")}
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={fieldCls} placeholder="例: ノートパソコン" />
        </label>
        <label>
          {label("勘定科目 *")}
          <select value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })} className={fieldCls}>
            {book.assetAccounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} {a.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {label("取得価額 *", "（税抜経理なら税抜の額）")}
          <AmountInput value={f.acquisitionCost} onChange={(v) => setF({ ...f, acquisitionCost: v })} className={cn(fieldCls, "text-right")} />
        </label>
        <label>
          {label("取得日 *")}
          <DateInput allowEmpty value={f.acquisitionDate} onChange={(v) => setF({ ...f, acquisitionDate: v })} className={fieldCls} />
        </label>
        <label>
          {label("事業に使い始めた日", "（取得日と違うときだけ）")}
          <DateInput allowEmpty value={f.serviceStartDate} onChange={(v) => setF({ ...f, serviceStartDate: v })} className={fieldCls} />
        </label>
        <label>
          {label("耐用年数 *", `（${MIN_USEFUL_LIFE}〜${MAX_USEFUL_LIFE}年）`)}
          <input
            type="number"
            min={MIN_USEFUL_LIFE}
            max={MAX_USEFUL_LIFE}
            value={f.usefulLife}
            onChange={(e) => setF({ ...f, usefulLife: e.target.value })}
            className={fieldCls}
          />
        </label>
        <label>
          {label("償却方法 *")}
          <select
            value={slOnly ? "straight_line" : f.method}
            disabled={Boolean(slOnly)}
            onChange={(e) => setF({ ...f, method: e.target.value as AssetInput["method"] })}
            className={fieldCls}
          >
            <option value="straight_line">定額法（毎年同じ額）</option>
            <option value="declining_balance">定率法（初めに多く、だんだん少なく）</option>
          </select>
          {slOnly && <span className="block text-[11px] text-muted-foreground mt-1">{slOnly}</span>}
        </label>
        <label>
          {label("特別償却率（%）", "（使う制度があるときだけ）")}
          <input
            type="number"
            min={0}
            max={100}
            step="0.1"
            value={f.special}
            onChange={(e) => setF({ ...f, special: e.target.value })}
            className={fieldCls}
            placeholder="例: 30、即時償却なら 100"
          />
        </label>
        <label>
          {label("特別償却の制度名")}
          <input
            value={f.specialNote}
            disabled={!f.special}
            onChange={(e) => setF({ ...f, specialNote: e.target.value })}
            className={fieldCls}
            placeholder="例: 中小企業投資促進税制"
          />
        </label>
        <label className="md:col-span-3">
          {label("メモ")}
          <input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} className={fieldCls} />
        </label>
        {error && <p className="md:col-span-3 text-sm text-destructive">{error}</p>}
        <div className="md:col-span-3 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            やめる
          </Button>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />}
            {asset ? "保存" : "登録"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
