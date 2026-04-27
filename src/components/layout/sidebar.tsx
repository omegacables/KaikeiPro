"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import {
  LayoutDashboard,
  Calculator,
  FileText,
  Users,
  Receipt,
  Settings,
  Building2,
  BookOpen,
  BarChart3,
  Percent,
  Archive,
  CreditCard,
  Wallet,
  Handshake,
  Banknote,
  LogOut,
  ChevronDown,
  Loader2,
  ShieldCheck,
  Shield,
  MessageSquare,
  FileCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/providers/auth-provider";
import { scopedGetItem, scopedSetItem } from "@/lib/scoped-storage";
import { getClients } from "@/actions/clients";

type ClientOption = { id: string; name: string };

const clientNav = [
  { href: "/journals", label: "仕訳入力", icon: Calculator },
  { href: "/documents", label: "証憑管理", icon: FileCheck },
  { href: "/ledgers", label: "帳簿閲覧", icon: BookOpen },
  { href: "/statements", label: "試算表・財務諸表", icon: BarChart3 },
  { href: "/accounts", label: "勘定科目管理", icon: FileText },
  { href: "/tax", label: "消費税計算", icon: Percent },
  { href: "/closing", label: "決算処理", icon: Archive },
  { href: "/payments", label: "入金消込", icon: Wallet },
  { href: "/bank-transactions", label: "口座取引", icon: Banknote },
  { href: "/card-transactions", label: "カード取引", icon: CreditCard },
  { href: "/partners", label: "取引先管理", icon: Handshake },
  { href: "/questions", label: "質問管理", icon: MessageSquare },
  { href: "/audit", label: "監査ログ", icon: Shield },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";
  const isClient = user?.role === "client";

  const [clients, setClients] = useState<ClientOption[]>([]);
  const [loadingClients, setLoadingClients] = useState(true);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // Detect clientId from URL
  const clientIdMatch = pathname.match(/^\/clients\/([^/]+)/);
  const urlClientId = clientIdMatch ? clientIdMatch[1] : null;

  // Selected client: prefer URL match, then localStorage
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

  useEffect(() => {
    getClients()
      .then((data) => {
        const opts = data.map((c) => ({ id: c.id, name: c.name }));
        setClients(opts);

        // Initialize selected client (user-scoped)
        const savedId = typeof window !== "undefined" ? scopedGetItem(user?.id ?? null, "selected_client") : null;
        if (urlClientId) {
          setSelectedClientId(urlClientId);
        } else if (savedId && opts.some((c) => c.id === savedId)) {
          setSelectedClientId(savedId);
        } else if (opts.length > 0) {
          setSelectedClientId(opts[0].id);
        }
      })
      .catch(() => {
        // DB not available
      })
      .finally(() => setLoadingClients(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync URL clientId → selectedClientId
  useEffect(() => {
    if (urlClientId && urlClientId !== selectedClientId) {
      setSelectedClientId(urlClientId);
    }
  }, [urlClientId]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeClientId = urlClientId ?? selectedClientId;
  const selectedClient = clients.find((c) => c.id === activeClientId);

  function handleSelectClient(clientId: string) {
    setSelectedClientId(clientId);
    setDropdownOpen(false);
    scopedSetItem(user?.id ?? null, "selected_client", clientId);
    // Navigate to the client detail page
    router.push(`/clients/${clientId}`);
  }

  async function handleLogout() {
    await signOut();
    router.push("/auth/login");
    router.refresh();
  }

  return (
    <aside className="w-64 border-r border-border bg-sidebar-bg flex flex-col shrink-0">
      <div className="p-6 flex flex-col gap-6 h-full">
        {/* Logo */}
        <div className="flex gap-3 items-center">
          <div className="bg-primary-light/20 rounded-full size-10 flex items-center justify-center text-cream">
            <Building2 className="size-5" />
          </div>
          <div className="flex flex-col">
            <h1 className="text-cream text-base font-bold leading-tight">
              Raqto会計
            </h1>
            <p className="text-sage text-xs font-normal">
              AIバージョン
            </p>
          </div>
        </div>

        {/* Main Navigation */}
        <nav className="flex flex-col gap-1 grow overflow-y-auto">
          {/* Dashboard link */}
          <Link
            href="/dashboard"
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-sm",
              pathname === "/dashboard"
                ? "bg-primary-light/20 text-cream font-semibold"
                : "text-sage hover:bg-slate-purple/50 hover:text-cream"
            )}
          >
            <LayoutDashboard className="size-5 shrink-0" />
            <span>ダッシュボード</span>
          </Link>

          {isSuperAdmin ? (
            /* Super Admin: show admin-only menu */
            <>
              <div className="mt-4 mb-2 px-3">
                <p className="text-sage/60 text-[10px] font-bold uppercase tracking-widest">
                  管理
                </p>
              </div>
              <Link
                href="/firms"
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-sm",
                  pathname === "/firms"
                    ? "bg-primary-light/20 text-cream font-semibold"
                    : "text-sage hover:bg-slate-purple/50 hover:text-cream"
                )}
              >
                <Building2 className="size-5 shrink-0" />
                <span>税理士事務所管理</span>
              </Link>
              <Link
                href="/clients"
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-sm",
                  pathname === "/clients"
                    ? "bg-primary-light/20 text-cream font-semibold"
                    : "text-sage hover:bg-slate-purple/50 hover:text-cream"
                )}
              >
                <Users className="size-5 shrink-0" />
                <span>顧客管理</span>
              </Link>
            </>
          ) : isClient && user.clientId ? (
            /* Client user: show business menu directly (no dropdown) */
            <>
              <div className="mt-4 mb-2 px-3">
                <p className="text-sage/60 text-[10px] font-bold uppercase tracking-widest">
                  業務メニュー
                </p>
              </div>
              <div className="flex flex-col gap-0.5">
                {clientNav.map((item) => {
                  const fullHref = `/clients/${user.clientId}${item.href}`;
                  const isActive = pathname === fullHref;
                  return (
                    <Link
                      key={item.href}
                      href={fullHref}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-sm",
                        isActive
                          ? "bg-primary-light/20 text-cream font-semibold"
                          : "text-sage hover:bg-slate-purple/50 hover:text-cream"
                      )}
                    >
                      <item.icon className="size-4 shrink-0" />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </>
          ) : (
            /* Regular users: show client selector and sub-nav */
            <>
              {/* Client Selector */}
              <div className="mt-4 mb-2 px-3 flex items-center justify-between">
                <p className="text-sage/60 text-[10px] font-bold uppercase tracking-widest">
                  顧問先
                </p>
                <Link
                  href="/clients"
                  className="text-sage/60 text-[10px] hover:text-cream transition-colors"
                >
                  一覧
                </Link>
              </div>

              {loadingClients ? (
                <div className="flex items-center gap-2 px-3 py-2 text-sage text-sm">
                  <Loader2 className="size-4 animate-spin" />
                  <span>読み込み中...</span>
                </div>
              ) : clients.length === 0 ? (
                <Link
                  href="/clients"
                  className="flex items-center gap-3 px-3 py-2 rounded-lg text-sage hover:bg-slate-purple/50 hover:text-cream transition-colors text-sm"
                >
                  <Users className="size-4 shrink-0" />
                  <span>顧問先を登録</span>
                </Link>
              ) : (
                <>
                  {/* Client dropdown */}
                  <div className="relative px-1">
                    <button
                      onClick={() => setDropdownOpen(!dropdownOpen)}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-purple/30 text-cream text-sm hover:bg-slate-purple/50 transition-colors cursor-pointer"
                    >
                      <Users className="size-4 shrink-0 text-primary-light" />
                      <span className="flex-1 text-left truncate">
                        {selectedClient?.name ?? "顧問先を選択"}
                      </span>
                      <ChevronDown className={cn("size-4 shrink-0 transition-transform", dropdownOpen && "rotate-180")} />
                    </button>

                    {dropdownOpen && (
                      <div className="absolute left-1 right-1 top-full mt-1 z-50 bg-sidebar-bg border border-slate-purple/50 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        {clients.map((c) => (
                          <button
                            key={c.id}
                            onClick={() => handleSelectClient(c.id)}
                            className={cn(
                              "w-full text-left px-3 py-2 text-sm transition-colors cursor-pointer",
                              c.id === activeClientId
                                ? "bg-primary-light/20 text-cream font-semibold"
                                : "text-sage hover:bg-slate-purple/50 hover:text-cream"
                            )}
                          >
                            {c.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Client sub-navigation - always visible when a client is selected */}
                  {activeClientId && (
                    <div className="mt-2 flex flex-col gap-0.5">
                      {clientNav.map((item) => {
                        const fullHref = `/clients/${activeClientId}${item.href}`;
                        const isActive = pathname === fullHref;
                        return (
                          <Link
                            key={item.href}
                            href={fullHref}
                            className={cn(
                              "flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-sm",
                              isActive
                                ? "bg-primary-light/20 text-cream font-semibold"
                                : "text-sage hover:bg-slate-purple/50 hover:text-cream"
                            )}
                          >
                            <item.icon className="size-4 shrink-0" />
                            <span>{item.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </nav>

        {/* Settings & Logout */}
        <div className="pt-4 border-t border-slate-purple/30 flex flex-col gap-1">
          <Link
            href="/settings"
            className="flex items-center gap-3 px-3 py-2 text-sage hover:text-cream transition-colors"
          >
            <Settings className="size-5" />
            <p className="text-sm font-medium">設定</p>
          </Link>
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-3 py-2 text-sage hover:text-destructive transition-colors w-full text-left"
          >
            <LogOut className="size-5" />
            <p className="text-sm font-medium">ログアウト</p>
          </button>
        </div>
      </div>
    </aside>
  );
}
