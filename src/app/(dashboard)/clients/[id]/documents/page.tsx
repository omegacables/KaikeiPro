"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { FileCheck, Receipt, FileText, FileSpreadsheet } from "lucide-react";
import { cn } from "@/lib/utils";
import { ReceiptsPageContent } from "../receipts/page";
import { InvoicesPageContent } from "../invoices/page";

type DocumentTab = "issued" | "received" | "statements";

const tabs: { key: DocumentTab; label: string; icon: typeof Receipt }[] = [
  { key: "issued", label: "領収書・請求書（発行）", icon: FileText },
  { key: "received", label: "領収書・請求書（受領）", icon: Receipt },
  { key: "statements", label: "明細書", icon: FileSpreadsheet },
];

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-base font-bold text-foreground border-l-4 border-primary pl-3 mb-4 mt-2">
      {children}
    </h2>
  );
}

export default function DocumentsPage() {
  const { id } = useParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState<DocumentTab>("issued");

  return (
    <>
      {/* Page Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <FileCheck className="size-6 text-primary" />
            帳票管理
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            領収書・請求書を「発行（自社）／受領（取引先）」に分けて管理。発行タブから請求書を新規作成・発行できます。
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

      {/* ===== 発行（自社）: 請求書 + 領収書 ===== */}
      {activeTab === "issued" && (
        <div className="space-y-10">
          <section>
            <SectionHeading>請求書（発行）</SectionHeading>
            <InvoicesPageContent hideHeader lockedDirection="sales" />
          </section>
          <section>
            <SectionHeading>領収書（発行）</SectionHeading>
            <ReceiptsPageContent
              hideHeader
              lockedDirection="issued"
              hideProcessingSection
              excludeDocTypes={["statement"]}
            />
          </section>
        </div>
      )}

      {/* ===== 受領（取引先）: 請求書 + 領収書 ===== */}
      {activeTab === "received" && (
        <div className="space-y-10">
          <section>
            <SectionHeading>請求書（受領）</SectionHeading>
            <InvoicesPageContent hideHeader lockedDirection="purchase" />
          </section>
          <section>
            <SectionHeading>領収書（受領）</SectionHeading>
            <ReceiptsPageContent
              hideHeader
              lockedDirection="received"
              excludeDocTypes={["statement"]}
            />
          </section>
        </div>
      )}

      {/* ===== 明細書 ===== */}
      {activeTab === "statements" && (
        <ReceiptsPageContent hideHeader lockedDocType="statement" hideProcessingSection />
      )}
    </>
  );
}
