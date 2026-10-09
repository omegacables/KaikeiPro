"use client";

/**
 * メンバーと権限（顧問先ごと）。
 *   - 担当の税理士・スタッフ: 社長がアクセスを止められる（交代したときなど）
 *   - 顧問先のユーザー: 社長・社員・閲覧専用の役割、停止、追加
 */

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Users, Loader2, Ban, RotateCcw, UserPlus, ShieldCheck, Eye } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn, formatDate } from "@/lib/utils";
import {
  getClientMembers,
  setFirmMemberBlocked,
  updateClientUserAccess,
  createClientUser,
  type ClientMembers,
} from "@/actions/members";

const FIRM_ROLE: Record<string, string> = { admin: "税理士（管理者）", staff: "スタッフ", viewer: "閲覧専用" };
const CLIENT_ROLE: Record<string, string> = { owner: "社長", member: "社員", viewer: "閲覧専用" };

const fieldCls = "w-full px-2 py-1.5 rounded-lg border border-border bg-card text-foreground text-sm";

export function MembersSettingsContent() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<ClientMembers | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "viewer" as "owner" | "member" | "viewer" });

  const load = useCallback(() => {
    getClientMembers(id)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "読み込みに失敗しました"));
  }, [id]);
  useEffect(load, [load]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setBusy(null);
    }
  };

  if (!data) {
    return error ? (
      <p className="text-sm text-destructive">{error}</p>
    ) : (
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <Loader2 className="size-4 animate-spin" />
        読み込み中...
      </div>
    );
  }

  const me = data.me;
  const canManageUsers = me.isOwner || (me.kind === "firm" && me.canWrite);

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center gap-2 text-sm">
        <ShieldCheck className="size-4 text-primary" />
        あなたの役割:
        <Badge variant={me.canWrite ? "default" : "warning"}>
          {me.kind === "super_admin"
            ? "システム管理者"
            : me.kind === "firm"
              ? FIRM_ROLE[me.role] ?? me.role
              : CLIENT_ROLE[me.role] ?? me.role}
        </Badge>
        {!me.canWrite && <span className="text-muted-foreground">（閲覧のみ。入力・修正はできません）</span>}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* 担当の税理士・スタッフ */}
      <Card className="p-4 space-y-3">
        <div>
          <h3 className="font-bold flex items-center gap-2">
            <Users className="size-4 text-primary" />
            担当の税理士・スタッフ
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            税理士やスタッフが交代したときは、社長がここで「アクセスを止める」と、その人はこの会社のデータを見ることも変えることもできなくなります。
          </p>
        </div>
        {data.firmMembers.length === 0 ? (
          <p className="text-sm text-muted-foreground">担当の事務所のメンバーはいません。</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {data.firmMembers.map((m) => (
              <li key={m.userId} className={cn("flex flex-wrap items-center gap-3 px-3 py-2 text-sm", m.blocked && "bg-destructive/5")}>
                <span className="font-medium">{m.name || m.email}</span>
                <span className="text-xs text-muted-foreground">{m.email}</span>
                <Badge variant="muted">{FIRM_ROLE[m.role] ?? m.role}</Badge>
                {m.blocked && (
                  <Badge variant="destructive">
                    アクセス停止中{m.blockedAt ? `（${formatDate(m.blockedAt)}〜）` : ""}
                  </Badge>
                )}
                <span className="ml-auto">
                  {me.isOwner &&
                    (m.blocked ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === m.userId}
                        onClick={() => run(m.userId, () => setFirmMemberBlocked(id, m.userId, false))}
                      >
                        <RotateCcw className="size-3.5" />
                        アクセスを戻す
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive border-destructive/30"
                        disabled={busy === m.userId}
                        onClick={() => {
                          const reason = prompt(`${m.name || m.email} のアクセスを止めます。理由（任意）:`, "担当の交代");
                          if (reason === null) return;
                          run(m.userId, () => setFirmMemberBlocked(id, m.userId, true, reason));
                        }}
                      >
                        <Ban className="size-3.5" />
                        アクセスを止める
                      </Button>
                    ))}
                </span>
              </li>
            ))}
          </ul>
        )}
        {!me.isOwner && <p className="text-xs text-muted-foreground">アクセスを止められるのは、この会社の社長だけです。</p>}
      </Card>

      {/* 顧問先のユーザー */}
      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-bold flex items-center gap-2">
              <Eye className="size-4 text-primary" />
              会社のユーザー
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              社長・社員は入力や修正ができます。閲覧専用は見るだけで、入力・修正・削除は一切できません。
            </p>
          </div>
          {canManageUsers && (
            <Button size="sm" variant="outline" onClick={() => setAdding((v) => !v)}>
              <UserPlus className="size-4" />
              ユーザーを追加
            </Button>
          )}
        </div>

        {adding && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2 rounded-lg border border-border p-3">
            <input placeholder="名前" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={fieldCls} />
            <input placeholder="メールアドレス" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={fieldCls} />
            <input
              type="password"
              placeholder="初期パスワード（8文字以上）"
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className={fieldCls}
            />
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as typeof form.role })} className={fieldCls}>
              <option value="viewer">閲覧専用</option>
              <option value="member">社員</option>
              {(me.isOwner || me.kind !== "client") && <option value="owner">社長</option>}
            </select>
            <div className="md:col-span-4 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
                やめる
              </Button>
              <Button
                size="sm"
                disabled={busy === "add" || !form.name.trim() || !form.email.trim() || form.password.length < 8}
                onClick={() =>
                  run("add", async () => {
                    await createClientUser(id, form);
                    setAdding(false);
                    setForm({ name: "", email: "", password: "", role: "viewer" });
                  })
                }
              >
                {busy === "add" && <Loader2 className="size-4 animate-spin" />}
                追加する
              </Button>
            </div>
          </div>
        )}

        {data.clientUsers.length === 0 ? (
          <p className="text-sm text-muted-foreground">会社のユーザーはいません。</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {data.clientUsers.map((u) => {
              const lockOwner = u.role === "owner" && !me.isOwner;
              return (
                <li key={u.id} className={cn("flex flex-wrap items-center gap-3 px-3 py-2 text-sm", !u.isActive && "opacity-50")}>
                  <span className="font-medium">{u.name || u.email}</span>
                  <span className="text-xs text-muted-foreground">{u.email}</span>
                  <span className="ml-auto flex items-center gap-2">
                    <select
                      value={u.role}
                      disabled={!canManageUsers || lockOwner || busy === u.id}
                      onChange={(e) =>
                        run(u.id, () => updateClientUserAccess(id, u.id, { role: e.target.value as "owner" | "member" | "viewer" }))
                      }
                      className="px-2 py-1 rounded border border-border bg-card text-xs"
                      aria-label="役割"
                    >
                      <option value="owner" disabled={!me.isOwner}>
                        社長
                      </option>
                      <option value="member">社員</option>
                      <option value="viewer">閲覧専用</option>
                    </select>
                    <button
                      disabled={!canManageUsers || lockOwner || busy === u.id}
                      onClick={() => run(u.id, () => updateClientUserAccess(id, u.id, { isActive: !u.isActive }))}
                      className={cn(
                        "text-xs px-2 py-0.5 rounded-full border disabled:opacity-50",
                        u.isActive ? "text-success border-success/30" : "text-muted-foreground border-border"
                      )}
                      title={u.isActive ? "クリックでログインを止める" : "クリックでログインを再開する"}
                    >
                      {u.isActive ? "有効" : "停止中"}
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
