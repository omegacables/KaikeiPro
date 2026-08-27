"use client";

import { useState } from "react";
import {
  Receipt,
  Loader2,
  ChevronDown,
  Upload,
  ScanLine,
  ClipboardCheck,
  BookOpen,
  Camera,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/providers/auth-provider";
import { useData } from "@/lib/use-data";
import { getReceipts } from "@/actions/receipts";
import { useParams } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";

type StatusKey = "uploaded" | "processing" | "ocr_done" | "reviewed" | "journalized";

const statusLabels: Record<
  StatusKey,
  {
    label: string;
    variant: "success" | "warning" | "default" | "muted" | "accent" | "info";
    icon: typeof Receipt;
  }
> = {
  uploaded: { label: "アップロード済", variant: "muted", icon: Upload },
  processing: { label: "処理中", variant: "warning", icon: Loader2 },
  ocr_done: { label: "OCR完了", variant: "info", icon: ScanLine },
  reviewed: { label: "確認済", variant: "accent", icon: ClipboardCheck },
  journalized: { label: "仕訳済", variant: "success", icon: BookOpen },
};

const methodLabels: Record<string, string> = {
  cash: "現金",
  card: "カード",
  e_money: "電子マネー",
  bank_transfer: "振込",
};

type FilterKey = "all" | "pending" | "done";

const filterOptions: { key: FilterKey; label: string }[] = [
  { key: "all", label: "全件" },
  { key: "pending", label: "未処理" },
  { key: "done", label: "処理済" },
];

export default function PortalReceiptsPage() {
  const { user } = useAuth();
  const params = useParams();
  const firm = params.firm as string;

  const { data: receipts } = useData(
    () => {
      if (!user?.clientId) return Promise.resolve(null);
      return getReceipts(user.clientId).then((rows) =>
        rows.map((r) => {
          const ocr = r.ocr_result as { vendor?: string; amount?: number } | null;
          return {
            id: r.id,
            vendor: ocr?.vendor ?? "不明",
            date: r.uploaded_at.slice(0, 10).replace(/-/g, "/"),
            amount: ocr?.amount ?? 0,
            method: methodLabels[r.payment_method ?? ""] ?? "不明",
            status: r.status as StatusKey,
          };
        })
      );
    },
    null,
    [user?.clientId]
  );

  const displayReceipts = receipts ?? [];

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");

  const doneStatuses: StatusKey[] = ["reviewed", "journalized"];

  const filteredReceipts = displayReceipts.filter((r) => {
    if (activeFilter === "all") return true;
    if (activeFilter === "done") return doneStatuses.includes(r.status);
    // pending = not done
    return !doneStatuses.includes(r.status);
  });

  return (
    <>
      <h2 className="text-lg font-bold text-foreground mb-4">アップロード履歴</h2>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <Card className="p-3 text-center">
          <p className="text-xl font-bold text-foreground">{displayReceipts.length}</p>
          <p className="text-[10px] text-muted-foreground">今月合計</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-xl font-bold text-success">
            {displayReceipts.filter((r) => r.status === "journalized").length}
          </p>
          <p className="text-[10px] text-muted-foreground">仕訳済</p>
        </Card>
        <Card className="p-3 text-center">
          <p className="text-xl font-bold text-warning">
            {displayReceipts.filter((r) => !doneStatuses.includes(r.status)).length}
          </p>
          <p className="text-[10px] text-muted-foreground">処理中</p>
        </Card>
      </div>

      {/* Status filter pills */}
      <div className="flex gap-2 mb-4">
        {filterOptions.map((opt) => (
          <button
            key={opt.key}
            onClick={() => setActiveFilter(opt.key)}
            className={cn(
              "px-4 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer",
              activeFilter === opt.key
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-muted/40 text-muted-foreground hover:bg-muted/60"
            )}
          >
            {opt.label}
            {opt.key === "all" && displayReceipts.length > 0 && (
              <span className="ml-1">({displayReceipts.length})</span>
            )}
            {opt.key === "pending" && (
              <span className="ml-1">
                ({displayReceipts.filter((r) => !doneStatuses.includes(r.status)).length})
              </span>
            )}
            {opt.key === "done" && (
              <span className="ml-1">
                ({displayReceipts.filter((r) => doneStatuses.includes(r.status)).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Receipt list */}
      <div className="space-y-3">
        {/* Empty state */}
        {displayReceipts.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <div className="size-16 rounded-full bg-muted/30 flex items-center justify-center text-muted-foreground">
              <Receipt className="size-8" />
            </div>
            <div className="text-center">
              <p className="text-sm font-bold text-foreground mb-1">
                レシートはまだありません
              </p>
              <p className="text-xs text-muted-foreground">
                撮影ページで領収書をアップロードしましょう
              </p>
            </div>
            <Link href={`/portal/${firm}/upload`}>
              <Button size="sm">
                <Camera className="size-4" />
                撮影ページへ
              </Button>
            </Link>
          </div>
        )}

        {/* Filtered empty state (when receipts exist but filter yields nothing) */}
        {displayReceipts.length > 0 && filteredReceipts.length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-sm">
            該当するレシートはありません
          </div>
        )}

        {filteredReceipts.map((receipt) => {
          const statusInfo = statusLabels[receipt.status] ?? statusLabels.uploaded;
          const isExpanded = expandedId === receipt.id;

          return (
            <Card
              key={receipt.id}
              className="overflow-hidden cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => setExpandedId(isExpanded ? null : receipt.id)}
            >
              <div className="p-4">
                <div className="flex items-center gap-3">
                  <div className="size-12 rounded-lg bg-muted/30 flex items-center justify-center text-muted-foreground shrink-0">
                    <Receipt className="size-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-foreground truncate">
                      {receipt.vendor}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {receipt.date} / {receipt.method}
                    </p>
                  </div>
                  <div className="text-right shrink-0 flex flex-col items-end gap-1">
                    <p className="text-sm font-bold font-mono text-foreground">
                      ¥{receipt.amount.toLocaleString()}
                    </p>
                    <Badge variant={statusInfo.variant}>
                      {statusInfo.label}
                    </Badge>
                  </div>
                  <ChevronDown
                    className={cn(
                      "size-4 text-muted-foreground shrink-0 transition-transform",
                      isExpanded && "rotate-180"
                    )}
                  />
                </div>
              </div>
              {isExpanded && (
                <div className="px-4 pb-4">
                  <div className="pt-3 border-t border-border text-xs space-y-2">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">ID</span>
                      <span className="font-mono text-foreground">{receipt.id}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">取引先</span>
                      <span className="text-foreground">{receipt.vendor}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">日付</span>
                      <span className="text-foreground">{receipt.date}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">金額</span>
                      <span className="font-mono font-bold text-foreground">
                        ¥{receipt.amount.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">支払方法</span>
                      <span className="text-foreground">{receipt.method}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">ステータス</span>
                      <Badge variant={statusInfo.variant}>
                        {statusInfo.label}
                      </Badge>
                    </div>
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
