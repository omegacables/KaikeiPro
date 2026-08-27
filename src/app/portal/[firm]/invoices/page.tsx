"use client";

import { useState, useMemo } from "react";
import { FileText, Download, Eye, ChevronUp, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/providers/auth-provider";
import { useData } from "@/lib/use-data";
import { getInvoices } from "@/actions/invoices";
import { printPage } from "@/lib/export";

const statusLabels: Record<string, { label: string; variant: "success" | "warning" | "destructive" | "muted" | "default" }> = {
  draft: { label: "下書き", variant: "muted" },
  issued: { label: "発行済", variant: "default" },
  sent: { label: "送信済", variant: "warning" },
  paid: { label: "入金済", variant: "success" },
  overdue: { label: "期限超過", variant: "destructive" },
};

type FilterKey = "all" | "unpaid" | "paid";

const filterOptions: { key: FilterKey; label: string }[] = [
  { key: "all", label: "全件" },
  { key: "unpaid", label: "未入金" },
  { key: "paid", label: "入金済" },
];

function formatMoney(amount: number): string {
  return `¥${amount.toLocaleString("ja-JP")}`;
}

export default function PortalInvoicesPage() {
  const { user } = useAuth();

  const { data: dbInvoices } = useData(
    () => {
      if (!user?.clientId) return Promise.resolve(null);
      return getInvoices(user.clientId).then((rows) =>
        rows.map((r) => ({
          id: r.id,
          number: r.invoice_number,
          partner: (r as unknown as { business_partners?: { name?: string } }).business_partners?.name ?? "",
          issued_date: r.issued_date?.replace(/-/g, "/") ?? "",
          due_date: r.due_date?.replace(/-/g, "/") ?? "",
          amount: r.total_amount,
          status: r.status,
        }))
      );
    },
    null,
    [user?.clientId]
  );

  const invoices = dbInvoices ?? [];

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");

  const filteredInvoices = useMemo(() => {
    if (filter === "all") return invoices;
    if (filter === "paid") return invoices.filter((inv) => inv.status === "paid");
    // unpaid = everything except paid and draft
    return invoices.filter((inv) => inv.status !== "paid" && inv.status !== "draft");
  }, [invoices, filter]);

  // Counts for filter pills
  const counts = useMemo(() => ({
    all: invoices.length,
    unpaid: invoices.filter((inv) => inv.status !== "paid" && inv.status !== "draft").length,
    paid: invoices.filter((inv) => inv.status === "paid").length,
  }), [invoices]);

  return (
    <>
      <h2 className="text-lg font-bold text-foreground mb-4">請求書一覧</h2>

      {/* Status filter pills */}
      <div className="flex gap-2 mb-4 overflow-x-auto">
        {filterOptions.map((opt) => (
          <button
            key={opt.key}
            onClick={() => setFilter(opt.key)}
            className={`
              shrink-0 px-3 py-1.5 rounded-full text-xs font-bold transition-colors cursor-pointer
              ${filter === opt.key
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-muted/30 text-muted-foreground hover:bg-muted/50"
              }
            `}
          >
            {opt.label}
            <span className="ml-1 opacity-70">{counts[opt.key]}</span>
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {filteredInvoices.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <FileText className="size-10 mb-3 opacity-40" />
            <p className="text-sm font-medium">請求書はまだありません</p>
            <p className="text-xs mt-1 text-center">
              請求書が発行されると、ここに表示されます
            </p>
          </div>
        )}
        {filteredInvoices.map((inv) => {
          const isOverdue = inv.status === "overdue";
          const statusInfo = statusLabels[inv.status] ?? statusLabels.issued;

          return (
            <Card
              key={inv.id}
              className={`p-4 ${isOverdue ? "border-destructive/60 border-2" : ""}`}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-start gap-2">
                  {isOverdue && (
                    <AlertTriangle className="size-4 text-destructive shrink-0 mt-0.5" />
                  )}
                  <div>
                    <p className="text-sm font-bold text-foreground">{inv.number}</p>
                    <p className="text-xs text-muted-foreground">{inv.partner}</p>
                  </div>
                </div>
                <Badge variant={statusInfo.variant}>
                  {statusInfo.label}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <div className="text-xs text-muted-foreground">
                  <p>発行日: {inv.issued_date}</p>
                  <p className={isOverdue ? "text-destructive font-bold" : ""}>
                    支払期限: {inv.due_date}
                  </p>
                </div>
                <p className="text-lg font-bold font-mono text-foreground">
                  {formatMoney(inv.amount)}
                </p>
              </div>
              <div className="flex gap-2 mt-3">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => setExpandedId(expandedId === inv.id ? null : inv.id)}>
                  {expandedId === inv.id ? <ChevronUp className="size-3" /> : <Eye className="size-3" />}
                  {expandedId === inv.id ? "閉じる" : "表示"}
                </Button>
                <Button variant="outline" size="sm" className="flex-1" onClick={printPage}>
                  <Download className="size-3" />
                  PDF
                </Button>
              </div>
              {expandedId === inv.id && (
                <div className="mt-3 pt-3 border-t border-border text-xs space-y-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">請求書番号</span>
                    <span className="font-mono text-foreground">{inv.number}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">取引先</span>
                    <span className="text-foreground">{inv.partner}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">発行日</span>
                    <span className="text-foreground">{inv.issued_date}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">支払期限</span>
                    <span className={`text-foreground font-bold ${isOverdue ? "text-destructive" : ""}`}>
                      {inv.due_date}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">金額</span>
                    <span className="text-foreground font-bold font-mono">
                      {formatMoney(inv.amount)}
                    </span>
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}
