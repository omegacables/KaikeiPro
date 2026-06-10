"use client";

import { useState, useEffect, use } from "react";
import { Loader2, Printer, ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  getInvoicePrintData,
  type InvoicePrintData,
} from "@/actions/invoices";
import { formatCurrency } from "@/lib/utils";

const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  #invoice-sheet, #invoice-sheet * { visibility: visible !important; }
  #invoice-sheet { position: absolute; left: 0; top: 0; width: 100%; margin: 0; padding: 24px; box-shadow: none !important; border: none !important; }
  .no-print { display: none !important; }
  @page { size: A4; margin: 12mm; }
}
`;

export default function InvoicePrintPage({
  params,
}: {
  params: Promise<{ id: string; invoiceId: string }>;
}) {
  const { id, invoiceId } = use(params);
  const router = useRouter();
  const [data, setData] = useState<InvoicePrintData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getInvoicePrintData(invoiceId)
      .then(setData)
      .catch((e) =>
        setError(e instanceof Error ? e.message : "読み込みに失敗しました")
      )
      .finally(() => setLoading(false));
  }, [invoiceId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="size-5 animate-spin mr-2" />
        読み込み中...
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
        {error ?? "データが見つかりません"}
      </div>
    );
  }

  const title = data.direction === "sales" ? "請求書" : "請求書（受領）";
  const isQualified = Boolean(data.issuer.registrationNumber);

  return (
    <div className="space-y-4">
      {/* eslint-disable-next-line react/no-danger */}
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />

      {/* 操作バー（印刷時は非表示） */}
      <div className="no-print flex items-center justify-between gap-2">
        <button
          onClick={() => router.push(`/clients/${id}/documents`)}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          帳票管理に戻る
        </button>
        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
        >
          <Printer className="size-4" />
          印刷 / PDF保存
        </button>
      </div>

      {!isQualified && (
        <div className="no-print p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm text-amber-700 dark:text-amber-400">
          発行者の登録番号（T+13桁）が未設定です。適格請求書として発行するには、設定画面で適格請求書発行事業者の登録番号を登録してください。
        </div>
      )}

      {/* ===== A4 請求書シート ===== */}
      <div
        id="invoice-sheet"
        className="mx-auto max-w-[800px] bg-white text-black border border-border rounded-lg shadow-sm p-10"
      >
        {/* タイトル */}
        <h1 className="text-center text-2xl font-bold tracking-[0.3em] mb-8">{title}</h1>

        {/* 宛先・発行者 */}
        <div className="flex justify-between gap-8 mb-8">
          <div className="flex-1">
            <p className="text-lg font-bold border-b-2 border-black pb-1 inline-block min-w-[200px]">
              {data.partner.name} 御中
            </p>
            {data.partner.postalCode && (
              <p className="text-xs mt-2">〒{data.partner.postalCode}</p>
            )}
            {data.partner.address && <p className="text-xs">{data.partner.address}</p>}
          </div>
          <div className="text-right text-sm leading-relaxed">
            <p className="font-bold text-base">{data.issuer.name}</p>
            {data.issuer.postalCode && <p className="text-xs">〒{data.issuer.postalCode}</p>}
            {data.issuer.address && <p className="text-xs">{data.issuer.address}</p>}
            {data.issuer.telephone && <p className="text-xs">TEL: {data.issuer.telephone}</p>}
            {data.issuer.registrationNumber && (
              <p className="text-xs mt-1">登録番号: {data.issuer.registrationNumber}</p>
            )}
          </div>
        </div>

        {/* 請求番号・日付 */}
        <div className="flex justify-between text-sm mb-4">
          <div className="space-y-1">
            <p>請求書番号: {data.invoiceNumber}</p>
            <p>発行日: {data.issuedDate}</p>
            {data.dueDate && <p>お支払期限: {data.dueDate}</p>}
          </div>
          <div className="text-right">
            <p className="text-sm">ご請求金額（税込）</p>
            <p className="text-2xl font-bold border-b-2 border-black">
              {formatCurrency(data.totalAmount)}
            </p>
          </div>
        </div>

        {/* 明細 */}
        <table className="w-full text-sm border-collapse mb-6">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-400 px-2 py-1.5 text-left w-28">取引年月日</th>
              <th className="border border-gray-400 px-2 py-1.5 text-left">品目</th>
              <th className="border border-gray-400 px-2 py-1.5 text-right w-16">数量</th>
              <th className="border border-gray-400 px-2 py-1.5 text-right w-24">単価</th>
              <th className="border border-gray-400 px-2 py-1.5 text-right w-14">税率</th>
              <th className="border border-gray-400 px-2 py-1.5 text-right w-28">金額</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((it, i) => (
              <tr key={i}>
                <td className="border border-gray-400 px-2 py-1.5">{it.transaction_date ?? ""}</td>
                <td className="border border-gray-400 px-2 py-1.5">{it.item_name}</td>
                <td className="border border-gray-400 px-2 py-1.5 text-right tabular-nums">{it.quantity}</td>
                <td className="border border-gray-400 px-2 py-1.5 text-right tabular-nums">{formatCurrency(it.unit_price)}</td>
                <td className="border border-gray-400 px-2 py-1.5 text-right tabular-nums">{it.tax_rate}%</td>
                <td className="border border-gray-400 px-2 py-1.5 text-right tabular-nums">{formatCurrency(it.amount)}</td>
              </tr>
            ))}
            {/* 空行で見栄えを整える */}
            {data.items.length < 5 &&
              Array.from({ length: 5 - data.items.length }).map((_, i) => (
                <tr key={`empty-${i}`}>
                  <td className="border border-gray-400 px-2 py-1.5">&nbsp;</td>
                  <td className="border border-gray-400 px-2 py-1.5"></td>
                  <td className="border border-gray-400 px-2 py-1.5"></td>
                  <td className="border border-gray-400 px-2 py-1.5"></td>
                  <td className="border border-gray-400 px-2 py-1.5"></td>
                  <td className="border border-gray-400 px-2 py-1.5"></td>
                </tr>
              ))}
          </tbody>
        </table>

        {/* 税率別集計（適格請求書の記載要件）＋合計 */}
        <div className="flex justify-end">
          <div className="w-80 text-sm">
            <div className="flex justify-between py-1 border-b border-gray-300">
              <span>小計（税抜）</span>
              <span className="tabular-nums">{formatCurrency(data.subtotal)}</span>
            </div>
            {data.taxBreakdown.map((b) => (
              <div key={b.rate} className="flex justify-between py-1 border-b border-gray-300 text-xs text-gray-600">
                <span>
                  {b.rate}% 対象 {formatCurrency(b.base)}（消費税 {formatCurrency(b.tax)}）
                </span>
              </div>
            ))}
            <div className="flex justify-between py-1 border-b border-gray-300">
              <span>消費税</span>
              <span className="tabular-nums">{formatCurrency(data.taxAmount)}</span>
            </div>
            <div className="flex justify-between py-2 font-bold text-base border-b-2 border-black">
              <span>合計（税込）</span>
              <span className="tabular-nums">{formatCurrency(data.totalAmount)}</span>
            </div>
          </div>
        </div>

        {isQualified && (
          <p className="text-xs text-gray-500 mt-8">
            ※ 本書類は適格請求書（インボイス）の記載要件に対応しています。
          </p>
        )}
      </div>
    </div>
  );
}
