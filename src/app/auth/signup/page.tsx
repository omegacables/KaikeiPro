"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { Building2, Loader2 } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase-browser";
import { setupSelfServiceAccount } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function SignupPage() {
  const router = useRouter();
  const [companyName, setCompanyName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("パスワードが一致しません");
      return;
    }

    if (password.length < 6) {
      setError("パスワードは6文字以上にしてください");
      return;
    }

    setLoading(true);

    try {
      const supabase = createBrowserClient();

      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { name },
        },
      });

      if (signUpError) {
        setError(
          signUpError.message === "User already registered"
            ? "このメールアドレスは既に登録されています"
            : signUpError.message
        );
        setLoading(false);
        return;
      }

      await setupSelfServiceAccount(name, companyName);

      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "アカウントの作成に失敗しました"
      );
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md p-8">
        <div className="flex flex-col items-center mb-8">
          <div className="bg-primary/10 rounded-full size-14 flex items-center justify-center mb-4">
            <Building2 className="size-7 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Raqto会計</h1>
          <p className="text-muted-foreground text-sm mt-1">
            新規アカウント登録
          </p>
        </div>

        <form onSubmit={handleSignup} className="flex flex-col gap-4">
          <div>
            <label
              htmlFor="companyName"
              className="block text-sm font-medium text-foreground mb-1.5"
            >
              会社名 / 事業者名
            </label>
            <input
              id="companyName"
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              required
              className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted-foreground"
              placeholder="株式会社サンプル"
            />
          </div>

          <div>
            <label
              htmlFor="name"
              className="block text-sm font-medium text-foreground mb-1.5"
            >
              名前
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted-foreground"
            />
          </div>

          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-foreground mb-1.5"
            >
              メールアドレス
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted-foreground"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-foreground mb-1.5"
            >
              パスワード
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted-foreground"
              placeholder="••••••••"
            />
          </div>

          <div>
            <label
              htmlFor="confirmPassword"
              className="block text-sm font-medium text-foreground mb-1.5"
            >
              パスワード確認
            </label>
            <input
              id="confirmPassword"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={6}
              className="w-full bg-background border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-muted-foreground"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-destructive text-sm bg-destructive/10 rounded-lg px-4 py-2">
              {error}
            </p>
          )}

          <Button type="submit" disabled={loading} className="w-full mt-2">
            {loading ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                登録中...
              </>
            ) : (
              "新規登録"
            )}
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground mt-6">
          既にアカウントをお持ちの方は{" "}
          <Link href="/auth/login" className="text-primary hover:underline font-medium">
            ログインはこちら
          </Link>
        </p>
      </Card>
    </div>
  );
}
