"use client";

import { useState, useEffect, useRef } from "react";
import { Sun, Moon, Menu, MessageSquare, Building2, ChevronDown } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/providers/auth-provider";
import { useMobileNav } from "@/components/layout/mobile-nav";
import { cn, getInitials } from "@/lib/utils";
import { getTheme, toggleTheme, type Theme } from "@/lib/theme";
import { getClient } from "@/actions/clients";
import { loadClients } from "@/lib/client-cache";

const pageTitles: Record<string, string> = {
  "/dashboard": "ダッシュボード",
  "/clients": "顧問先管理",
  "/firms": "税理士事務所管理",
  "/settings": "マイアカウント",
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
  "closing-checklist": "決算前チェック",
  payroll: "給与台帳",
  loans: "借入金台帳",
  "opening-balances": "期首残高設定",
  "company-documents": "会社書類",
  invoices: "請求書管理",
  payments: "入金消込",
  "bank-transactions": "口座取引",
  "card-transactions": "カード取引",
  partners: "取引先管理",
  questions: "質問管理",
  audit: "監査ログ",
  settings: "設定",
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
  const { user, rawUser } = useAuth();
  const { openNav } = useMobileNav();
  const [theme, setThemeState] = useState<Theme>("light");
  const [companyName, setCompanyName] = useState<string | null>(null);

  // 今どの顧問先を見ているか。ヘッダーは常に表示されるので、ここに出しておく
  const [activeClientName, setActiveClientName] = useState<string | null>(null);
  const [clientList, setClientList] = useState<{ id: string; name: string }[]>([]);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);

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

  // 切り替え先の一覧。顧問先ユーザーは自社しか見られないので読まない。
  // 一覧はキャッシュされ、サイドバーと共有される
  useEffect(() => {
    if (user?.role === "client") return;
    loadClients().then(setClientList);
  }, [user?.role]);

  // 今の顧問先の名前。一覧に載っていればそこから引き、サーバーへ行かない。
  // pathname ではなく顧問先IDに反応させる（画面を移るたびに読み直さない）
  const activeClientId = pathname.match(/^\/clients\/([^/]+)/)?.[1] ?? null;
  useEffect(() => {
    if (!activeClientId || activeClientId === "new") {
      setActiveClientName(null);
      return;
    }
    const hit = clientList.find((c) => c.id === activeClientId);
    if (hit) {
      setActiveClientName(hit.name);
      return;
    }
    // 一覧に無い場合だけ問い合わせる（権限の広いユーザーが他事務所の顧問先を開いたときなど）
    let cancelled = false;
    getClient(activeClientId)
      .then((c) => !cancelled && setActiveClientName(c.name))
      .catch(() => !cancelled && setActiveClientName(null));
    return () => {
      cancelled = true;
    };
  }, [activeClientId, clientList]);

  // 切り替えメニューの外側を押したら閉じる
  useEffect(() => {
    if (!switcherOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!switcherRef.current?.contains(e.target as Node)) setSwitcherOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [switcherOpen]);

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
  const avatarUrl =
    (rawUser?.user_metadata?.avatar_url as string | undefined) || null;

  // 現在の顧問先ID（チャット=質問管理への導線に使用）
  const clientMatch = pathname.match(/^\/clients\/([^/]+)/);
  const currentClientId = clientMatch ? clientMatch[1] : null;

  return (
    <header className="sticky top-0 z-10 bg-card/80 backdrop-blur-md border-b border-border px-4 py-3 sm:px-6 sm:py-4 lg:px-8">
      {/* ページ本体と同じ幅・同じ中央寄せにする。
          ヘッダーだけ画面幅いっぱいだと、広い画面で右端がそろわない */}
      <div className="flex items-center justify-between gap-2 max-w-7xl mx-auto w-full min-w-0">
      <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-1">
        {/* モバイル用ハンバーガー（サイドバードロワーを開く） */}
        <button
          onClick={openNav}
          className="p-2 -ml-2 rounded-lg text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors lg:hidden"
          aria-label="メニューを開く"
        >
          <Menu className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          {/* 顧問先名を画面名の上に出す。どの会社を触っているかを取り違えると
              入力先そのものを間違えるため、常に見える場所に置く */}
          {activeClientName && (
            <div className="relative" ref={switcherRef}>
              <button
                onClick={() => clientList.length > 1 && setSwitcherOpen((v) => !v)}
                className={cn(
                  // 顧問先名は取り違えると入力先を間違えるので、本文と同じ濃さで出す。
                  // primary の緑はライトモード向けの濃さで、暗い背景では 2.36:1 しかなく読めない
                  "flex items-center gap-1.5 rounded px-1 -ml-1 text-[16px] font-bold text-foreground",
                  clientList.length > 1 && "hover:bg-muted/50 cursor-pointer"
                )}
                title={clientList.length > 1 ? "顧問先を切り替える" : undefined}
              >
                <Building2 className="size-4 shrink-0 text-primary-light" />
                {/* 名前は省略せず全部出す（末尾が切れると別会社と紛らわしい）。
                    ただし1行に固定するとヘッダーが画面幅を超え、ページ全体が
                    横スクロールしてしまうため、長いときは折り返す */}
                <span className="text-left leading-tight break-words">{activeClientName}</span>
                {clientList.length > 1 && (
                  <ChevronDown
                    className={cn("size-4 shrink-0 transition-transform", switcherOpen && "rotate-180")}
                  />
                )}
              </button>

              {switcherOpen && (
                <div className="absolute left-0 top-full mt-1 z-50 min-w-56 max-h-72 overflow-y-auto rounded-lg border border-border bg-card shadow-lg">
                  <p className="px-3 py-2 text-[13px] font-bold text-muted-foreground border-b border-border">
                    顧問先を切り替える
                  </p>
                  {clientList.map((c) => {
                    const active = pathname.startsWith(`/clients/${c.id}`);
                    return (
                      <button
                        key={c.id}
                        onClick={() => {
                          setSwitcherOpen(false);
                          // 同じ画面のまま相手先だけ入れ替える（借入金台帳→借入金台帳）
                          const sub = pathname.match(/^\/clients\/[^/]+(\/.*)?$/)?.[1] ?? "";
                          router.push(`/clients/${c.id}${sub}`);
                        }}
                        className={cn(
                          "w-full text-left px-3 py-2 text-[15px] transition-colors",
                          active
                            ? "bg-primary/10 text-primary font-semibold"
                            : "text-foreground hover:bg-muted/50"
                        )}
                      >
                        {c.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          <h2 className="text-foreground text-lg sm:text-xl font-bold tracking-tight truncate">
            {pageTitle}
          </h2>
        </div>
      </div>
      <div className="flex items-center gap-2 sm:gap-6">
        {/* Action buttons */}
        <div className="flex gap-1 sm:gap-2">
          {/* チャット（質問管理）: 顧問先を開いているときのみ */}
          {currentClientId && (
            <button
              onClick={() => router.push(`/clients/${currentClientId}/questions`)}
              className="p-2 rounded-lg bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors cursor-pointer"
              title="質問・チャット"
            >
              <MessageSquare className="size-5" />
            </button>
          )}
          <button
            onClick={handleToggleTheme}
            className="p-2 rounded-lg bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors cursor-pointer"
            title={theme === "dark" ? "ライトモードに切り替え" : "ダークモードに切り替え"}
          >
            {theme === "dark" ? <Sun className="size-5" /> : <Moon className="size-5" />}
          </button>
        </div>

        <div className="hidden sm:block h-8 w-px bg-border mx-1" />

        {/* User profile（クリックでマイアカウントへ。左にアイコン、右に名前・会社名） */}
        <button
          onClick={() => router.push("/settings")}
          title="マイアカウント"
          className="flex items-center gap-3 rounded-lg px-1 py-1 -my-1 hover:bg-muted/40 transition-colors cursor-pointer"
        >
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl}
              alt={displayName}
              className="size-10 rounded-full border-2 border-primary-light/30 object-cover shrink-0"
            />
          ) : (
            <div className="size-10 rounded-full border-2 border-primary-light/30 bg-primary/20 flex items-center justify-center text-cream text-sm font-bold shrink-0">
              {getInitials(displayName)}
            </div>
          )}
          <div className="hidden sm:flex flex-col items-start text-left">
            <span className="text-sm font-bold text-foreground leading-none">
              {displayName}
            </span>
            <span className="text-[10px] text-primary-light font-bold tracking-wider mt-1">
              {roleLabel}
            </span>
          </div>
        </button>
      </div>
      </div>
    </header>
  );
}
