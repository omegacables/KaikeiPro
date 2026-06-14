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
  // サーバー側のロールゲート（多層防御）。
  // データアクセス自体は各サーバーアクションの assertClientAccess / RLS で保護済みだが、
  // 「事務所管理下の顧問先ポータル専用ユーザー」が税理士アプリ(/dashboard)の画面を
  // 開かないようにポータルへ誘導する。
  // 注意: セルフサービス利用者（firm_id=NULL のクライアントに紐づく client_user）は
  // ダッシュボードを正規に利用するため、リダイレクト対象から除外する。
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const [{ data: superAdmin }, { data: member }] = await Promise.all([
    supabase
      .from("super_admins")
      .select("id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle(),
    supabase
      .from("firm_members")
      .select("id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle(),
  ]);

  if (!superAdmin && !member) {
    const { data: clientUser } = await supabase
      .from("client_users")
      .select("client_id")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();
    if (clientUser?.client_id) {
      const { data: client } = await supabase
        .from("clients")
        .select("firm_id")
        .eq("id", clientUser.client_id)
        .maybeSingle();
      // 事務所管理下（firm_id あり）の顧問先ユーザーはポータルへ誘導。
      // セルフサービス（firm_id=NULL）はダッシュボードを正規利用するため除外。
      if (client?.firm_id) {
        redirect(`/portal/${client.firm_id}/receipts`);
      }
    }
    // 未割当 / セルフサービスはそのまま表示（データは RLS でスコープされる）。
  }

  return (
    <MobileNavProvider>
      <div className="flex h-screen overflow-hidden">
        <GlobalLoading />
        <Sidebar />
        <main className="flex-1 flex flex-col overflow-y-auto">
          <Header />
          <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full">
            {children}
          </div>
        </main>
      </div>
    </MobileNavProvider>
  );
}
