"use client";

/**
 * 交際費の設定（顧問先ごと）と、当期の交際費の明細。
 *   - 業種（AIが交際費か別の科目かを判断する目安が変わる）
 *   - 1人当たりの飲食費の基準額・基準額以下の飲食を移す科目・定額控除を使えない法人・独自のルール
 *   - 当期の交際費の行ごとの区分・参加人数・相手（別表十五の接待飲食費と、交際費から除く飲食費の集計に使う）
 * 決まりは src/lib/entertainment.ts。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Wine, Loader2, Check, AlertTriangle, Info, Save } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AmountInput } from "@/components/ui/amount-input";
import { cn, formatCurrency } from "@/lib/utils";
import { useClientRole } from "@/lib/use-client-role";
import { useFiscalPeriods } from "@/lib/use-fiscal-periods";
import {
  getEntertainmentConfig,
  saveEntertainmentConfig,
  getEntertainmentReport,
  updateEntertainmentLine,
  type EntertainmentConfig,
  type EntertainmentReport,
} from "@/actions/entertainment";
import {
  COMMON_RULES,
  INDUSTRY_CODES,
  INDUSTRY_PRESETS,
  ENTERTAINMENT_KINDS,
  ENTERTAINMENT_KIND_LABELS,
  CAPITAL_CLASS_LABELS,
  statutoryPerPersonLimit,
  type EntertainmentKind,
  type IndustryCode,
} from "@/lib/entertainment";

const fieldCls = "w-full px-2 py-1.5 rounded-lg border border-border bg-card text-foreground text-sm";

export function EntertainmentSettingsContent() {
  const { id } = useParams<{ id: string }>();
  const role = useClientRole(id);
  const canWrite = role?.canWrite ?? false;
  const [config, setConfig] = useState<EntertainmentConfig | null>(null);
  const [draft, setDraft] = useState<{ industry: IndustryCode; limitMode: "statutory" | "custom"; limit: string; account: string; noFixed: boolean; rules: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    getEntertainmentConfig(id)
      .then((c) => {
        setConfig(c);
        setDraft({
          industry: c.industry,
          limitMode: c.settings.perPersonLimit === null ? "statutory" : "custom",
          limit: c.settings.perPersonLimit === null ? "" : String(c.settings.perPersonLimit),
          account: c.settings.underLimitAccount,
          noFixed: c.settings.noFixedDeduction,
          rules: c.settings.customRules.join("\n"),
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : "読み込みに失敗しました"));
  }, [id]);
  useEffect(load, [load]);

  const save = async () => {
    if (!draft || saving) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await saveEntertainmentConfig(id, {
        industry: draft.industry,
        settings: {
          perPersonLimit: draft.limitMode === "custom" && draft.limit ? Number(draft.limit.replace(/,/g, "")) : null,
          underLimitAccount: draft.account,
          noFixedDeduction: draft.noFixed,
          customRules: draft.rules.split("\n"),
        },
      });
      setSaved(true);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  if (!draft || !config) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        {error ? <span className="text-destructive">{error}</span> : <><Loader2 className="size-4 animate-spin" />読み込み中...</>}
      </div>
    );
  }

  const preset = INDUSTRY_PRESETS[draft.industry];
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="flex items-start gap-2 rounded-lg border border-info/30 bg-info/10 px-4 py-3 text-sm text-info">
        <Info className="size-4 mt-0.5 shrink-0" />
        <div>
          税法の交際費の限度額は業種では変わりませんが、同じような支出でも業種によって交際費にするか、福利厚生費・販売促進費・研修費・原価にするかの判断が分かれます。
          ここで選んだ業種の目安と、この会社の決まりを、AIが仕訳を作るときと質問するときに使います。
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card className="p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold flex items-center gap-2">
            <Wine className="size-4 text-primary" />
            交際費の決まり
          </h3>
          {canWrite && (
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : saved ? <Check className="size-4" /> : <Save className="size-4" />}
              {saved ? "保存しました" : "保存"}
            </Button>
          )}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="text-xs font-bold text-muted-foreground">業種</span>
            <select
              value={draft.industry}
              disabled={!canWrite}
              onChange={(e) => {
                setDraft({ ...draft, industry: e.target.value as IndustryCode });
                setSaved(false);
              }}
              className={cn(fieldCls, "mt-1")}
            >
              {INDUSTRY_CODES.map((c) => (
                <option key={c} value={c}>
                  {INDUSTRY_PRESETS[c].label}
                </option>
              ))}
            </select>
            {config.industryGuessed && (
              <span className="block text-xs text-muted-foreground mt-1">
                まだ選ばれていないため、顧問先の業種欄（{config.businessType || "空欄"}）から「{INDUSTRY_PRESETS[config.industry].label}」と推し量っています。保存すると確定します。
              </span>
            )}
          </label>

          <div>
            <span className="text-xs font-bold text-muted-foreground">1人当たりの飲食費の基準額</span>
            <div role="radiogroup" className="mt-1 inline-flex flex-wrap rounded-lg border border-border bg-muted/30 p-0.5">
              {(["statutory", "custom"] as const).map((m) => (
                <button
                  key={m}
                  role="radio"
                  aria-checked={draft.limitMode === m}
                  disabled={!canWrite}
                  onClick={() => {
                    setDraft({ ...draft, limitMode: m });
                    setSaved(false);
                  }}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-bold transition-colors",
                    draft.limitMode === m ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {m === "statutory" ? "法令どおり" : "金額を決める"}
                </button>
              ))}
            </div>
            {draft.limitMode === "custom" ? (
              <div className="mt-2 flex items-center gap-2">
                <AmountInput
                  value={draft.limit}
                  onChange={(v) => {
                    setDraft({ ...draft, limit: v });
                    setSaved(false);
                  }}
                  className={cn(fieldCls, "text-right max-w-40")}
                  disabled={!canWrite}
                />
                <span className="text-sm">円以下</span>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground mt-2">
                2024年4月1日以後の支出は {statutoryPerPersonLimit(today).toLocaleString()}円、それより前は 5,000円。税抜経理なら税抜の額で比べます。
              </p>
            )}
          </div>

          <label className="block">
            <span className="text-xs font-bold text-muted-foreground">基準額以下の取引先との飲食を付ける科目</span>
            <input
              value={draft.account}
              disabled={!canWrite}
              onChange={(e) => {
                setDraft({ ...draft, account: e.target.value });
                setSaved(false);
              }}
              className={cn(fieldCls, "mt-1")}
              placeholder="会議費"
            />
            <span className="block text-xs text-muted-foreground mt-1">
              日付・相手の名前と関係・人数・金額・店名の記録が要ります。社内の人だけの飲食は除けません。
            </span>
          </label>

          {config.entityType !== "individual" && (
            <div>
              <span className="text-xs font-bold text-muted-foreground">損金算入限度額の区分</span>
              <label className="mt-1 flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={draft.noFixed}
                  disabled={!canWrite}
                  onChange={(e) => {
                    setDraft({ ...draft, noFixed: e.target.checked });
                    setSaved(false);
                  }}
                />
                <span>大法人（資本金5億円以上）の100%子会社などで、800万円の定額控除を使えない</span>
              </label>
              <p className="text-xs text-muted-foreground mt-1">
                資本金 {config.capital === null ? "未登録（中小法人として扱います）" : `${config.capital.toLocaleString()}円`}
              </p>
            </div>
          )}
        </div>

        <label className="block">
          <span className="text-xs font-bold text-muted-foreground">この会社の決まり（1行に1つ。AIの仕訳と質問に使います）</span>
          <textarea
            value={draft.rules}
            disabled={!canWrite}
            rows={3}
            onChange={(e) => {
              setDraft({ ...draft, rules: e.target.value });
              setSaved(false);
            }}
            className={cn(fieldCls, "mt-1 font-normal")}
            placeholder={"例: 朝礼のときの差し入れは福利厚生費\n例: ○○商店のお菓子は取引先への手土産なので接待交際費"}
          />
        </label>

        <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm">
          <p className="font-bold mb-1">AIが使う目安（{preset.label}）</p>
          <ul className="list-disc pl-5 space-y-0.5 text-muted-foreground">
            {COMMON_RULES.map((r) => (
              <li key={r}>{r}</li>
            ))}
            {preset.rules.map((r) => (
              <li key={r} className="text-foreground">
                {r}
              </li>
            ))}
          </ul>
        </div>
      </Card>

      <EntertainmentLinesCard clientId={id} canWrite={canWrite} entityType={config.entityType} />
    </div>
  );
}

function EntertainmentLinesCard({ clientId, canWrite, entityType }: { clientId: string; canWrite: boolean; entityType: EntertainmentConfig["entityType"] }) {
  const { ready, options, current } = useFiscalPeriods(clientId, { past: 3 });
  const [periodKey, setPeriodKey] = useState<string | null>(null);
  const [report, setReport] = useState<EntertainmentReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const reqRef = useRef(0);

  const period = options.find((o) => o.key === (periodKey ?? current?.key)) ?? current ?? options[0] ?? null;

  const load = useCallback(() => {
    if (!period) return;
    const req = ++reqRef.current;
    setLoading(true);
    getEntertainmentReport(clientId, period.startDate, period.endDate)
      .then((r) => req === reqRef.current && setReport(r))
      .catch((e) => req === reqRef.current && setError(e instanceof Error ? e.message : "読み込みに失敗しました"))
      .finally(() => req === reqRef.current && setLoading(false));
  }, [clientId, period?.startDate, period?.endDate]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(load, [load]);

  const patch = async (lineId: string, p: { kind?: EntertainmentKind | null; attendees?: number | null; attendeeNote?: string | null }) => {
    setSavingId(lineId);
    setError(null);
    try {
      await updateEntertainmentLine(clientId, lineId, p);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <Card className="p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold">当期の交際費の明細</h3>
        <select
          value={period?.key ?? ""}
          onChange={(e) => setPeriodKey(e.target.value)}
          disabled={!ready}
          className="px-2 py-1.5 rounded-lg border border-border bg-card text-foreground text-sm"
        >
          {options.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!report || loading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="size-4 animate-spin" />
          集計中...
        </div>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-sm">
            <Stat label="交際費の科目の額" value={report.bookTotal} />
            <Stat label="うち1人当たり基準額以下の飲食（除く）" value={report.underLimit} />
            <Stat label="支出交際費等の額" value={report.total} strong />
            <Stat label="うち接待飲食費" value={report.dining} />
          </div>
          {entityType === "individual" ? (
            <p className="text-sm rounded-lg bg-success/10 text-success px-3 py-2">
              個人事業主には交際費の限度額がありません（事業に関係する分は全額が必要経費）。家族や友人との私的な飲食は経費にできません。
            </p>
          ) : (
            report.limit &&
            report.cls && (
              <div className="rounded-lg border border-border p-3 text-sm space-y-1">
                <p className="text-muted-foreground">{CAPITAL_CLASS_LABELS[report.cls]}（{report.months}か月）</p>
                <div className="flex flex-wrap gap-x-6 gap-y-1">
                  {report.cls === "sme" && <span>定額控除 <b className="font-mono">{formatCurrency(report.limit.fixedLimit)}</b></span>}
                  <span>接待飲食費の50% <b className="font-mono">{formatCurrency(report.limit.diningLimit)}</b></span>
                  <span>損金算入限度額 <b className="font-mono">{formatCurrency(report.limit.limit)}</b></span>
                  <span className={cn(report.limit.disallowed > 0 && "text-destructive font-bold")}>
                    損金不算入額 <b className="font-mono">{formatCurrency(report.limit.disallowed)}</b>
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  法人税申告書の別表十五にこの区分の集計を使います（
                  <Link href={`/clients/${clientId}/corporate-tax`} className="text-primary underline underline-offset-2">
                    法人税申告書
                  </Link>
                  ）。
                </p>
              </div>
            )
          )}

          {report.lines.some((l) => l.missing.length > 0) && (
            <p className="flex items-start gap-2 text-sm rounded-lg bg-warning/10 text-warning px-3 py-2">
              <AlertTriangle className="size-4 mt-0.5 shrink-0" />
              区分か参加人数が入っていない行が {report.lines.filter((l) => l.missing.length > 0).length} 件あります。接待飲食費の50%や、基準額以下の飲食を除く計算に入りません。
            </p>
          )}

          {report.lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">この期の交際費の仕訳はありません。</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[860px]">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-2">日付</th>
                    <th className="py-2 pr-2">摘要</th>
                    <th className="py-2 pr-2">科目</th>
                    <th className="py-2 pr-2 text-right">金額</th>
                    <th className="py-2 pr-2">区分</th>
                    <th className="py-2 pr-2">人数</th>
                    <th className="py-2 pr-2">相手（名前・関係）</th>
                    <th className="py-2 pr-2 text-right">1人当たり</th>
                  </tr>
                </thead>
                <tbody>
                  {report.lines.map((l) => (
                    <tr key={l.lineId} className={cn("border-b border-border/60 align-top", l.missing.length > 0 && "bg-warning/5")}>
                      <td className="py-2 pr-2 whitespace-nowrap">{l.entryDate}</td>
                      <td className="py-2 pr-2">{l.description || "—"}</td>
                      <td className="py-2 pr-2 whitespace-nowrap">{l.accountName}</td>
                      <td className="py-2 pr-2 text-right font-mono">{formatCurrency(l.amount)}</td>
                      <td className="py-2 pr-2">
                        <select
                          value={l.kind ?? ""}
                          disabled={!canWrite || savingId === l.lineId}
                          onChange={(e) => patch(l.lineId, { kind: (e.target.value || null) as EntertainmentKind | null })}
                          className="px-1.5 py-1 rounded border border-border bg-card text-foreground text-xs max-w-56"
                        >
                          <option value="">（未設定）</option>
                          {ENTERTAINMENT_KINDS.map((k) => (
                            <option key={k} value={k}>
                              {ENTERTAINMENT_KIND_LABELS[k]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 pr-2">
                        <input
                          type="number"
                          min={1}
                          defaultValue={l.attendees ?? ""}
                          disabled={!canWrite || savingId === l.lineId}
                          onBlur={(e) => {
                            const v = e.target.value === "" ? null : Number(e.target.value);
                            if (v !== l.attendees) patch(l.lineId, { attendees: v });
                          }}
                          className="w-16 px-1.5 py-1 rounded border border-border bg-card text-foreground text-xs"
                        />
                      </td>
                      <td className="py-2 pr-2">
                        <input
                          defaultValue={l.attendeeNote ?? ""}
                          disabled={!canWrite || savingId === l.lineId}
                          onBlur={(e) => {
                            if ((e.target.value || null) !== l.attendeeNote) patch(l.lineId, { attendeeNote: e.target.value });
                          }}
                          placeholder="例: A社 山田様ほか2名"
                          className="w-full min-w-40 px-1.5 py-1 rounded border border-border bg-card text-foreground text-xs"
                        />
                      </td>
                      <td className="py-2 pr-2 text-right font-mono whitespace-nowrap">
                        {l.perPerson === null ? (
                          "—"
                        ) : (
                          <span className={cn(l.perPerson <= l.limit ? "text-success" : "text-foreground")}>
                            {formatCurrency(l.perPerson)}
                            <span className="block text-[11px] text-muted-foreground">{l.perPerson <= l.limit ? "基準額以下" : "基準額超"}</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function Stat({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("font-mono", strong && "font-bold text-base")}>{formatCurrency(value)}</div>
    </div>
  );
}
