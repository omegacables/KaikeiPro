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
  Archive,
  CreditCard,
  Wallet,
  Handshake,
  Banknote,
  Landmark,
  Scale,
  ListChecks,
  LogOut,
  ChevronDown,
  Loader2,
  ShieldCheck,
  FileCheck,
  Home,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/providers/auth-provider";
import { scopedGetItem, scopedSetItem } from "@/lib/scoped-storage";
import { getClients } from "@/actions/clients";
import { useMobileNav } from "@/components/layout/mobile-nav";

type ClientOption = { id: string; name: string };

type NavItem = { href: string; label: string; icon: typeof Calculator };
type NavGroup = { key: string; label: string; icon: typeof Calculator; items: NavItem[] };

// 業務メニューはトグル式のグループにまとめる（開くとアコーディオンで項目を表示）
const navGroups: NavGroup[] = [
  {
    key: "daily",
    label: "日常業務",
    icon: Calculator,
    items: [
      { href: "/journals", label: "仕訳入力", icon: Calculator },
      { href: "/documents", label: "証憑管理", icon: FileCheck },
      { href: "/payments", label: "入金消込", icon: Wallet },
      // 銀行連携は一旦非表示（コードは残す。仕訳入力ページのCSV取込で代替）
      // { href: "/bank-transactions", label: "口座取引", icon: Banknote },
      { href: "/card-transactions", label: "カード取引", icon: CreditCard },
    ],
  },
  {
    key: "books",
    label: "帳簿・レポート",
    icon: BookOpen,
    items: [
      { href: "/ledgers", label: "帳簿閲覧", icon: BookOpen },
      { href: "/statements", label: "試算表・財務諸表", icon: BarChart3 },
    ],
  },
  {
    key: "closing",
    label: "決算",
    icon: Archive,
    items: [
      { href: "/closing-checklist", label: "決算前チェック", icon: ListChecks },
      { href: "/closing", label: "決算処理", icon: Archive },
      { href: "/opening-balances", label: "期首残高設定", icon: Scale },
    ],
  },
  {
    key: "records",
    label: "台帳・取引先",
    icon: Handshake,
    items: [
      { href: "/payroll", label: "給与台帳", icon: Banknote },
      { href: "/loans", label: "借入金台帳", icon: Landmark },
      { href: "/partners", label: "取引先管理", icon: Handshake },
    ],
  },
  {
    key: "master",
    label: "マスタ・設定",
    icon: Settings,
    items: [
      { href: "/accounts", label: "勘定科目管理", icon: FileText },
      { href: "/learned-rules", label: "仕訳学習", icon: Sparkles },
      { href: "/allocations", label: "家事按分設定", icon: Home },
      // 消費税計算・会社書類・監査ログ は「設定」ページに集約
      { href: "/settings", label: "設定", icon: Settings },
    ],
  },
];

/**
 * 業務メニュー（アコーディオン）。
 * 現在ページを含むグループは自動で開き、開閉状態はユーザーごとに保存する。
 */
