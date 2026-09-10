import { redirect } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { GlobalLoading } from "@/components/ui/global-loading";
import { MobileNavProvider } from "@/components/layout/mobile-nav";
import { createServerSupabaseClient } from "@/lib/supabase";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // 認証チェックのみ（未ログインはログインへ）。
  // データアクセスは各サーバーアクションの assertClientAccess / RLS で保護されるため、
  // ここでは画面のロール振り分け（ポータルへの自動リダイレクト）は行わない。
  // ※以前はロール別にポータルへ自動リダイレクトしていたが、client_user 登録の
  //   アカウントがダッシュボードを開けなくなる問題があったため撤去。
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  return (
    <MobileNavProvider>
      <div className="flex h-screen overflow-hidden">
        <GlobalLoading />
        <Sidebar />
        {/* 横方向は隠す。どこか1か所が幅を超えても、画面全体が横スクロールしないようにする */}
        <main className="flex-1 flex flex-col overflow-y-auto overflow-x-hidden min-w-0">
          <Header />
          <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full min-w-0">
            {children}
          </div>
        </main>
      </div>
    </MobileNavProvider>
  );
}
