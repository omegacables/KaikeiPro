"use client";

/**
 * AIに渡す情報の設定（顧問先ごと）。
 * 会社情報・個人情報を、AIの読み取りや仕訳の提案に添えるかを選ぶ。
 */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Bot, Loader2, Building2, UserRound, Check, Ban } from "lucide-react";
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

  const choose = async (key: keyof Flags, value: boolean) => {
    if (!flags || flags[key] === value) return;
    const next = { ...flags, [key]: value };
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
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <it.icon className="size-5 text-primary mt-0.5" />
                  <div>
                    <div className="font-bold">{it.title}</div>
                    <div className="text-sm text-muted-foreground mt-1">対象: {it.what}</div>
                    <div className="text-xs text-muted-foreground mt-1">{it.effect}</div>
                  </div>
                </div>
                {/* 「渡す」「渡さない」を両方並べ、選ばれている方を塗る（ボタン1つだと、
                    書いてあるのが今の状態なのか押した後の状態なのか分からないため） */}
                <div
                  role="radiogroup"
                  aria-label={`${it.title}をAIに渡すか`}
                  className="shrink-0 inline-flex rounded-lg border border-border bg-muted/30 p-0.5"
                >
                  {([true, false] as const).map((v) => {
                    const selected = on === v;
                    return (
                      <button
                        key={String(v)}
                        role="radio"
                        aria-checked={selected}
                        disabled={saving === it.key}
                        onClick={() => choose(it.key, v)}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-bold transition-colors",
                          selected
                            ? v
                              ? "bg-success text-success-foreground shadow-sm"
                              : "bg-foreground/80 text-background shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {selected && saving === it.key ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : v ? (
                          <Check className="size-3.5" />
                        ) : (
                          <Ban className="size-3.5" />
                        )}
                        {v ? "渡す" : "渡さない"}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div
                className={cn(
                  "mt-3 rounded-md px-3 py-1.5 text-xs font-bold",
                  on ? "bg-success/10 text-success" : "bg-muted/50 text-muted-foreground"
                )}
              >
                現在の設定: {on ? `${it.title}をAIに渡しています` : `${it.title}はAIに渡していません`}
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
}
