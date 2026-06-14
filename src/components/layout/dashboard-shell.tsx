"use client";

// ダッシュボード(税理士アプリ)の外枠。
// PCでは従来どおりサイドバー/ヘッダー付きで表示。
// 実機スマホ（タッチ操作=primary pointer が coarse、かつ狭い画面）でのみ、
// レイアウト崩れを避けるため撮影専用の最小画面に切り替える。
// ※ マウス操作のPCは、ウィンドウ幅や表示倍率に関わらず常に通常画面（pointer:fine のため）。

import { useEffect, useState } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { GlobalLoading } from "@/components/ui/global-loading";
import { MobileNavProvider } from "@/components/layout/mobile-nav";
import { MobileCaptureScreen } from "@/components/capture/mobile-capture-screen";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [isPhone, setIsPhone] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // タッチが主入力(coarse)かつ狭い画面のときだけスマホ扱い。
    // PC（マウス/トラックパッド = fine）は幅に関係なく通常画面のまま。
    const mq = window.matchMedia("(max-width: 820px) and (pointer: coarse)");
    const update = () => setIsPhone(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // 実機スマホ: 撮影専用画面（最低限の機能のみ）
  if (mounted && isPhone) {
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
