"use client";

import { useState, useEffect } from "react";
import {
  Building2,
  Bell,
  User,
  LogOut,
  Save,
  X,
  Loader2,
  Pencil,
  ChevronDown,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/providers/auth-provider";
import { scopedGetItem, scopedSetItem } from "@/lib/scoped-storage";
import { getClient, updateClient } from "@/actions/clients";

export default function PortalSettingsPage() {
  const { user, signOut } = useAuth();

  const [editingProfile, setEditingProfile] = useState(false);
  const [profileData, setProfileData] = useState({
    name: user?.name ?? "",
    email: user?.email ?? "",
  });

  // Company info state
  const [companyData, setCompanyData] = useState({
    name: "",
    address: "",
    telephone: "",
    email: "",
    fiscal_year_start_month: 4,
    business_type: "",
  });
  const [editingCompany, setEditingCompany] = useState(false);
  const [savingCompany, setSavingCompany] = useState(false);
  const [loadingCompany, setLoadingCompany] = useState(true);
  const [companyExpanded, setCompanyExpanded] = useState(false);

  const [notifications, setNotifications] = useState([
    { key: "receipt_reminder", label: "領収書リマインダー", description: "月末に未提出の領収書をお知らせ", enabled: true },
    { key: "question_notify", label: "質問の通知", description: "税理士からの質問を受信時に通知", enabled: true },
    { key: "invoice_notify", label: "請求書の通知", description: "新しい請求書の発行を通知", enabled: false },
  ]);

  // Load client data
  useEffect(() => {
    if (!user?.clientId) {
      setLoadingCompany(false);
      return;
    }
    getClient(user.clientId)
      .then((client) => {
        setCompanyData({
          name: client.name,
          address: client.address ?? "",
          telephone: client.telephone ?? "",
          email: client.email ?? "",
          fiscal_year_start_month: client.fiscal_year_start_month,
          business_type: client.business_type ?? "",
        });
      })
      .catch(() => {
        /* DB not available */
      })
      .finally(() => setLoadingCompany(false));
  }, [user?.clientId]);

  useEffect(() => {
    if (!user?.id) return;
    try {
      const saved = scopedGetItem(user.id, "portal_notifications");
      if (saved) {
        const keys: Record<string, boolean> = JSON.parse(saved);
        setNotifications((prev) =>
          prev.map((n) => ({ ...n, enabled: keys[n.key] ?? n.enabled }))
        );
      }
    } catch {
      /* ignore */
    }
  }, [user?.id]);

  const toggleNotification = (key: string) => {
    const updated = notifications.map((n) =>
      n.key === key ? { ...n, enabled: !n.enabled } : n
    );
    setNotifications(updated);
    const keys: Record<string, boolean> = {};
    updated.forEach((n) => {
      keys[n.key] = n.enabled;
    });
    scopedSetItem(
      user?.id ?? null,
      "portal_notifications",
      JSON.stringify(keys)
    );
  };

  const handleSaveCompany = async () => {
    if (!user?.clientId) return;
    setSavingCompany(true);
    try {
      await updateClient(user.clientId, {
        name: companyData.name,
        address: companyData.address || null,
        telephone: companyData.telephone || null,
        email: companyData.email || null,
        business_type: companyData.business_type || null,
      });
      setEditingCompany(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSavingCompany(false);
    }
  };

  const fiscalYearEndMonth =
    ((companyData.fiscal_year_start_month + 10) % 12) + 1;

  return (
    <>
      <h2 className="text-lg font-bold text-foreground mb-4">設定</h2>

      <div className="space-y-4">
        {/* ── Card 1: プロフィール ── */}
        <Card>
          <CardHeader className="pb-0">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-full bg-primary/10 flex items-center justify-center">
                <User className="size-5 text-primary" />
              </div>
              <CardTitle className="text-sm">プロフィール</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3 mb-4 mt-1">
              <div className="size-12 rounded-full bg-primary/15 flex items-center justify-center text-primary font-bold text-lg">
                {(user?.name ?? "").charAt(0) || "?"}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-bold text-foreground truncate">
                  {user?.name ?? ""}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {user?.email ?? ""}
                </p>
              </div>
            </div>

            {!editingProfile ? (
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setEditingProfile(true)}
              >
                <Pencil className="size-3.5" />
                プロフィール編集
              </Button>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                    名前
                  </label>
                  <input
                    type="text"
                    value={profileData.name}
                    onChange={(e) =>
                      setProfileData({ ...profileData, name: e.target.value })
                    }
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-shadow"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                    メール
                  </label>
                  <input
                    type="email"
                    value={profileData.email}
                    onChange={(e) =>
                      setProfileData({ ...profileData, email: e.target.value })
                    }
                    className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-shadow"
                  />
                </div>
                <div className="flex gap-2 pt-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex-1"
                    onClick={() => setEditingProfile(false)}
                  >
                    <X className="size-3.5" />
                    キャンセル
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={() => {
                      alert("プロフィールを保存しました");
                      setEditingProfile(false);
                    }}
                  >
                    <Save className="size-3.5" />
                    保存
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Card 2: 会社情報 (Collapsible) ── */}
        <Card>
          <CardHeader className="pb-0">
            <button
              type="button"
              onClick={() => {
                if (!editingCompany) setCompanyExpanded((v) => !v);
              }}
              className="flex items-center justify-between w-full cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <Building2 className="size-5 text-primary" />
                </div>
                <div className="text-left">
                  <CardTitle className="text-sm">会社情報</CardTitle>
                  {!companyExpanded && !editingCompany && !loadingCompany && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {companyData.name || "未設定"}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {!editingCompany && !loadingCompany && companyExpanded && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingCompany(true);
                    }}
                    className="text-primary text-xs flex items-center gap-1 hover:underline cursor-pointer"
                  >
                    <Pencil className="size-3" />
                    編集
                  </button>
                )}
                <ChevronDown
                  className={`size-5 text-muted-foreground transition-transform duration-300 ${
                    companyExpanded || editingCompany ? "rotate-180" : ""
                  }`}
                />
              </div>
            </button>
          </CardHeader>

          <div
            className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
              companyExpanded || editingCompany
                ? "grid-rows-[1fr]"
                : "grid-rows-[0fr]"
            }`}
          >
            <div className="overflow-hidden">
              <CardContent>
                {loadingCompany ? (
                  <div className="flex items-center justify-center py-6 text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    <span className="ml-2 text-sm">読み込み中...</span>
                  </div>
                ) : !editingCompany ? (
                  <div className="space-y-2.5 text-sm">
                    <CompanyRow label="会社名" value={companyData.name} />
                    <CompanyRow label="業種" value={companyData.business_type} />
                    <CompanyRow label="住所" value={companyData.address} />
                    <CompanyRow label="電話番号" value={companyData.telephone} />
                    <CompanyRow label="メール" value={companyData.email} />
                    <CompanyRow
                      label="決算月"
                      value={`${fiscalYearEndMonth}月`}
                    />
                  </div>
                ) : (
                  <div className="space-y-3">
                    <CompanyInput
                      label="会社名"
                      type="text"
                      value={companyData.name}
                      onChange={(v) =>
                        setCompanyData({ ...companyData, name: v })
                      }
                    />
                    <CompanyInput
                      label="業種"
                      type="text"
                      value={companyData.business_type}
                      onChange={(v) =>
                        setCompanyData({ ...companyData, business_type: v })
                      }
                    />
                    <CompanyInput
                      label="住所"
                      type="text"
                      value={companyData.address}
                      onChange={(v) =>
                        setCompanyData({ ...companyData, address: v })
                      }
                    />
                    <CompanyInput
                      label="電話番号"
                      type="text"
                      value={companyData.telephone}
                      onChange={(v) =>
                        setCompanyData({ ...companyData, telephone: v })
                      }
                    />
                    <CompanyInput
                      label="メール"
                      type="email"
                      value={companyData.email}
                      onChange={(v) =>
                        setCompanyData({ ...companyData, email: v })
                      }
                    />
                    <div className="flex gap-2 pt-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="flex-1"
                        onClick={() => setEditingCompany(false)}
                      >
                        <X className="size-3.5" />
                        キャンセル
                      </Button>
                      <Button
                        size="sm"
                        className="flex-1"
                        onClick={handleSaveCompany}
                        disabled={savingCompany || !companyData.name}
                      >
                        {savingCompany ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Save className="size-3.5" />
                        )}
                        保存
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </div>
          </div>
        </Card>

        {/* ── Card 3: 通知設定 ── */}
        <Card>
          <CardHeader className="pb-0">
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Bell className="size-5 text-primary" />
              </div>
              <CardTitle className="text-sm">通知設定</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              {notifications.map((item) => (
                <div
                  key={item.key}
                  className="flex items-center justify-between py-2.5"
                >
                  <div className="min-w-0 flex-1 pr-3">
                    <span className="text-sm font-medium text-foreground block">
                      {item.label}
                    </span>
                    <span className="text-xs text-muted-foreground block mt-0.5">
                      {item.description}
                    </span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={item.enabled}
                    onClick={() => toggleNotification(item.key)}
                    className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-300 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                      item.enabled ? "bg-primary" : "bg-muted/50"
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block size-5 rounded-full bg-white shadow-md ring-0 transition-transform duration-300 ease-in-out ${
                        item.enabled ? "translate-x-6" : "translate-x-1"
                      }`}
                    />
                  </button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* ── Card 4: ログアウト ── */}
        <div className="pt-2 pb-8">
          <Button
            variant="outline"
            size="lg"
            className="w-full text-destructive border-destructive/30 hover:bg-destructive/10 hover:border-destructive/50 transition-colors"
            onClick={() => signOut()}
          >
            <LogOut className="size-4" />
            ログアウト
          </Button>
        </div>
      </div>
    </>
  );
}

/* ── Small helper components ── */

function CompanyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-baseline gap-2">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-foreground font-medium text-right truncate">
        {value || "---"}
      </span>
    </div>
  );
}

function CompanyInput({
  label,
  type,
  value,
  onChange,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1.5">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-background border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-shadow"
      />
    </div>
  );
}
