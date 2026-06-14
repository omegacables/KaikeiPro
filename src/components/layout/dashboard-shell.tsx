"use client";

// ダッシュボード(税理士アプリ)の外枠。
// PCでは従来どおりサイドバー/ヘッダー付きで表示する。
// 「実機スマホ」だけ撮影専用の最小画面に切り替える。
//
// スマホ判定はユーザーエージェント（Android/iPhone等のモバイル端末）を主とする。
// 画面幅や表示倍率だけで判定すると、ウィンドウが狭いPCやタッチ対応PCまで
// 撮影画面になってしまうため、UAベースに変更（PCは常に通常画面）。
// 万一誤判定しても「PC版を表示」で通常画面に切り替えられる。

import { useEffect, useState } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { GlobalLoading } from "@/components/ui/global-loading";
import { MobileNavProvider } from "@/components/layout/mobile-nav";
import { MobileCaptureScreen } from "@/components/capture/mobile-capture-screen";

const FORCE_DESKTOP_KEY = "kaikei_force_desktop";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [isPhone, setIsPhone] = useState(false);
  const [forceDesktop, setForceDesktop] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);

    // ユーザーが「PC版を表示」を選んでいれば常に通常画面
    try {
      if (localStorage.getItem(FORCE_DESKTOP_KEY) === "1") setForceDesktop(true);
    } catch { /* ignore */ }

    // モバイル端末の判定はUAを主に使う（PCは常にデスクトップUA → 通常画面）。
    const ua = navigator.userAgent || "";
    const isMobileUA = /Android|webOS|iPhone|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua);
    // iPad含むタブレットはPC扱い（画面が広く通常画面で問題ないため）。

    const mq = window.matchMedia("(max-width: 820px)");
    const update = () => setIsPhone(isMobileUA && mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const useDesktop = () => {
    try {
      localStorage.setItem(FORCE_DESKTOP_KEY, "1");
    } catch { /* ignore */ }
    setForceDesktop(true);
  };

  // 実機スマホ（かつPC版が選ばれていない）: 撮影専用画面
  if (mounted && isPhone && !forceDesktop) {
    return <MobileCaptureScreen onUseDesktop={useDesktop} />;
  }

  // PC（および「PC版を表示」選択時）: 通常のダッシュボード
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
