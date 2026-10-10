"use client";

/**
 * 決算の税金の仕訳（法人税等・消費税）を作るカード。消費税申告書・法人税申告書の画面で使う。
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { FileText, Loader2, CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  getSettlementStatus,
  postSettlement,
  cancelSettlement,
  type SettlementKind,
  type SettlementStatus,
} from "@/actions/tax-settlement";

const TITLE: Record<SettlementKind, string> = {
  corporate: "決算の仕訳: 法人税等の計上",
  consumption: "決算の仕訳: 消費税等の計上",
};
const NOTE: Record<SettlementKind, string> = {
  corporate:
    "当期の税額（法人税・地方法人税・住民税・事業税など）から中間納付を差し引いた確定分を「未払法人税等」に計上します。中間納付を「仮払法人税等」で記帳していれば、それも取り崩します。",
  consumption:
    "年間の消費税額（中間納付を差し引く前）を「未払消費税等」に計上します。税抜経理なら仮受消費税と仮払消費税を相殺し、端数の差額は雑収入（損なら租税公課）にします。中間納付は「未払消費税等」の借方で記帳している前提です。",
};

export function SettlementCard({
  clientId,
  kind,
  periodKey,
  endDate,
  canWrite,
  refreshKey,
  onChanged,
}: {
  clientId: string;
  kind: SettlementKind;
  periodKey: string;
  endDate: string;
  canWrite: boolean;
  refreshKey?: number;
  onChanged?: () => void;
}) {
  const [status, setStatus] = useState<SettlementStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    setStatus(null);
    getSettlementStatus(clientId, kind, periodKey)
      .then((s) => alive && setStatus(s))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "読み込みに失敗しました"));
    return () => {
      alive = false;
    };
  }, [clientId, kind, periodKey, reload, refreshKey]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setReload((k) => k + 1);
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "失敗しました");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-4 space-y-3 print:hidden">
      <h3 className="font-bold text-sm flex items-center gap-2">
        <FileText className="size-4 text-primary" />
        {TITLE[kind]}
      </h3>
      <p className="text-xs text-muted-foreground">{NOTE[kind]}</p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!status ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="size-4 animate-spin" />
          読み込み中...
        </div>
      ) : status.posted ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <CheckCircle2 className="size-4 text-success" />
          <span>期末日（{status.posted.date}）付けで作成済みです。</span>
          <Link
            href={`/clients/${clientId}/ledgers?tab=journal&entry=${status.posted.entryId}&date=${status.posted.date}`}
            className="text-primary underline"
          >
            仕訳を見る
          </Link>
          {canWrite && (
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              disabled={busy}
              onClick={() => {
                if (!confirm("この仕訳を削除します。よろしいですか？")) return;
                run(() => cancelSettlement(clientId, kind, periodKey));
              }}
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              仕訳を取り消す
            </Button>
          )}
        </div>
      ) : "error" in status.preview ? (
        <p className="text-sm text-muted-foreground">{status.preview.error}</p>
      ) : (
        <>
          <table className="text-xs">
            <thead>
              <tr className="text-muted-foreground border-b border-border">
                <th className="text-left px-2 py-1">科目</th>
                <th className="text-right px-2 py-1 w-32">借方</th>
                <th className="text-right px-2 py-1 w-32">貸方</th>
              </tr>
            </thead>
            <tbody>
              {status.preview.lines.map((l) => (
                <tr key={l.account} className="border-b border-border/40 last:border-0">
                  <td className="px-2 py-1">{l.account}</td>
                  <td className="px-2 py-1 text-right font-mono">{l.debit ? l.debit.toLocaleString() : ""}</td>
                  <td className="px-2 py-1 text-right font-mono">{l.credit ? l.credit.toLocaleString() : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {canWrite && (
            <Button size="sm" disabled={busy} onClick={() => run(() => postSettlement(clientId, kind, periodKey))}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              期末日（{endDate}）付けで仕訳を作る
            </Button>
          )}
        </>
      )}
    </Card>
  );
}
