"use client";

/**
 * 勘定科目ひとつ分の補助科目の設定（勘定科目管理で科目を開いたときに出す）。
 * 追加・名前の変更・有効/無効の切り替えと、取引先マスタからの一括作成ができる。
 */

import { useEffect, useState } from "react";
import { Plus, Loader2, Users, Check, X, Pen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PartnerInput, type PartnerSuggestion } from "@/components/ui/partner-input";
import { cn } from "@/lib/utils";
import {
  getSubAccounts,
  createSubAccount,
  updateSubAccount,
  createSubAccountsFromPartners,
  type SubAccount,
} from "@/actions/sub-accounts";

/** 相手先ごとに管理することが多い科目（取引先マスタからの一括作成を目立たせる） */
const PARTNER_ACCOUNT = /売掛金|買掛金|未払金|未収入金|前受金|前払金|前渡金|預り金|仮払金|仮受金|受取手形|支払手形|借入金|貸付金/;

export function SubAccountManager({
  clientId,
  account,
  partners,
  onCountChange,
}: {
  clientId: string;
  account: { id: string; name: string };
  partners: (PartnerSuggestion & { id: string })[];
  onCountChange?: (count: number) => void;
}) {
  const [subs, setSubs] = useState<SubAccount[] | null>(null);
  const [newName, setNewName] = useState("");
  const [newPartnerId, setNewPartnerId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);

  const load = async () => {
    const list = await getSubAccounts(clientId, { accountId: account.id, includeInactive: true });
    setSubs(list);
    onCountChange?.(list.filter((s) => s.isActive).length);
  };

  useEffect(() => {
    load().catch((e) => setMessage(e instanceof Error ? e.message : "読み込みに失敗しました"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, account.id]);

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
      await load();
      if (done) setMessage(done);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const add = () =>
    run(async () => {
      await createSubAccount(clientId, account.id, newName, newPartnerId);
      setNewName("");
      setNewPartnerId(null);
    });

  const fromPartners = () =>
    run(async () => {
      const r = await createSubAccountsFromPartners(clientId, account.id);
      setMessage(
        r.total === 0
          ? "取引先マスタに取引先がありません。"
          : r.created === 0
            ? "取引先マスタの取引先は、すべて補助科目になっています。"
            : `取引先マスタから${r.created}件の補助科目を作りました。`
      );
    });

  const suggestPartners = PARTNER_ACCOUNT.test(account.name);

  return (
    <div className="space-y-3 py-1">
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-72">
          <label className="block text-xs font-bold text-muted-foreground mb-1">
            「{account.name}」に補助科目を追加
          </label>
          <PartnerInput
            value={newName}
            partners={partners}
            showOnEmpty={suggestPartners}
            placeholder={suggestPartners ? "取引先名（候補から選べます）" : "例: 電気代、〇〇銀行 本店"}
            onChange={(t) => {
              setNewName(t);
              setNewPartnerId(null);
            }}
            onSelect={(p) => {
              setNewName(p.name);
              setNewPartnerId(p.id);
            }}
          />
        </div>
        <Button size="sm" onClick={add} disabled={busy || !newName.trim()}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          追加
        </Button>
        <Button
          size="sm"
          variant={suggestPartners ? "outline" : "ghost"}
          onClick={fromPartners}
          disabled={busy}
          title="取引先マスタの全取引先を、この科目の補助科目にします"
        >
          <Users className="size-4" />
          取引先マスタから一括作成
        </Button>
      </div>
      {message && <p className="text-xs text-info">{message}</p>}

      {subs === null ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          読み込み中...
        </div>
      ) : subs.length === 0 ? (
        <p className="text-xs text-muted-foreground">補助科目はまだありません。</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {subs.map((s) => (
            <li key={s.id} className={cn("flex items-center gap-3 px-3 py-1.5 text-sm", !s.isActive && "opacity-50")}>
              {editing?.id === s.id ? (
                <>
                  <input
                    autoFocus
                    value={editing.name}
                    onChange={(e) => setEditing({ id: s.id, name: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.nativeEvent.isComposing) return;
                      if (e.key === "Enter") run(() => updateSubAccount(s.id, { name: editing.name })).then(() => setEditing(null));
                      if (e.key === "Escape") setEditing(null);
                    }}
                    className="flex-1 px-2 py-1 rounded border border-border bg-card text-sm"
                  />
                  <button
                    type="button"
                    title="保存"
                    onClick={() => run(() => updateSubAccount(s.id, { name: editing.name })).then(() => setEditing(null))}
                    className="p-1 text-success"
                  >
                    <Check className="size-4" />
                  </button>
                  <button type="button" title="やめる" onClick={() => setEditing(null)} className="p-1 text-muted-foreground">
                    <X className="size-4" />
                  </button>
                </>
              ) : (
                <>
                  <span className="flex-1">{s.name}</span>
                  {s.partnerId && <span className="text-[11px] text-muted-foreground">取引先マスタ</span>}
                  <button
                    type="button"
                    title="名前を変える"
                    onClick={() => setEditing({ id: s.id, name: s.name })}
                    className="p-1 text-muted-foreground hover:text-foreground"
                  >
                    <Pen className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => run(() => updateSubAccount(s.id, { isActive: !s.isActive }))}
                    disabled={busy}
                    className={cn(
                      "text-xs px-2 py-0.5 rounded-full border",
                      s.isActive ? "text-success border-success/30" : "text-muted-foreground border-border"
                    )}
                    title="クリックで有効/無効を切り替え（無効にしても過去の仕訳はそのままです）"
                  >
                    {s.isActive ? "有効" : "無効"}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
