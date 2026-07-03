"use client";

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Search,
  Plus,
  ChevronRight,
  X,
  Loader2,
  Save,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-bar";
import { useData } from "@/lib/use-data";
import { getClientSummaries, createClient } from "@/actions/clients";
import { getInitials } from "@/lib/utils";
import { settlementMonth, startMonthFromSettlement } from "@/lib/fiscal";

const statusConfig = {
  good: { variant: "success" as const, label: "順調" },
  warning: { variant: "warning" as const, label: "要確認" },
  overdue: { variant: "destructive" as const, label: "未提出" },
};

export default function ClientsPage() {
  return (
    <Suspense>
      <ClientsPageContent />
    </Suspense>
  );
}

function ClientsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [showNewForm, setShowNewForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newClient, setNewClient] = useState({
    name: "",
    business_type: "",
    postal_code: "",
    address: "",
    telephone: "",
    email: "",
    fiscal_year_start_month: 4,
    tax_method: "standard" as "standard" | "simplified",
    invoice_registration_number: "",
  });

  const { data: summaries, refetch: refetchSummaries } = useData(() => getClientSummaries(), []);

  // Open new form if ?new=1
  useEffect(() => {
    if (searchParams.get("new") === "1") {
      setShowNewForm(true);
    }
  }, [searchParams]);

  // Convert Supabase summaries to page format (no fallback mock)
  const clients = summaries.map((s) => ({
    id: s.client.id,
    name: s.client.name,
    initials: getInitials(s.client.name),
    business_type: s.client.business_type ?? "",
    fiscal_year_end: `${settlementMonth(s.client.fiscal_year_start_month)}月`,
    tax_method: s.client.tax_method === "standard" ? "本則課税" : "簡易課税",
    status: s.status,
    statusLabel:
      s.status === "good"
        ? "順調"
        : s.status === "warning"
          ? "要確認"
          : "未提出",
    pending_receipts: s.pending_receipts,
    unanswered_questions: s.unanswered_questions,
    ai_pending: s.ai_pending_reviews,
    needs_review: s.needs_review_count ?? 0,
    progress: s.submission_progress,
  }));

  const filteredClients = clients.filter((c) => {
    const matchesSearch = c.name.toLowerCase().includes(search.toLowerCase());
    const matchesFilter = filterStatus === "all" || c.status === filterStatus;
    return matchesSearch && matchesFilter;
  });

  const stats = {
    total: clients.length,
    good: clients.filter((c) => c.status === "good").length,
    warning: clients.filter((c) => c.status === "warning").length,
    overdue: clients.filter((c) => c.status === "overdue").length,
  };

  async function handleCreateClient() {
    if (!newClient.name) return;
    setSaving(true);
    try {
      const created = await createClient({
        name: newClient.name,
        business_type: newClient.business_type || null,
        postal_code: newClient.postal_code || null,
        address: newClient.address || null,
        telephone: newClient.telephone || null,
        email: newClient.email || null,
        fiscal_year_start_month: newClient.fiscal_year_start_month,
        tax_method: newClient.tax_method,
        invoice_registration_number: newClient.invoice_registration_number || null,
      });
      refetchSummaries();
      // Navigate to the new client
      router.push(`/clients/${created.id}`);
    } catch (e) {
      alert(e instanceof Error ? e.message : "顧問先の作成に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/* New Client Form */}
      {showNewForm && (
        <Card className="mb-6 p-6 border-primary/30">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-foreground">新規顧問先登録</h3>
            <button
              onClick={() => {
                setShowNewForm(false);
                router.replace("/clients");
              }}
              className="p-1 rounded-lg hover:bg-muted/30 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              <X className="size-5" />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                顧問先名 <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                value={newClient.name}
                onChange={(e) => setNewClient({ ...newClient, name: e.target.value })}
                placeholder="株式会社〇〇"
                className="w-full bg-card border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted-foreground"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                業種
              </label>
              <input
                type="text"
                value={newClient.business_type}
                onChange={(e) => setNewClient({ ...newClient, business_type: e.target.value })}
                placeholder="製造業"
                className="w-full bg-card border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted-foreground"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                メールアドレス
              </label>
              <input
                type="email"
                value={newClient.email}
                onChange={(e) => setNewClient({ ...newClient, email: e.target.value })}
                placeholder="info@example.com"
                className="w-full bg-card border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted-foreground"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                電話番号
              </label>
              <input
                type="text"
                value={newClient.telephone}
                onChange={(e) => setNewClient({ ...newClient, telephone: e.target.value })}
                placeholder="03-1234-5678"
                className="w-full bg-card border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted-foreground"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                決算月
              </label>
              <select
                value={settlementMonth(newClient.fiscal_year_start_month)}
                onChange={(e) =>
                  setNewClient({
                    ...newClient,
                    fiscal_year_start_month: startMonthFromSettlement(Number(e.target.value)),
                  })
                }
                className="w-full bg-card border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>
                    {m}月
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground mt-1">
                会計年度: {newClient.fiscal_year_start_month}月 〜{" "}
                {newClient.fiscal_year_start_month === 1 ? "" : "翌"}
                {settlementMonth(newClient.fiscal_year_start_month)}月
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                課税方式
              </label>
              <select
                value={newClient.tax_method}
                onChange={(e) =>
                  setNewClient({
                    ...newClient,
                    tax_method: e.target.value as "standard" | "simplified",
                  })
                }
                className="w-full bg-card border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                <option value="standard">本則課税</option>
                <option value="simplified">簡易課税</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                インボイス登録番号
              </label>
              <input
                type="text"
                value={newClient.invoice_registration_number}
                onChange={(e) =>
                  setNewClient({ ...newClient, invoice_registration_number: e.target.value })
                }
                placeholder="T1234567890123"
                className="w-full bg-card border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted-foreground"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                住所
              </label>
              <input
                type="text"
                value={newClient.address}
                onChange={(e) => setNewClient({ ...newClient, address: e.target.value })}
                placeholder="東京都千代田区..."
                className="w-full bg-card border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted-foreground"
              />
            </div>
          </div>
          <div className="mt-4 flex gap-2 justify-end">
            <Button
              variant="ghost"
              onClick={() => {
                setShowNewForm(false);
                router.replace("/clients");
              }}
            >
              キャンセル
            </Button>
            <Button
              onClick={handleCreateClient}
              disabled={saving || !newClient.name}
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              登録
            </Button>
          </div>
        </Card>
      )}

      {/* Summary */}
      <div className="flex flex-wrap gap-4 mb-6">
        <Card className="flex-1 min-w-[150px] p-4">
          <p className="text-muted-foreground text-xs font-medium">全顧問先</p>
          <p className="text-2xl font-bold text-foreground">{stats.total}</p>
        </Card>
        <Card className="flex-1 min-w-[150px] p-4">
          <p className="text-muted-foreground text-xs font-medium">順調</p>
          <p className="text-2xl font-bold text-success">{stats.good}</p>
        </Card>
        <Card className="flex-1 min-w-[150px] p-4">
          <p className="text-muted-foreground text-xs font-medium">要確認</p>
          <p className="text-2xl font-bold text-warning">{stats.warning}</p>
        </Card>
        <Card className="flex-1 min-w-[150px] p-4">
          <p className="text-muted-foreground text-xs font-medium">未提出</p>
          <p className="text-2xl font-bold text-destructive">{stats.overdue}</p>
        </Card>
      </div>

      {/* Search & Filter */}
      <div className="flex flex-wrap gap-4 mb-6 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground size-4" />
          <input
            className="w-full bg-card border border-border rounded-lg pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted-foreground"
            placeholder="顧問先を検索..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          {[
            { key: "all", label: "すべて" },
            { key: "good", label: "順調" },
            { key: "warning", label: "要確認" },
            { key: "overdue", label: "未提出" },
          ].map((f) => (
            <Button
              key={f.key}
              variant={filterStatus === f.key ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterStatus(f.key)}
            >
              {f.label}
            </Button>
          ))}
        </div>
        <Button onClick={() => setShowNewForm(true)}>
          <Plus className="size-4" />
          新規顧問先
        </Button>
      </div>

      {/* Client List */}
      <div className="space-y-3">
        {filteredClients.map((client) => (
          <Link key={client.id} href={`/clients/${client.id}`}>
            <Card className="flex items-center gap-4 p-4 hover:shadow-md transition-shadow cursor-pointer mb-3">
              <div className="size-12 rounded-lg bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                {client.initials}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="text-foreground font-bold truncate">
                    {client.name}
                  </h4>
                  <Badge variant="muted">{client.business_type}</Badge>
                </div>
                <p className="text-muted-foreground text-xs mt-0.5">
                  決算月: {client.fiscal_year_end} • {client.tax_method}
                </p>
              </div>

              {/* Pending items */}
              <div className="hidden lg:flex gap-6 text-xs">
                {client.pending_receipts > 0 && (
                  <div className="text-center">
                    <p className="text-warning font-bold text-base">
                      {client.pending_receipts}
                    </p>
                    <p className="text-muted-foreground">未確認領収書</p>
                  </div>
                )}
                {client.unanswered_questions > 0 && (
                  <div className="text-center">
                    <p className="text-destructive font-bold text-base">
                      {client.unanswered_questions}
                    </p>
                    <p className="text-muted-foreground">未回答質問</p>
                  </div>
                )}
                {client.ai_pending > 0 && (
                  <div className="text-center">
                    <p className="text-primary-light font-bold text-base">
                      {client.ai_pending}
                    </p>
                    <p className="text-muted-foreground">AI仕訳待ち</p>
                  </div>
                )}
                {client.needs_review > 0 && (
                  <div className="text-center">
                    <p className="text-amber-500 font-bold text-base">
                      {client.needs_review}
                    </p>
                    <p className="text-muted-foreground">確認待ち</p>
                  </div>
                )}
              </div>

              <div className="hidden md:block w-36">
                <ProgressBar
                  value={client.progress}
                  label="月次進捗"
                  showPercent
                />
              </div>

              <Badge variant={statusConfig[client.status].variant}>
                {client.statusLabel}
              </Badge>

              <ChevronRight className="size-4 text-muted-foreground" />
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
