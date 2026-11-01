"use client";

/**
 * 固定資産台帳と減価償却。
 * 計算は src/lib/depreciation.ts（テストあり）、保存と仕訳の作成は src/actions/assets.ts。
 */

import { Fragment, useEffect, useRef, useState } from "react";
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
  LogOut,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { AmountInput } from "@/components/ui/amount-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { handleBarKeyNav } from "@/lib/key-nav";
import { cn } from "@/lib/utils";
import { formatYen } from "@/lib/wareki";
import { useClientRole } from "@/lib/use-client-role";
import { SPECIAL_MEASURES, specialMeasure, clauseText } from "@/lib/special-measures";
import {
  ROUNDING_LABELS,
  straightLineOnlyReason,
  usedAssetUsefulLife,
  MIN_USEFUL_LIFE,
  MAX_USEFUL_LIFE,
  type DepreciationRounding,
} from "@/lib/depreciation";
import { SALE_TAX_CATEGORIES, type DisposalType } from "@/lib/asset-disposal";
import type { TaxCategoryCode } from "@/lib/tax-category";
import {
  getDepreciationBook,
  saveAsset,
  deleteAsset,
  previewDisposal,
  createDisposal,
  cancelDisposal,
  saveDepreciationSettings,
  setBookedAmount,
  postDepreciationJournal,
  cancelDepreciationJournal,
  type DepreciationBook,
  type DepreciationAsset,
  type DisposalPreview,
  type DisposalRequest,
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
            固定資産・減価償却
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
            <Summary
              label="当期の償却限度額"
              value={book.totals.limit}
              note={
                book.totals.specialLimit > 0
                  ? `普通 ${formatYen(book.totals.ordinaryLimit)} ＋ 特別 ${formatYen(book.totals.specialLimit)}`
                  : "経費にできる上限（普通償却）"
              }
            />
            <Summary
              label="当期の計上額"
              value={book.totals.booked}
              note={
                book.totals.inDisposal > 0
                  ? `うち ${formatYen(book.totals.inDisposal)} は売却・除却の仕訳に計上`
                  : "帳簿に計上する減価償却費"
              }
            />
            <Summary label="期末の帳簿価額" value={book.totals.closingBook} />
          </div>

          {book.totals.specialShortfall > 0 && (
            <Note tone="info">
              特別償却の限度額まで計上しなかった分（特別償却不足額）{formatYen(book.totals.specialShortfall)} を、
              翌期に1年だけ繰り越して上乗せできます（翌期の特別償却限度額に足しています）。
            </Note>
          )}

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
              <table className="w-full text-xs min-w-[1060px]">
                <thead>
                  <tr className="bg-muted/20 border-b-2 border-border text-muted-foreground">
                    <th className="text-left px-3 py-2 font-bold">資産名・科目</th>
                    <th className="text-left px-3 py-2 font-bold">使い始めた日</th>
                    <th className="text-right px-3 py-2 font-bold">取得価額</th>
                    <th className="text-left px-3 py-2 font-bold">耐用年数・方法</th>
                    <th className="text-right px-3 py-2 font-bold">期首帳簿価額</th>
                    <th className="text-right px-3 py-2 font-bold">普通償却限度額</th>
                    <th className="text-right px-3 py-2 font-bold">特別償却限度額</th>
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
                              {a.disposedAt && (
                                <Badge variant="muted" className="ml-1">
                                  {a.disposal?.type === "sale" ? "売却" : "除却"} {a.disposedAt}
                                </Badge>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2 tabular-nums text-muted-foreground">{a.serviceStartDate}</td>
                          <td className="px-3 py-2 text-right font-mono">{formatYen(a.acquisitionCost)}</td>
                          <td className="px-3 py-2">
                            {a.usefulLife}年 <Badge variant={a.kind === "sl" ? "default" : "accent"}>{a.kindLabel}</Badge>
                            {a.isUsed ? <Badge variant="muted" className="ml-1">中古</Badge> : null}
                            {a.specialRate ? <Badge variant="info" className="ml-1">特別償却</Badge> : null}
                            {a.specialTreatment === "tax_credit" ? <Badge variant="success" className="ml-1">税額控除</Badge> : null}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">{c ? formatYen(c.openingBook) : "—"}</td>
                          <td className="px-3 py-2 text-right font-mono">{c?.limit != null ? formatYen(c.ordinaryLimit) : "—"}</td>
                          <td className="px-3 py-2 text-right font-mono">
                            {c && c.specialLimit > 0 ? formatYen(c.specialLimit) : ""}
                            {c && c.specialShortfall > 0 && (
                              <div className="text-[10px] text-info">不足額 {formatYen(c.specialShortfall)} を翌期へ</div>
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
                            <td colSpan={isCorp ? 11 : 10} className="p-0">
                              <AssetDetail
                                clientId={id}
                                book={book}
                                asset={a}
                                canWrite={canWrite}
                                isCorp={isCorp}
                                journalLocked={journalLocked}
                                busy={busy}
                                run={run}
                                reload={reload}
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
                      <td className="px-3 py-2 text-right font-mono">{formatYen(book.totals.ordinaryLimit)}</td>
                      <td className="px-3 py-2 text-right font-mono">{book.totals.specialLimit ? formatYen(book.totals.specialLimit) : ""}</td>
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
  if (book.totals.toPost === 0) return null;
  return (
    <Card className="p-4 flex flex-wrap items-center gap-3">
      <span className="text-sm">
        期末日（{book.period.endDate}）付けで、減価償却費 <b className="font-mono">{formatYen(book.totals.toPost)}</b> の仕訳を作ります（
        {book.entryMethod === "direct" ? "直接法" : "間接法"}）。
        {book.totals.inDisposal > 0 && (
          <> 売却・除却の仕訳に入れた手放した月までの償却費 {formatYen(book.totals.inDisposal)} は、二重にならないよう除きます。</>
        )}
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
  reload,
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
  reload: () => void;
  onEdit: () => void;
}) {
  const c = asset.current;
  const [amount, setAmount] = useState(c ? String(c.booked) : "");
  // 期首の帳簿価額から備忘価額1円を残した額までしか計上できない。超える額は黙って丸めず、止めて知らせる
  const maxAmount = c ? Math.max(0, c.openingBook - 1) : 0;
  const amountTooLarge = amount !== "" && Number(amount) > maxAmount;
  const [disposing, setDisposing] = useState(false);
  // 売却・除却の仕訳を作った資産は、その仕訳の額で決まっている（変えるときは取り消してから）
  const disposalJournal = asset.disposal?.journal ?? null;
  const canSetAmount =
    canWrite && c && !journalLocked && !asset.depreciationInDisposal && !disposalJournal && (isCorp || asset.kind === "unsupported");

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
            disabled={busy === `amt-${asset.id}` || amount === "" || amountTooLarge}
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
          {amountTooLarge ? (
            <span className="text-xs text-destructive">
              期首の帳簿価額（{formatYen(c?.openingBook ?? 0)}）から1円（備忘価額）を残した {formatYen(maxAmount)} までしか計上できません。
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">
              {c?.limit != null && `償却限度額は ${formatYen(c.limit)} です。下回っても構いませんが、超えた分は損金になりません。`}
            </span>
          )}
        </div>
      )}

      <div>
        <h4 className="text-sm font-bold text-foreground mb-2">償却スケジュール</h4>
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[820px]">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left px-2 py-1.5">事業年度</th>
                <th className="text-right px-2 py-1.5">月数</th>
                <th className="text-right px-2 py-1.5">期首帳簿価額</th>
                <th className="text-right px-2 py-1.5">普通償却限度額</th>
                <th className="text-right px-2 py-1.5">特別償却限度額</th>
                <th className="text-right px-2 py-1.5">計上額</th>
                <th className="text-right px-2 py-1.5">特別償却不足額（翌期へ）</th>
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
                    <td className="px-2 py-1 text-right font-mono">{r.limit != null ? formatYen(r.ordinaryLimit) : "—"}</td>
                    <td className="px-2 py-1 text-right font-mono">{r.specialLimit ? formatYen(r.specialLimit) : ""}</td>
                    <td className={cn("px-2 py-1 text-right font-mono", r.overridden && "text-primary")}>{formatYen(r.booked)}</td>
                    <td className="px-2 py-1 text-right font-mono">{r.specialShortfall ? formatYen(r.specialShortfall) : ""}</td>
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

      {asset.disposal && (
        <DisposalInfo clientId={clientId} asset={asset} canWrite={canWrite} busy={busy} run={run} />
      )}

      {canWrite && disposing && !asset.disposal && (
        <DisposalForm
          clientId={clientId}
          book={book}
          asset={asset}
          onClose={() => setDisposing(false)}
          onDone={() => {
            setDisposing(false);
            reload();
          }}
        />
      )}

      {canWrite && (
        <div className="flex flex-wrap items-end gap-2 pt-2 border-t border-border">
          {disposalJournal ? (
            <span className="text-xs text-muted-foreground">
              売却・除却の仕訳を作った資産は、編集・削除できません。直すときは先に売却・除却を取り消してください。
            </span>
          ) : (
            <>
              <Button size="sm" variant="outline" onClick={onEdit}>
                <Pencil className="size-3.5" />
                資産を編集
              </Button>
              {!asset.disposal && !disposing && (
                <Button size="sm" variant="outline" onClick={() => setDisposing(true)}>
                  <LogOut className="size-3.5" />
                  売却・除却
                </Button>
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
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 売却・除却
// ---------------------------------------------------------------------------

/** 売却代金の税区分（償却資産の売却で使うものだけ） */
const SALE_TAX_LABELS: Record<string, string> = {
  sales_10: "課税売上10%",
  sales_tax_free: "免税売上（輸出）",
  sales_out_of_scope: "不課税（国外にある資産の譲渡など）",
};

/** 売却・除却を登録した資産: 中身と仕訳へのリンク、取り消し */
function DisposalInfo({
  clientId,
  asset,
  canWrite,
  busy,
  run,
}: {
  clientId: string;
  asset: DepreciationAsset;
  canWrite: boolean;
  busy: string | null;
  run: (key: string, fn: () => Promise<unknown>) => Promise<void>;
}) {
  const d = asset.disposal!;
  const kind = d.type === "sale" ? "売却" : d.type === "retire" ? "除却" : "売却・除却";
  const key = `disp-${asset.id}`;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm">
      <CheckCircle2 className="size-4 text-success" />
      <span className="text-foreground">
        {asset.disposedAt} に{kind}
        {d.journal ? "しました（仕訳を作成済み）" : "したことを記録しています（仕訳はありません）"}
        {d.salePrice != null && (
          <>
            。売却代金 <span className="font-mono">{formatYen(d.salePrice)}</span>
            {d.saleAccountName && `（${d.saleAccountName}）`}
          </>
        )}
      </span>
      {d.journal && (
        <Link
          href={`/clients/${clientId}/ledgers?tab=journal&entry=${d.journal.entryId}&date=${d.journal.date}`}
          className="text-primary underline flex items-center gap-1"
        >
          <FileText className="size-3.5" />
          仕訳を見る
        </Link>
      )}
      {canWrite && (
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          disabled={busy === key}
          onClick={() => {
            const msg = d.journal
              ? `「${asset.name}」の${kind}の仕訳を削除し、手放す前の状態に戻します。よろしいですか？`
              : `「${asset.name}」の${kind}の記録を取り消します。よろしいですか？`;
            if (!confirm(msg)) return;
            run(key, () => cancelDisposal(clientId, asset.id));
          }}
        >
          {busy === key && <Loader2 className="size-4 animate-spin" />}
          {kind}を取り消す
        </Button>
      )}
    </div>
  );
}

type DisposalFields = {
  type: DisposalType;
  date: string;
  salePrice: string;
  saleAccountId: string;
  saleTaxCategory: TaxCategoryCode;
  /** 税抜経理か。null は仕訳から判断してもらう（見込みを出すと決まる） */
  exclusive: boolean | null;
};

/** 売却・除却の入力 → 仕訳の見込み → 作成 */
function DisposalForm({
  clientId,
  book,
  asset,
  onClose,
  onDone,
}: {
  clientId: string;
  book: DepreciationBook;
  asset: DepreciationAsset;
  onClose: () => void;
  onDone: () => void;
}) {
  const [f, setF] = useState<DisposalFields>({
    type: "sale",
    date: "",
    salePrice: "",
    saleAccountId: book.receiptAccounts.find((a) => a.name === "普通預金")?.id ?? book.receiptAccounts[0]?.id ?? "",
    saleTaxCategory: "sales_10",
    exclusive: null,
  });
  const [preview, setPreview] = useState<DisposalPreview | null>(null);
  const [busy, setBusy] = useState<"preview" | "create" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 連打で仕訳が2本できないよう、押した瞬間に蓋をする（state の反映は間に合わない）
  const creating = useRef(false);

  const toRequest = (x: DisposalFields): DisposalRequest => ({
    type: x.type,
    date: x.date,
    salePrice: x.type === "sale" && x.salePrice !== "" ? Number(x.salePrice) : null,
    saleAccountId: x.type === "sale" ? x.saleAccountId || null : null,
    saleTaxCategory: x.type === "sale" ? x.saleTaxCategory : null,
    exclusive: x.type === "sale" ? x.exclusive : null,
  });

  // 入力を変えたら見込みを消す（古い見込みのまま作らせない）
  const change = (patch: Partial<DisposalFields>) => {
    setF((x) => ({ ...x, ...patch }));
    setPreview(null);
    setError(null);
  };

  const loadPreview = async (x: DisposalFields) => {
    setBusy("preview");
    setError(null);
    try {
      const p = await previewDisposal(clientId, asset.id, toRequest(x));
      setPreview(p);
      // 仕訳から判断した経理方式を、選んだ状態で見せる（違っていれば選び直せる）
      if (x.type === "sale" && x.exclusive === null) setF((cur) => ({ ...cur, exclusive: p.exclusive }));
    } catch (e) {
      setPreview(null);
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    if (creating.current) return;
    creating.current = true;
    setBusy("create");
    setError(null);
    try {
      await createDisposal(clientId, asset.id, toRequest(f));
      onDone();
    } catch (e) {
      // 入力と見込みは残す（直してやり直せるように）
      setError(errMsg(e));
      creating.current = false;
    } finally {
      setBusy(null);
    }
  };

  const label = (text: string, hint?: string) => (
    <span className="block text-xs font-bold text-muted-foreground mb-1">
      {text}
      {hint && <span className="font-normal ml-1">{hint}</span>}
    </span>
  );
  const sale = f.type === "sale";
  const p = preview;
  const totalDebit = p ? p.lines.reduce((s, l) => s + l.debit, 0) : 0;
  const totalCredit = p ? p.lines.reduce((s, l) => s + l.credit, 0) : 0;

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-bold text-foreground">売却・除却を登録</h4>
        <span className="text-xs text-muted-foreground">
          手放した月までの当期の償却費・帳簿価額の消去・{sale ? "売却損益" : "除却損"}を、手放した日付けの1本の仕訳にします。
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          {label("種類")}
          {/* 2つを並べて選ばれている方を塗る */}
          <div role="radiogroup" aria-label="売却か除却か" className="inline-flex rounded-lg border border-border bg-muted/30 p-0.5">
            {(
              [
                ["sale", "売却"],
                ["retire", "除却（廃棄）"],
              ] as const
            ).map(([v, text]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={f.type === v}
                onClick={() => change({ type: v })}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-bold transition-colors",
                  f.type === v ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {text}
              </button>
            ))}
          </div>
        </div>
        <label className="text-sm">
          {label("手放した日")}
          <DateInput allowEmpty value={f.date} onChange={(v) => change({ date: v })} className={cn(fieldCls, "w-36")} />
        </label>
        {sale && (
          <>
            <label className="text-sm">
              {label("売却代金", "（税込）")}
              <AmountInput value={f.salePrice} onChange={(v) => change({ salePrice: v })} className={cn(fieldCls, "w-36 text-right")} />
            </label>
            <label className="text-sm">
              {label("入金先の科目")}
              <select value={f.saleAccountId} onChange={(e) => change({ saleAccountId: e.target.value })} className={cn(fieldCls, "w-44")}>
                {book.receiptAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              {label("売却代金の税区分")}
              <select
                value={f.saleTaxCategory}
                onChange={(e) => change({ saleTaxCategory: e.target.value as TaxCategoryCode })}
                className={cn(fieldCls, "w-60")}
              >
                {SALE_TAX_CATEGORIES.map((code) => (
                  <option key={code} value={code}>
                    {SALE_TAX_LABELS[code] ?? code}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>
      {sale && (
        <p className="text-xs text-muted-foreground">
          下取りで新しい資産の代金と相殺したときは、入金先に未払金などを選んでください。
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={!f.date || busy !== null} onClick={() => loadPreview(f)}>
          {busy === "preview" && <Loader2 className="size-4 animate-spin" />}
          仕訳の見込みを出す
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose} disabled={busy === "create"}>
          やめる
        </Button>
        {!f.date && <span className="text-xs text-muted-foreground">手放した日を入れると、見込みを出せます。</span>}
      </div>

      {error && <Note tone="warning">{error}</Note>}

      {p && (
        <div className="space-y-3 border-t border-border pt-3">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span>
              手放した期 {p.period.startDate}〜{p.period.endDate}
              {!p.continuesAmortization && `（期首から${p.months}か月）`}
            </span>
            {!p.continuesAmortization && (
              <>
                <span>
                  当期の償却費 <span className="font-mono">{formatYen(p.depreciation)}</span>
                  {!p.depreciationIncluded && <span className="text-muted-foreground">（減価償却の仕訳に計上済み）</span>}
                </span>
                <span>
                  手放した時点の帳簿価額 <span className="font-mono">{formatYen(p.bookValue)}</span>
                </span>
              </>
            )}
            {p.mode === "journal" && p.type === "sale" && (
              <span>
                {p.loss > 0 ? "売却損" : "売却益"}{" "}
                <b className="font-mono">{formatYen(p.loss > 0 ? p.loss : p.gain)}</b>
              </span>
            )}
            {p.mode === "journal" && p.type === "retire" && (
              <span>
                除却損 <b className="font-mono">{formatYen(p.retireLoss)}</b>
              </span>
            )}
          </div>

          {p.mode === "journal" && p.type === "sale" && (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs font-bold text-muted-foreground">消費税の経理方式</span>
              <div role="radiogroup" aria-label="消費税の経理方式" className="inline-flex rounded-lg border border-border bg-muted/30 p-0.5">
                {(
                  [
                    [false, "税込経理"],
                    [true, "税抜経理（仮受消費税を立てる）"],
                  ] as const
                ).map(([v, text]) => (
                  <button
                    key={text}
                    type="button"
                    role="radio"
                    aria-checked={p.exclusive === v}
                    disabled={p.taxExempt || busy !== null}
                    onClick={() => {
                      if (p.exclusive === v) return;
                      const next = { ...f, exclusive: v };
                      setF(next);
                      loadPreview(next);
                    }}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-sm font-bold transition-colors disabled:cursor-not-allowed",
                      p.exclusive === v ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {text}
                  </button>
                ))}
              </div>
              <span className="text-xs text-muted-foreground">
                {p.exclusiveNote}
                {!p.taxExempt && " 違っていれば選び直してください。"}
              </span>
            </div>
          )}

          {p.notes.map((n) => (
            <Note key={n} tone="info">
              {n}
            </Note>
          ))}
          {p.warnings.map((w) => (
            <Note key={w} tone="warning">
              {w}
            </Note>
          ))}

          {p.mode === "record_only" ? (
            <>
              <Note tone="info">{p.reason}</Note>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={busy !== null} onClick={create}>
                  {busy === "create" && <Loader2 className="size-4 animate-spin" />}
                  日付だけを記録する
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[720px]">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="text-left px-2 py-1.5">借方</th>
                      <th className="text-right px-2 py-1.5">金額</th>
                      <th className="text-left px-2 py-1.5">貸方</th>
                      <th className="text-right px-2 py-1.5">金額</th>
                      <th className="text-left px-2 py-1.5">税区分</th>
                      <th className="text-left px-2 py-1.5">内容</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.lines.map((l, i) => (
                      <tr key={i} className="border-b border-border/40">
                        <td className="px-2 py-1">{l.debit > 0 ? l.accountName : ""}</td>
                        <td className="px-2 py-1 text-right font-mono">{l.debit > 0 ? formatYen(l.debit) : ""}</td>
                        <td className="px-2 py-1">{l.credit > 0 ? l.accountName : ""}</td>
                        <td className="px-2 py-1 text-right font-mono">{l.credit > 0 ? formatYen(l.credit) : ""}</td>
                        <td className="px-2 py-1 text-muted-foreground">{l.taxCategoryName ?? ""}</td>
                        <td className="px-2 py-1 text-muted-foreground">{l.note}</td>
                      </tr>
                    ))}
                    <tr className="font-bold">
                      <td className="px-2 py-1">合計</td>
                      <td className="px-2 py-1 text-right font-mono">{formatYen(totalDebit)}</td>
                      <td />
                      <td className="px-2 py-1 text-right font-mono">{formatYen(totalCredit)}</td>
                      <td colSpan={2} />
                    </tr>
                  </tbody>
                </table>
              </div>
              {p.type === "sale" && (
                <p className="text-[11px] text-muted-foreground">
                  消費税の課税売上は、売却益（差額）ではなく売却代金の全額です。そのため固定資産売却益を、売却代金（課税売上）と
                  帳簿価額の消去（不課税）の2行に分けています。科目の残高は売却益の額になります。
                </p>
              )}
              {p.missingAccounts.length > 0 && (
                <Note tone="warning">
                  勘定科目（{p.missingAccounts.join("・")}）が見つかりません。
                  <Link href={`/clients/${clientId}/accounts`} className="underline ml-1">
                    勘定科目管理
                  </Link>
                  で有効にしてください。
                </Note>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" disabled={busy !== null || p.missingAccounts.length > 0} onClick={create}>
                  {busy === "create" && <Loader2 className="size-4 animate-spin" />}
                  {p.date} 付けでこの仕訳を作る
                </Button>
                <span className="text-xs text-muted-foreground">作った仕訳を削除すると、手放す前の状態に戻ります。</span>
              </div>
            </>
          )}
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
    // 特別償却の制度: "" 使わない / 区分番号 / "other" 一覧に無い制度（制度名を手入力）
    measure: asset?.specialMeasureCode ?? (asset?.specialRate ? "other" : ""),
    // 特別償却か税額控除か（税額控除のある制度だけ選べる）
    treatment: (asset?.specialTreatment ?? "depreciation") as "depreciation" | "tax_credit",
    // 事業専用割合（個人事業主の家事と共用の資産）
    businessRatio: asset ? String(asset.businessRatio) : "100",
    note: asset?.note ?? "",
    // 中古資産（簡便法の入力）。経過年数は年と月に分けて入れる
    isUsed: asset?.isUsed ?? false,
    usedLife: asset?.usedStatutoryLife != null ? String(asset.usedStatutoryLife) : "",
    usedYears: asset?.usedElapsedMonths != null ? String(Math.floor(asset.usedElapsedMonths / 12)) : "",
    usedMonths: asset?.usedElapsedMonths != null ? String(asset.usedElapsedMonths % 12) : "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accountName = book.assetAccounts.find((a) => a.id === f.accountId)?.name ?? "";
  const slOnly = f.acquisitionDate ? straightLineOnlyReason(accountName, f.acquisitionDate) : null;
  // 定額法しか使えない資産は、定率法を選べない（一括償却資産・少額減価償却資産は選べる）
  const method = slOnly && f.method === "declining_balance" ? "straight_line" : f.method;

  // 中古資産の見積耐用年数（簡便法）。読み取れない入力は計算せず、止めて知らせる
  const usedLife = f.usedLife === "" ? null : Number(f.usedLife);
  const usedYears = f.usedYears === "" ? 0 : Number(f.usedYears);
  const usedMonthsPart = f.usedMonths === "" ? 0 : Number(f.usedMonths);
  const usedElapsedOk =
    Number.isInteger(usedYears) && usedYears >= 0 && Number.isInteger(usedMonthsPart) && usedMonthsPart >= 0 && usedMonthsPart < 12;
  const usedElapsed = usedElapsedOk ? usedYears * 12 + usedMonthsPart : null;
  const usedLifeOk = usedLife === null || (Number.isInteger(usedLife) && usedLife >= 1 && usedLife <= 100);
  const usedEstimate =
    f.isUsed && usedLife !== null && usedLifeOk && usedElapsed !== null ? usedAssetUsefulLife(usedLife, usedElapsed) : null;
  const usedError = !f.isUsed
    ? null
    : !usedLifeOk
      ? "法定耐用年数は1〜100年の整数で入力してください"
      : !usedElapsedOk
        ? "経過年数は、年は0以上の整数、月は0〜11で入力してください"
        : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (usedError) {
      setError(usedError);
      return;
    }
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
          usefulLife: method === "lump_sum" ? 3 : Number(f.usefulLife),
          method,
          specialRatePercent: f.measure && f.special ? Number(f.special) : null,
          specialNote: f.specialNote,
          specialMeasureCode: f.measure && f.measure !== "other" ? f.measure : null,
          specialTreatment: specialMeasure(f.measure)?.credit ? f.treatment : "depreciation",
          businessRatio: book.entityType === "individual" && f.businessRatio ? Number(f.businessRatio) : 100,
          note: f.note,
          isUsed: f.isUsed,
          usedStatutoryLife: f.isUsed ? usedLife : null,
          usedElapsedMonths: f.isUsed && (f.usedYears !== "" || f.usedMonths !== "") ? usedElapsed : null,
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
      <form onSubmit={submit} onKeyDown={handleBarKeyNav} className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
            value={method === "lump_sum" ? "3" : f.usefulLife}
            disabled={method === "lump_sum"}
            onChange={(e) => setF({ ...f, usefulLife: e.target.value })}
            className={fieldCls}
          />
          {method === "lump_sum" && <span className="block text-[11px] text-muted-foreground mt-1">一括償却資産は耐用年数にかかわらず3年で均等に償却します</span>}
        </label>
        {method !== "lump_sum" && (
          <div className="md:col-span-3 rounded-lg border border-border bg-muted/10 p-3 space-y-2">
            <label className="flex items-center gap-2 text-sm font-bold text-foreground">
              <input type="checkbox" checked={f.isUsed} onChange={(e) => setF({ ...f, isUsed: e.target.checked })} />
              中古で取得した
              <span className="font-normal text-xs text-muted-foreground">（簡便法で耐用年数を見積もれます）</span>
            </label>
            {f.isUsed && (
              <>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="text-sm">
                    {label("法定耐用年数", "（新品のときの年数）")}
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={f.usedLife}
                      onChange={(e) => setF({ ...f, usedLife: e.target.value })}
                      className={cn(fieldCls, "w-24")}
                      placeholder="例: 6"
                    />
                  </label>
                  <div className="text-sm">
                    {label("経過年数", "（作られてから、または前の持ち主が使い始めてから取得まで）")}
                    <div className="flex flex-wrap items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        value={f.usedYears}
                        onChange={(e) => setF({ ...f, usedYears: e.target.value })}
                        className={cn(fieldCls, "w-20")}
                        aria-label="経過年数（年）"
                      />
                      <span>年</span>
                      <input
                        type="number"
                        min={0}
                        max={11}
                        value={f.usedMonths}
                        onChange={(e) => setF({ ...f, usedMonths: e.target.value })}
                        className={cn(fieldCls, "w-16")}
                        aria-label="経過年数（月）"
                      />
                      <span>か月</span>
                    </div>
                  </div>
                  {usedEstimate && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={f.usefulLife === String(usedEstimate.years)}
                      onClick={() => setF({ ...f, usefulLife: String(usedEstimate.years) })}
                    >
                      耐用年数を {usedEstimate.years}年にする
                    </Button>
                  )}
                </div>
                {usedError ? (
                  <p className="text-xs text-destructive">{usedError}</p>
                ) : usedEstimate && usedLife !== null && usedElapsed !== null ? (
                  <p className="text-xs text-foreground">
                    簡便法の見積耐用年数 <b>{usedEstimate.years}年</b>：
                    {usedEstimate.fullyElapsed
                      ? `法定耐用年数をすべて経過しているので ${usedLife}年 × 20% = ${usedEstimate.months}か月`
                      : `（${usedLife * 12}か月 − ${usedElapsed}か月）＋ ${usedElapsed}か月 × 20% = ${usedEstimate.months}か月`}
                    {" → 1年未満を切り捨て"}
                    {Math.floor(usedEstimate.months / 12) < MIN_USEFUL_LIFE && "、2年に満たないので2年"}
                    {f.usefulLife === String(usedEstimate.years) && "（耐用年数の欄と同じです）"}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">法定耐用年数と経過年数を入れると、見積耐用年数を計算します。</p>
                )}
                <p className="text-[11px] text-muted-foreground">
                  簡便法は、事業に使い始めた年度にだけ選べます（耐用年数省令3条）。取得後の改良費が取得価額の50%を超えるときは、法定耐用年数を使います。
                  合理的に見積もった年数（見積法）を使うときは、耐用年数の欄に直接入れてください。
                </p>
              </>
            )}
          </div>
        )}
        <label>
          {label("償却方法 *")}
          <select
            value={method}
            onChange={(e) => setF({ ...f, method: e.target.value as AssetInput["method"] })}
            className={fieldCls}
          >
            <option value="straight_line">定額法（毎年同じ額）</option>
            <option value="declining_balance" disabled={Boolean(slOnly)}>
              定率法（初めに多く、だんだん少なく）
            </option>
            <option value="lump_sum">一括償却資産（20万円未満・3年で均等）</option>
            <option value="small_immediate">少額減価償却資産（30万円未満・全額を経費）</option>
          </select>
          {slOnly && <span className="block text-[11px] text-muted-foreground mt-1">{slOnly}</span>}
        </label>
        {book.entityType === "individual" && (
          <label>
            {label("事業専用割合（%）", "（家事と共用なら事業に使う割合）")}
            <input
              type="number"
              min={1}
              max={100}
              step="1"
              value={f.businessRatio}
              onChange={(e) => setF({ ...f, businessRatio: e.target.value })}
              className={fieldCls}
            />
            <span className="block text-[11px] text-muted-foreground mt-1">
              減価償却費のうちこの割合だけを経費にし、残りは事業主貸にします（仕訳を作るときに分けます）。
            </span>
          </label>
        )}
        <label className="md:col-span-2">
          {label("特別償却の制度", "（使うときだけ）")}
          <select
            value={f.measure}
            onChange={(e) => {
              const code = e.target.value;
              const m = specialMeasure(code);
              setF({
                ...f,
                measure: code,
                // 制度を選ぶと、決まっている率と制度名を入れる（率は直せる）
                special: m?.rate ? String(Math.round(m.rate * 1000) / 10) : code === "" ? "" : f.special,
                specialNote: m ? `${m.group} ${m.label}` : code === "other" ? f.specialNote : "",
              });
            }}
            className={fieldCls}
          >
            <option value="">使わない</option>
            {[...new Set(SPECIAL_MEASURES.map((m) => m.group))].map((g) => (
              <optgroup key={g} label={g}>
                {SPECIAL_MEASURES.filter((m) => m.group === g).map((m) => (
                  <option key={m.code} value={m.code}>
                    {m.label}（{clauseText(m.clause)}）
                  </option>
                ))}
              </optgroup>
            ))}
            <option value="other">一覧に無い制度（制度名を入力）</option>
          </select>
        </label>
        {specialMeasure(f.measure)?.credit && (
          <div className="md:col-span-3">
            {label("特別償却か税額控除か", "（同じ資産でどちらか一方）")}
            {/* 2つを並べて選ばれている方を塗る（ボタン1つの切り替えは今の状態が分かりにくいため） */}
            <div role="radiogroup" aria-label="特別償却か税額控除か" className="inline-flex rounded-lg border border-border bg-muted/30 p-0.5">
              {(
                [
                  ["depreciation", "特別償却（経費を前倒し）"],
                  ["tax_credit", "税額控除（法人税から直接引く）"],
                ] as const
              ).map(([v, text]) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={f.treatment === v}
                  onClick={() => setF({ ...f, treatment: v })}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-bold transition-colors",
                    f.treatment === v ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {text}
                </button>
              ))}
            </div>
            <span className="block text-[11px] text-muted-foreground mt-1">
              {f.treatment === "tax_credit"
                ? specialMeasure(f.measure)!.group.startsWith("中小企業投資促進")
                  ? "取得価額の7%を法人税額から控除します（資本金3,000万円以下の会社だけ。法人税額の20%まで）。使い始めた期の法人税申告書に反映します。"
                  : "取得価額の10%（資本金3,000万円超は7%）を法人税額から控除します（法人税額の20%まで）。使い始めた期の法人税申告書に反映します。"
                : "使い始めた期に、普通償却に上乗せして償却できます。"}
            </span>
          </div>
        )}
        <label>
          {label("特別償却率（%）", "（即時償却は 100）")}
          <input
            type="number"
            min={0}
            max={100}
            step="0.1"
            value={f.special}
            disabled={!f.measure || (f.treatment === "tax_credit" && Boolean(specialMeasure(f.measure)?.credit))}
            onChange={(e) => setF({ ...f, special: e.target.value })}
            className={fieldCls}
            placeholder="例: 30"
          />
        </label>
        {f.measure === "other" && (
          <label className="md:col-span-3">
            {label("特別償却の制度名")}
            <input
              value={f.specialNote}
              onChange={(e) => setF({ ...f, specialNote: e.target.value })}
              className={fieldCls}
              placeholder="例: 〇〇の特別償却（措法〇条）"
            />
            <span className="block text-[11px] text-muted-foreground mt-1">
              一覧に無い制度は、e-Tax 用ファイルの適用額明細書に載りません。申告書に手で書き足してください。
            </span>
          </label>
        )}
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
