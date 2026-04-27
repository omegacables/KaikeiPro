"use client";

import Link from "next/link";
import { usePathname, useParams } from "next/navigation";
import { Camera, History, MessageSquare, FileText, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/providers/auth-provider";
import { getInitials } from "@/lib/utils";

const navItems = [
  { key: "upload", label: "撮影", icon: Camera },
  { key: "receipts", label: "履歴", icon: History },
  { key: "questions", label: "質問", icon: MessageSquare },
  { key: "invoices", label: "請求書", icon: FileText },
  { key: "settings", label: "設定", icon: Settings },
];

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { firm } = useParams();
  const { user } = useAuth();

  // Don't show portal chrome on auth pages
  if (pathname.includes("/auth/")) {
    return <>{children}</>;
  }

  const displayName = user?.name ?? "ユーザー";

  return (
    <div className="flex flex-col min-h-screen max-w-md mx-auto bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-charcoal text-cream px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold">Raqto会計</h1>
          <p className="text-sage text-[10px]">顧問先ポータル</p>
        </div>
        <div className="size-8 rounded-full bg-primary/20 flex items-center justify-center text-cream text-xs font-bold">
          {getInitials(displayName)}
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 p-4 overflow-y-auto pb-20">
        {children}
      </main>

      {/* Bottom navigation */}
      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-card border-t border-border flex justify-around py-1.5 z-10">
        {navItems.map((item) => {
          const href = `/portal/${firm}/${item.key}`;
          const isActive = pathname === href;
          return (
            <Link
              key={item.key}
              href={href}
              className={cn(
                "relative flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg transition-colors min-w-[56px]",
                isActive
                  ? "text-primary"
                  : "text-muted-foreground active:text-foreground"
              )}
            >
              {isActive && (
                <span className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-5 h-0.5 rounded-full bg-primary" />
              )}
              <item.icon className={cn("size-5", isActive && "stroke-[2.5]")} />
              <span className={cn("text-[10px]", isActive ? "font-bold" : "font-medium")}>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
