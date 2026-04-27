"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Building2,
  Users,
  Bell,
  Link2,
  Shield,
  Mail,
  MessageSquare,
  Save,
  Plus,
  Trash2,
  RefreshCw,
  Banknote,
  CreditCard,
  ExternalLink,
  CheckCircle,
  Circle,
  Loader2,
  Key,
  Clock,
  AlertTriangle,
  Settings,
  X,
  Eye,
  EyeOff,
  Package,
  User,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  getAllBankAccounts,
  createBankAccount,
  deleteBankAccount,
  syncBankAccount,
} from "@/actions/bank";
import {
  getAllCardAccounts,
  createCardAccount,
  deleteCardAccount,
} from "@/actions/cards";
import { getClients, getClient, updateClient } from "@/actions/clients";
import { getCurrentFirm, updateFirm, getFirms, getFirmMembers, inviteFirmMember, updateFirmMember, isSelfServiceFirm } from "@/actions/firms";
import { useAuth } from "@/components/providers/auth-provider";
import { scopedGetItem, scopedSetItem } from "@/lib/scoped-storage";
import { runFullRaqtoSync, type RaqtoSyncResult } from "@/actions/raqto-sync";
import { getRaqtoIntegrations, linkRaqtoAccount, unlinkRaqtoAccount, type RaqtoIntegrationWithClient } from "@/actions/raqto-integration";

const firmTabs = [
  { key: "firm", label: "事務所情報", icon: Building2 },
  { key: "members", label: "メンバー管理", icon: Users },
  { key: "notifications", label: "通知設定", icon: Bell },
  { key: "integrations", label: "外部連携", icon: Link2 },
  { key: "security", label: "セキュリティ", icon: Shield },
];

const clientTabs = [
  { key: "account", label: "アカウント設定", icon: User },
  { key: "notifications", label: "通知設定", icon: Bell },
  { key: "integrations", label: "外部連携", icon: Link2 },
  { key: "security", label: "セキュリティ", icon: Shield },
];

const defaultMembers: { id: string; name: string; email: string; role: string; active: boolean }[] = [];

type ProviderKey = "moneytree" | "moneyforward" | "zaim";

type ProviderInfo = {
  key: ProviderKey;
  name: string;
  description: string;
  features: string[];
  connected: boolean;
  api_key?: string;
  connected_at?: string;
  sync_interval?: "hourly" | "daily" | "weekly";
};

type ProviderConnectionForm = {
  api_key: string;
  sync_interval: "hourly" | "daily" | "weekly";
  agreed: boolean;
};

const providerAuthUrls: Record<ProviderKey, string> = {
  moneytree: "https://link.getmoneytree.com",
  moneyforward: "https://account.moneyforward.com",
  zaim: "https://auth.zaim.net",
};

const providerApiDocs: Record<ProviderKey, { keyLabel: string; keyPlaceholder: string; instructions: string[] }> = {
  moneytree: {
    keyLabel: "Moneytree LINK APIキー",
    keyPlaceholder: "mtl_live_xxxxxxxxxxxxxxxxxxxx",
    instructions: [
      "1. Moneytree LINK 開発者ポータルにログイン",
      "2. 「アプリケーション設定」からAPIキーを取得",
      "3. コールバックURLに https://app.raqto.com/api/callback/moneytree を登録",
    ],
  },
  moneyforward: {
    keyLabel: "マネーフォワード クラウドAPIキー",
    keyPlaceholder: "mf_xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    instructions: [
      "1. マネーフォワード クラウド API設定ページにアクセス",
      "2. 「API連携」セクションでアクセストークンを発行",
      "3. 権限スコープ: 口座情報(読取), 取引情報(読取) を付与",
    ],
  },
  zaim: {
    keyLabel: "Zaim APIコンシューマーキー",
    keyPlaceholder: "zaim_ck_xxxxxxxxxxxxxxxx",
    instructions: [
      "1. Zaim Developers にアプリケーションを登録",
      "2. コンシューマーキーとシークレットを取得",
      "3. OAuth認証後にアクセストークンが自動発行されます",
    ],
  },
};

const syncIntervalLabels: Record<string, string> = {
  hourly: "毎時",
  daily: "毎日",
  weekly: "毎週",
  realtime: "リアルタイム",
};


const defaultProviders: ProviderInfo[] = [
  {
    key: "moneytree",
    name: "Moneytree LINK",
    description: "2,500以上の金融機関に対応。メガバンク・地方銀行・信用金庫まで幅広くカバー。",
    features: ["メガバンク", "地方銀行", "信用金庫", "ネット銀行"],
    connected: false,
  },
  {
    key: "moneyforward",
    name: "マネーフォワード クラウド",
    description: "会計データとの親和性が高く、口座自動連携に対応。",
    features: ["メガバンク", "地方銀行", "クレジットカード"],
    connected: false,
  },
  {
    key: "zaim",
    name: "Zaim",
    description: "個人事業主向けに最適。シンプルな口座連携。",
    features: ["メガバンク", "ネット銀行"],
    connected: false,
  },
];

type BankAccountWithClient = {
  id: string;
  client_id: string;
  bank_name: string;
  branch_name: string | null;
  account_type: string;
  account_number: string;
  account_holder: string | null;
  provider: string;
  sync_status: string;
  last_synced_at: string | null;
  clients: { id: string; name: string } | null;
};

type CardAccountWithClient = {
  id: string;
  client_id: string;
  card_company: string;
  card_name: string;
  card_number_masked: string;
  card_holder: string | null;
  closing_day: number;
  payment_day: number;
  linked_bank_account_id: string | null;
  payable_account_id: string | null;
  provider: string;
  sync_status: string;
  clients: { id: string; name: string } | null;
};

type ClientOption = { id: string; name: string };

const providerLabels: Record<string, string> = {
  manual: "手動",
  moneytree: "Moneytree",
  moneyforward: "マネーフォワード",
  zaim: "Zaim",
};

const accountTypeLabels: Record<string, string> = {
  ordinary: "普通",
  checking: "当座",
  savings: "定期",
};

const syncStatusConfig: Record<string, { label: string; variant: "success" | "warning" | "destructive" | "muted" }> = {
  idle: { label: "未同期", variant: "muted" },
  syncing: { label: "同期中", variant: "warning" },
  success: { label: "同期済", variant: "success" },
  error: { label: "エラー", variant: "destructive" },
};

type ProviderSaveData = {
  connected: boolean;
  api_key?: string;
  connected_at?: string;
  sync_interval?: "hourly" | "daily" | "weekly";
};

function loadProviders(userId: string | null): ProviderInfo[] {
  if (typeof window === "undefined") return defaultProviders;
  try {
    const saved = scopedGetItem(userId, "providers");
    if (saved) {
      const data: Record<string, ProviderSaveData | boolean> = JSON.parse(saved);
      return defaultProviders.map((p) => {
        const entry = data[p.key];
        if (typeof entry === "boolean") {
          // Migrate from old boolean format
          return { ...p, connected: entry };
        }
        if (entry && typeof entry === "object") {
          return {
            ...p,
            connected: entry.connected,
            api_key: entry.api_key,
            connected_at: entry.connected_at,
            sync_interval: entry.sync_interval,
          };
        }
        return p;
      });
    }
  } catch { /* ignore */ }
  return defaultProviders;
}

function saveProviders(userId: string | null, providers: ProviderInfo[]) {
  if (typeof window === "undefined") return;
  const data: Record<string, ProviderSaveData> = {};
  providers.forEach((p) => {
    data[p.key] = {
      connected: p.connected,
      api_key: p.api_key,
      connected_at: p.connected_at,
      sync_interval: p.sync_interval,
    };
  });
  scopedSetItem(userId, "providers", JSON.stringify(data));
}

function maskApiKey(key: string): string {
  if (key.length <= 8) return "••••••••";
  return key.slice(0, 4) + "••••••••" + key.slice(-4);
}

