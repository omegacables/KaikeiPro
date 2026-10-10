"use client";

/**
 * 勘定科目内訳明細書を e-Tax 用の CSV（国税庁の標準フォームの形式・Shift_JIS）で保存する。
 * e-Taxソフト（PC版）の「財務諸表等の組み込み」→「勘定科目内訳明細書（CSVファイル）」で取り込める。
 */

import { useState } from "react";
import { Download, Loader2, FileSpreadsheet } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ETAX_FILES } from "@/lib/etax-breakdown-csv";
import { getEtaxBreakdownCsv } from "@/actions/etax-breakdown";

export function EtaxCsvCard({ clientId, periodKey }: { clientId: string; periodKey: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, string>>({});

  const download = async (id: string) => {
    setBusy(id);
    try {
      const r = await getEtaxBreakdownCsv(clientId, periodKey, id);
      const bin = atob(r.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = r.fileName;
      a.click();
      URL.revokeObjectURL(url);
      setMessages((m) => ({
        ...m,
        [id]:
          r.rows === 0
            ? "記入する行がありません（提出不要です）"
            : r.unsupported.length
              ? `${r.rows}行。e-Taxで使えない文字（${r.unsupported.join("")}）を「〓」にしました。直してから取り込んでください`
              : `${r.rows}行を保存しました`,
      }));
    } catch (e) {
      setMessages((m) => ({ ...m, [id]: e instanceof Error ? e.message : "作れませんでした" }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="p-4 space-y-3 print:hidden">
      <h3 className="font-bold text-sm flex items-center gap-2">
        <FileSpreadsheet className="size-4 text-primary" />
        e-Tax 用の CSV
      </h3>
      <p className="text-xs text-muted-foreground">
        国税庁の標準フォーム（令和6年3月1日以後終了事業年度分）の形式・文字コード Shift_JIS で保存します。
        e-Taxソフト（PC版）の「財務諸表等の組み込み」から取り込めます。取り込む前に、e-Tax の「CSVファイルチェックコーナー」で確かめると安心です。
        合計行は任意のため出力していません。
      </p>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {ETAX_FILES.map((f) => (
          <li key={f.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
            <span className="font-medium">{f.title}</span>
            <span className="text-xs text-muted-foreground font-mono">{f.id}.csv</span>
            {messages[f.id] && <span className="text-xs text-muted-foreground">{messages[f.id]}</span>}
            <Button size="sm" variant="outline" className="ml-auto" disabled={busy !== null} onClick={() => download(f.id)}>
              {busy === f.id ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              CSV
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
