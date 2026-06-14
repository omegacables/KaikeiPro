"use client";

// ダッシュボード(税理士アプリ)の外枠。
// PC幅では従来どおりサイドバー/ヘッダー付きで表示。
// スマホ幅(<768px)ではレイアウト崩れを避けるため、撮影専用の最小画面に切り替える。

import { useEffect, useState } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { GlobalLoading } from "@/components/ui/global-loading";
import { MobileNavProvider } from "@/components/layout/mobile-nav";
import { MobileCaptureScreen } from "@/components/capture/mobile-capture-screen";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [isMobile, setIsMobile] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // スマホ幅: 撮影専用画面（最低限の機能のみ）
  if (mounted && isMobile) {
    return <MobileCaptureScreen />;
  }

  // PC幅: 通常のダッシュボード
  return (
    <MobileNavProvider>
      <div className="flex h-screen overflow-hidden">
        <GlobalLoading />
        <Sidebar />
        <main className="flex-1 flex flex-col overflow-y-auto">
          <Header />
          <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full">{children}</div>
        </main>
      </div>
    </MobileNavProvider>
  );
}
