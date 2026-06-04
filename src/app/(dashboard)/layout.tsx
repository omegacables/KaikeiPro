import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { GlobalLoading } from "@/components/ui/global-loading";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen overflow-hidden">
      <GlobalLoading />
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-y-auto">
        <Header />
        <div className="p-8 max-w-7xl mx-auto w-full">{children}</div>
      </main>
    </div>
  );
}
