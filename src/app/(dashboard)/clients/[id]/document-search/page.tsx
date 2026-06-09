"use client";

import { useState, useCallback, use } from "react";
import {
  FileSearch,
  Loader2,
  Search,
  ExternalLink,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  searchDocuments,
  type DocSearchRow,
  type DocSearchResult,
} from "@/actions/document-search";
import { getReceiptImageUrl, verifyReceiptIntegrity } from "@/actions/receipt-storage";
import { formatCurrency } from "@/lib/utils";

const inputCls =
  "w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40";

const docTypeLabel: Record<string, string> = {
  qualified_invoice: "適格請求書",
  category_invoice: "区分記載請求書",
  receipt: "領収書",
  statement: "明細書",
  delivery_note: "納品書",
  estimate: "見積書",
  contract: "契約書",
  other: "その他",
};

export default function DocumentSearchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");
  const [vendor, setVendor] = useState("");
  const [direction, setDirection] = useState<"" | "issued" | "received">("");

  const [result, setResult] = useState<DocSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState<string | null>(null);
  const [verifyMap, setVerifyMap] = useState<Record<string, boolean>>({});

  const runSearch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await searchDocuments(id, {
        dateFrom: dateFrom || null,
        dateTo: dateTo || null,
        amountMin: amountMin.trim() === "" ? null : Number(amountMin),
        amountMax: amountMax.trim() === "" ? null : Number(amountMax),
        vendor: vendor || null,
        direction: direction || null,
      });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "検索に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [id, dateFrom, dateTo, amountMin, amountMax, vendor, direction]);

  async function handleView(row: DocSearchRow) {
    try {
      const url = await getReceiptImageUrl(row.imagePath);
      if (url) window.open(url, "_blank", "noopener,noreferrer");
      else setError("ファイルURLの取得に失敗しました（連携元の証憑の可能性があります）");
    } catch (e) {
      setError(e instanceof Error ? e.message : "取得に失敗しました");
    }
  }

  async function handleVerify(row: DocSearchRow) {
    setVerifying(row.id);
    setError(null);
    try {
      const res = await verifyReceiptIntegrity(row.id);
      setVerifyMap((prev) => ({ ...prev, [row.id]: res.valid }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "検証に失敗しました");
    } finally {
      setVerifying(null);
    }
  }

  function reset() {
    setDateFrom("");
    setDateTo("");
    setAmountMin("");
    setAmountMax("");
    setVendor("");
    setDirection("");
  }

  return (
    <div className="space-y-6">
      {/* ヘッダー */}
      <div className="flex items-center gap-2">
        <FileSearch className="size-6 text-primary" />
        <h1 className="text-xl font-bold">証憑検索（電子帳簿保存法）</h1>
      </div>

      <p className="text-sm text-muted-foreground">
        電子帳簿保存法の検索要件に対応し、取引年月日・取引金額（範囲）・取引先を組合せて証憑を検索できます。各証憑は改ざん検知（ハッシュ）による真実性の確認が可能です。
      </p>

      {/* 検索フォーム */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">取引年月日（自）</label>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">取引年月日（至）</label>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">取引先</label>
              <input value={vendor} onChange={(e) => setVendor(e.target.value)} className={inputCls} placeholder="取引先名" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">取引金額（下限）</label>
              <input type="number" value={amountMin} onChange={(e) => setAmountMin(e.target.value)} className={inputCls + " text-right"} placeholder="0" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">取引金額（上限）</label>
              <input type="number" value={amountMax} onChange={(e) => setAmountMax(e.target.value)} className={inputCls + " text-right"} placeholder="上限なし" />
            </div>
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">区分</label>
              <select value={direction} onChange={(e) => setDirection(e.target.value as "" | "issued" | "received")} className={inputCls}>
                <option value="">すべて</option>
                <option value="received">受領</option>
                <option value="issued">発行</option>
              </select>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={runSearch} disabled={loading}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
              検索
            </Button>
            <Button variant="outline" onClick={reset}>クリア</Button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* 結果 */}
      <Card>
        <CardContent className="pt-6">
          {!result ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              検索条件を指定して「検索」を押してください。
            </div>
          ) : result.rows.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              条件に一致する証憑はありません（走査 {result.scanned} 件）。
            </div>
          ) : (
            <>
              <p className="text-xs text-muted-foreground mb-3">
                {result.total} 件ヒット（走査 {result.scanned} 件）
              </p>
              <div className="overflow-x-auto -mx-2 px-2">
                <table className="w-full text-sm min-w-[820px]">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted-foreground">
                      <th className="text-left py-2 px-2">取引日</th>
                      <th className="text-left py-2 px-2">取引先</th>
                      <th className="text-right py-2 px-2">金額</th>
                      <th className="text-left py-2 px-2">登録番号</th>
                      <th className="text-center py-2 px-2">区分</th>
                      <th className="text-center py-2 px-2">真実性</th>
                      <th className="text-right py-2 px-2">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row) => {
                      const verified = verifyMap[row.id];
                      return (
                        <tr key={row.id} className="border-b border-border/50">
                          <td className="py-2 px-2 whitespace-nowrap">{row.date}</td>
                          <td className="py-2 px-2 max-w-[180px] truncate" title={row.vendor}>
                            {row.vendor}
                            {row.documentType && (
                              <span className="ml-1 text-xs text-muted-foreground">
                                [{docTypeLabel[row.documentType] ?? row.documentType}]
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-2 text-right tabular-nums">{formatCurrency(row.amount)}</td>
                          <td className="py-2 px-2 text-xs text-muted-foreground">{row.invoiceNumber ?? "—"}</td>
                          <td className="py-2 px-2 text-center">
                            <Badge variant={row.direction === "issued" ? "default" : "muted"}>
                              {row.direction === "issued" ? "発行" : "受領"}
                            </Badge>
                          </td>
                          <td className="py-2 px-2 text-center">
                            {verifying === row.id ? (
                              <Loader2 className="size-4 animate-spin mx-auto text-muted-foreground" />
                            ) : verified === true ? (
                              <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400 text-xs">
                                <ShieldCheck className="size-4" /> 改ざんなし
                              </span>
                            ) : verified === false ? (
                              <span className="inline-flex items-center gap-1 text-destructive text-xs">
                                <ShieldAlert className="size-4" /> 不一致
                              </span>
                            ) : (
                              <button
                                onClick={() => handleVerify(row)}
                                disabled={!row.hashProtected}
                                title={row.hashProtected ? "ハッシュで真実性を検証" : "ハッシュ未保存"}
                                className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground text-xs disabled:opacity-40"
                              >
                                <ShieldQuestion className="size-4" /> 検証
                              </button>
                            )}
                          </td>
                          <td className="py-2 px-2 text-right">
                            <button
                              onClick={() => handleView(row)}
                              title="証憑を表示"
                              className="p-1.5 rounded hover:bg-muted text-primary"
                            >
                              <ExternalLink className="size-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
