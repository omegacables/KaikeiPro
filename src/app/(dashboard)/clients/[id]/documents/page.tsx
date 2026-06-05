"use client";

import { useState } from "react";
import { FileCheck, Receipt, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { ReceiptsPageContent } from "../receipts/page";
import { InvoicesPageContent } from "../invoices/page";

type DocumentTab =
  | "receipts_received"
  | "receipts_issued"
  | "invoices_purchase"
  | "invoices_sales";

const tabs: { key: DocumentTab; label: string; icon: typeof Receipt }[] = [
  { key: "receipts_received", label: "領収書（受領）", icon: Receipt },
  { key: "receipts_issued", label: "領収書（発行）", icon: Receipt },
  { key: "invoices_purchase", label: "請求書（受領）", icon: FileText },
  { key: "invoices_sales", label: "請求書（発行）", icon: FileText },
];

export default function DocumentsPage() {
  const [activeTab, setActiveTab] = useState<DocumentTab>("receipts_received");

  return (
    <>
      {/* Page Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <FileCheck className="size-6 text-primary" />
            証憑管理
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            領収書・請求書を「発行（自社）／受領（取引先）」で分けて管理
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-6 overflow-x-auto border-b border-border pb-px">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2 text-sm font-bold transition-colors whitespace-nowrap border-b-2 -mb-px cursor-pointer",
              activeTab === tab.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <tab.icon className="size-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {activeTab === "receipts_received" && <ReceiptsPageContent hideHeader lockedDirection="received" />}
      {activeTab === "receipts_issued" && <ReceiptsPageContent hideHeader lockedDirection="issued" />}
      {activeTab === "invoices_purchase" && <InvoicesPageContent hideHeader lockedDirection="purchase" />}
      {activeTab === "invoices_sales" && <InvoicesPageContent hideHeader lockedDirection="sales" />}
    </>
  );
}
