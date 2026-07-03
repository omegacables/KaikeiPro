"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  Crown,
  Users,
  Eye,
  EyeOff,
  Landmark,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/components/providers/auth-provider";
import {
  getExecutiveSummary,
  type ExecutiveSummary,
  type MonthPoint,
} from "@/actions/executive-summary";

function yen(n: number): string {
  return `¥${Math.abs(n).toLocaleString("ja-JP")}`;
}

function signedYen(n: number): string {
  return n < 0 ? `-${yen(n)}` : yen(n);
}

function ymLabel(ym: string | null): string {
  if (!ym) return "-";
  const [y, m] = ym.split("-").map(Number);
  return `${y}年${m}月`;
}

// 月次の売上（バー）と利益（ドット付き折れ線）のシンプルなSVGチャート
function PerformanceChart({ months }: { months: MonthPoint[] }) {
  const W = 320;
  const H = 130;
  const padB = 16;
  const padT = 10;
  const plotH = H - padB - padT;
  const maxSales = Math.max(...months.map((m) => m.sales), 1);
  const maxAbsProfit = Math.max(...months.map((m) => Math.abs(m.profit)), 1);
  const bw = Math.min(18, (W / months.length) * 0.5);
  const step = W / months.length;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {/* 基準線（利益0） */}
      <line
        x1={0}
        x2={W}
        y1={padT + plotH / 2}
        y2={padT + plotH / 2}
        stroke="currentColor"
        strokeOpacity={0.12}
        strokeDasharray="3 3"
      />
      {months.map((m, i) => {
        const x = step * i + step / 2;
        const barH = (m.sales / maxSales) * plotH;
        const profitY = padT + plotH / 2 - (m.profit / maxAbsProfit) * (plotH / 2 - 4);
        return (
          <g key={m.month}>
            <rect
              x={x - bw / 2}
              y={padT + plotH - barH}
              width={bw}
              height={Math.max(barH, m.sales > 0 ? 2 : 0)}
              rx={2}
              className="fill-primary/40"
            />
            <circle
              cx={x}
              cy={profitY}
              r={3}
              className={m.profit >= 0 ? "fill-emerald-500" : "fill-red-500"}
            />
            <text
              x={x}
              y={H - 4}
              textAnchor="middle"
              className="fill-muted-foreground"
              fontSize={9}
            >
              {m.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// 現金・預金残高の推移（エリア付き折れ線）
function CashSparkline({ months }: { months: MonthPoint[] }) {
  const W = 320;
  const H = 72;
  const pad = 6;
  const values = months.map((m) => m.cashBalance);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const step = months.length > 1 ? (W - pad * 2) / (months.length - 1) : 0;
  const pts = values.map((v, i) => ({
    x: pad + step * i,
    y: pad + (1 - (v - min) / range) * (H - pad * 2),
  }));
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const area = `${line} L${pts[pts.length - 1].x},${H} L${pts[0].x},${H} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      <path d={area} className="fill-primary/15" />
      <path d={line} className="stroke-primary" strokeWidth={2} fill="none" />
      <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r={3.5} className="fill-primary" />
    </svg>
  );
}

function StatRow({ label, value, accent }: { label: string; value: string; accent?: "up" | "down" }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={
          "text-sm font-bold tabular-nums " +
          (accent === "up" ? "text-emerald-600 dark:text-emerald-400" : accent === "down" ? "text-red-600 dark:text-red-400" : "text-foreground")
        }
      >
        {value}
      </span>
    </div>
  );
}

function SectionTitle({ icon: Icon, title, sub }: { icon: typeof Wallet; title: string; sub?: string }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <div className="size-7 rounded-lg bg-primary/10 flex items-center justify-center">
        <Icon className="size-4 text-primary" />
      </div>
      <span className="text-sm font-bold text-foreground">{title}</span>
      {sub && <span className="text-[10px] text-muted-foreground ml-auto">{sub}</span>}
    </div>
  );
}

export default function PortalCompanyPage() {
  const { user } = useAuth();
  const [hidden, setHidden] = useState(false);

  // 認証情報（clientId）の解決を待ってから取得する（useData は初回マウント時のみ実行のため不使用）
  const [data, setData] = useState<ExecutiveSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refetch = useCallback(() => {
    if (!user?.clientId) return;
    setLoading(true);
    setError(null);
    getExecutiveSummary(user.clientId)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "読み込みに失敗しました"))
      .finally(() => setLoading(false));
  }, [user?.clientId]);
  useEffect(() => {
    refetch();
  }, [refetch]);

  // 金額の目隠し（電車の中などで開いても安心）
  const fmt = (n: number) => (hidden ? "¥ ＊＊＊＊" : signedYen(n));

  if (error) {
    return (
      <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
        {error}
      </div>
    );
  }
  if (loading || !data) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="size-5 animate-spin mr-2" />
        <span className="text-sm">読み込み中...</span>
      </div>
    );
  }

  const { wealth, performance, executive, payroll } = data;
  const profitUp = performance.netIncome >= 0;

  return (
    <div className="space-y-4">
      {/* ヘッダ */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-bold text-foreground">経営ダッシュボード</h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {data.companyName}／会計年度 {data.period.start.slice(0, 7).replace("-", "/")}〜
            {data.period.end.slice(0, 7).replace("-", "/")}（{data.asOf.replace(/-/g, "/")} 時点）
          </p>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => refetch()}
            className="size-8 rounded-lg border border-border flex items-center justify-center text-muted-foreground active:text-foreground"
            aria-label="更新"
          >
            <RefreshCw className="size-4" />
          </button>
          <button
            onClick={() => setHidden((v) => !v)}
            className="size-8 rounded-lg border border-border flex items-center justify-center text-muted-foreground active:text-foreground"
            aria-label={hidden ? "金額を表示" : "金額を隠す"}
          >
            {hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </div>

      {/* ── 会社の財産 ── */}
      <Card className="p-4">
        <SectionTitle icon={Wallet} title="会社の財産" />
        <p className="text-[11px] text-muted-foreground">現金・預金</p>
        <p className="text-3xl font-bold tabular-nums text-foreground mt-0.5 mb-2">
          {fmt(wealth.cashAndDeposits)}
        </p>
        {!hidden && performance.months.length > 1 && (
          <CashSparkline months={performance.months} />
        )}
        <div className="grid grid-cols-3 gap-2 mt-2">
          <div className="rounded-lg bg-muted/20 px-2 py-1.5">
            <p className="text-[10px] text-muted-foreground">総資産</p>
            <p className="text-xs font-bold tabular-nums">{fmt(wealth.totalAssets)}</p>
          </div>
          <div className="rounded-lg bg-muted/20 px-2 py-1.5">
            <p className="text-[10px] text-muted-foreground">負債</p>
            <p className="text-xs font-bold tabular-nums">{fmt(wealth.totalLiabilities)}</p>
          </div>
          <div className="rounded-lg bg-muted/20 px-2 py-1.5">
            <p className="text-[10px] text-muted-foreground">純資産</p>
            <p className="text-xs font-bold tabular-nums">{fmt(wealth.netAssets)}</p>
          </div>
        </div>
      </Card>

      {/* ── 今期の業績 ── */}
      <Card className="p-4">
        <SectionTitle
          icon={profitUp ? TrendingUp : TrendingDown}
          title="今期の業績"
          sub="バー=売上 ／ ●=利益"
        />
        <div className="grid grid-cols-2 gap-2 mb-2">
          <div className="rounded-lg bg-muted/20 px-3 py-2">
            <p className="text-[10px] text-muted-foreground">売上（累計）</p>
            <p className="text-base font-bold tabular-nums">{fmt(performance.sales)}</p>
          </div>
          <div className="rounded-lg bg-muted/20 px-3 py-2">
            <p className="text-[10px] text-muted-foreground">利益（累計）</p>
            <p
              className={
                "text-base font-bold tabular-nums " +
                (profitUp ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")
              }
            >
              {fmt(performance.netIncome)}
            </p>
          </div>
        </div>
        {!hidden && <PerformanceChart months={performance.months} />}
      </Card>

      {/* ── 社長の報酬 ── */}
      <Card className="p-4">
        <SectionTitle
          icon={Crown}
          title="役員報酬"
          sub={executive.latestMonth ? `${ymLabel(executive.latestMonth)}分` : undefined}
        />
        {executive.latestMonth === null ? (
          <p className="text-xs text-muted-foreground py-2">
            今期の役員報酬データがまだありません。
          </p>
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <p className="text-2xl font-bold tabular-nums text-foreground">
                {fmt(executive.latestMonthly)}
              </p>
              <span className="text-[10px] text-muted-foreground">/ 月（総支給）</span>
            </div>
            <StatRow label="今期累計" value={fmt(executive.yearTotal)} />
            {executive.officers.map((o) => (
              <StatRow key={o.name} label={o.name} value={`${fmt(o.gross)}（手取り ${fmt(o.net)}）`} />
            ))}
            {executive.source === "journal" && (
              <p className="text-[10px] text-muted-foreground mt-1">
                ※ 仕訳の「役員報酬」科目から自動集計
              </p>
            )}
          </>
        )}
      </Card>

      {/* ── 社員の給与 ── */}
      <Card className="p-4">
        <SectionTitle
          icon={Users}
          title="社員の給与"
          sub={payroll.latestMonth ? `${ymLabel(payroll.latestMonth)}分` : undefined}
        />
        {payroll.latestMonth === null ? (
          <p className="text-xs text-muted-foreground py-2">
            今期の給与データがまだありません。
          </p>
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <p className="text-2xl font-bold tabular-nums text-foreground">
                {fmt(payroll.latestTotal)}
              </p>
              <span className="text-[10px] text-muted-foreground">
                / 月（総支給{payroll.latestCount > 0 ? `・${payroll.latestCount}名` : ""}）
              </span>
            </div>
            <StatRow label="今期累計" value={fmt(payroll.yearTotal)} />
            {payroll.employees.map((e) => (
              <StatRow key={e.name} label={e.name} value={`${fmt(e.gross)}（手取り ${fmt(e.net)}）`} />
            ))}
            {payroll.source === "journal" && (
              <p className="text-[10px] text-muted-foreground mt-1">
                ※ 仕訳の給与科目（給料手当等）から自動集計
              </p>
            )}
          </>
        )}
      </Card>

      <p className="text-[10px] text-muted-foreground flex items-center gap-1 pb-2">
        <Landmark className="size-3" />
        記帳済みの仕訳・給与台帳をもとに自動集計しています。最新でない場合は会計事務所へご確認ください。
      </p>
    </div>
  );
}
