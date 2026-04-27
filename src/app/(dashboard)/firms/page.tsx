"use client";

import { useState } from "react";
import {
  Building2,
  Plus,
  ChevronRight,
  ChevronDown,
  X,
  Save,
  Loader2,
  Users,
  UserPlus,
  Eye,
  EyeOff,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useData } from "@/lib/use-data";
import { getFirms, createFirm, getFirmMembers } from "@/actions/firms";
import { createFirmMemberAccount } from "@/actions/auth";

type FirmMember = {
  name: string;
  email: string;
  role: string;
  is_active: boolean;
};

export default function FirmsPage() {
  const { data: firms, refetch: refetchFirms } = useData(() => getFirms(), []);

  // Firm creation
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newFirm, setNewFirm] = useState({ name: "", email: "", postal_code: "", address: "", telephone: "" });
  const [creatingFirm, setCreatingFirm] = useState(false);

  // Expanded firm (show members)
  const [expandedFirmId, setExpandedFirmId] = useState<string | null>(null);
  const [firmMembers, setFirmMembers] = useState<Record<string, FirmMember[]>>({});
  const [loadingMembers, setLoadingMembers] = useState<string | null>(null);

  // Member creation
  const [showMemberForm, setShowMemberForm] = useState<string | null>(null);
  const [newMember, setNewMember] = useState({ name: "", email: "", password: "", role: "admin" as "admin" | "staff" });
  const [creatingMember, setCreatingMember] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleCreateFirm = async () => {
    if (!newFirm.name.trim()) return;
    setCreatingFirm(true);
    try {
      await createFirm({
        name: newFirm.name.trim(),
        email: newFirm.email.trim() || null,
        postal_code: newFirm.postal_code.trim() || null,
        address: newFirm.address.trim() || null,
        telephone: newFirm.telephone.trim() || null,
      });
      setNewFirm({ name: "", email: "", postal_code: "", address: "", telephone: "" });
      setShowCreateForm(false);
      refetchFirms();
    } catch (e) {
      alert(e instanceof Error ? e.message : "事務所の作成に失敗しました");
    } finally {
      setCreatingFirm(false);
    }
  };

  const toggleExpand = async (firmId: string) => {
    if (expandedFirmId === firmId) {
      setExpandedFirmId(null);
      return;
    }
    setExpandedFirmId(firmId);
    if (!firmMembers[firmId]) {
      setLoadingMembers(firmId);
      try {
        const members = await getFirmMembers(firmId);
        setFirmMembers((prev) => ({
          ...prev,
          [firmId]: members.map((m) => ({
            name: m.name,
            email: m.email ?? "",
            role: m.role,
            is_active: m.is_active,
          })),
        }));
      } catch {
        setFirmMembers((prev) => ({ ...prev, [firmId]: [] }));
      } finally {
        setLoadingMembers(null);
      }
    }
  };

  const handleCreateMember = async (firmId: string) => {
    if (!newMember.name || !newMember.email || !newMember.password) return;
    setCreatingMember(true);
    try {
      await createFirmMemberAccount({
        firmId,
        name: newMember.name,
        email: newMember.email,
        password: newMember.password,
        role: newMember.role,
      });
      // Refresh members
      const members = await getFirmMembers(firmId);
      setFirmMembers((prev) => ({
        ...prev,
        [firmId]: members.map((m) => ({
          name: m.name,
          email: m.email ?? "",
          role: m.role,
          is_active: m.is_active,
        })),
      }));
      setNewMember({ name: "", email: "", password: "", role: "admin" });
      setShowMemberForm(null);
      setShowPassword(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : "アカウントの作成に失敗しました");
    } finally {
      setCreatingMember(false);
    }
  };

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">税理士事務所管理</h1>
          <p className="text-muted-foreground text-sm mt-1">{firms.length} 事務所</p>
        </div>
        <Button onClick={() => setShowCreateForm(!showCreateForm)}>
          {showCreateForm ? <X className="size-4" /> : <Plus className="size-4" />}
          {showCreateForm ? "閉じる" : "事務所を追加"}
        </Button>
      </div>

      {/* Create Firm Form */}
      {showCreateForm && (
        <Card className="mb-6 p-6 border-primary/30">
          <h3 className="font-bold text-foreground mb-4">新規事務所作成</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                事務所名 <span className="text-destructive">*</span>
              </label>
              <input
                type="text"
                value={newFirm.name}
                onChange={(e) => setNewFirm({ ...newFirm, name: e.target.value })}
                placeholder="田中税理士事務所"
                className="w-full bg-card border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">メールアドレス</label>
              <input
                type="email"
                value={newFirm.email}
                onChange={(e) => setNewFirm({ ...newFirm, email: e.target.value })}
                placeholder="info@example.com"
                className="w-full bg-card border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">電話番号</label>
              <input
                type="text"
                value={newFirm.telephone}
                onChange={(e) => setNewFirm({ ...newFirm, telephone: e.target.value })}
                placeholder="03-1234-5678"
                className="w-full bg-card border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">郵便番号</label>
              <input
                type="text"
                value={newFirm.postal_code}
                onChange={(e) => setNewFirm({ ...newFirm, postal_code: e.target.value })}
                placeholder="100-0001"
                className="w-full bg-card border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-foreground mb-1.5">住所</label>
              <input
                type="text"
                value={newFirm.address}
                onChange={(e) => setNewFirm({ ...newFirm, address: e.target.value })}
                placeholder="東京都千代田区..."
                className="w-full bg-card border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>
          <div className="mt-4 flex gap-2 justify-end">
            <Button variant="ghost" onClick={() => setShowCreateForm(false)}>キャンセル</Button>
            <Button onClick={handleCreateFirm} disabled={creatingFirm || !newFirm.name.trim()}>
              {creatingFirm ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              作成
            </Button>
          </div>
        </Card>
      )}

      {/* Firms List */}
      <div className="space-y-3">
        {firms.length === 0 ? (
          <Card className="p-8 text-center">
            <Building2 className="size-10 mx-auto mb-3 text-muted-foreground opacity-50" />
            <p className="text-muted-foreground text-sm">登録された事務所がありません</p>
            <p className="text-muted-foreground text-xs mt-1">「事務所を追加」ボタンから事務所を作成してください</p>
          </Card>
        ) : (
          firms.map((firm) => {
            const isExpanded = expandedFirmId === firm.id;
            const members = firmMembers[firm.id] ?? [];
            const isLoading = loadingMembers === firm.id;
            const showingMemberForm = showMemberForm === firm.id;

            return (
              <Card key={firm.id} className="overflow-hidden">
                {/* Firm header */}
                <button
                  onClick={() => toggleExpand(firm.id)}
                  className="w-full flex items-center gap-4 p-4 hover:bg-muted/10 transition-colors text-left cursor-pointer"
                >
                  <div className="size-12 rounded-lg bg-primary/10 flex items-center justify-center text-primary font-bold">
                    {firm.name.slice(0, 2)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-foreground font-bold truncate">{firm.name}</h4>
                    <p className="text-muted-foreground text-xs">
                      {[firm.email, firm.telephone].filter(Boolean).join(" • ") || "情報未登録"}
                    </p>
                  </div>
                  {isExpanded ? (
                    <ChevronDown className="size-4 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="size-4 text-muted-foreground" />
                  )}
                </button>

                {/* Expanded: Members */}
                {isExpanded && (
                  <div className="border-t border-border px-4 pb-4 pt-3">
                    <div className="flex items-center justify-between mb-3">
                      <h5 className="text-sm font-bold text-foreground flex items-center gap-2">
                        <Users className="size-4 text-primary" />
                        メンバー
                      </h5>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setShowMemberForm(showingMemberForm ? null : firm.id);
                          setNewMember({ name: "", email: "", password: "", role: "admin" });
                          setShowPassword(false);
                        }}
                      >
                        {showingMemberForm ? <X className="size-3" /> : <UserPlus className="size-3" />}
                        {showingMemberForm ? "閉じる" : "アカウント作成"}
                      </Button>
                    </div>

                    {/* Member creation form */}
                    {showingMemberForm && (
                      <div className="mb-4 p-4 rounded-lg border border-primary/30 bg-primary/5">
                        <h4 className="font-bold text-foreground text-sm mb-3">税理士アカウント作成</h4>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-medium text-foreground mb-1">名前 *</label>
                            <input
                              type="text"
                              value={newMember.name}
                              onChange={(e) => setNewMember({ ...newMember, name: e.target.value })}
                              placeholder="田中 健二"
                              className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-foreground mb-1">メールアドレス *</label>
                            <input
                              type="email"
                              value={newMember.email}
                              onChange={(e) => setNewMember({ ...newMember, email: e.target.value })}
                              placeholder="tanaka@example.com"
                              className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-foreground mb-1">パスワード *</label>
                            <div className="flex items-center gap-1">
                              <input
                                type={showPassword ? "text" : "password"}
                                value={newMember.password}
                                onChange={(e) => setNewMember({ ...newMember, password: e.target.value })}
                                placeholder="6文字以上"
                                className="flex-1 bg-card border border-border rounded-lg px-3 py-2 text-sm"
                              />
                              <button
                                onClick={() => setShowPassword(!showPassword)}
                                className="p-2 text-muted-foreground hover:text-foreground cursor-pointer"
                              >
                                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                              </button>
                            </div>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-foreground mb-1">ロール</label>
                            <select
                              value={newMember.role}
                              onChange={(e) => setNewMember({ ...newMember, role: e.target.value as "admin" | "staff" })}
                              className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm"
                            >
                              <option value="admin">管理者（税理士）</option>
                              <option value="staff">スタッフ</option>
                            </select>
                          </div>
                        </div>
                        <div className="mt-3 flex gap-2 justify-end">
                          <Button variant="ghost" size="sm" onClick={() => setShowMemberForm(null)}>キャンセル</Button>
                          <Button
                            size="sm"
                            onClick={() => handleCreateMember(firm.id)}
                            disabled={creatingMember || !newMember.name || !newMember.email || !newMember.password || newMember.password.length < 6}
                          >
                            {creatingMember ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
                            作成
                          </Button>
                        </div>
                      </div>
                    )}

                    {isLoading ? (
                      <div className="flex items-center gap-2 py-4 justify-center text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" />
                        <span className="text-sm">読み込み中...</span>
                      </div>
                    ) : members.length === 0 ? (
                      <p className="text-muted-foreground text-sm py-4 text-center">
                        メンバーがいません。「アカウント作成」から税理士アカウントを作成してください。
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {members.map((m) => (
                          <div key={m.email} className="flex items-center gap-3 p-3 rounded-lg border border-border">
                            <div className="size-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs">
                              {m.name.charAt(0)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-foreground font-bold text-sm">{m.name}</p>
                              <p className="text-muted-foreground text-xs">{m.email}</p>
                            </div>
                            <Badge variant={m.role === "admin" ? "default" : "muted"}>
                              {m.role === "admin" ? "管理者" : "スタッフ"}
                            </Badge>
                            <Badge variant={m.is_active ? "success" : "destructive"}>
                              {m.is_active ? "有効" : "無効"}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })
        )}
      </div>
    </>
  );
}
