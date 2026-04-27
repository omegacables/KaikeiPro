"use client";

import { useState, useEffect } from "react";
import {
  CheckCircle,
  AlertTriangle,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  Mail,
  Receipt,
  Plus,
  ChevronRight,
  Zap,
  PlusSquare,
  Package,
  Building2,
  Users,
  ShieldCheck,
  X,
  Loader2,
  Save,
  Calendar,
  Banknote,
  FileText,
  Calculator,
  BookOpen,
  BarChart3,
  Percent,
  Archive,
  Landmark,
  CreditCard,
  Handshake,
  FileCheck,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useData } from "@/lib/use-data";
import { useAuth } from "@/components/providers/auth-provider";
import { scopedGetItem, scopedSetItem } from "@/lib/scoped-storage";
import { getClientSummaries, getClientUsers, updateClientUser } from "@/actions/clients";
import { getFirms, createFirm } from "@/actions/firms";
import { ClientPortalAccountForm } from "@/components/client-portal-account-form";

const statusVariantMap = {
  good: "success" as const,
  warning: "warning" as const,
  overdue: "destructive" as const,
};
const statusLabelMap = {
  good: "完了",
  warning: "注意",
  overdue: "遅延",
};

function getInitialsFromName(name: string) {
  const chars = name.replace(/[株式会社（）()]/g, "").trim();
  return chars.slice(0, 2);
}

// ---------------------------------------------------------------------------
// Widget definitions
// ---------------------------------------------------------------------------
type WidgetKey = "calendar" | "bank" | "invoices" | "ai_review";

const WIDGET_DEFINITIONS: {
  key: WidgetKey;
  label: string;
  desc: string;
  icon: typeof Calendar;
  href: string;
}[] = [
  { key: "calendar", label: "税務カレンダー", desc: "次回の申告期限・届出予定を確認", icon: Calendar, href: "/clients" },
  { key: "bank", label: "口座残高サマリー", desc: "登録口座の最新残高を一覧表示", icon: Banknote, href: "/settings" },
  { key: "invoices", label: "請求書ステータス", desc: "未送信・未入金の請求書を確認", icon: FileText, href: "/clients" },
  { key: "ai_review", label: "AI仕訳レビュー", desc: "AIが提案した仕訳の確認待ち一覧", icon: Calculator, href: "/clients" },
];

function loadWidgets(userId: string | null): WidgetKey[] {
  if (typeof window === "undefined") return [];
  try {
    const saved = scopedGetItem(userId, "dashboard_widgets");
    if (saved) return JSON.parse(saved);
  } catch { /* ignore */ }
  return [];
}

function saveWidgets(userId: string | null, widgets: WidgetKey[]) {
  if (typeof window === "undefined") return;
  scopedSetItem(userId, "dashboard_widgets", JSON.stringify(widgets));
}

