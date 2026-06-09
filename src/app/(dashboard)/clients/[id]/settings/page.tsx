"use client";

import { useState } from "react";
import { Settings, Percent, FolderArchive, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import TaxPage from "../tax/page";
import CompanyDocumentsPage from "../company-documents/page";
import AuditLogPage from "../audit/page";

type SettingsTab = "tax" | "company_documents" | "audit";

const tabs: { key: SettingsTab; label: string; icon: typeof Settings }[] = [
  { key: "tax", label: "消費税計算", icon: Percent },
  { key: "company_documents", label: "会社書類", icon: FolderArchive },
  { key: "audit", label: "監査ログ", icon: Shield },
];

export default function ClientSettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("tax");

  return (
    <>
      {/* Page Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Settings className="size-6 text-primary" />
            設定
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            消費税計算・会社書類・監査ログをまとめて管理します。
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
      {activeTab === "tax" && <TaxPage />}
      {activeTab === "company_documents" && <CompanyDocumentsPage />}
      {activeTab === "audit" && <AuditLogPage />}
    </>
  );
}
