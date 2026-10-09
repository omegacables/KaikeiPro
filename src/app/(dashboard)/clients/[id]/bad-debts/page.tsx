"use client";

/**
 * 貸倒れの処理と、貸倒引当金の計上。
 * 計算は src/lib/bad-debt.ts（テストあり）、仕訳の作成は src/actions/bad-debts.ts。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ShieldAlert, Loader2, ChevronLeft, ChevronRight, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AmountInput } from "@/components/ui/amount-input";
import { DateInput } from "@/components/ui/date-input";
import { cn } from "@/lib/utils";
import { formatYen } from "@/lib/wareki";
import { calcAllowance, writeOffLines } from "@/lib/bad-debt";
import {
  getBadDebtContext,
  getReceivablePartners,
  createBadDebtWriteOff,
  createAllowanceEntries,
  getAllowanceEntries,
  type BadDebtContext,
} from "@/actions/bad-debts";

const REASONS = [
  "法律上の貸倒れ（破産・会社更生・債権放棄など）",
  "事実上の貸倒れ（資産状況から全額回収できないことが明らか）",
  "形式上の貸倒れ（取引停止から1年以上経過）",
  "その他",
];

const ROLE_LABEL: Record<string, string> = {
  loss: "貸倒損失",
  allowance: "貸倒引当金",
  output_tax: "仮受消費税",
};

export default function BadDebtsPage() {
  const { id } = useParams<{ id: string }>();
  const [periodKey, setPeriodKey] = useState<string | undefined>(undefined);
  const [ctx, setCtx] = useState<BadDebtContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setCtx(null);
    getBadDebtContext(id, periodKey)
      .then((c) => alive && setCtx(c))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "読み込みに失敗しました"));
    return () => {
      alive = false;
    };
  }, [id, periodKey, reloadKey]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldAlert className="size-6 text-primary" />
            貸倒れ・貸倒引当金
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            回収できなくなった売掛金などの貸倒処理と、期末の貸倒引当金の計上を行います。
          </p>
        </div>
        {ctx && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPeriodKey(ctx.period.prevKey)}>
              <ChevronLeft className="size-4" />
              前期
            </Button>
            <span className="text-sm font-medium tabular-nums">
              {ctx.period.startDate} 〜 {ctx.period.endDate}
            </span>
            <Button variant="outline" size="sm" onClick={() => setPeriodKey(ctx.period.nextKey)}>
              翌期
              <ChevronRight className="size-4" />
            </Button>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {!ctx && !error && (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          読み込み中...
        </div>
      )}
      {ctx && ctx.missingAccounts.length > 0 && (
        <Note tone="warning">
          勘定科目（{ctx.missingAccounts.join("・")}）が無効か見つかりません。
          <Link href={`/clients/${id}/accounts`} className="underline ml-1">
            勘定科目管理
          </Link>
          で有効にしてください。
        </Note>
      )}
      {ctx && (
        <>
          <WriteOffSection clientId={id} ctx={ctx} onDone={() => setReloadKey((k) => k + 1)} />
          <AllowanceSection clientId={id} ctx={ctx} onDone={() => setReloadKey((k) => k + 1)} />
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

const fieldCls = "w-full px-2 py-1.5 rounded-lg border border-border bg-card text-foreground text-sm";

// ---------------------------------------------------------------------------
// 貸倒れの処理
// ---------------------------------------------------------------------------

function WriteOffSection({ clientId, ctx, onDone }: { clientId: string; ctx: BadDebtContext; onDone: () => void }) {
  const [accountId, setAccountId] = useState(ctx.receivables[0]?.id ?? "");
  const [partners, setPartners] = useState<{ subAccountId: string | null; name: string; balance: number }[] | null>(null);
  const [partnerKey, setPartnerKey] = useState("");
  const [date, setDate] = useState(ctx.period.endDate);
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState<"0.1" | "0.08" | "">("0.1");
  const [useAllowance, setUseAllowance] = useState("");
  const [reason, setReason] = useState(REASONS[0]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "warning"; text: string } | null>(null);

  useEffect(() => {
    if (!accountId) return;
    setPartners(null);
    setPartnerKey("");
    getReceivablePartners(clientId, accountId, ctx.period.startDate, ctx.period.endDate)
      .then(setPartners)
      .catch(() => setPartners([]));
  }, [clientId, accountId, ctx.period.startDate, ctx.period.endDate]);

  const partner = partners?.find((p) => (p.subAccountId ?? "none") === partnerKey) ?? null;
  useEffect(() => {
    if (partner) setAmount(String(partner.balance));
  }, [partner]);

  const account = ctx.receivables.find((r) => r.id === accountId);
  // 貸付金・立替金は売上ではないので、消費税の控除は無い
  const isSalesReceivable = account ? /売掛金|受取手形|未収入金|未収金/.test(account.name) : false;
  const effectiveRate = ctx.taxExempt || !isSalesReceivable || !rate ? null : (Number(rate) as 0.1 | 0.08);
  const num = (v: string) => Number(v.replace(/,/g, "")) || 0;
  const lines = writeOffLines({ amount: num(amount), rate: effectiveRate, exclusive: ctx.exclusive, useAllowance: num(useAllowance) });

  const submit = async () => {
    if (!partner || !account) return;
    if (!confirm(`${partner.name} の ${account.name} ${formatYen(num(amount))}円 を貸倒れとして仕訳します。よろしいですか？`)) return;
    setSaving(true);
    setMessage(null);
    try {
      await createBadDebtWriteOff(clientId, {
        date,
        accountId,
        subAccountId: partner.subAccountId,
        partnerName: partner.name,
        amount: num(amount),
        rate: effectiveRate,
        useAllowance: num(useAllowance),
        reason: reason.replace(/（.*）$/, ""),
      });
      setMessage({ tone: "success", text: "貸倒れの仕訳を作成しました。帳簿閲覧の仕訳帳・売掛帳で確認できます。" });
      onDone();
    } catch (e) {
      setMessage({ tone: "warning", text: e instanceof Error ? e.message : "仕訳の作成に失敗しました" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-5 space-y-4">
      <div>
        <h2 className="text-lg font-bold">貸倒れの処理</h2>
        <p className="text-sm text-muted-foreground mt-1">
          回収できなくなった債権を貸倒損失にします。課税売上の売掛金なら、貸倒れに係る消費税額を売上の消費税から控除できます
          （消費税計算に自動で反映されます）。
        </p>
      </div>
      {ctx.receivables.length === 0 ? (
        <Note tone="info">この期間末に残高のある売掛金・貸付金などはありません。</Note>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="text-xs font-bold text-muted-foreground">
              債権の科目
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={cn(fieldCls, "mt-1")}>
                {ctx.receivables.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}（期末残高 {formatYen(r.balance)}円）
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-bold text-muted-foreground">
              相手先
              <select value={partnerKey} onChange={(e) => setPartnerKey(e.target.value)} className={cn(fieldCls, "mt-1")}>
                <option value="">{partners === null ? "読み込み中…" : "選んでください"}</option>
                {(partners ?? []).map((p) => (
                  <option key={p.subAccountId ?? "none"} value={p.subAccountId ?? "none"}>
                    {p.name}（残高 {formatYen(p.balance)}円）
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-bold text-muted-foreground">
              貸倒れの日
              <DateInput value={date} onChange={setDate} className={cn(fieldCls, "mt-1 pr-7")} />
            </label>
            <label className="text-xs font-bold text-muted-foreground">
              貸倒れの金額（税込）
              <AmountInput value={amount} onChange={setAmount} className={cn(fieldCls, "mt-1 text-right font-mono")} />
            </label>
            <label className="text-xs font-bold text-muted-foreground">
              元の売上の税率
              <select
                value={isSalesReceivable && !ctx.taxExempt ? rate : ""}
                disabled={!isSalesReceivable || ctx.taxExempt}
                onChange={(e) => setRate(e.target.value as typeof rate)}
                className={cn(fieldCls, "mt-1")}
              >
                <option value="0.1">10%（標準税率）</option>
                <option value="0.08">8%（軽減税率）</option>
                <option value="">課税売上ではない</option>
              </select>
            </label>
            <label className="text-xs font-bold text-muted-foreground">
              引当金の取り崩し（任意）
              <AmountInput value={useAllowance} onChange={setUseAllowance} placeholder="0" className={cn(fieldCls, "mt-1 text-right font-mono")} />
              <span className="font-normal">今の貸倒引当金 {formatYen(ctx.allowanceBalance)}円</span>
            </label>
            <label className="text-xs font-bold text-muted-foreground md:col-span-3">
              貸倒れの理由（摘要に残します）
              <select value={reason} onChange={(e) => setReason(e.target.value)} className={cn(fieldCls, "mt-1")}>
                {REASONS.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
          </div>

          {ctx.taxExempt && <Note tone="info">免税事業者のため、消費税の控除はありません。</Note>}
          {!isSalesReceivable && account && <Note tone="info">{account.name}は売上の債権ではないため、消費税の控除はありません。</Note>}

          {lines.length > 0 && partner && (
            <div className="rounded-lg border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">作成する仕訳（{ctx.exclusive ? "税抜経理" : "税込経理"}）</th>
                    <th className="px-3 py-2 text-right">借方</th>
                    <th className="px-3 py-2 text-right">貸方</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-3 py-2">
                        {l.role === "receivable" ? `${account?.name}（${partner.name}）` : ROLE_LABEL[l.role]}
                        {l.taxCategory && <span className="ml-2 text-xs text-destructive">貸倒れ{l.taxCategory === "bad_debt_10" ? "10%" : "8%"}</span>}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{l.debit ? formatYen(l.debit) : ""}</td>
                      <td className="px-3 py-2 text-right font-mono">{l.credit ? formatYen(l.credit) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {message && <Note tone={message.tone}>{message.text}</Note>}
          <div className="flex justify-end">
            <Button onClick={submit} disabled={saving || !partner || num(amount) <= 0}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              貸倒れの仕訳を作成
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 貸倒引当金
// ---------------------------------------------------------------------------

function AllowanceSection({ clientId, ctx, onDone }: { clientId: string; ctx: BadDebtContext; onDone: () => void }) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(ctx.receivables.filter((r) => r.balance > 0).map((r) => r.id))
  );
  const [deduction, setDeduction] = useState("");
  const [rateMode, setRateMode] = useState<"statutory" | "actual">("statutory");
  const [industry, setIndustry] = useState("other");
  const [actualRate, setActualRate] = useState("");
  const [method, setMethod] = useState<"reversal" | "difference">("reversal");
  const [existing, setExisting] = useState<{ id: string; entry_date: string; description: string | null }[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "warning"; text: string } | null>(null);

  const loadExisting = useCallback(() => {
    getAllowanceEntries(clientId, ctx.period.startDate, ctx.period.endDate).then(setExisting).catch(() => setExisting([]));
  }, [clientId, ctx.period.startDate, ctx.period.endDate]);
  useEffect(loadExisting, [loadExisting]);

  const num = (v: string) => Number(v.replace(/,/g, "")) || 0;
  const rate =
    rateMode === "statutory"
      ? (ctx.industries.find((i) => i.key === industry)?.perMille ?? 6) / 1000
      : (Number(actualRate) || 0) / 100;
  const receivables = ctx.receivables.filter((r) => selected.has(r.id)).reduce((s, r) => s + r.balance, 0);
  const result = useMemo(
    () => calcAllowance({ receivables, deduction: num(deduction), rate, priorBalance: ctx.allowanceBalance, method }),
    [receivables, deduction, rate, ctx.allowanceBalance, method]
  );

  const submit = async () => {
    const warn = existing.length > 0 ? `\nこの期間にはすでに貸倒引当金の仕訳が${existing.length}件あります。` : "";
    if (!confirm(`期末日（${ctx.period.endDate}）で貸倒引当金の仕訳を作成します。${warn}\nよろしいですか？`)) return;
    setSaving(true);
    setMessage(null);
    try {
      const ids = await createAllowanceEntries(clientId, {
        periodKey: ctx.period.key,
        accountIds: [...selected],
        deduction: num(deduction),
        rate,
        method,
      });
      setMessage({ tone: "success", text: `貸倒引当金の仕訳を${ids.length}件作成しました。` });
      loadExisting();
      onDone();
    } catch (e) {
      setMessage({ tone: "warning", text: e instanceof Error ? e.message : "仕訳の作成に失敗しました" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-5 space-y-4">
      <div>
        <h2 className="text-lg font-bold">貸倒引当金（一括評価）</h2>
        <p className="text-sm text-muted-foreground mt-1">
          期末の売掛金などの残高に繰入率を掛けて、繰入限度額を出します（円未満切り捨て）。
          法人税で貸倒引当金を損金にできるのは、中小法人等（資本金1億円以下など）に限られます。
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="space-y-3">
          <div className="text-xs font-bold text-muted-foreground">対象にする債権（期末残高）</div>
          {ctx.receivables.length === 0 ? (
            <p className="text-sm text-muted-foreground">期末に残高のある債権はありません。</p>
          ) : (
            ctx.receivables.map((r) => (
              <label key={r.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selected.has(r.id)}
                    onChange={(e) =>
                      setSelected((prev) => {
                        const n = new Set(prev);
                        if (e.target.checked) n.add(r.id);
                        else n.delete(r.id);
                        return n;
                      })
                    }
                  />
                  {r.code} {r.name}
                </span>
                <span className="font-mono">{formatYen(r.balance)}</span>
              </label>
            ))
          )}
          <label className="block text-xs font-bold text-muted-foreground">
            実質的に債権とみられない額（同じ相手への買掛金など、相殺できる額）
            <AmountInput value={deduction} onChange={setDeduction} placeholder="0" className={cn(fieldCls, "mt-1 text-right font-mono")} />
          </label>
        </div>

        <div className="space-y-3">
          <div className="text-xs font-bold text-muted-foreground">繰入率</div>
          <div className="flex gap-1 bg-muted/20 p-1 rounded-lg w-fit">
            {([
              ["statutory", "法定繰入率"],
              ["actual", "貸倒実績率"],
            ] as const).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setRateMode(k)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-bold",
                  rateMode === k ? "bg-card text-primary shadow-sm" : "text-muted-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {rateMode === "statutory" ? (
            <select value={industry} onChange={(e) => setIndustry(e.target.value)} className={fieldCls}>
              {ctx.industries.map((i) => (
                <option key={i.key} value={i.key}>
                  {i.label}（{i.perMille}/1000）
                </option>
              ))}
            </select>
          ) : (
            <label className="flex items-center gap-2 text-sm">
              <input
                value={actualRate}
                onChange={(e) => setActualRate(e.target.value.normalize("NFKC"))}
                inputMode="decimal"
                placeholder="例: 1.25"
                className={cn(fieldCls, "w-28 text-right")}
              />
              %（過去3年の貸倒損失の割合）
            </label>
          )}
          <div className="text-xs font-bold text-muted-foreground pt-1">計上の仕方</div>
          <div className="flex gap-1 bg-muted/20 p-1 rounded-lg w-fit">
            {([
              ["reversal", "洗替法"],
              ["difference", "差額補充法"],
            ] as const).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setMethod(k)}
                className={cn(
                  "px-3 py-1.5 rounded-md text-xs font-bold",
                  method === k ? "bg-card text-primary shadow-sm" : "text-muted-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            洗替法は前期の残高を全額戻し入れてから、当期の限度額を繰り入れます。差額補充法は差額だけを繰り入れ（戻し入れ）ます。
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-sm">
          <tbody>
            <Row label="対象債権の合計" value={receivables} />
            <Row label="実質的に債権とみられない額" value={-num(deduction)} />
            <Row label="繰入の基礎" value={result.base} />
            <Row label={`繰入率 ${(rate * 100).toFixed(rate * 1000 % 1 === 0 ? 1 : 3)}%`} value={null} />
            <Row label="繰入限度額（計上後の貸倒引当金）" value={result.limit} strong />
            <Row label="計上前の貸倒引当金（前期から繰り越した残高）" value={ctx.allowanceBalance} />
          </tbody>
        </table>
      </div>

      {result.entries.length > 0 && (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">作成する仕訳（{ctx.period.endDate}）</th>
                <th className="px-3 py-2 text-right">金額</th>
              </tr>
            </thead>
            <tbody>
              {result.entries.map((e, i) => (
                <tr key={i} className="border-t border-border">
                  <td className="px-3 py-2">
                    {e.kind === "reverse" ? "(借)貸倒引当金 ／(貸)貸倒引当金戻入益" : "(借)貸倒引当金繰入額 ／(貸)貸倒引当金"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{formatYen(e.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {existing.length > 0 && (
        <Note tone="warning">
          この期間はすでに貸倒引当金を計上しています（
          {existing.map((e) => `${e.entry_date} ${e.description ?? ""}`).join("、")}）。
          二重に計上しないよう、作成ボタンは止めています。やり直すときは、帳簿閲覧の仕訳帳で前の仕訳を削除してから作成してください。
        </Note>
      )}
      {message && <Note tone={message.tone}>{message.text}</Note>}
      <div className="flex justify-end">
        <Button onClick={submit} disabled={saving || result.entries.length === 0 || existing.length > 0}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          貸倒引当金の仕訳を作成
        </Button>
      </div>
    </Card>
  );
}

function Row({ label, value, strong }: { label: string; value: number | null; strong?: boolean }) {
  return (
    <tr className={cn("border-t border-border first:border-t-0", strong && "bg-primary/5 font-bold")}>
      <td className="px-3 py-2">{label}</td>
      <td className="px-3 py-2 text-right font-mono">{value == null ? "" : formatYen(value)}</td>
    </tr>
  );
}
