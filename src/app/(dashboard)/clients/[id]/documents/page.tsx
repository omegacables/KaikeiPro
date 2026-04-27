"use client";

import { useState } from "react";
import { FileCheck, Receipt, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { ReceiptsPageContent } from "../receipts/page";
import { InvoicesPageContent } from "../invoices/page";

type DocumentTab = "receipts" | "invoices";

const tabs: { key: DocumentTab; label: string; icon: typeof Receipt }[] = [
  { key: "receipts", label: "領収書", icon: Receipt },
  { key: "invoices", label: "請求書", icon: FileText },
];

export default function DocumentsPage() {
  const [activeTab, setActiveTab] = useState<DocumentTab>("receipts");

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
            領収書・請求書の管理
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
      {activeTab === "receipts" && <ReceiptsPageContent hideHeader />}
      {activeTab === "invoices" && <InvoicesPageContent hideHeader />}
    </>
  );
}
