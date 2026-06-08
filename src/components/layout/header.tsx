"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Bell, HelpCircle, Sun, Moon, Menu } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/auth-provider";
import { useMobileNav } from "@/components/layout/mobile-nav";
import { getInitials, formatTimeAgo } from "@/lib/utils";
import { getTheme, toggleTheme, type Theme } from "@/lib/theme";
import { getClient } from "@/actions/clients";
import {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  type Notification,
} from "@/actions/notifications";

const pageTitles: Record<string, string> = {
  "/dashboard": "ダッシュボード",
  "/clients": "顧問先管理",
  "/firms": "税理士事務所管理",
  "/settings": "設定",
};

const clientSubPageTitles: Record<string, string> = {
  journals: "仕訳入力",
  documents: "証憑管理",
  receipts: "領収書管理",
  ledgers: "帳簿閲覧",
  statements: "試算表・財務諸表",
  accounts: "勘定科目管理",
  tax: "消費税計算",
  closing: "決算処理",
  invoices: "請求書管理",
  payments: "入金消込",
  "bank-transactions": "口座取引",
  "card-transactions": "カード取引",
  partners: "取引先管理",
  audit: "監査ログ",
};

function getPageTitle(pathname: string): string {
  // Exact match
  if (pageTitles[pathname]) return pageTitles[pathname];

  // Client sub-page: /clients/[id]/subpage
  const clientSubMatch = pathname.match(/^\/clients\/[^/]+\/([^/]+)/);
  if (clientSubMatch) {
    return clientSubPageTitles[clientSubMatch[1]] ?? "顧問先";
  }

  // Client detail: /clients/[id]
  if (pathname.match(/^\/clients\/[^/]+$/)) {
    return "顧問先詳細";
  }

  return "ダッシュボード";
}

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const { openNav } = useMobileNav();
  const [theme, setThemeState] = useState<Theme>("light");
  const [companyName, setCompanyName] = useState<string | null>(null);

  // Notification state
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setThemeState(getTheme());
  }, []);

  useEffect(() => {
    if (user?.role === "client" && user.clientId) {
      getClient(user.clientId)
        .then((client) => setCompanyName(client.name))
        .catch(() => {});
    }
  }, [user?.role, user?.clientId]);

  // Fetch unread count on mount
  useEffect(() => {
    getUnreadCount()
      .then(setUnreadCount)
      .catch(() => {});
  }, []);

  // Close panel on outside click
  useEffect(() => {
    if (!isOpen) return;
    function handleMouseDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [isOpen]);

  const handleToggleBell = useCallback(async () => {
    const opening = !isOpen;
    setIsOpen(opening);
    if (opening) {
      setLoading(true);
      try {
        const [items, count] = await Promise.all([
          getNotifications(),
          getUnreadCount(),
        ]);
        setNotifications(items);
        setUnreadCount(count);
      } catch {
        // fail silently
      } finally {
        setLoading(false);
      }
    }
  }, [isOpen]);

  const handleMarkAsRead = useCallback(
    async (notification: Notification) => {
      if (!notification.is_read) {
        // Optimistic update
        setNotifications((prev) =>
          prev.map((n) =>
            n.id === notification.id ? { ...n, is_read: true } : n
          )
        );
        setUnreadCount((c) => Math.max(0, c - 1));
        try {
          await markAsRead(notification.id);
        } catch {
          // Revert on failure
          setNotifications((prev) =>
            prev.map((n) =>
              n.id === notification.id ? { ...n, is_read: false } : n
            )
          );
          setUnreadCount((c) => c + 1);
        }
      }
      if (notification.link) {
        setIsOpen(false);
        router.push(notification.link);
      }
    },
    [router]
  );

  const handleMarkAllAsRead = useCallback(async () => {
    // Optimistic update
    const prevNotifications = notifications;
    const prevCount = unreadCount;
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnreadCount(0);
    try {
      await markAllAsRead();
    } catch {
      // Revert on failure
      setNotifications(prevNotifications);
      setUnreadCount(prevCount);
    }
  }, [notifications, unreadCount]);

  function handleToggleTheme() {
    const next = toggleTheme();
    setThemeState(next);
  }

  const displayName = user?.name ?? "ユーザー";
  const roleLabel =
    user?.role === "super_admin"
      ? "スーパー管理者"
      : user?.role === "admin"
        ? "税理士（管理者）"
        : user?.role === "staff"
          ? "税理士（スタッフ）"
          : companyName ?? "顧問先";

  const pageTitle = getPageTitle(pathname);

  return (
    <header className="sticky top-0 z-10 flex items-center justify-between bg-card/80 backdrop-blur-md border-b border-border px-4 py-3 sm:px-6 sm:py-4 lg:px-8">
      <div className="flex items-center gap-2 sm:gap-4 min-w-0">
        {/* モバイル用ハンバーガー（サイドバードロワーを開く） */}
        <button
          onClick={openNav}
          className="p-2 -ml-2 rounded-lg text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors lg:hidden"
          aria-label="メニューを開く"
        >
          <Menu className="size-5" />
        </button>
        <h2 className="text-foreground text-lg sm:text-xl font-bold tracking-tight truncate">
          {pageTitle}
        </h2>
      </div>
      <div className="flex items-center gap-2 sm:gap-6">
        {/* Action buttons */}
        <div className="flex gap-1 sm:gap-2">
          <button
            onClick={handleToggleTheme}
            className="p-2 rounded-lg bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors cursor-pointer"
            title={theme === "dark" ? "ライトモードに切り替え" : "ダークモードに切り替え"}
          >
            {theme === "dark" ? <Sun className="size-5" /> : <Moon className="size-5" />}
          </button>

          {/* Bell with notification panel */}
          <div className="relative" ref={panelRef}>
            <button
              onClick={handleToggleBell}
              className="relative p-2 rounded-lg bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors cursor-pointer"
            >
              <Bell className="size-5" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-bold px-1 leading-none">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </button>

            {isOpen && (
              <div className="absolute right-0 top-full mt-2 w-96 max-h-80 bg-card border border-border rounded-xl shadow-xl z-50 flex flex-col overflow-hidden">
                {/* Panel header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                  <span className="text-sm font-bold text-foreground">
                    お知らせ
                  </span>
                  {unreadCount > 0 && (
                    <button
                      onClick={handleMarkAllAsRead}
                      className="text-xs text-primary hover:text-primary-light transition-colors cursor-pointer"
                    >
                      すべて既読にする
                    </button>
                  )}
                </div>

                {/* Panel body */}
                <div className="overflow-y-auto flex-1">
                  {loading ? (
                    <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                      読み込み中...
                    </div>
                  ) : notifications.length === 0 ? (
                    <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                      お知らせはありません
                    </div>
                  ) : (
                    notifications.map((n) => (
                      <button
                        key={n.id}
                        onClick={() => handleMarkAsRead(n)}
                        className={`w-full text-left px-4 py-3 border-b border-border last:border-b-0 hover:bg-muted/30 transition-colors cursor-pointer ${
                          !n.is_read ? "bg-primary/5" : ""
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <span
                            className={`mt-1.5 shrink-0 size-2 rounded-full ${
                              !n.is_read ? "bg-primary" : "bg-transparent"
                            }`}
                          />
                          <div className="min-w-0 flex-1">
                            <p
                              className={`text-sm leading-snug ${
                                !n.is_read
                                  ? "font-bold text-foreground"
                                  : "text-foreground/80"
                              }`}
                            >
                              {n.title}
                            </p>
                            {n.body && (
                              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                                {n.body}
                              </p>
                            )}
                            <p className="text-[10px] text-muted-foreground mt-1">
                              {formatTimeAgo(n.created_at)}
                            </p>
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          <button className="p-2 rounded-lg bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors">
            <HelpCircle className="size-5" />
          </button>
        </div>

        <div className="hidden sm:block h-8 w-px bg-border mx-1" />

        {/* User profile */}
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex flex-col items-end">
            <span className="text-sm font-bold text-foreground leading-none">
              {displayName}
            </span>
            <span className="text-[10px] text-primary-light font-bold tracking-wider">
              {roleLabel}
            </span>
          </div>
          <div className="size-10 rounded-full border-2 border-primary-light/30 bg-primary/20 flex items-center justify-center text-cream text-sm font-bold">
            {getInitials(displayName)}
          </div>
        </div>
      </div>
    </header>
  );
}
