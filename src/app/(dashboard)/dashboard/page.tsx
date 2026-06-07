"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronRight, CheckCircle, Loader2, CalendarClock, Wallet, Layers, Receipt, CreditCard } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useData } from "@/lib/use-data";
import { getReviewCountsByClient } from "@/actions/receipts";
import { getTaxCalendar, getClients } from "@/actions/clients";
import { getInvoiceStatusByClient, getPayableStatusByClient } from "@/actions/invoices";
import { getBalanceSummary, type BalanceSummary } from "@/actions/ledgers";
import { formatDate, formatCurrency } from "@/lib/utils";

const EMPTY_BALANCE: BalanceSummary = {
  accountBalances: [],
  cashTotal: 0,
  subAccountBalances: [],
};

// 残高を絶対値で表示し、正常残高と逆向きのときは「貸方残／借方残」タグを添える。
// （マイナス表記は使わない方針）
function BalanceAmount({ balance, debitNormal }: { balance: number; debitNormal: boolean }) {
  // debitNormal科目が負＝貸方残、貸方正科目が負＝借方残
  const reverseLabel = debitNormal ? "貸方残" : "借方残";
  return (
    <span className="text-sm font-medium text-foreground tabular-nums shrink-0">
      {formatCurrency(Math.abs(balance))}
      {balance < 0 && (
        <span className="ml-1 text-[10px] font-normal text-destructive">{reverseLabel}</span>
      )}
    </span>
  );
}

