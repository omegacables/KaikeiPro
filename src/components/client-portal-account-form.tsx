"use client";

import { useState } from "react";
import { UserPlus, Loader2, Eye, EyeOff } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { createClientPortalAccount } from "@/actions/auth";

export function ClientPortalAccountForm({ clientId }: { clientId: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password.length < 6) {
      setError("パスワードは6文字以上にしてください");
      return;
    }

    setLoading(true);
    try {
      await createClientPortalAccount({ clientId, name, email, password });
      setSuccess(true);
      setName("");
      setEmail("");
      setPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "作成に失敗しました");
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <Card className="border-success/50 bg-success/5">
        <CardContent className="p-4">
          <p className="text-success font-bold text-sm">
            ポータルアカウントを作成しました
          </p>
          <p className="text-muted-foreground text-xs mt-1">
            顧問先にログイン情報を共有してください。
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2"
            onClick={() => {
              setSuccess(false);
              setOpen(false);
            }}
          >
            閉じる
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!open) {
    return (
      <Card className="border-dashed border-primary/30 hover:border-primary/60 transition-colors">
        <CardContent className="p-4">
          <button
            onClick={() => setOpen(true)}
            className="flex items-center gap-3 w-full text-left cursor-pointer"
          >
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <UserPlus className="size-5" />
            </div>
            <div>
              <p className="font-bold text-foreground text-sm">
                ポータルアカウント作成
              </p>
              <p className="text-muted-foreground text-xs">
                顧問先がポータルにログインするためのアカウントを作成します
              </p>
            </div>
          </button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <UserPlus className="size-4 text-primary" />
          ポータルアカウント作成
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              名前
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              メールアドレス
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="client@example.com"
              className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              パスワード
            </label>
            <div className="flex items-center gap-2">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                placeholder="6文字以上"
                className="flex-1 bg-card border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </Button>
            </div>
          </div>

          {error && (
            <p className="text-destructive text-xs bg-destructive/10 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-2 justify-end pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setOpen(false)}
            >
              キャンセル
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={loading || !name || !email || !password}
            >
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  作成中...
                </>
              ) : (
                "アカウント作成"
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
