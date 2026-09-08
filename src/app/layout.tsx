import type { Metadata } from "next";
import { AuthProvider } from "@/components/providers/auth-provider";
import { NumberInputGuard } from "@/components/providers/number-input-guard";
import "./globals.css";

export const metadata: Metadata = {
  title: "Raqto会計 - AIバージョン",
  description: "税理士事務所と顧問先をつなぐクラウド会計システム",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var t=localStorage.getItem('raqto_theme');if(t==='dark'||((!t)&&matchMedia('(prefers-color-scheme:dark)').matches))document.documentElement.setAttribute('data-theme','dark')})()`,
          }}
        />
      </head>
      <body className="antialiased" suppressHydrationWarning>
        <NumberInputGuard />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