function ClientNavAccordion({ basePath, userId }: { basePath: string; userId: string | null }) {
  const pathname = usePathname();

  // 現在ページが属するグループ
  const activeGroupKey = navGroups.find((g) =>
    g.items.some((item) => pathname === `${basePath}${item.href}`)
  )?.key;

  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    const saved = typeof window !== "undefined" ? scopedGetItem(userId, "sidebar_open_groups") : null;
    const initial = new Set<string>(saved ? (JSON.parse(saved) as string[]) : ["daily"]);
    if (activeGroupKey) initial.add(activeGroupKey);
    return initial;
  });

  // ページ遷移で別グループに移動したら、そのグループを自動で開く
  useEffect(() => {
    if (activeGroupKey && !openGroups.has(activeGroupKey)) {
      setOpenGroups((prev) => new Set(prev).add(activeGroupKey));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGroupKey]);

  const toggleGroup = (key: string) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      scopedSetItem(userId, "sidebar_open_groups", JSON.stringify([...next]));
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-0.5">
      {navGroups.map((group) => {
        const isOpen = openGroups.has(group.key);
        return (
          <div key={group.key}>
            {/* グループトグル */}
            <button
              onClick={() => toggleGroup(group.key)}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-sm cursor-pointer text-white font-bold hover:bg-slate-purple/50"
            >
              <group.icon className="size-4 shrink-0" />
              <span className="flex-1 text-left">{group.label}</span>
              <ChevronDown
                className={cn("size-4 shrink-0 transition-transform", isOpen && "rotate-180")}
              />
            </button>

            {/* アコーディオン項目 */}
            {isOpen && (
              <div className="ml-4 pl-3 border-l border-slate-purple/40 flex flex-col gap-0.5 py-0.5">
                {group.items.map((item) => {
                  const fullHref = `${basePath}${item.href}`;
                  const isActive = pathname === fullHref;
                  return (
                    <Link
                      key={item.href}
                      href={fullHref}
                      className={cn(
                        "flex items-center gap-2.5 px-3 py-1.5 rounded-lg transition-colors text-sm",
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
          </div>
        );
      })}
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { open: mobileOpen, closeNav } = useMobileNav();
  const isSuperAdmin = user?.role === "super_admin";
  const isClient = user?.role === "client";

  // モバイルではページ遷移時にドロワーを閉じる
  useEffect(() => {
    closeNav();
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

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
    <>
      {/* モバイル用バックドロップ（ドロワーが開いている時のみ） */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={closeNav}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          "w-64 border-r border-border bg-sidebar-bg flex flex-col shrink-0",
          // モバイル: 画面外に固定配置し、開いた時だけスライドイン
          "fixed inset-y-0 left-0 z-50 transition-transform duration-200 ease-in-out",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          // デスクトップ: 通常のフロー内に固定表示
          "lg:static lg:translate-x-0 lg:z-auto"
        )}
      >
        <div className="p-6 flex flex-col gap-6 h-full">
          {/* Logo + モバイル用閉じるボタン */}
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
            <button
              onClick={closeNav}
              className="ml-auto p-1.5 rounded-lg text-sage hover:bg-slate-purple/50 hover:text-cream transition-colors lg:hidden"
              aria-label="メニューを閉じる"
            >
              <X className="size-5" />
            </button>
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
                <p className="text-white text-[10px] font-bold uppercase tracking-widest">
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
                <p className="text-white text-[10px] font-bold uppercase tracking-widest">
                  業務メニュー
                </p>
              </div>
              <ClientNavAccordion basePath={`/clients/${user.clientId}`} userId={user?.id ?? null} />
            </>
          ) : (
            /* Regular users: show client selector and sub-nav */
            <>
              {/* Client Selector */}
              <div className="mt-4 mb-2 px-3 flex items-center justify-between">
                <p className="text-white text-[10px] font-bold uppercase tracking-widest">
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
                    {/* 選択中の顧問先。押すと切り替えられることが分かるよう、
                        名前だけでなく枠と説明を付ける */}
                    <button
                      onClick={() => setDropdownOpen(!dropdownOpen)}
                      title="顧問先を切り替える"
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-purple/30 border border-primary-light/40 text-cream text-sm hover:bg-slate-purple/50 transition-colors cursor-pointer"
                    >
                      <Users className="size-4 shrink-0 text-primary-light" />
                      <span className="flex-1 min-w-0 text-left">
                        <span className="block text-[10px] text-sage leading-tight">
                          選択中の顧問先
                        </span>
                        <span className="block truncate font-semibold">
                          {selectedClient?.name ?? "顧問先を選択"}
                        </span>
                      </span>
                      <ChevronDown className={cn("size-4 shrink-0 transition-transform", dropdownOpen && "rotate-180")} />
                    </button>

                    {dropdownOpen && (
                      <div className="absolute left-1 right-1 top-full mt-1 z-50 bg-sidebar-bg border border-slate-purple/50 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                        <p className="px-3 py-2 text-[10px] font-bold text-sage border-b border-slate-purple/40">
                          顧問先を切り替える
                        </p>
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
                    <div className="mt-2">
                      <ClientNavAccordion basePath={`/clients/${activeClientId}`} userId={user?.id ?? null} />
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </nav>

        {/* Logout（マイアカウントはヘッダー右上のアイコンから） */}
        <div className="pt-4 border-t border-slate-purple/30 flex flex-col gap-1">
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
    </>
  );
}
