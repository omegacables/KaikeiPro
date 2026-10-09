"use client";

/**
 * AIに渡す情報の設定（顧問先ごと）。
 * 会社情報・個人情報を、AIの読み取りや仕訳の提案に添えるかを選ぶ。
 */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Bot, Loader2, Building2, UserRound } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { getClient, updateClient } from "@/actions/clients";

type Flags = { ai_share_company_info: boolean; ai_share_personal_info: boolean };

const ITEMS: { key: keyof Flags; title: string; icon: typeof Bot; what: string; effect: string }[] = [
  {
    key: "ai_share_company_info",
    title: "会社情報",
    icon: Building2,
    what: "自社名、取引先マスタの名前、業種",
    effect: "渡さないと、証憑が「自社発行か受領か」の判定や、取引先の当てはめの精度が下がることがあります。",
  },
  {
    key: "ai_share_personal_info",
    title: "個人情報",
    icon: UserRound,
    what: "役員・従業員の氏名、役員報酬の額",
    effect: "渡さないと、通帳の振込を役員借入金・役員報酬と見分ける精度が下がることがあります。",
  },
];

export function AiSettingsContent() {
  const { id } = useParams<{ id: string }>();
  const [flags, setFlags] = useState<Flags | null>(null);
  const [saving, setSaving] = useState<keyof Flags | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getClient(id)
      .then((c) => {
        const row = c as Partial<Flags>;
        setFlags({
          ai_share_company_info: row.ai_share_company_info ?? true,
          ai_share_personal_info: row.ai_share_personal_info ?? true,
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : "読み込みに失敗しました"));
  }, [id]);

  const toggle = async (key: keyof Flags) => {
    if (!flags) return;
    const next = { ...flags, [key]: !flags[key] };
    setFlags(next);
    setSaving(key);
    setError(null);
    try {
      await updateClient(id, { [key]: next[key] });
    } catch (e) {
      setFlags(flags);
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-start gap-2 rounded-lg border border-info/30 bg-info/10 px-4 py-3 text-sm text-info">
        <Bot className="size-4 mt-0.5 shrink-0" />
        <div>
          証憑の読み取りや仕訳の提案にAI（Google Gemini）を使っています。証憑の画像や銀行明細そのものは、
          読み取りのためにAIへ送ります。ここで選べるのは、精度を上げるためにAIへの指示に<strong>追加で添えている情報</strong>です。
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!flags ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="size-4 animate-spin" />
          読み込み中...
        </div>
      ) : (
        ITEMS.map((it) => {
          const on = flags[it.key];
          return (
            <Card key={it.key} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <it.icon className="size-5 text-primary mt-0.5" />
                  <div>
                    <div className="font-bold">{it.title}をAIに渡す</div>
                    <div className="text-sm text-muted-foreground mt-1">対象: {it.what}</div>
                    <div className="text-xs text-muted-foreground mt-1">{it.effect}</div>
                  </div>
                </div>
                <button
                  role="switch"
                  aria-checked={on}
                  aria-label={`${it.title}をAIに渡す`}
                  disabled={saving === it.key}
                  onClick={() => toggle(it.key)}
                  className={cn(
                    "shrink-0 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-bold transition-colors",
                    on ? "border-success/40 bg-success/10 text-success" : "border-border bg-muted/30 text-muted-foreground"
                  )}
                >
                  {saving === it.key ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  {on ? "渡す" : "渡さない"}
                </button>
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
}