export default function SettingsPage() {
  const { user } = useAuth();
  const isClient = user?.role === "client";
  const tabs = isClient ? clientTabs : firmTabs;
  const [activeTab, setActiveTab] = useState("firm");

  // Sync default tab when user role loads (fixes reload showing firm tab for client users)
  useEffect(() => {
    if (isClient) {
      setActiveTab((prev) => prev === "firm" ? "account" : prev);
    }
  }, [isClient]);

  // Client account data (for client role)
  const [clientData, setClientData] = useState({
    id: "",
    name: "",
    business_type: "",
    postal_code: "",
    address: "",
    telephone: "",
    email: "",
    invoice_registration_number: "",
  });
  const [clientSaving, setClientSaving] = useState(false);

  // Load client data for client role
  useEffect(() => {
    if (!isClient || !user?.clientId) return;
    getClient(user.clientId).then((c) => {
      setClientData({
        id: c.id,
        name: c.name,
        business_type: c.business_type ?? "",
        postal_code: c.postal_code ?? "",
        address: c.address ?? "",
        telephone: c.telephone ?? "",
        email: c.email ?? "",
        invoice_registration_number: c.invoice_registration_number ?? "",
      });
    }).catch(() => {});
  }, [isClient, user?.clientId]);

  const handleSaveClient = async () => {
    if (!clientData.id) return;
    setClientSaving(true);
    try {
      await updateClient(clientData.id, {
        name: clientData.name,
        business_type: clientData.business_type || null,
        postal_code: clientData.postal_code || null,
        address: clientData.address || null,
        telephone: clientData.telephone || null,
        email: clientData.email || null,
        invoice_registration_number: clientData.invoice_registration_number || null,
      });
      alert("保存しました");
    } catch (e) {
      alert(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setClientSaving(false);
    }
  };

  // Bank data from DB
  const [bankAccounts, setBankAccounts] = useState<BankAccountWithClient[]>([]);
  const [clientOptions, setClientOptions] = useState<ClientOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [firmData, setFirmData] = useState({
    id: "",
    name: "",
    representative_name: "",
    postal_code: "",
    phone: "",
    address: "",
    email: "",
    invoice_registration_number: "",
  });
  const [firmSaving, setFirmSaving] = useState(false);
  const [firmMembers, setFirmMembers] = useState(defaultMembers);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteData, setInviteData] = useState({ email: "", name: "", role: "staff" as "admin" | "staff" });
  const [inviting, setInviting] = useState(false);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [editMemberData, setEditMemberData] = useState<{ name: string; role: "admin" | "staff"; active: boolean }>({ name: "", role: "staff", active: true });
  const [savingMember, setSavingMember] = useState(false);

  // Self-service firm state
  const [selfService, setSelfService] = useState(false);
  const [showTaxAccountantInvite, setShowTaxAccountantInvite] = useState(false);
  const [taxAccountantData, setTaxAccountantData] = useState({ name: "", email: "" });
  const [invitingTaxAccountant, setInvitingTaxAccountant] = useState(false);

  // Notification toggles (persisted in localStorage)
  const [notifications, setNotifications] = useState([
    { key: "email", icon: Mail, label: "メール通知", desc: "Resend経由でメール通知を送信", enabled: true },
    { key: "line", icon: MessageSquare, label: "LINE通知", desc: "LINE Messaging APIで顧問先に通知", enabled: false },
    { key: "app", icon: Bell, label: "アプリ内通知", desc: "ブラウザ内での通知表示", enabled: true },
  ]);

  // Password change
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [passwordData, setPasswordData] = useState({ current: "", new_password: "", confirm: "" });
  const [changingPassword, setChangingPassword] = useState(false);

  // Raqto受発注管理（メール連携）
  const [raqtoIntegrations, setRaqtoIntegrations] = useState<RaqtoIntegrationWithClient[]>([]);
  const [raqtoLinkEmail, setRaqtoLinkEmail] = useState("");
  const [raqtoLinkClientId, setRaqtoLinkClientId] = useState("");
  const [raqtoLinking, setRaqtoLinking] = useState(false);
  const [raqtoUnlinking, setRaqtoUnlinking] = useState<string | null>(null);
  const [raqtoSyncing, setRaqtoSyncing] = useState<string | null>(null);
  const [showRaqtoLinkForm, setShowRaqtoLinkForm] = useState(false);
  const [raqtoSyncResult, setRaqtoSyncResult] = useState<{ clientId: string; result: RaqtoSyncResult } | null>(null);

  // Load firm data
  useEffect(() => {
    async function loadFirm() {
      let firm = await getCurrentFirm();
      // super_admin has no firm_member; fall back to first firm in DB
      if (!firm) {
        const allFirms = await getFirms();
        if (allFirms.length > 0) firm = allFirms[0];
      }
      if (!firm) return;
      setFirmData({
        id: firm.id,
        name: firm.name,
        representative_name: "",
        postal_code: firm.postal_code ?? "",
        phone: firm.telephone ?? "",
        address: firm.address ?? "",
        email: firm.email ?? "",
        invoice_registration_number: firm.invoice_registration_number ?? "",
      });
      const dbMembers = await getFirmMembers(firm.id);
      if (dbMembers && dbMembers.length > 0) {
        setFirmMembers(dbMembers.map((m) => ({
          id: m.id,
          name: m.name,
          email: m.email ?? "",
          role: m.role,
          active: m.is_active,
        })));
      }
    }
    loadFirm().catch(() => { /* use defaults */ });
  }, []);

  // Check if self-service firm
  useEffect(() => {
    isSelfServiceFirm().then(setSelfService).catch(() => {});
  }, []);

  // Load notification settings from user-scoped localStorage
  useEffect(() => {
    if (!user?.id) return;
    try {
      const saved = scopedGetItem(user.id, "notifications");
      if (saved) {
        const keys: Record<string, boolean> = JSON.parse(saved);
        setNotifications((prev) => prev.map((n) => ({ ...n, enabled: keys[n.key] ?? n.enabled })));
      }
    } catch { /* ignore */ }
  }, [user?.id]);

  // Load Raqto integrations from DB
  const fetchRaqtoIntegrations = useCallback(async () => {
    try {
      const data = await getRaqtoIntegrations();
      setRaqtoIntegrations(data);
    } catch {
      // DB not available
    }
  }, []);

  useEffect(() => {
    if (activeTab === "integrations") {
      fetchRaqtoIntegrations();
      // Client role: auto-set clientId (no dropdown needed)
      if (isClient && user?.clientId) {
        setRaqtoLinkClientId(user.clientId);
      }
    }
  }, [activeTab, fetchRaqtoIntegrations, isClient, user?.clientId]);

  const handleRaqtoLink = async () => {
    if (!raqtoLinkClientId || !raqtoLinkEmail) return;
    setRaqtoLinking(true);
    try {
      await linkRaqtoAccount(raqtoLinkClientId, raqtoLinkEmail);
      await fetchRaqtoIntegrations();
      setRaqtoLinkEmail("");
      setRaqtoLinkClientId("");
      setShowRaqtoLinkForm(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : "連携に失敗しました");
    } finally {
      setRaqtoLinking(false);
    }
  };

  const handleRaqtoUnlink = async (clientId: string) => {
    setRaqtoUnlinking(clientId);
    try {
      await unlinkRaqtoAccount(clientId);
      setRaqtoIntegrations((prev) => prev.filter((r) => r.client_id !== clientId));
      if (raqtoSyncResult?.clientId === clientId) setRaqtoSyncResult(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "連携解除に失敗しました");
    } finally {
      setRaqtoUnlinking(null);
    }
  };

  const handleRaqtoSyncClient = async (clientId: string) => {
    setRaqtoSyncing(clientId);
    try {
      const result = await runFullRaqtoSync(clientId);
      setRaqtoSyncResult({ clientId, result });
    } catch {
      // ignore
    } finally {
      setRaqtoSyncing(null);
    }
  };

  const handleSaveFirm = async () => {
    if (!firmData.id) { alert("事務所データが未ロードです"); return; }
    setFirmSaving(true);
    try {
      await updateFirm(firmData.id, {
        name: firmData.name,
        postal_code: firmData.postal_code || null,
        address: firmData.address || null,
        telephone: firmData.phone || null,
        email: firmData.email || null,
        invoice_registration_number: firmData.invoice_registration_number || null,
      });
      alert("保存しました");
    } catch (e) {
      alert(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setFirmSaving(false);
    }
  };

  const handleInviteTaxAccountant = async () => {
    if (!taxAccountantData.email || !taxAccountantData.name || !firmData.id) return;
    setInvitingTaxAccountant(true);
    try {
      await inviteFirmMember({
        firm_id: firmData.id,
        email: taxAccountantData.email,
        name: taxAccountantData.name,
        role: "admin",
      });
      alert("税理士を招待しました");
      setShowTaxAccountantInvite(false);
      setTaxAccountantData({ name: "", email: "" });
      window.location.reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : "招待に失敗しました");
    } finally {
      setInvitingTaxAccountant(false);
    }
  };

  const handleInvite = async () => {
    if (!inviteData.email || !inviteData.name || !firmData.id) return;
    setInviting(true);
    try {
      await inviteFirmMember({
        firm_id: firmData.id,
        email: inviteData.email,
        name: inviteData.name,
        role: inviteData.role,
      });
      alert("メンバーを招待しました");
      setShowInviteForm(false);
      setInviteData({ email: "", name: "", role: "staff" });
      window.location.reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : "招待に失敗しました");
    } finally {
      setInviting(false);
    }
  };

  const handleEditMember = async () => {
    if (!editingMemberId) return;
    setSavingMember(true);
    try {
      await updateFirmMember(editingMemberId, {
        name: editMemberData.name,
        role: editMemberData.role,
        is_active: editMemberData.active,
      });
      setFirmMembers((prev) =>
        prev.map((m) =>
          m.id === editingMemberId
            ? { ...m, name: editMemberData.name, role: editMemberData.role, active: editMemberData.active }
            : m
        )
      );
      setEditingMemberId(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "更新に失敗しました");
    } finally {
      setSavingMember(false);
    }
  };

  const toggleNotification = (key: string) => {
    const updated = notifications.map((n) => n.key === key ? { ...n, enabled: !n.enabled } : n);
    setNotifications(updated);
    const keys: Record<string, boolean> = {};
    updated.forEach((n) => { keys[n.key] = n.enabled; });
    scopedSetItem(user?.id ?? null, "notifications", JSON.stringify(keys));
  };

  const handleChangePassword = async () => {
    if (passwordData.new_password !== passwordData.confirm) {
      alert("新しいパスワードが一致しません");
      return;
    }
    if (passwordData.new_password.length < 6) {
      alert("パスワードは6文字以上にしてください");
      return;
    }
    setChangingPassword(true);
    try {
      alert("パスワード変更機能は準備中です");
    } finally {
      setChangingPassword(false);
      setShowPasswordForm(false);
      setPasswordData({ current: "", new_password: "", confirm: "" });
    }
  };

  // Providers (persisted in user-scoped localStorage)
  const [providers, setProviders] = useState<ProviderInfo[]>(defaultProviders);
  useEffect(() => {
    if (user?.id) setProviders(loadProviders(user.id));
  }, [user?.id]);

  const [showBankForm, setShowBankForm] = useState(false);
  const [newBank, setNewBank] = useState({
    client_id: "",
    bank_name: "",
    branch_name: "",
    account_type: "ordinary" as "ordinary" | "checking" | "savings",
    account_number: "",
    account_holder: "",
    provider: "manual" as ProviderKey | "manual",
  });

  // Card accounts state
  const [cardAccounts, setCardAccounts] = useState<CardAccountWithClient[]>([]);
  const [showCardForm, setShowCardForm] = useState(false);
  const [cardSaving, setCardSaving] = useState(false);
  const [cardDeleting, setCardDeleting] = useState<string | null>(null);
  const [newCard, setNewCard] = useState({
    client_id: "",
    card_company: "VISA" as "VISA" | "Master" | "JCB" | "AMEX" | "Diners" | "UnionPay" | "other",
    card_name: "",
    card_number_last4: "",
    card_holder: "",
    closing_day: 15,
    payment_day: 10,
    linked_bank_account_id: "",
    provider: "manual" as ProviderKey | "manual",
  });

  const connectedProviders = providers.filter((p) => p.connected);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [accounts, cards, clients] = await Promise.all([
        getAllBankAccounts(),
        getAllCardAccounts().catch(() => []),
        getClients(),
      ]);
      setBankAccounts(accounts as BankAccountWithClient[]);
      setCardAccounts(cards as CardAccountWithClient[]);
      setClientOptions(clients.map((c) => ({ id: c.id, name: c.name })));
      if (clients.length > 0 && !newBank.client_id) {
        setNewBank((prev) => ({ ...prev, client_id: clients[0].id }));
      }
      if (clients.length > 0 && !newCard.client_id) {
        setNewCard((prev) => ({ ...prev, client_id: clients[0].id }));
      }
    } catch {
      // DB not available – keep empty
    } finally {
      setLoading(false);
    }
  }, [newBank.client_id, newCard.client_id]);

  useEffect(() => {
    if (activeTab === "integrations") {
      fetchData();
    }
  }, [activeTab, fetchData]);

  // Aggregation service connection flow
  const [connectingProvider, setConnectingProvider] = useState<ProviderKey | null>(null);
  const [connectionForm, setConnectionForm] = useState<ProviderConnectionForm>({
    api_key: "",
    sync_interval: "daily",
    agreed: false,
  });
  const [connectionSaving, setConnectionSaving] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [disconnectConfirm, setDisconnectConfirm] = useState<ProviderKey | null>(null);
  const [editingProvider, setEditingProvider] = useState<ProviderKey | null>(null);

  const handleStartConnect = (key: ProviderKey) => {
    setConnectingProvider(key);
    setConnectionForm({ api_key: "", sync_interval: "daily", agreed: false });
    setShowApiKey(false);
  };

  const handleConnect = async (key: ProviderKey) => {
    if (!connectionForm.api_key || !connectionForm.agreed) return;
    setConnectionSaving(true);
    // Simulate API key validation (1.5s delay)
    await new Promise((r) => setTimeout(r, 1500));
    const updated = providers.map((p) =>
      p.key === key
        ? {
            ...p,
            connected: true,
            api_key: connectionForm.api_key,
            connected_at: new Date().toISOString(),
            sync_interval: connectionForm.sync_interval,
          }
        : p
    );
    setProviders(updated);
    saveProviders(user?.id ?? null, updated);
    setConnectingProvider(null);
    setConnectionSaving(false);
    setConnectionForm({ api_key: "", sync_interval: "daily", agreed: false });
  };

  const handleDisconnect = (key: ProviderKey) => {
    const updated = providers.map((p) =>
      p.key === key
        ? { ...p, connected: false, api_key: undefined, connected_at: undefined, sync_interval: undefined }
        : p
    );
    setProviders(updated);
    saveProviders(user?.id ?? null, updated);
    setDisconnectConfirm(null);
  };

  const handleUpdateSyncInterval = (key: ProviderKey, interval: "hourly" | "daily" | "weekly") => {
    const updated = providers.map((p) =>
      p.key === key ? { ...p, sync_interval: interval } : p
    );
    setProviders(updated);
    saveProviders(user?.id ?? null, updated);
    setEditingProvider(null);
  };

  const handleCreateAccount = async () => {
    if (!newBank.bank_name || !newBank.account_number || !newBank.client_id) return;
    setSaving(true);
    try {
      const created = await createBankAccount({
        client_id: newBank.client_id,
        bank_name: newBank.bank_name,
        branch_name: newBank.branch_name || null,
        account_type: newBank.account_type,
        account_number: newBank.account_number,
        account_holder: newBank.account_holder || null,
        provider: newBank.provider,
        sync_status: newBank.provider !== "manual" ? "success" : "idle",
        last_synced_at: newBank.provider !== "manual" ? new Date().toISOString() : null,
      });
      setBankAccounts((prev) => [...prev, created as BankAccountWithClient]);
      setNewBank({
        client_id: clientOptions[0]?.id ?? "",
        bank_name: "",
        branch_name: "",
        account_type: "ordinary",
        account_number: "",
        account_holder: "",
        provider: "manual",
      });
      setShowBankForm(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : "口座の追加に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAccount = async (id: string) => {
    setDeleting(id);
    try {
      await deleteBankAccount(id);
      setBankAccounts((prev) => prev.filter((a) => a.id !== id));
    } catch (e) {
      alert(e instanceof Error ? e.message : "口座の削除に失敗しました");
    } finally {
      setDeleting(null);
    }
  };

  const handleSync = async (id: string) => {
    setSyncing(id);
    try {
      const updated = await syncBankAccount(id);
      setBankAccounts((prev) =>
        prev.map((a) => (a.id === id ? (updated as BankAccountWithClient) : a))
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : "同期に失敗しました");
    } finally {
      setSyncing(null);
    }
  };

  const handleCreateCard = async () => {
    if (!newCard.card_name || !newCard.card_number_last4 || !newCard.client_id) return;
    setCardSaving(true);
    try {
      const masked = `**** **** **** ${newCard.card_number_last4.slice(-4).padStart(4, "0")}`;
      const created = await createCardAccount({
        client_id: newCard.client_id,
        card_company: newCard.card_company,
        card_name: newCard.card_name,
        card_number_masked: masked,
        card_holder: newCard.card_holder || null,
        closing_day: newCard.closing_day,
        payment_day: newCard.payment_day,
        linked_bank_account_id: newCard.linked_bank_account_id || null,
        provider: newCard.provider,
      });
      setCardAccounts((prev) => [...prev, created as unknown as CardAccountWithClient]);
      setNewCard({
        client_id: clientOptions[0]?.id ?? "",
        card_company: "VISA",
        card_name: "",
        card_number_last4: "",
        card_holder: "",
        closing_day: 15,
        payment_day: 10,
        linked_bank_account_id: "",
        provider: "manual",
      });
      setShowCardForm(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : "カードの追加に失敗しました");
    } finally {
      setCardSaving(false);
    }
  };

  const handleDeleteCard = async (id: string) => {
    setCardDeleting(id);
    try {
      await deleteCardAccount(id);
      setCardAccounts((prev) => prev.filter((c) => c.id !== id));
    } catch (e) {
      alert(e instanceof Error ? e.message : "カードの削除に失敗しました");
    } finally {
      setCardDeleting(null);
    }
  };

  return (
    <>
      <h1 className="text-2xl font-bold text-foreground mb-6">設定</h1>

      <div className="flex gap-8">
        {/* Sidebar tabs */}
        <nav className="w-48 shrink-0 space-y-1">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors cursor-pointer ${
                activeTab === tab.key
                  ? "bg-primary/10 text-primary font-semibold"
                  : "text-muted-foreground hover:bg-muted/30 hover:text-foreground"
              }`}
            >
              <tab.icon className="size-4" />
              {tab.label}
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="flex-1">
          {activeTab === "firm" && (
            <Card>
              <CardHeader>
                <CardTitle>事務所情報</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">事務所名</label>
                    <input type="text" value={firmData.name} onChange={(e) => setFirmData({ ...firmData, name: e.target.value })} className="w-full bg-card border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">代表者名</label>
                    <input type="text" value={firmData.representative_name} onChange={(e) => setFirmData({ ...firmData, representative_name: e.target.value })} className="w-full bg-card border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">郵便番号</label>
                    <input type="text" value={firmData.postal_code} onChange={(e) => setFirmData({ ...firmData, postal_code: e.target.value })} className="w-full bg-card border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">電話番号</label>
                    <input type="text" value={firmData.phone} onChange={(e) => setFirmData({ ...firmData, phone: e.target.value })} className="w-full bg-card border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-foreground mb-1.5">住所</label>
                    <input type="text" value={firmData.address} onChange={(e) => setFirmData({ ...firmData, address: e.target.value })} className="w-full bg-card border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">メールアドレス</label>
                    <input type="email" value={firmData.email} onChange={(e) => setFirmData({ ...firmData, email: e.target.value })} className="w-full bg-card border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">インボイス登録番号</label>
                    <input type="text" value={firmData.invoice_registration_number} onChange={(e) => setFirmData({ ...firmData, invoice_registration_number: e.target.value })} className="w-full bg-card border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                  </div>
                </div>
                <div className="mt-6 flex justify-end">
                  <Button onClick={handleSaveFirm} disabled={firmSaving}>
                    {firmSaving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                    保存
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {activeTab === "account" && (
            <Card>
              <CardHeader>
                <CardTitle>アカウント設定</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">会社名・屋号</label>
                    <input type="text" value={clientData.name} onChange={(e) => setClientData({ ...clientData, name: e.target.value })} className="w-full bg-card border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">業種</label>
                    <input type="text" value={clientData.business_type} onChange={(e) => setClientData({ ...clientData, business_type: e.target.value })} className="w-full bg-card border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">郵便番号</label>
                    <input type="text" value={clientData.postal_code} onChange={(e) => setClientData({ ...clientData, postal_code: e.target.value })} className="w-full bg-card border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">電話番号</label>
                    <input type="text" value={clientData.telephone} onChange={(e) => setClientData({ ...clientData, telephone: e.target.value })} className="w-full bg-card border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-foreground mb-1.5">住所</label>
                    <input type="text" value={clientData.address} onChange={(e) => setClientData({ ...clientData, address: e.target.value })} className="w-full bg-card border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">メールアドレス</label>
                    <input type="email" value={clientData.email} onChange={(e) => setClientData({ ...clientData, email: e.target.value })} className="w-full bg-card border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">インボイス登録番号</label>
                    <input type="text" value={clientData.invoice_registration_number} onChange={(e) => setClientData({ ...clientData, invoice_registration_number: e.target.value })} className="w-full bg-card border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50" />
                  </div>
                </div>
                <div className="mt-6 flex justify-end">
                  <Button onClick={handleSaveClient} disabled={clientSaving}>
                    {clientSaving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                    保存
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {activeTab === "members" && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>メンバー管理</CardTitle>
                  <Button size="sm" onClick={() => setShowInviteForm((v) => !v)}>
                    <Users className="size-4" />
                    メンバー招待
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {selfService && (
                  <div className="mb-6 p-4 rounded-lg border-2 border-primary bg-primary/5">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <h4 className="font-bold text-foreground flex items-center gap-2">
                          <Shield className="size-4 text-primary" />
                          税理士を招待
                        </h4>
                        <p className="text-muted-foreground text-xs mt-1">
                          顧問税理士をこの事務所に招待して、会計データを共有できます。
                          招待された税理士は管理者権限でアクセスできます。
                        </p>
                      </div>
                      <Button size="sm" onClick={() => setShowTaxAccountantInvite((v) => !v)}>
                        {showTaxAccountantInvite ? "閉じる" : "招待する"}
                      </Button>
                    </div>
                    {showTaxAccountantInvite && (
                      <div className="mt-4 grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-1">税理士名</label>
                          <input
                            type="text"
                            value={taxAccountantData.name}
                            onChange={(e) => setTaxAccountantData({ ...taxAccountantData, name: e.target.value })}
                            placeholder="田中 健二"
                            className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-1">メールアドレス</label>
                          <input
                            type="email"
                            value={taxAccountantData.email}
                            onChange={(e) => setTaxAccountantData({ ...taxAccountantData, email: e.target.value })}
                            placeholder="tax@example.com"
                            className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm"
                          />
                        </div>
                        <div className="col-span-2 flex justify-end">
                          <Button
                            size="sm"
                            onClick={handleInviteTaxAccountant}
                            disabled={invitingTaxAccountant || !taxAccountantData.email || !taxAccountantData.name}
                          >
                            {invitingTaxAccountant && <Loader2 className="size-4 animate-spin" />}
                            税理士を招待する
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {showInviteForm && (
                  <div className="mb-6 p-4 rounded-lg border border-primary/30 bg-primary/5">
                    <h4 className="font-bold text-foreground mb-3">新規メンバー招待</h4>
                    <div className="grid grid-cols-3 gap-4 mb-4">
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-1">名前</label>
                        <input type="text" value={inviteData.name} onChange={(e) => setInviteData({ ...inviteData, name: e.target.value })} placeholder="山田 太郎" className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-1">メール</label>
                        <input type="email" value={inviteData.email} onChange={(e) => setInviteData({ ...inviteData, email: e.target.value })} placeholder="yamada@example.com" className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-foreground mb-1">ロール</label>
                        <select value={inviteData.role} onChange={(e) => setInviteData({ ...inviteData, role: e.target.value as "admin" | "staff" })} className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm">
                          <option value="staff">スタッフ</option>
                          <option value="admin">管理者</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex gap-2 justify-end">
                      <Button variant="ghost" size="sm" onClick={() => setShowInviteForm(false)}>キャンセル</Button>
                      <Button size="sm" onClick={handleInvite} disabled={inviting || !inviteData.email || !inviteData.name}>
                        {inviting && <Loader2 className="size-4 animate-spin" />}
                        招待する
                      </Button>
                    </div>
                  </div>
                )}
                <div className="space-y-3">
                  {firmMembers.map((m) => (
                    <div key={m.id} className="rounded-lg border border-border">
                      <div className="flex items-center gap-4 p-4">
                        <div className="size-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                          {m.name.charAt(0)}
                        </div>
                        <div className="flex-1">
                          <p className="font-bold text-foreground">{m.name}</p>
                          <p className="text-muted-foreground text-xs">{m.email}</p>
                        </div>
                        <Badge variant={m.role === "admin" ? "default" : "muted"}>
                          {m.role === "admin" ? "管理者" : "スタッフ"}
                        </Badge>
                        <Badge variant={m.active ? "success" : "destructive"}>
                          {m.active ? "有効" : "無効"}
                        </Badge>
                        <Button variant="ghost" size="sm" onClick={() => {
                          if (editingMemberId === m.id) {
                            setEditingMemberId(null);
                          } else {
                            setEditingMemberId(m.id);
                            setEditMemberData({ name: m.name, role: m.role as "admin" | "staff", active: m.active });
                          }
                        }}>
                          {editingMemberId === m.id ? "閉じる" : "編集"}
                        </Button>
                      </div>
                      {editingMemberId === m.id && (
                        <div className="px-4 pb-4 pt-2 border-t border-border bg-muted/20 space-y-4">
                          <div>
                            <label className="text-xs font-bold text-muted-foreground mb-1 block">名前</label>
                            <input
                              type="text"
                              className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm"
                              value={editMemberData.name}
                              onChange={(e) => setEditMemberData({ ...editMemberData, name: e.target.value })}
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label className="text-xs font-bold text-muted-foreground mb-1 block">ロール</label>
                              <select
                                className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm"
                                value={editMemberData.role}
                                onChange={(e) => setEditMemberData({ ...editMemberData, role: e.target.value as "admin" | "staff" })}
                              >
                                <option value="admin">管理者</option>
                                <option value="staff">スタッフ</option>
                              </select>
                            </div>
                            <div>
                              <label className="text-xs font-bold text-muted-foreground mb-1 block">ステータス</label>
                              <select
                                className="w-full px-3 py-2 rounded-lg border border-border bg-card text-foreground text-sm"
                                value={editMemberData.active ? "active" : "inactive"}
                                onChange={(e) => setEditMemberData({ ...editMemberData, active: e.target.value === "active" })}
                              >
                                <option value="active">有効</option>
                                <option value="inactive">無効</option>
                              </select>
                            </div>
                          </div>
                          <div className="flex gap-2 justify-end">
                            <Button variant="ghost" size="sm" onClick={() => setEditingMemberId(null)}>キャンセル</Button>
                            <Button size="sm" onClick={handleEditMember} disabled={savingMember || !editMemberData.name.trim()}>
                              {savingMember && <Loader2 className="size-4 animate-spin" />}
                              保存
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {activeTab === "notifications" && (
            <Card>
              <CardHeader>
                <CardTitle>通知設定</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  {notifications.map((item) => (
                    <div key={item.key} className="flex items-center gap-4 p-4 rounded-lg border border-border">
                      <div className="p-2 rounded-lg bg-primary/10 text-primary">
                        <item.icon className="size-5" />
                      </div>
                      <div className="flex-1">
                        <p className="font-bold text-foreground">{item.label}</p>
                        <p className="text-muted-foreground text-xs">{item.desc}</p>
                      </div>
                      <div
                        onClick={() => toggleNotification(item.key)}
                        className={`w-12 h-7 rounded-full flex items-center cursor-pointer transition-colors ${
                          item.enabled ? "bg-success justify-end" : "bg-muted/50 justify-start"
                        }`}
                      >
                        <div className="size-5 bg-white rounded-full m-1 shadow-sm" />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {activeTab === "integrations" && (
            <div className="space-y-6">
              {/* Overview */}
              <Card>
                <CardHeader>
                  <CardTitle>外部連携</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className={`rounded-lg border transition-colors ${raqtoIntegrations.length > 0 ? "border-success/50 bg-success/5" : "border-border"}`}>
                      {/* Raqto header */}
                      <div className="flex items-center gap-4 p-4">
                        <div className={`p-2 rounded-lg ${raqtoIntegrations.length > 0 ? "bg-success/10 text-success" : "bg-primary/10 text-primary"}`}>
                          <Package className="size-5" />
                        </div>
                        <div className="flex-1">
                          <p className="font-bold text-foreground">Raqto 受発注管理</p>
                          <p className="text-muted-foreground text-xs">
                            メールアドレスでRaqto受発注と連携
                          </p>
                        </div>
                        {raqtoIntegrations.length > 0 && (
                          <Badge variant="success">{raqtoIntegrations.length}件連携済</Badge>
                        )}
                      </div>

                      {/* Linked clients list */}
                      {raqtoIntegrations.length > 0 && (
                        <div className="px-4 pb-3 pt-0 space-y-2">
                          {raqtoIntegrations.map((integration) => {
                            const isSyncingThis = raqtoSyncing === integration.client_id;
                            const isUnlinkingThis = raqtoUnlinking === integration.client_id;
                            return (
                              <div key={integration.id} className={`flex items-center gap-3 p-3 rounded-lg bg-card border border-border ${isUnlinkingThis ? "opacity-50" : ""}`}>
                                <div className="flex-1 min-w-0">
                                  <p className="font-bold text-foreground text-sm">{integration.client_name}</p>
                                  <p className="text-muted-foreground text-xs truncate">
                                    {integration.raqto_company_name && (
                                      <span className="text-primary font-medium">{integration.raqto_company_name} — </span>
                                    )}
                                    {integration.raqto_email}
                                  </p>
                                  {integration.last_synced_at && (
                                    <p className="text-muted-foreground text-[10px] mt-0.5">
                                      最終同期: {new Date(integration.last_synced_at).toLocaleString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                                    </p>
                                  )}
                                </div>
                                <Badge variant="success">連携済</Badge>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  title="同期"
                                  disabled={isSyncingThis}
                                  onClick={() => handleRaqtoSyncClient(integration.client_id)}
                                >
                                  {isSyncingThis ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  title="連携解除"
                                  disabled={isUnlinkingThis}
                                  onClick={() => handleRaqtoUnlink(integration.client_id)}
                                  className="text-destructive hover:bg-destructive/10"
                                >
                                  {isUnlinkingThis ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                                </Button>
                              </div>
                            );
                          })}

                          {/* Sync result */}
                          {raqtoSyncResult && (
                            <div className="rounded-lg bg-muted/10 border border-border p-3">
                              <p className="text-xs font-bold text-foreground mb-1">
                                同期結果 ({raqtoIntegrations.find((r) => r.client_id === raqtoSyncResult.clientId)?.client_name})
                              </p>
                              <div className="flex gap-4 text-xs text-muted-foreground">
                                <span>取引先: {raqtoSyncResult.result.counts.partners}件</span>
                                <span>受注: {raqtoSyncResult.result.counts.salesOrders}件</span>
                                <span>発注: {raqtoSyncResult.result.counts.purchaseOrders}件</span>
                                <span>入金: {raqtoSyncResult.result.counts.payments}件</span>
                              </div>
                              {raqtoSyncResult.result.errors.length > 0 && (
                                <div className="mt-2 text-xs text-destructive">
                                  {raqtoSyncResult.result.errors.map((err, i) => <p key={i}>{err}</p>)}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Link form */}
                      {(() => {
                        // Client role: already linked check uses user.clientId
                        const alreadyLinkedAsClient = isClient && user?.clientId && raqtoIntegrations.some((r) => r.client_id === user.clientId);
                        if (isClient && alreadyLinkedAsClient) return null;

                        // Staff/admin: check for unlinked clients
                        const unlinkedClients = isClient ? [] : clientOptions.filter((c) => !raqtoIntegrations.some((r) => r.client_id === c.id));
                        const showDropdown = !isClient && unlinkedClients.length > 1;

                        // Staff/admin with no unlinked clients left
                        if (!isClient && unlinkedClients.length === 0 && raqtoIntegrations.length > 0) return null;

                        return (
                          <div className="px-4 pb-4 pt-0">
                            {!showRaqtoLinkForm ? (
                              <Button size="sm" variant="outline" onClick={() => {
                                setShowRaqtoLinkForm(true);
                                if (isClient && user?.clientId) {
                                  setRaqtoLinkClientId(user.clientId);
                                } else if (unlinkedClients.length === 1) {
                                  setRaqtoLinkClientId(unlinkedClients[0].id);
                                }
                              }}>
                                <Plus className="size-4" />
                                連携する
                              </Button>
                            ) : (
                              <div className="rounded-lg border border-primary/30 bg-card p-4">
                                <h4 className="font-bold text-foreground text-sm mb-3 flex items-center gap-2">
                                  <Mail className="size-4 text-primary" />
                                  Raqto受発注と連携
                                </h4>
                                <div className="space-y-4 mb-4">
                                  {showDropdown && (
                                    <div>
                                      <label className="block text-xs font-medium text-foreground mb-1">顧問先</label>
                                      <select
                                        value={raqtoLinkClientId}
                                        onChange={(e) => setRaqtoLinkClientId(e.target.value)}
                                        className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm"
                                      >
                                        <option value="">選択してください</option>
                                        {unlinkedClients.map((c) => (
                                          <option key={c.id} value={c.id}>{c.name}</option>
                                        ))}
                                      </select>
                                    </div>
                                  )}
                                  <div>
                                    <label className="block text-xs font-medium text-foreground mb-1">Raqto受発注のメールアドレス</label>
                                    <input
                                      type="email"
                                      value={raqtoLinkEmail}
                                      onChange={(e) => setRaqtoLinkEmail(e.target.value)}
                                      placeholder="user@example.com"
                                      className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm"
                                    />
                                  </div>
                                </div>
                                <div className="flex gap-2 justify-end">
                                  <Button variant="ghost" size="sm" onClick={() => { setShowRaqtoLinkForm(false); setRaqtoLinkEmail(""); setRaqtoLinkClientId(""); }}>
                                    キャンセル
                                  </Button>
                                  <Button size="sm" onClick={handleRaqtoLink} disabled={raqtoLinking || !raqtoLinkClientId || !raqtoLinkEmail}>
                                    {raqtoLinking ? <><Loader2 className="size-4 animate-spin" />連携中...</> : <><CheckCircle className="size-4" />連携する</>}
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                    <div className="flex items-center gap-4 p-4 rounded-lg border border-border">
                      <div className="p-2 rounded-lg bg-primary/10 text-primary">
                        <Banknote className="size-5" />
                      </div>
                      <div className="flex-1">
                        <p className="font-bold text-foreground">銀行API連携</p>
                        <p className="text-muted-foreground text-xs">
                          アグリゲーションサービス経由で口座取引データを自動取得
                        </p>
                      </div>
                      {connectedProviders.length > 0 ? (
                        <Badge variant="success">
                          {connectedProviders.map((p) => p.name).join(", ")} 接続済
                        </Badge>
                      ) : (
                        <Badge variant="muted">未接続</Badge>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Aggregation provider connection */}
              <Card>
                <CardHeader>
                  <CardTitle>アグリゲーションサービス接続</CardTitle>
                  <p className="text-muted-foreground text-xs mt-1">
                    銀行口座データの自動取得には、アグリゲーションサービスとの接続が必要です。
                    サービスを経由することで、メガバンクから地方銀行まで幅広い金融機関に対応できます。
                  </p>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {providers.map((provider) => {
                      const isConnecting = connectingProvider === provider.key;
                      const isDisconnecting = disconnectConfirm === provider.key;
                      const isEditing = editingProvider === provider.key;
                      const docs = providerApiDocs[provider.key];
                      const linkedAccounts = bankAccounts.filter((a) => a.provider === provider.key).length;

                      return (
                        <div
                          key={provider.key}
                          className={`rounded-lg border transition-colors ${
                            provider.connected
                              ? "border-success/50 bg-success/5"
                              : isConnecting
                                ? "border-primary/50 bg-primary/5"
                                : "border-border"
                          }`}
                        >
                          {/* Provider header */}
                          <div className="flex items-center gap-4 p-4">
                            <div className={`p-2 rounded-lg ${
                              provider.connected
                                ? "bg-success/10 text-success"
                                : "bg-muted/20 text-muted-foreground"
                            }`}>
                              {provider.connected ? (
                                <CheckCircle className="size-5" />
                              ) : (
                                <Circle className="size-5" />
                              )}
                            </div>
                            <div className="flex-1">
                              <p className="font-bold text-foreground">{provider.name}</p>
                              <p className="text-muted-foreground text-xs mt-0.5">
                                {provider.description}
                              </p>
                              <div className="flex gap-1.5 mt-2">
                                {provider.features.map((f) => (
                                  <span
                                    key={f}
                                    className="px-2 py-0.5 text-[10px] rounded-full bg-muted/20 text-muted-foreground"
                                  >
                                    {f}
                                  </span>
                                ))}
                              </div>
                            </div>
                            {provider.connected ? (
                              <div className="flex items-center gap-2">
                                <Badge variant="success">接続済</Badge>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setEditingProvider(isEditing ? null : provider.key)}
                                >
                                  <Settings className="size-4" />
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setDisconnectConfirm(isDisconnecting ? null : provider.key)}
                                  className="text-destructive border-destructive/30 hover:bg-destructive/10"
                                >
                                  切断
                                </Button>
                              </div>
                            ) : (
                              <Button
                                size="sm"
                                onClick={() => isConnecting ? setConnectingProvider(null) : handleStartConnect(provider.key)}
                              >
                                {isConnecting ? (
                                  <>
                                    <X className="size-4" />
                                    キャンセル
                                  </>
                                ) : (
                                  <>
                                    <ExternalLink className="size-4" />
                                    接続する
                                  </>
                                )}
                              </Button>
                            )}
                          </div>

                          {/* Connected details */}
                          {provider.connected && !isEditing && !isDisconnecting && (
                            <div className="px-4 pb-4 pt-0">
                              <div className="rounded-lg bg-card border border-border p-3">
                                <div className="grid grid-cols-4 gap-4 text-xs">
                                  <div>
                                    <span className="text-muted-foreground">APIキー</span>
                                    <p className="font-mono text-foreground mt-0.5">
                                      {provider.api_key ? maskApiKey(provider.api_key) : "—"}
                                    </p>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">接続日時</span>
                                    <p className="text-foreground mt-0.5">
                                      {provider.connected_at
                                        ? new Date(provider.connected_at).toLocaleDateString("ja-JP", {
                                            year: "numeric",
                                            month: "2-digit",
                                            day: "2-digit",
                                            hour: "2-digit",
                                            minute: "2-digit",
                                          })
                                        : "—"}
                                    </p>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">同期頻度</span>
                                    <p className="text-foreground mt-0.5">
                                      {syncIntervalLabels[provider.sync_interval ?? "daily"]}
                                    </p>
                                  </div>
                                  <div>
                                    <span className="text-muted-foreground">連携口座数</span>
                                    <p className="text-foreground mt-0.5">{linkedAccounts}口座</p>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Edit settings panel */}
                          {provider.connected && isEditing && (
                            <div className="px-4 pb-4 pt-0">
                              <div className="rounded-lg border border-primary/30 bg-card p-4">
                                <h4 className="font-bold text-foreground text-sm mb-3 flex items-center gap-2">
                                  <Settings className="size-4 text-primary" />
                                  接続設定
                                </h4>
                                <div className="grid grid-cols-2 gap-4 mb-4">
                                  <div>
                                    <label className="block text-xs font-medium text-foreground mb-1">同期頻度</label>
                                    <select
                                      defaultValue={provider.sync_interval ?? "daily"}
                                      onChange={(e) => handleUpdateSyncInterval(provider.key, e.target.value as "hourly" | "daily" | "weekly")}
                                      className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm"
                                    >
                                      <option value="hourly">毎時（1時間ごと）</option>
                                      <option value="daily">毎日（1日1回）</option>
                                      <option value="weekly">毎週（週1回）</option>
                                    </select>
                                  </div>
                                  <div>
                                    <label className="block text-xs font-medium text-foreground mb-1">APIキー</label>
                                    <div className="flex items-center gap-2">
                                      <input
                                        type={showApiKey ? "text" : "password"}
                                        value={provider.api_key ?? ""}
                                        readOnly
                                        className="flex-1 bg-muted/20 border border-border rounded-lg px-3 py-2 text-sm font-mono"
                                      />
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setShowApiKey(!showApiKey)}
                                      >
                                        {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                                <div className="flex justify-end">
                                  <Button variant="ghost" size="sm" onClick={() => setEditingProvider(null)}>
                                    閉じる
                                  </Button>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Disconnect confirmation */}
                          {provider.connected && isDisconnecting && (
                            <div className="px-4 pb-4 pt-0">
                              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                                <div className="flex items-start gap-3">
                                  <AlertTriangle className="size-5 text-destructive shrink-0 mt-0.5" />
                                  <div className="flex-1">
                                    <p className="font-bold text-destructive text-sm">
                                      {provider.name} との接続を切断しますか？
                                    </p>
                                    <p className="text-muted-foreground text-xs mt-1">
                                      切断すると、このサービス経由での口座データ自動同期が停止します。
                                      {linkedAccounts > 0 && (
                                        <span className="font-bold text-foreground">
                                          現在 {linkedAccounts}口座がこのサービスを使用しています。
                                        </span>
                                      )}
                                      既に取得済みのデータは削除されません。
                                    </p>
                                    <div className="flex gap-2 mt-3">
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => setDisconnectConfirm(null)}
                                      >
                                        キャンセル
                                      </Button>
                                      <Button
                                        variant="destructive"
                                        size="sm"
                                        onClick={() => handleDisconnect(provider.key)}
                                      >
                                        切断する
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Connection form */}
                          {isConnecting && (
                            <div className="px-4 pb-4 pt-0">
                              <div className="rounded-lg border border-primary/30 bg-card p-4">
                                <h4 className="font-bold text-foreground text-sm mb-3 flex items-center gap-2">
                                  <Key className="size-4 text-primary" />
                                  {provider.name} に接続
                                </h4>

                                {/* Setup instructions */}
                                <div className="rounded-lg bg-muted/10 p-3 mb-4">
                                  <p className="text-xs font-bold text-foreground mb-2">セットアップ手順</p>
                                  <ul className="space-y-1">
                                    {docs.instructions.map((step) => (
                                      <li key={step} className="text-xs text-muted-foreground">{step}</li>
                                    ))}
                                  </ul>
                                  <a
                                    href={providerAuthUrls[provider.key]}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-xs text-primary font-medium mt-2 hover:underline"
                                  >
                                    <ExternalLink className="size-3" />
                                    {provider.name} 開発者ポータルを開く
                                  </a>
                                </div>

                                {/* API Key input */}
                                <div className="mb-4">
                                  <label className="block text-sm font-medium text-foreground mb-1.5">
                                    {docs.keyLabel}
                                  </label>
                                  <div className="flex items-center gap-2">
                                    <div className="relative flex-1">
                                      <Key className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                                      <input
                                        type={showApiKey ? "text" : "password"}
                                        value={connectionForm.api_key}
                                        onChange={(e) => setConnectionForm({ ...connectionForm, api_key: e.target.value })}
                                        placeholder={docs.keyPlaceholder}
                                        className="w-full bg-card border border-border rounded-lg pl-10 pr-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
                                      />
                                    </div>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => setShowApiKey(!showApiKey)}
                                    >
                                      {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                                    </Button>
                                  </div>
                                </div>

                                {/* Sync interval */}
                                <div className="mb-4">
                                  <label className="block text-sm font-medium text-foreground mb-1.5">
                                    同期頻度
                                  </label>
                                  <div className="flex gap-2">
                                    {(["hourly", "daily", "weekly"] as const).map((interval) => (
                                      <button
                                        key={interval}
                                        onClick={() => setConnectionForm({ ...connectionForm, sync_interval: interval })}
                                        className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                                          connectionForm.sync_interval === interval
                                            ? "bg-primary text-cream"
                                            : "bg-muted/20 text-muted-foreground hover:bg-muted/40"
                                        }`}
                                      >
                                        <Clock className="size-3" />
                                        {syncIntervalLabels[interval]}
                                      </button>
                                    ))}
                                  </div>
                                </div>

                                {/* Terms agreement */}
                                <div className="mb-4 p-3 rounded-lg bg-muted/10 border border-border">
                                  <label className="flex items-start gap-3 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={connectionForm.agreed}
                                      onChange={(e) => setConnectionForm({ ...connectionForm, agreed: e.target.checked })}
                                      className="mt-0.5 size-4 rounded border-border accent-primary"
                                    />
                                    <span className="text-xs text-muted-foreground leading-relaxed">
                                      {provider.name} のAPI利用規約に同意し、口座取引データをRaqto会計に連携することを許可します。
                                      APIキーは暗号化して保存され、データ取得以外の目的では使用されません。
                                    </span>
                                  </label>
                                </div>

                                {/* Connect button */}
                                <div className="flex items-center justify-between">
                                  <p className="text-xs text-muted-foreground">
                                    {connectionForm.api_key && connectionForm.agreed
                                      ? "接続の準備ができました"
                                      : !connectionForm.api_key
                                        ? "APIキーを入力してください"
                                        : "利用規約に同意してください"}
                                  </p>
                                  <div className="flex gap-2">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => setConnectingProvider(null)}
                                    >
                                      キャンセル
                                    </Button>
                                    <Button
                                      size="sm"
                                      onClick={() => handleConnect(provider.key)}
                                      disabled={connectionSaving || !connectionForm.api_key || !connectionForm.agreed}
                                    >
                                      {connectionSaving ? (
                                        <>
                                          <Loader2 className="size-4 animate-spin" />
                                          接続中...
                                        </>
                                      ) : (
                                        <>
                                          <CheckCircle className="size-4" />
                                          接続する
                                        </>
                                      )}
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              {/* Bank accounts management panel */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>登録口座</CardTitle>
                    <Button size="sm" onClick={() => setShowBankForm(!showBankForm)}>
                      <Plus className="size-4" />
                      口座追加
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {showBankForm && (
                    <div className="mb-6 p-4 rounded-lg border border-primary/30 bg-primary/5">
                      <h4 className="font-bold text-foreground mb-4">新規口座追加</h4>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-1.5">顧問先</label>
                          <select
                            value={newBank.client_id}
                            onChange={(e) => setNewBank({ ...newBank, client_id: e.target.value })}
                            className="w-full bg-card border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                          >
                            {clientOptions.map((c) => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-1.5">データ取得方法</label>
                          <select
                            value={newBank.provider}
                            onChange={(e) => setNewBank({ ...newBank, provider: e.target.value as ProviderKey | "manual" })}
                            className="w-full bg-card border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                          >
                            <option value="manual">手動（CSVインポート）</option>
                            {connectedProviders.map((p) => (
                              <option key={p.key} value={p.key}>{p.name}（自動同期）</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-1.5">銀行名</label>
                          <input
                            type="text"
                            value={newBank.bank_name}
                            onChange={(e) => setNewBank({ ...newBank, bank_name: e.target.value })}
                            placeholder="三菱UFJ銀行"
                            className="w-full bg-card border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-1.5">支店名</label>
                          <input
                            type="text"
                            value={newBank.branch_name}
                            onChange={(e) => setNewBank({ ...newBank, branch_name: e.target.value })}
                            placeholder="丸の内支店"
                            className="w-full bg-card border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-1.5">口座種別</label>
                          <select
                            value={newBank.account_type}
                            onChange={(e) => setNewBank({ ...newBank, account_type: e.target.value as "ordinary" | "checking" | "savings" })}
                            className="w-full bg-card border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                          >
                            <option value="ordinary">普通</option>
                            <option value="checking">当座</option>
                            <option value="savings">定期</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-1.5">口座番号</label>
                          <input
                            type="text"
                            value={newBank.account_number}
                            onChange={(e) => setNewBank({ ...newBank, account_number: e.target.value })}
                            placeholder="1234567"
                            className="w-full bg-card border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                          />
                        </div>
                        <div className="col-span-2">
                          <label className="block text-sm font-medium text-foreground mb-1.5">口座名義</label>
                          <input
                            type="text"
                            value={newBank.account_holder}
                            onChange={(e) => setNewBank({ ...newBank, account_holder: e.target.value })}
                            placeholder="松田工業株式会社"
                            className="w-full bg-card border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                          />
                        </div>
                      </div>
                      {newBank.provider !== "manual" && (
                        <p className="mt-3 text-xs text-primary">
                          {providerLabels[newBank.provider]} 経由で取引データが自動同期されます
                        </p>
                      )}
                      <div className="mt-4 flex gap-2 justify-end">
                        <Button variant="ghost" size="sm" onClick={() => setShowBankForm(false)}>
                          キャンセル
                        </Button>
                        <Button size="sm" onClick={handleCreateAccount} disabled={saving || !newBank.bank_name || !newBank.account_number}>
                          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                          追加
                        </Button>
                      </div>
                    </div>
                  )}

                  {loading ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Loader2 className="size-8 mx-auto mb-2 animate-spin opacity-50" />
                      <p className="text-sm">読み込み中...</p>
                    </div>
                  ) : bankAccounts.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Banknote className="size-10 mx-auto mb-3 opacity-50" />
                      <p className="text-sm">登録済みの口座がありません</p>
                      <p className="text-xs mt-1">「口座追加」ボタンから口座を登録してください</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {bankAccounts.map((acc) => {
                        const statusConf = syncStatusConfig[acc.sync_status] ?? syncStatusConfig.idle;
                        const isSyncing = syncing === acc.id;
                        const isDeleting = deleting === acc.id;
                        return (
                          <div
                            key={acc.id}
                            className={`flex items-center gap-4 p-4 rounded-lg border border-border ${isDeleting ? "opacity-50" : ""}`}
                          >
                            <div className="p-2 rounded-lg bg-primary/10 text-primary">
                              <Banknote className="size-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-bold text-foreground">
                                {acc.bank_name} {acc.branch_name}
                              </p>
                              <p className="text-muted-foreground text-xs">
                                {accountTypeLabels[acc.account_type] ?? acc.account_type} {acc.account_number} / {acc.account_holder ?? "-"}
                                {acc.clients && (
                                  <span className="ml-2 text-primary">({acc.clients.name})</span>
                                )}
                              </p>
                            </div>
                            <Badge variant={acc.provider !== "manual" ? "accent" : "muted"}>
                              {providerLabels[acc.provider] ?? acc.provider}
                            </Badge>
                            <Badge variant={isSyncing ? "warning" : statusConf.variant}>
                              {isSyncing ? "同期中" : statusConf.label}
                            </Badge>
                            {acc.last_synced_at && (
                              <span className="text-muted-foreground text-xs whitespace-nowrap">
                                {new Date(acc.last_synced_at).toLocaleDateString("ja-JP")}
                              </span>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              title="同期"
                              disabled={isSyncing}
                              onClick={() => handleSync(acc.id)}
                            >
                              <RefreshCw className={`size-4 ${isSyncing ? "animate-spin" : ""}`} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              title="削除"
                              disabled={isDeleting}
                              onClick={() => handleDeleteAccount(acc.id)}
                            >
                              {isDeleting ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : (
                                <Trash2 className="size-4 text-destructive" />
                              )}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Credit card management panel */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>登録クレジットカード</CardTitle>
                    <Button size="sm" onClick={() => setShowCardForm(!showCardForm)}>
                      <Plus className="size-4" />
                      カード追加
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {showCardForm && (
                    <div className="mb-6 p-4 rounded-lg border border-primary/30 bg-primary/5">
                      <h4 className="font-bold text-foreground mb-4">新規カード追加</h4>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-1.5">顧問先</label>
                          <select
                            value={newCard.client_id}
                            onChange={(e) => setNewCard({ ...newCard, client_id: e.target.value })}
                            className="w-full bg-card border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                          >
                            {clientOptions.map((c) => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-1.5">データ取得方法</label>
                          <select
                            value={newCard.provider}
                            onChange={(e) => setNewCard({ ...newCard, provider: e.target.value as ProviderKey | "manual" })}
                            className="w-full bg-card border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                          >
                            <option value="manual">手動（CSVインポート）</option>
                            {connectedProviders.map((p) => (
                              <option key={p.key} value={p.key}>{p.name}（自動同期）</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-1.5">カード会社</label>
                          <select
                            value={newCard.card_company}
                            onChange={(e) => setNewCard({ ...newCard, card_company: e.target.value as typeof newCard.card_company })}
                            className="w-full bg-card border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                          >
                            <option value="VISA">VISA</option>
                            <option value="Master">Master</option>
                            <option value="JCB">JCB</option>
                            <option value="AMEX">AMEX</option>
                            <option value="Diners">Diners</option>
                            <option value="UnionPay">UnionPay</option>
                            <option value="other">その他</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-1.5">カード名</label>
                          <input
                            type="text"
                            value={newCard.card_name}
                            onChange={(e) => setNewCard({ ...newCard, card_name: e.target.value })}
                            placeholder="楽天カード"
                            className="w-full bg-card border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-1.5">カード番号下4桁</label>
                          <input
                            type="text"
                            value={newCard.card_number_last4}
                            onChange={(e) => setNewCard({ ...newCard, card_number_last4: e.target.value.replace(/\D/g, "").slice(0, 4) })}
                            placeholder="1234"
                            className="w-full bg-card border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-1.5">名義人</label>
                          <input
                            type="text"
                            value={newCard.card_holder}
                            onChange={(e) => setNewCard({ ...newCard, card_holder: e.target.value })}
                            placeholder="TARO YAMADA"
                            className="w-full bg-card border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-1.5">締日</label>
                          <input
                            type="number"
                            min="1"
                            max="31"
                            value={newCard.closing_day}
                            onChange={(e) => setNewCard({ ...newCard, closing_day: Number(e.target.value) || 15 })}
                            className="w-full bg-card border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-1.5">引き落とし日</label>
                          <input
                            type="number"
                            min="1"
                            max="31"
                            value={newCard.payment_day}
                            onChange={(e) => setNewCard({ ...newCard, payment_day: Number(e.target.value) || 10 })}
                            className="w-full bg-card border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                          />
                        </div>
                        <div className="col-span-2">
                          <label className="block text-sm font-medium text-foreground mb-1.5">引き落とし口座</label>
                          <select
                            value={newCard.linked_bank_account_id}
                            onChange={(e) => setNewCard({ ...newCard, linked_bank_account_id: e.target.value })}
                            className="w-full bg-card border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                          >
                            <option value="">選択なし</option>
                            {bankAccounts
                              .filter((b) => b.client_id === newCard.client_id)
                              .map((b) => (
                                <option key={b.id} value={b.id}>
                                  {b.bank_name} {b.branch_name ?? ""} ({b.account_number})
                                </option>
                              ))}
                          </select>
                        </div>
                      </div>
                      <div className="mt-4 flex gap-2 justify-end">
                        <Button variant="ghost" size="sm" onClick={() => setShowCardForm(false)}>
                          キャンセル
                        </Button>
                        <Button size="sm" onClick={handleCreateCard} disabled={cardSaving || !newCard.card_name || !newCard.card_number_last4}>
                          {cardSaving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                          追加
                        </Button>
                      </div>
                    </div>
                  )}

                  {cardAccounts.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <CreditCard className="size-10 mx-auto mb-3 opacity-50" />
                      <p className="text-sm">登録済みのカードがありません</p>
                      <p className="text-xs mt-1">「カード追加」ボタンからカードを登録してください</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {cardAccounts.map((card) => {
                        const isDeleting = cardDeleting === card.id;
                        return (
                          <div
                            key={card.id}
                            className={`flex items-center gap-4 p-4 rounded-lg border border-border ${isDeleting ? "opacity-50" : ""}`}
                          >
                            <div className="p-2 rounded-lg bg-primary/10 text-primary">
                              <CreditCard className="size-5" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-bold text-foreground">
                                {card.card_company} {card.card_name}
                              </p>
                              <p className="text-muted-foreground text-xs">
                                {card.card_number_masked} / {card.card_holder ?? "-"} / 締日 {card.closing_day}日・支払日 {card.payment_day}日
                                {card.clients && (
                                  <span className="ml-2 text-primary">({card.clients.name})</span>
                                )}
                              </p>
                            </div>
                            <Badge variant={card.provider !== "manual" ? "accent" : "muted"}>
                              {providerLabels[card.provider] ?? card.provider}
                            </Badge>
                            <Button
                              variant="ghost"
                              size="sm"
                              title="削除"
                              disabled={isDeleting}
                              onClick={() => handleDeleteCard(card.id)}
                            >
                              {isDeleting ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : (
                                <Trash2 className="size-4 text-destructive" />
                              )}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {activeTab === "security" && (
            <Card>
              <CardHeader>
                <CardTitle>セキュリティ</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-6">
                  <div className="p-4 rounded-lg border border-border">
                    <p className="font-bold text-foreground mb-1">二要素認証</p>
                    <p className="text-muted-foreground text-sm mb-3">
                      アカウントのセキュリティを強化するため、二要素認証を有効にすることを推奨します。
                    </p>
                    <Button variant="outline" size="sm" onClick={() => alert("二要素認証の設定は準備中です")}>設定する</Button>
                  </div>
                  <div className="p-4 rounded-lg border border-border">
                    <p className="font-bold text-foreground mb-1">セッション管理</p>
                    <p className="text-muted-foreground text-sm mb-3">
                      現在のアクティブなセッション: 2台のデバイス
                    </p>
                    <Button variant="outline" size="sm" onClick={() => alert("セッション管理は準備中です")}>セッション一覧</Button>
                  </div>
                  <div className="p-4 rounded-lg border border-border">
                    <p className="font-bold text-foreground mb-1">パスワード変更</p>
                    <p className="text-muted-foreground text-sm mb-3">
                      最終変更: 30日前
                    </p>
                    {!showPasswordForm ? (
                      <Button variant="outline" size="sm" onClick={() => setShowPasswordForm(true)}>パスワードを変更</Button>
                    ) : (
                      <div className="space-y-3 mt-3 p-4 rounded-lg border border-border bg-muted/10">
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-1">現在のパスワード</label>
                          <input type="password" value={passwordData.current} onChange={(e) => setPasswordData({ ...passwordData, current: e.target.value })} className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-1">新しいパスワード</label>
                          <input type="password" value={passwordData.new_password} onChange={(e) => setPasswordData({ ...passwordData, new_password: e.target.value })} className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-foreground mb-1">新しいパスワード（確認）</label>
                          <input type="password" value={passwordData.confirm} onChange={(e) => setPasswordData({ ...passwordData, confirm: e.target.value })} className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm" />
                        </div>
                        <div className="flex gap-2 justify-end">
                          <Button variant="ghost" size="sm" onClick={() => setShowPasswordForm(false)}>キャンセル</Button>
                          <Button size="sm" onClick={handleChangePassword} disabled={changingPassword || !passwordData.new_password}>
                            {changingPassword && <Loader2 className="size-4 animate-spin" />}
                            変更する
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