export default function DashboardPage() {
  const { data: reviewCounts, loading: reviewLoading } = useData(getReviewCountsByClient, []);
  const { data: taxItems, loading: taxLoading } = useData(getTaxCalendar, []);
  const { data: invoiceStatus, loading: invoiceLoading } = useData(getInvoiceStatusByClient, []);
  const { data: payableStatus, loading: payableLoading } = useData(getPayableStatusByClient, []);

  // 残高表示用のクライアント選択
  const { data: clients } = useData(getClients, []);
  const [selectedClient, setSelectedClient] = useState<string>("");
  useEffect(() => {
    if (!selectedClient && clients.length > 0) {
      setSelectedClient(clients[0].id);
    }
  }, [clients, selectedClient]);

  const {
    data: balance,
    loading: balanceLoading,
    refetch: refetchBalance,
  } = useData<BalanceSummary>(
    () => (selectedClient ? getBalanceSummary(selectedClient) : Promise.resolve(EMPTY_BALANCE)),
    EMPTY_BALANCE
  );
  useEffect(() => {
    if (selectedClient) refetchBalance();
  }, [selectedClient, refetchBalance]);

  const clientsWithReview = reviewCounts
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count);
  const total = reviewCounts.reduce((sum, c) => sum + c.count, 0);

  const totalOverdueAmount = invoiceStatus.reduce((s, c) => s + c.overdueAmount, 0);
  const totalUnpaidAmount = invoiceStatus.reduce((s, c) => s + c.unpaidAmount, 0);

  const totalPayableOverdue = payableStatus.reduce((s, c) => s + c.overdueAmount, 0);
  const totalPayableAmount = payableStatus.reduce((s, c) => s + c.unpaidAmount, 0);

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">ダッシュボード</h1>
        <p className="text-muted-foreground text-sm mt-1">
          対応が必要な証憑・決算をまとめて確認できます。
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3 max-w-6xl items-stretch">
        {/* 要確認の証憑 */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5">
              <AlertTriangle className="size-5 text-warning" />
              <h2 className="text-lg font-bold text-foreground">要確認の証憑</h2>
            </div>
            {!reviewLoading && (
              <Badge variant={total > 0 ? "warning" : "muted"} className="text-xs">
                全{total}件
              </Badge>
            )}
          </div>

          {reviewLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : total === 0 ? (
            <div className="flex items-center justify-center gap-1.5 py-4 text-center">
              <CheckCircle className="size-4 text-success" />
              <p className="text-xs text-muted-foreground">要確認の証憑はありません</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {clientsWithReview.map((c) => (
                <Link
                  key={c.client_id}
                  href={`/clients/${c.client_id}/documents`}
                  className="flex items-center justify-between py-2 px-1 -mx-1 rounded-md hover:bg-muted/40 transition-colors"
                >
                  <span className="text-sm font-medium text-foreground truncate">{c.client_name}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant="warning" className="text-xs">
                      {c.count}件
                    </Badge>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>

        {/* 税務カレンダー */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5">
              <CalendarClock className="size-5 text-warning" />
              <h2 className="text-lg font-bold text-foreground">税務カレンダー</h2>
            </div>
            {!taxLoading && (
              <Badge variant={taxItems.length > 0 ? "warning" : "muted"} className="text-xs">
                {taxItems.length}件
              </Badge>
            )}
          </div>

          {taxLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : taxItems.length === 0 ? (
            <div className="flex items-center justify-center gap-1.5 py-4 text-center">
              <CheckCircle className="size-4 text-success" />
              <p className="text-xs text-muted-foreground">
                期日が近い税務イベントはありません
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {taxItems.map((item) => {
                const label = item.client_name
                  ? `${item.client_name}：${item.title}`
                  : item.title;
                const sub = [formatDate(item.date), item.note].filter(Boolean).join("・");
                const badge = (
                  <Badge
                    variant={item.days_until <= 14 ? "destructive" : "warning"}
                    className="text-xs"
                  >
                    あと{item.days_until}日
                  </Badge>
                );
                const inner = (
                  <>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{label}</p>
                      <p className="text-[10px] text-muted-foreground">{sub}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {badge}
                      {item.client_id && <ChevronRight className="size-4 text-muted-foreground" />}
                    </div>
                  </>
                );
                return item.client_id ? (
                  <Link
                    key={item.id}
                    href={`/clients/${item.client_id}/closing`}
                    className="flex items-center justify-between py-2 px-1 -mx-1 rounded-md hover:bg-muted/40 transition-colors gap-2"
                  >
                    {inner}
                  </Link>
                ) : (
                  <div
                    key={item.id}
                    className="flex items-center justify-between py-2 px-1 gap-2"
                  >
                    {inner}
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* 請求書状況（未入金・期限超過） */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5">
              <Receipt className="size-5 text-warning" />
              <h2 className="text-lg font-bold text-foreground">請求書状況</h2>
            </div>
            {!invoiceLoading && (
              <Badge variant={totalOverdueAmount > 0 ? "destructive" : invoiceStatus.length > 0 ? "warning" : "muted"} className="text-xs">
                未入金{invoiceStatus.length}社
              </Badge>
            )}
          </div>

          {invoiceLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : invoiceStatus.length === 0 ? (
            <div className="flex items-center justify-center gap-1.5 py-4 text-center">
              <CheckCircle className="size-4 text-success" />
              <p className="text-xs text-muted-foreground">未入金の請求書はありません</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-2 text-xs">
                <span className="text-muted-foreground">
                  未入金 <span className="font-bold text-foreground tabular-nums">{formatCurrency(totalUnpaidAmount)}</span>
                </span>
                {totalOverdueAmount > 0 && (
                  <span className="text-destructive">
                    期限超過 <span className="font-bold tabular-nums">{formatCurrency(totalOverdueAmount)}</span>
                  </span>
                )}
              </div>
              <div className="divide-y divide-border">
                {invoiceStatus.map((c) => (
                  <Link
                    key={c.client_id}
                    href={`/clients/${c.client_id}/invoices`}
                    className="flex items-center justify-between py-2 px-1 -mx-1 rounded-md hover:bg-muted/40 transition-colors gap-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{c.client_name}</p>
                      <p className="text-[10px] text-muted-foreground tabular-nums">
                        未入金 {formatCurrency(c.unpaidAmount)}（{c.unpaidCount}件）
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {c.overdueCount > 0 ? (
                        <Badge variant="destructive" className="text-xs">
                          超過{c.overdueCount}件・{c.maxDaysOverdue}日
                        </Badge>
                      ) : (
                        <Badge variant="warning" className="text-xs">
                          {c.unpaidCount}件
                        </Badge>
                      )}
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </div>
                  </Link>
                ))}
              </div>
            </>
          )}
        </Card>

        {/* 支払状況（未払・期限超過） */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5">
              <CreditCard className="size-5 text-warning" />
              <h2 className="text-lg font-bold text-foreground">支払状況</h2>
            </div>
            {!payableLoading && (
              <Badge variant={totalPayableOverdue > 0 ? "destructive" : payableStatus.length > 0 ? "warning" : "muted"} className="text-xs">
                未払{payableStatus.length}社
              </Badge>
            )}
          </div>

          {payableLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : payableStatus.length === 0 ? (
            <div className="flex items-center justify-center gap-1.5 py-4 text-center">
              <CheckCircle className="size-4 text-success" />
              <p className="text-xs text-muted-foreground">未払の請求書はありません</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-2 text-xs">
                <span className="text-muted-foreground">
                  未払 <span className="font-bold text-foreground tabular-nums">{formatCurrency(totalPayableAmount)}</span>
                </span>
                {totalPayableOverdue > 0 && (
                  <span className="text-destructive">
                    期限超過 <span className="font-bold tabular-nums">{formatCurrency(totalPayableOverdue)}</span>
                  </span>
                )}
              </div>
              <div className="divide-y divide-border">
                {payableStatus.map((c) => (
                  <Link
                    key={c.client_id}
                    href={`/clients/${c.client_id}/invoices`}
                    className="flex items-center justify-between py-2 px-1 -mx-1 rounded-md hover:bg-muted/40 transition-colors gap-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{c.client_name}</p>
                      <p className="text-[10px] text-muted-foreground tabular-nums">
                        未払 {formatCurrency(c.unpaidAmount)}（{c.unpaidCount}件）
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {c.overdueCount > 0 ? (
                        <Badge variant="destructive" className="text-xs">
                          超過{c.overdueCount}件・{c.maxDaysOverdue}日
                        </Badge>
                      ) : (
                        <Badge variant="warning" className="text-xs">
                          {c.unpaidCount}件
                        </Badge>
                      )}
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </div>
                  </Link>
                ))}
              </div>
            </>
          )}
        </Card>

        {/* 残高サマリー（クライアント選択式） */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3 gap-2">
            <div className="flex items-center gap-1.5">
              <Wallet className="size-5 text-primary" />
              <h2 className="text-lg font-bold text-foreground">残高サマリー</h2>
            </div>
            <select
              value={selectedClient}
              onChange={(e) => setSelectedClient(e.target.value)}
              className="h-7 max-w-[55%] rounded-md border border-border bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {clients.length === 0 && <option value="">顧問先がありません</option>}
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {balanceLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-4">
              {/* 口座残高 */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-muted-foreground">口座残高</span>
                  <span className="text-sm font-bold text-foreground tabular-nums">
                    {formatCurrency(Math.abs(balance.cashTotal))}
                    {balance.cashTotal < 0 && (
                      <span className="ml-1 text-[10px] font-normal text-destructive">貸方残</span>
                    )}
                  </span>
                </div>
                {balance.accountBalances.length === 0 ? (
                  <p className="py-2 text-center text-xs text-muted-foreground">
                    現金・預金の勘定科目がありません
                  </p>
                ) : (
                  <div className="divide-y divide-border">
                    {balance.accountBalances.map((a) => (
                      <div key={a.account_id} className="flex items-center justify-between py-1.5">
                        <span className="text-sm text-foreground truncate">{a.name}</span>
                        <BalanceAmount balance={a.balance} debitNormal={a.debitNormal} />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 補助科目別残高 */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="flex items-center gap-1 text-xs font-bold text-muted-foreground">
                    <Layers className="size-3" />
                    補助科目別残高
                  </span>
                  <Badge variant="muted" className="text-xs">
                    {balance.subAccountBalances.length}件
                  </Badge>
                </div>
                {balance.subAccountBalances.length === 0 ? (
                  <p className="py-2 text-center text-xs text-muted-foreground">
                    補助科目の残高はありません
                  </p>
                ) : (
                  <div className="max-h-56 overflow-y-auto divide-y divide-border">
                    {balance.subAccountBalances.map((s) => (
                      <div key={s.sub_account_id} className="flex items-center justify-between py-1.5 gap-2">
                        <div className="min-w-0">
                          <p className="text-sm text-foreground truncate">{s.sub_name}</p>
                          <p className="text-[10px] text-muted-foreground truncate">{s.account_name}</p>
                        </div>
                        <BalanceAmount balance={s.balance} debitNormal={s.debitNormal} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