// ---------------------------------------------------------------------------
// Super Admin Dashboard
// ---------------------------------------------------------------------------
function SuperAdminDashboard() {
  const { data: firms, refetch: refetchFirms } = useData(() => getFirms(), []);
  const { data: summaries } = useData(() => getClientSummaries().catch(() => []), []);

  const [showFirmForm, setShowFirmForm] = useState(false);
  const [firmName, setFirmName] = useState("");
  const [firmEmail, setFirmEmail] = useState("");
  const [creating, setCreating] = useState(false);

  const handleCreateFirm = async () => {
    if (!firmName.trim()) return;
    setCreating(true);
    try {
      await createFirm({
        name: firmName.trim(),
        email: firmEmail.trim() || null,
      });
      setFirmName("");
      setFirmEmail("");
      setShowFirmForm(false);
      refetchFirms();
    } catch (e) {
      alert(e instanceof Error ? e.message : "事務所の作成に失敗しました");
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
      {/* Admin header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <ShieldCheck className="size-6 text-primary" />
          <h2 className="text-foreground text-2xl font-bold">システム管理</h2>
        </div>
        <p className="text-muted-foreground text-sm">
          事務所と顧客の管理を行います
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Firms card */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10 text-primary">
                <Building2 className="size-5" />
              </div>
              <div>
                <h3 className="text-foreground text-lg font-bold">税理士事務所一覧</h3>
                <p className="text-muted-foreground text-xs">{firms.length} 事務所</p>
              </div>
            </div>
            <Button size="sm" onClick={() => setShowFirmForm(!showFirmForm)}>
              {showFirmForm ? <X className="size-4" /> : <Plus className="size-4" />}
              {showFirmForm ? "閉じる" : "事務所を追加"}
            </Button>
          </div>

          {showFirmForm && (
            <div className="mb-4 p-4 rounded-lg border border-primary/30 bg-primary/5">
              <h4 className="font-bold text-foreground text-sm mb-3">新規事務所作成</h4>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">事務所名 *</label>
                  <input
                    type="text"
                    value={firmName}
                    onChange={(e) => setFirmName(e.target.value)}
                    placeholder="田中税理士事務所"
                    className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">メールアドレス</label>
                  <input
                    type="email"
                    value={firmEmail}
                    onChange={(e) => setFirmEmail(e.target.value)}
                    placeholder="info@example.com"
                    className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" size="sm" onClick={() => setShowFirmForm(false)}>
                    キャンセル
                  </Button>
                  <Button size="sm" onClick={handleCreateFirm} disabled={creating || !firmName.trim()}>
                    {creating ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                    作成
                  </Button>
                </div>
              </div>
            </div>
          )}

          {firms.length === 0 ? (
            <p className="text-muted-foreground text-sm py-4 text-center">登録された事務所がありません</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {firms.map((firm) => (
                <Link key={firm.id} href="/firms">
                  <div className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted/10 transition-colors cursor-pointer">
                    <div className="size-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                      {firm.name.slice(0, 2)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-foreground font-bold text-sm truncate">{firm.name}</p>
                      <p className="text-muted-foreground text-xs">{firm.email ?? ""}</p>
                    </div>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>

        {/* Clients card */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-accent/10 text-accent">
                <Users className="size-5" />
              </div>
              <div>
                <h3 className="text-foreground text-lg font-bold">顧客一覧</h3>
                <p className="text-muted-foreground text-xs">{summaries.length} 顧客</p>
              </div>
            </div>
            <Link href="/clients?new=1">
              <Button size="sm">
                <Plus className="size-4" />
                顧客を追加
              </Button>
            </Link>
          </div>
          {summaries.length === 0 ? (
            <p className="text-muted-foreground text-sm py-4 text-center">登録された顧客がありません</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {summaries.slice(0, 10).map((s) => (
                <Link key={s.client.id} href={`/clients/${s.client.id}`}>
                  <div className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted/10 transition-colors cursor-pointer">
                    <div className="size-10 rounded-lg bg-accent/10 flex items-center justify-center text-accent font-bold text-sm">
                      {getInitialsFromName(s.client.name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-foreground font-bold text-sm truncate">{s.client.name}</p>
                      <p className="text-muted-foreground text-xs">{s.client.business_type ?? ""}</p>
                    </div>
                    <Badge variant={statusVariantMap[s.status]}>
                      {statusLabelMap[s.status]}
                    </Badge>
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Client Dashboard (single company - portal user on staff side)
// ---------------------------------------------------------------------------
const clientMenuItems = [
  { href: "journals", label: "仕訳入力", icon: Calculator, desc: "仕訳の作成・編集・確認" },
  { href: "receipts", label: "領収書管理", icon: Receipt, desc: "領収書のアップロード・OCR・確認" },
  { href: "ledgers", label: "帳簿閲覧", icon: BookOpen, desc: "仕訳帳・総勘定元帳・出納帳" },
  { href: "statements", label: "試算表・財務諸表", icon: BarChart3, desc: "B/S・P/L・月次推移表" },
  { href: "accounts", label: "勘定科目管理", icon: FileText, desc: "科目の追加・編集・補助科目" },
  { href: "tax", label: "消費税計算", icon: Percent, desc: "税率別集計・申告データ" },
  { href: "closing", label: "決算処理", icon: Archive, desc: "減価償却・決算整理仕訳・年度締め" },
  { href: "assets", label: "固定資産台帳", icon: Landmark, desc: "資産管理・償却計算" },
  { href: "invoices", label: "請求書管理", icon: FileText, desc: "請求書作成・発行履歴" },
  { href: "payments", label: "入金消込", icon: CreditCard, desc: "入金照合・消込処理" },
  { href: "bank-transactions", label: "口座取引", icon: Banknote, desc: "銀行口座の取引照合・仕訳連携" },
  { href: "partners", label: "取引先管理", icon: Handshake, desc: "得意先・仕入先・インボイス登録" },
];

function ClientDashboard() {
  const { user } = useAuth();
  const { data: summaries } = useData(() => getClientSummaries().catch(() => []), []);
  const clientId = summaries[0]?.client.id ?? user?.clientId;

  const [clientUsers, setClientUsers] = useState<{ id: string; name: string; email: string; is_active: boolean }[]>([]);
  useEffect(() => {
    if (clientId) {
      getClientUsers(clientId).then(setClientUsers).catch(() => {});
    }
  }, [clientId]);

  const mySummary = summaries[0];
  const pendingReceipts = mySummary?.pending_receipts ?? 0;
  const unansweredQuestions = mySummary?.unanswered_questions ?? 0;
  const aiPendingReviews = mySummary?.ai_pending_reviews ?? 0;
  const needsReviewCount = mySummary?.needs_review_count ?? 0;

  const kpiCards = [
    {
      icon: Receipt,
      iconColor: "text-warning",
      label: "未確認領収書",
      value: `${pendingReceipts} 件`,
    },
    {
      icon: FileCheck,
      iconColor: "text-amber-500",
      label: "確認待ち",
      value: `${needsReviewCount} 件`,
      href: clientId ? `/clients/${clientId}/ledgers` : "/clients",
    },
    {
      icon: Calculator,
      iconColor: "text-primary-light",
      label: "AI仕訳確認待ち",
      value: `${aiPendingReviews} 件`,
    },
    {
      icon: Mail,
      iconColor: "text-destructive",
      label: "未回答の質問",
      value: `${unansweredQuestions} 件`,
    },
  ];

  const actionItems = [
    {
      icon: Receipt,
      iconBg: "bg-warning/10 text-warning",
      borderColor: "border-l-warning",
      title: "領収書提出",
      description: pendingReceipts === 0
        ? "未確認の領収書はありません。"
        : `${pendingReceipts}件の領収書が確認待ちです。`,
      href: clientId ? `/clients/${clientId}/receipts` : "/clients",
    },
    {
      icon: FileCheck,
      iconBg: "bg-amber-500/10 text-amber-500",
      borderColor: "border-l-amber-500",
      title: "確認待ち",
      description: needsReviewCount === 0
        ? "確認待ちの仕訳はありません。"
        : `${needsReviewCount}件の仕訳が税理士の確認待ちです。`,
      href: clientId ? `/clients/${clientId}/ledgers` : "/clients",
    },
    {
      icon: Mail,
      iconBg: "bg-primary/10 text-primary",
      borderColor: "border-l-primary",
      title: "税理士からの質問",
      description: unansweredQuestions === 0
        ? "未回答の質問はありません。"
        : `${unansweredQuestions}件の質問が回答待ちです。`,
      href: clientId ? `/clients/${clientId}` : "/clients",
    },
    {
      icon: Package,
      iconBg: "bg-primary/10 text-primary",
      borderColor: "border-l-primary",
      title: "Raqto受発注管理",
      description: "受発注管理との連携状況を確認できます。",
      href: "/settings",
    },
  ];

  return (
    <>
      {/* KPI Cards */}
      <div className="flex flex-wrap gap-6 mb-8">
        {kpiCards.map((card) => {
          const inner = (
            <>
              <div className="flex items-center gap-2 mb-1">
                <card.icon className={`size-5 ${card.iconColor}`} />
                <p className="text-muted-foreground text-sm font-medium">
                  {card.label}
                </p>
              </div>
              <p className="text-foreground tracking-tight text-3xl font-bold leading-tight">
                {card.value}
              </p>
            </>
          );
          return card.href ? (
            <Link key={card.label} href={card.href} className="flex min-w-[200px] flex-1">
              <Card className="flex flex-1 flex-col gap-2 p-6 hover:border-primary/40 transition-colors cursor-pointer">
                {inner}
              </Card>
            </Link>
          ) : (
            <Card key={card.label} className="flex min-w-[200px] flex-1 flex-col gap-2 p-6">
              {inner}
            </Card>
          );
        })}
      </div>

      {/* Action Items */}
      <div className="mb-8">
        <h2 className="text-foreground text-xl font-bold leading-tight tracking-tight mb-4 flex items-center gap-2">
          <Zap className="size-5 text-primary-light" /> やること
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {actionItems.map((item) => (
            <Link key={item.title} href={item.href}>
              <Card
                className={`flex flex-col gap-4 border-l-4 ${item.borderColor} p-6 hover:shadow-md transition-shadow cursor-pointer h-full`}
              >
                <div className={`p-2 rounded-lg ${item.iconBg} w-fit`}>
                  <item.icon className="size-5" />
                </div>
                <div className="flex flex-col gap-1">
                  <h3 className="text-foreground text-lg font-bold">
                    {item.title}
                  </h3>
                  <p className="text-muted-foreground text-sm">
                    {item.description}
                  </p>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </div>

      {/* Business Menu (12 items) */}
      {clientId && (
        <div className="mb-8">
          <h2 className="text-foreground text-xl font-bold leading-tight tracking-tight mb-4">
            業務メニュー
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {clientMenuItems.map((item) => (
              <Link key={item.href} href={`/clients/${clientId}/${item.href}`}>
                <Card className="p-4 hover:shadow-md transition-all hover:border-primary/30 cursor-pointer group h-full">
                  <div className="flex items-start justify-between">
                    <div className="p-2 rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-cream transition-colors">
                      <item.icon className="size-5" />
                    </div>
                  </div>
                  <h4 className="text-foreground font-bold mt-3">{item.label}</h4>
                  <p className="text-muted-foreground text-xs mt-1">{item.desc}</p>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Portal Account & Account List */}
      {clientId && (
        <div className="mb-8">
          <h2 className="text-foreground text-xl font-bold leading-tight tracking-tight mb-4 flex items-center gap-2">
            <Users className="size-5 text-primary-light" /> ポータルアカウント
          </h2>

          {/* Account creation form */}
          <div className="mb-6">
            <ClientPortalAccountForm clientId={clientId} />
          </div>

          {/* Account list */}
          {clientUsers.length > 0 && (
            <PortalAccountList clientUsers={clientUsers} setClientUsers={setClientUsers} />
          )}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Portal Account List with inline editing
// ---------------------------------------------------------------------------
function PortalAccountList({
  clientUsers,
  setClientUsers,
}: {
  clientUsers: { id: string; name: string; email: string; is_active: boolean }[];
  setClientUsers: React.Dispatch<React.SetStateAction<{ id: string; name: string; email: string; is_active: boolean }[]>>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState({ name: "", active: true });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!editingId || !editData.name.trim()) return;
    setSaving(true);
    try {
      await updateClientUser(editingId, { name: editData.name.trim(), is_active: editData.active });
      setClientUsers((prev) =>
        prev.map((cu) => cu.id === editingId ? { ...cu, name: editData.name.trim(), is_active: editData.active } : cu)
      );
      setEditingId(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "更新に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-6">
      <h3 className="text-foreground font-bold text-sm mb-4">
        アカウント一覧（{clientUsers.length}名）
      </h3>
      <div className="space-y-3">
        {clientUsers.map((cu) => (
          <div key={cu.id} className="rounded-lg border border-border">
            <div className="flex items-center gap-3 p-3">
              <div className="size-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                {cu.name.slice(0, 2)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-foreground font-bold text-sm truncate">{cu.name}</p>
                <p className="text-muted-foreground text-xs truncate">{cu.email}</p>
              </div>
              <Badge variant={cu.is_active ? "success" : "muted"}>
                {cu.is_active ? "有効" : "無効"}
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (editingId === cu.id) {
                    setEditingId(null);
                  } else {
                    setEditingId(cu.id);
                    setEditData({ name: cu.name, active: cu.is_active });
                  }
                }}
              >
                {editingId === cu.id ? "閉じる" : "編集"}
              </Button>
            </div>
            {editingId === cu.id && (
              <div className="px-3 pb-3 pt-2 border-t border-border bg-muted/20 space-y-3">
                <div>
                  <label className="text-xs font-bold text-muted-foreground mb-1 block">名前</label>
                  <input
                    type="text"
                    className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm"
                    value={editData.name}
                    onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-muted-foreground mb-1 block">ステータス</label>
                  <select
                    className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm"
                    value={editData.active ? "active" : "inactive"}
                    onChange={(e) => setEditData({ ...editData, active: e.target.value === "active" })}
                  >
                    <option value="active">有効</option>
                    <option value="inactive">無効</option>
                  </select>
                </div>
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>キャンセル</Button>
                  <Button size="sm" onClick={handleSave} disabled={saving || !editData.name.trim()}>
                    {saving && <Loader2 className="size-4 animate-spin" />}
                    保存
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Regular Dashboard (admin/staff - multi-client)
// ---------------------------------------------------------------------------
function RegularDashboard() {
  const router = useRouter();
  const { user } = useAuth();
  const { data: summaries } = useData(() => getClientSummaries(), []);

  // Custom widgets (user-scoped)
  const [activeWidgets, setActiveWidgets] = useState<WidgetKey[]>([]);
  const [showWidgetPicker, setShowWidgetPicker] = useState(false);

  useEffect(() => {
    if (user?.id) setActiveWidgets(loadWidgets(user.id));
  }, [user?.id]);

  function addWidget(key: WidgetKey) {
    const updated = [...activeWidgets, key];
    setActiveWidgets(updated);
    saveWidgets(user?.id ?? null, updated);
    setShowWidgetPicker(false);
  }

  function removeWidget(key: WidgetKey) {
    const updated = activeWidgets.filter((w) => w !== key);
    setActiveWidgets(updated);
    saveWidgets(user?.id ?? null, updated);
  }

  const availableWidgets = WIDGET_DEFINITIONS.filter(
    (w) => !activeWidgets.includes(w.key)
  );

  // Build activity from real data (no fallback mock)
  const recentActivity = summaries.slice(0, 5).map((s) => ({
    initials: getInitialsFromName(s.client.name),
    name: s.client.name,
    detail: `${s.client.business_type ?? ""} • ${s.client.tax_method === "standard" ? "本則課税" : "簡易課税"}`,
    progress: s.submission_progress,
    status: statusLabelMap[s.status],
    statusVariant: statusVariantMap[s.status],
    id: s.client.id,
  }));

  // Compute KPIs from real data
  const completedCount = summaries.filter((s) => s.status === "good").length;
  const warningCount = summaries.filter((s) => s.status === "warning").length;
  const overdueCount = summaries.filter((s) => s.status === "overdue").length;

  const kpiCards = [
    {
      icon: CheckCircle,
      iconColor: "text-success",
      label: "提出完了",
      value: `${completedCount} 社`,
      trend: null,
      trendUp: true,
      trendLabel: "",
    },
    {
      icon: AlertTriangle,
      iconColor: "text-warning",
      label: "確認待ち",
      value: `${warningCount} 社`,
      trend: null,
      trendUp: false,
      trendLabel: "",
    },
    {
      icon: AlertCircle,
      iconColor: "text-destructive",
      label: "要対応",
      value: `${overdueCount} 社`,
      trend: null,
      trendUp: null,
      trendLabel: "変動なし",
    },
  ];

  // Compute dynamic counts for action items (pre-compute for KPI card)
  const totalNeedsReviewForKpi = summaries.reduce((sum, s) => sum + (s.needs_review_count ?? 0), 0);
  if (totalNeedsReviewForKpi > 0) {
    kpiCards.push({
      icon: FileCheck,
      iconColor: "text-amber-500",
      label: "確認待ち仕訳",
      value: `${totalNeedsReviewForKpi} 件`,
      trend: null,
      trendUp: false,
      trendLabel: "",
    });
  }

  // Compute dynamic counts for action items
  const totalQuestions = summaries.reduce((sum, s) => sum + s.unanswered_questions, 0);
  const questionClients = summaries.filter((s) => s.unanswered_questions > 0).length;
  const totalReceipts = summaries.reduce((sum, s) => sum + s.pending_receipts, 0);
  const receiptClients = summaries.filter((s) => s.pending_receipts > 0).length;
  const totalAiReviews = summaries.reduce((sum, s) => sum + s.ai_pending_reviews, 0);
  const totalNeedsReview = summaries.reduce((sum, s) => sum + (s.needs_review_count ?? 0), 0);
  const needsReviewClients = summaries.filter((s) => (s.needs_review_count ?? 0) > 0).length;

  const actionItems = [
    {
      icon: Mail,
      iconBg: "bg-primary/10 text-primary",
      borderColor: "border-l-primary",
      title: "未読メッセージ",
      description: totalQuestions === 0
        ? "新規の問い合わせはありません。"
        : totalQuestions <= 5
          ? `${questionClients}社の顧問先で${totalQuestions}件の問い合わせがあります。`
          : `${questionClients}社の顧問先で、対応が必要な問い合わせが${totalQuestions}件あります。`,
      urgent: totalQuestions > 5,
      href: "/clients",
    },
    {
      icon: Receipt,
      iconBg: "bg-warning/10 text-warning",
      borderColor: "border-l-warning",
      title: "未確認領収書",
      description: totalReceipts === 0
        ? "すべての領収書が確認済みです。"
        : totalReceipts <= 10
          ? `${totalReceipts}件の未確認領収書があります。`
          : `現在の会計期間で${totalReceipts}件の未確認領収書があります。${receiptClients}社の顧問先に影響しています。`,
      urgent: totalReceipts > 20,
      href: "/clients",
    },
    {
      icon: FileCheck,
      iconBg: "bg-amber-500/10 text-amber-500",
      borderColor: "border-l-amber-500",
      title: "確認待ち仕訳",
      description: totalNeedsReview === 0
        ? "確認待ちの仕訳はありません。"
        : `${needsReviewClients}社の顧問先で${totalNeedsReview}件の仕訳が確認待ちです。`,
      urgent: totalNeedsReview > 10,
      href: (() => {
        const first = summaries.find((s) => (s.needs_review_count ?? 0) > 0);
        return first ? `/clients/${first.client.id}/ledgers` : "/clients";
      })(),
    },
    {
      icon: Package,
      iconBg: "bg-primary/10 text-primary",
      borderColor: "border-l-primary",
      title: "Raqto受発注管理",
      description: totalAiReviews === 0
        ? "同期待ちのデータはありません。設定から連携状況を確認できます。"
        : `AI仕訳確認待ちが${totalAiReviews}件あります。設定から手動同期を実行できます。`,
      urgent: false,
      href: "/settings",
    },
  ];

  return (
    <>
      {/* KPI Cards */}
      <div className="flex flex-wrap gap-6 mb-8">
        {kpiCards.map((card) => (
          <Card
            key={card.label}
            className="flex min-w-[200px] flex-1 flex-col gap-2 p-6"
          >
            <div className="flex items-center gap-2 mb-1">
              <card.icon className={`size-5 ${card.iconColor}`} />
              <p className="text-muted-foreground text-sm font-medium">
                {card.label}
              </p>
            </div>
            <p className="text-foreground tracking-tight text-3xl font-bold leading-tight">
              {card.value}
            </p>
            {card.trend ? (
              <p
                className={`text-sm font-semibold flex items-center gap-1 ${card.trendUp ? "text-success" : "text-warning"}`}
              >
                {card.trendUp ? (
                  <TrendingUp className="size-4" />
                ) : (
                  <TrendingDown className="size-4" />
                )}
                {card.trendLabel} {card.trend}
              </p>
            ) : (
              <p className="text-muted-foreground text-sm font-medium">
                {card.trendLabel}
              </p>
            )}
          </Card>
        ))}
      </div>

      {/* Action Items + Custom Widgets */}
      <div className="mb-8">
        <h2 className="text-foreground text-xl font-bold leading-tight tracking-tight mb-4 flex items-center gap-2">
          <Zap className="size-5 text-primary-light" /> アクション項目
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {actionItems.map((item) => (
            <Link key={item.title} href={item.href}>
              <Card
                className={`flex flex-col gap-4 border-l-4 ${item.borderColor} p-6 hover:shadow-md transition-shadow cursor-pointer h-full`}
              >
                <div className="flex justify-between items-start">
                  <div className={`p-2 rounded-lg ${item.iconBg}`}>
                    <item.icon className="size-5" />
                  </div>
                  {item.urgent && (
                    <Badge variant="default" className="bg-primary text-cream text-[10px]">
                      至急
                    </Badge>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <h3 className="text-foreground text-lg font-bold">
                    {item.title}
                  </h3>
                  <p className="text-muted-foreground text-sm">
                    {item.description}
                  </p>
                </div>
              </Card>
            </Link>
          ))}

          {/* Rendered custom widgets */}
          {activeWidgets.map((key) => {
            const def = WIDGET_DEFINITIONS.find((w) => w.key === key);
            if (!def) return null;
            return (
              <div key={key} className="relative group">
                <Link href={def.href}>
                  <Card className="flex flex-col gap-4 border-l-4 border-l-accent p-6 hover:shadow-md transition-shadow cursor-pointer h-full">
                    <div className="p-2 rounded-lg bg-accent/10 text-accent w-fit">
                      <def.icon className="size-5" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <h3 className="text-foreground text-lg font-bold">
                        {def.label}
                      </h3>
                      <p className="text-muted-foreground text-sm">
                        {def.desc}
                      </p>
                    </div>
                  </Card>
                </Link>
                <button
                  onClick={() => removeWidget(key)}
                  className="absolute top-2 right-2 size-6 rounded-full bg-muted/50 text-muted-foreground hover:bg-destructive/20 hover:text-destructive flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                  title="ウィジェットを削除"
                >
                  <X className="size-3" />
                </button>
              </div>
            );
          })}

          {/* Add widget card */}
          {availableWidgets.length > 0 && (
            <div className="relative">
              <div
                onClick={() => setShowWidgetPicker(!showWidgetPicker)}
                className="flex flex-col gap-4 rounded-xl border border-dashed border-border bg-transparent p-6 items-center justify-center group cursor-pointer hover:bg-card transition-colors h-full"
              >
                <div className="p-3 bg-muted/30 rounded-full text-muted-foreground group-hover:text-primary-light group-hover:bg-primary/10 transition-colors">
                  <Plus className="size-8" />
                </div>
                <p className="text-muted-foreground font-medium text-sm">
                  カスタムウィジェットを追加
                </p>
              </div>

              {showWidgetPicker && (
                <div className="absolute top-full left-0 right-0 mt-2 z-50 bg-card border border-border rounded-xl shadow-lg p-3 space-y-1">
                  <p className="text-xs font-bold text-muted-foreground px-2 mb-2">ウィジェットを選択</p>
                  {availableWidgets.map((w) => (
                    <button
                      key={w.key}
                      onClick={() => addWidget(w.key)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/20 transition-colors text-left cursor-pointer"
                    >
                      <div className="p-1.5 rounded-lg bg-accent/10 text-accent">
                        <w.icon className="size-4" />
                      </div>
                      <div>
                        <p className="text-foreground font-bold text-sm">{w.label}</p>
                        <p className="text-muted-foreground text-xs">{w.desc}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Recent Activity */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-foreground text-xl font-bold leading-tight tracking-tight">
          最近の顧問先アクティビティ
        </h2>
        <Link
          href="/clients"
          className="text-primary-light text-sm font-bold flex items-center gap-1 hover:underline"
        >
          すべて表示 <ChevronRight className="size-4" />
        </Link>
      </div>

      <div className="space-y-3">
        {recentActivity.map((item) => (
          <Link key={item.id} href={`/clients/${item.id}`}>
            <Card
              className="flex items-center gap-4 p-4 hover:shadow-md transition-shadow cursor-pointer mb-3"
            >
              <div className="size-12 rounded-lg bg-muted/30 flex items-center justify-center text-muted-foreground font-bold text-sm">
                {item.initials}
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-foreground font-bold truncate">
                  {item.name}
                </h4>
                <p className="text-muted-foreground text-xs">{item.detail}</p>
              </div>
              <div className="hidden md:block w-48">
                <ProgressBar
                  value={item.progress}
                  label="提出進捗"
                  showPercent
                />
              </div>
              <Badge variant={item.statusVariant}>{item.status}</Badge>
              <ChevronRight className="size-4 text-muted-foreground" />
            </Card>
          </Link>
        ))}
      </div>

      {/* FAB */}
      <div className="fixed bottom-8 right-8">
        <Button
          size="lg"
          className="shadow-xl hover:scale-105 transition-all"
          onClick={() => router.push("/clients?new=1")}
        >
          <PlusSquare className="size-5" />
          <span>新規顧問先登録</span>
        </Button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------
export default function DashboardPage() {
  const { user } = useAuth();

  if (user?.role === "super_admin") {
    return <SuperAdminDashboard />;
  }

  if (user?.role === "client") {
    return <ClientDashboard />;
  }

  return <RegularDashboard />;
}
