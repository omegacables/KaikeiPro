"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Loader2, Banknote } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getClient, updateClient } from "@/actions/clients";
import { paydayOf, paydayLabel, PAYDAY_END_OF_MONTH } from "@/lib/payday";

const inputCls =
  "w-full px-3 py-2 rounded-lg border border-border bg-background text-[17px] focus:outline-none focus:ring-2 focus:ring-primary/40";

/**
 * 給与に関する顧問先ごとの設定。
 *
 * 給料日は会社ごとに違い（末日・10日・25日など）、月次で必ず使う値なので、
 * ここで一度決めておくと給与を登録するたびに打ち直さずに済む。
 */
export function PayrollSettingsContent() {
  const { id } = useParams<{ id: string }>();

  const [payday, setPayday] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getClient(id)
      .then((c) => {
        const v = c.payday;
        setPayday(v == null ? "" : String(v));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "読み込みに失敗しました"))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await updateClient(id, {
        payday: payday === "" ? null : Number(payday),
      });
      setMessage("保存しました。次に給与を登録するときから支給日に反映されます。");
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-[17px] text-foreground">
        <Loader2 className="size-5 animate-spin" />
        読み込み中...
      </div>
    );
  }

  // 選んだ内容がどう反映されるかを、実際の月で見せる
  const sample = payday === "" ? "" : paydayOf(new Date().toISOString().slice(0, 7), Number(payday));

  return (
    <Card>
      <CardContent className="py-5 space-y-4 max-w-xl">
        <div className="flex items-center gap-2">
          <Banknote className="size-5 text-primary" />
          <h2 className="text-lg font-bold">給料日</h2>
        </div>

        <p className="text-[17px] text-foreground">
          給与を登録するときの支給日の初期値になります。会社ごとに決まっているので、
          ここで一度決めておくと毎回打ち直さずに済みます。
        </p>

        <div>
          <label className="block text-[15px] font-medium text-foreground mb-1">給料日</label>
          <select
            value={payday}
            onChange={(e) => setPayday(e.target.value)}
            className={inputCls}
          >
            <option value="">未設定（支給日は空欄のまま）</option>
            <option value={PAYDAY_END_OF_MONTH}>末日</option>
            {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {d}日
              </option>
            ))}
          </select>
        </div>

        {sample && (
          <p className="text-[17px] text-foreground">
            今月なら <span className="font-bold">{sample}</span> が支給日の初期値になります
            （{paydayLabel(Number(payday))}）。
            {/* 末日は月によって日にちが変わるため、選んだ月で計算して見せる */}
          </p>
        )}

        <p className="text-[15px] text-foreground/80">
          その月に無い日にち（2月の31日など）を選んだ場合は、その月の末日に置き換えます。
        </p>

        {error && <p className="text-[17px] text-destructive">{error}</p>}
        {message && <p className="text-[17px] text-primary">{message}</p>}

        <Button onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          保存
        </Button>
      </CardContent>
    </Card>
  );
}
