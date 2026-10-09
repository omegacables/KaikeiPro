"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ClipboardList,
  Loader2,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getBreakdownOverview, type BreakdownOverviewItem, type BreakdownPeriod } from "@/actions/breakdown";
import { formatYen } from "@/lib/wareki";
import { isAvailableForm } from "@/lib/breakdown";

const STATUS_NOTE: Record<string, string> = {
  needs_items: "相手先ごとの明細を入力する画面を準備中です",
};

export default function BreakdownOverviewPage({
  params,
}: {
  params: Promise<{ id: string; period: string }>;
}) {
  // 期は年（2025）か開始日（2025-09-01）で指定する。決算月を変えた年は期が2つあるため
  const { id, period: periodKey } = use(params);
  const router = useRouter();
  const [period, setPeriod] = useState<BreakdownPeriod | null>(null);
  const [items, setItems] = useState<BreakdownOverviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getBreakdownOverview(id, periodKey)
      .then((r) => {
        setPeriod(r.period);
        setItems(r.items);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "読み込みに失敗しました"))
      .finally(() => setLoading(false));
  }, [id, periodKey]);

  const go = (key: string) => router.push(`/clients/${id}/breakdown/${key}`);
  const mismatches = items.filter((it) =>
    it.summary?.checks.some((c) => !c.informational && !c.check.matches)
  ).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ClipboardList className="size-6 text-primary" />
          <h1 className="text-xl font-bold">勘定科目内訳明細書</h1>
        </div>
        {/* 内訳書は決算後に「終わった期」の分を作るので、期を前後に切り替えられるようにする */}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => period && go(period.prevKey)} disabled={!period} title="前の事業年度">
            <ChevronLeft className="size-4" />
            前期
          </Button>
          <span className="text-[17px] font-medium tabular-nums">
            {period ? `${period.startDate} 〜 ${period.endDate}` : "読み込み中…"}
          </span>
          <Button variant="outline" onClick={() => period && go(period.nextKey)} disabled={!period} title="次の事業年度">
            翌期
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>

      <p className="text-[15px] text-muted-foreground">
        法人税の申告書に添付する書類です。記載要領の基準（期末残高50万円以上など）に従って、
        相手先ごとに記入するものと「その他」にまとめるものを自動で分けます。
        金額は試算表の科目残高と照合し、合わないときは警告を出します。
      </p>

      {period?.fromFiscalYears && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-info/10 border border-info/20 text-sm text-info">
          <Info className="size-4 mt-0.5 shrink-0" />
          決算月の変更などで記録された事業年度の期間（{period.startDate} 〜 {period.endDate}）を使っています。
        </div>
      )}

      {error && (
        <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
          {error}
        </div>
      )}

      {!loading && !error && mismatches > 0 && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-warning/10 border border-warning/20 text-sm text-warning">
          <AlertTriangle className="size-4 mt-0.5 shrink-0" />
          {mismatches}件の内訳書で、合計が試算表の科目残高と一致していません。各内訳書を開いて差額を確認してください。
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-[17px]">
          <Loader2 className="size-5 animate-spin mr-2" />
          読み込み中...
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[720px] text-[15px]">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th className="px-3 py-2 w-12">様式</th>
                <th className="px-3 py-2">名称</th>
                <th className="px-3 py-2 text-right">記入額の合計</th>
                <th className="px-3 py-2">試算表との照合</th>
                <th className="px-3 py-2 w-28"></th>
              </tr>
            </thead>
            <tbody>
              {items.map(({ def, summary }) => {
                const ready = isAvailableForm(def);
                const isInput = def.status === "input";
                return (
                  <tr key={def.key} className="border-t border-border">
                    <td className="px-3 py-2 text-center">{def.number}</td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{def.title}</div>
                      {isInput && (
                        <div className="text-[13px] text-muted-foreground">
                          相手先ごとの明細を入力{summary?.itemCount ? `（${summary.itemCount}件入力済み）` : ""}
                        </div>
                      )}
                      {!ready && (
                        <div className="text-[13px] text-muted-foreground">
                          準備中：{def.note ?? STATUS_NOTE[def.status] ?? ""}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {summary ? `${formatYen(summary.total)}円` : ""}
                    </td>
                    <td className="px-3 py-2">
                      {summary && summary.checks.length === 0 && (
                        <span className="text-[13px] text-muted-foreground">
                          {!isInput
                            ? "科目残高から作成"
                            : !summary.reconcilable
                              ? `照合なし（専用の科目がないため）${summary.itemCount ? "" : "・未入力"}`
                              : "記入する残高なし"}
                        </span>
                      )}
                      <div className="flex flex-wrap gap-1.5">
                        {summary?.checks.map(({ label, check, informational }) =>
                          check.matches ? (
                            <Badge key={label} variant="success">
                              <CheckCircle2 className="size-3 mr-1" />
                              {label} 一致
                            </Badge>
                          ) : (
                            <Badge key={label} variant={informational ? "muted" : "warning"}>
                              {!informational && <AlertTriangle className="size-3 mr-1" />}
                              {label} 差額 {formatYen(check.difference)}円
                              {informational && "（参考）"}
                            </Badge>
                          )
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {ready ? (
                        <Link href={`/clients/${id}/breakdown/${period?.startDate ?? periodKey}/${def.key}`}>
                          <Button variant="outline" size="sm">
                            {isInput ? "入力・印刷" : "開く"}
                          </Button>
                        </Link>
                      ) : (
                        <Badge variant="muted">準備中</Badge>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
