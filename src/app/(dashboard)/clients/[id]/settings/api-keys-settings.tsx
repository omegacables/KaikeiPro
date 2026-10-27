"use client";

/**
 * 外部連携（APIキー）。社内の自動仕訳などから、仕訳と証憑をこの会社へ送るためのキー。
 *   - 発行したキーはそのときだけ表示する（閉じたら二度と見られない）
 *   - 発行・無効化はその会社の管理者（社長）と事務所の管理者だけ
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { KeyRound, Loader2, Plus, Ban, Copy, Check, TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { createApiKey, listApiKeys, revokeApiKey, type ApiKeyList } from "@/actions/api-keys";

const fieldCls = "w-full px-2 py-1.5 rounded-lg border border-border bg-card text-foreground text-sm";

export function ApiKeysSettingsContent() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<ApiKeyList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ name: string; key: string } | null>(null);
  const [copied, setCopied] = useState(false);
  // 連打で二重に発行しないよう、state の反映を待たずに止める
  const lock = useRef(false);

  const load = useCallback(() => {
    listApiKeys(id)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "読み込みに失敗しました"));
  }, [id]);
  useEffect(load, [load]);

  const issue = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy("issue");
    setError(null);
    try {
      const r = await createApiKey(id, name);
      setIssued({ name: r.item.name, key: r.key });
      setCopied(false);
      setName("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "発行に失敗しました");
    } finally {
      setBusy(null);
      lock.current = false;
    }
  };

  const revoke = async (keyId: string, keyName: string) => {
    if (!window.confirm(`「${keyName}」を無効にします。このキーでは送れなくなり、元に戻せません。よろしいですか？`)) return;
    setBusy(keyId);
    setError(null);
    try {
      await revokeApiKey(id, keyId);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "無効にできませんでした");
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.key);
      setCopied(true);
    } catch {
      setError("コピーできませんでした。キーを選んで手でコピーしてください");
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

  const active = data.keys.filter((k) => !k.revokedAt);
  const revoked = data.keys.filter((k) => k.revokedAt);

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-start gap-2 rounded-lg border border-info/30 bg-info/10 px-4 py-3 text-sm text-info">
        <KeyRound className="size-4 mt-0.5 shrink-0" />
        <div>
          社内の自動仕訳などのシステムから、<strong>仕訳と証憑をこの会社へ送る</strong>ためのキーです。
          送られた仕訳は<strong>確定済み</strong>で登録されます（締めた年度には入りません）。
          キーは会社ごとに効き、キーを発行した人として書き込まれます。漏れたと思ったらすぐ無効にして発行し直してください。
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {issued && (
        <Card className="p-4 border-warning/50 bg-warning/5">
          <div className="flex items-start gap-2 text-sm font-bold text-warning">
            <TriangleAlert className="size-4 mt-0.5 shrink-0" />
            「{issued.name}」のキーです。この画面を閉じると二度と表示できません。今すぐ送る側に登録してください。
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-md border border-border bg-card px-3 py-2 text-sm select-all">
              {issued.key}
            </code>
            <Button size="sm" variant="outline" onClick={copy}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? "コピーしました" : "コピー"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setIssued(null)}>
              登録したので閉じる
            </Button>
          </div>
        </Card>
      )}

      {data.canManage ? (
        <Card className="p-4">
          <div className="font-bold text-sm mb-2">キーを発行する</div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className={`${fieldCls} max-w-sm`}
              placeholder="名前（例: 自動仕訳のMac）"
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && name.trim()) issue();
              }}
            />
            <Button size="sm" onClick={issue} disabled={!name.trim() || busy === "issue"}>
              {busy === "issue" ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              発行
            </Button>
          </div>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground">
          キーの発行・無効化は、会社の管理者（社長）と事務所の管理者だけができます。
        </p>
      )}

      <Card className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-4 py-2 font-bold">名前</th>
              <th className="px-4 py-2 font-bold">キーの先頭</th>
              <th className="px-4 py-2 font-bold">発行日</th>
              <th className="px-4 py-2 font-bold">最終利用</th>
              <th className="px-4 py-2 font-bold">状態</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {data.keys.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                  発行したキーはありません
                </td>
              </tr>
            )}
            {[...active, ...revoked].map((k) => (
              <tr key={k.id} className="border-b border-border last:border-0">
                <td className="px-4 py-2 font-bold">{k.name}</td>
                <td className="px-4 py-2">
                  <code>{k.keyPrefix}…</code>
                </td>
                <td className="px-4 py-2 whitespace-nowrap">{formatDate(k.createdAt)}</td>
                <td className="px-4 py-2 whitespace-nowrap">{k.lastUsedAt ? formatDate(k.lastUsedAt) : "まだ使われていません"}</td>
                <td className="px-4 py-2 whitespace-nowrap">
                  {k.revokedAt ? (
                    <Badge variant="muted">無効（{formatDate(k.revokedAt)}）</Badge>
                  ) : (
                    <Badge variant="success">有効</Badge>
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  {data.canManage && !k.revokedAt && (
                    <Button size="sm" variant="outline" onClick={() => revoke(k.id, k.name)} disabled={busy === k.id}>
                      {busy === k.id ? <Loader2 className="size-4 animate-spin" /> : <Ban className="size-4" />}
                      無効にする
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
