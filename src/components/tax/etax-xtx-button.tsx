"use client";

/**
 * e-Tax 用ファイル（.xtx）の保存ボタン（消費税・法人税の申告書の画面で使う）。
 * 提出者の情報（税務署・利用者識別番号など）が足りなければ設定画面へ案内する。
 */

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function EtaxXtxButton({
  clientId,
  load,
}: {
  clientId: string;
  load: () => Promise<{ fileName: string; xml: string; warnings?: string[] } | { missing: string[] }>;
}) {
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      const r = await load();
      if ("missing" in r) {
        if (confirm(`e-Tax の提出情報（${r.missing.join("・")}）が入っていません。設定画面を開きますか？`))
          window.location.href = `/clients/${clientId}/settings?tab=etax`;
        return;
      }
      const url = URL.createObjectURL(new Blob([r.xml], { type: "application/xml" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = r.fileName;
      a.click();
      URL.revokeObjectURL(url);
      if (r.warnings?.length) alert(`保存しました。次の点を e-Taxソフトで確認してください。\n\n・${r.warnings.join("\n・")}`);
    } catch (e) {
      alert(e instanceof Error ? e.message : "作れませんでした");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={download}
      disabled={busy}
      title="e-Taxソフト（WEB版は「作成済みデータの利用」、PC版は「組み込み」）で読み込み、署名して送信します"
    >
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
      e-Tax用ファイル（.xtx）
    </Button>
  );
}
