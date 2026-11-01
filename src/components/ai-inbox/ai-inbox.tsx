"use client";

/**
 * AIの取込箱（仕訳入力の「1つの箱」）。
 * 写真・PDF・CSV・Excel を何でもまとめて入れると、AIが種類を見分けて読み取る。
 *   領収書・請求書・売上日報 → 読み取って仕訳（下書き）を作る。迷った点は右の要確認ボックスへ
 *   通帳・カード明細（PDF・写真・CSV）→ 仕訳の候補を下の表に出す（画面の既存の表で確かめて登録）
 *   会計ソフトの仕訳（CSV・Excel）→ 仕訳の候補を下の表に出す
 * 分析中は Thinking Orb（libraries.dev）を出し、要確認はチャットで答えられる（音声入力も可）。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BorderBeam } from "border-beam";
import { Upload, Camera, Check, AlertTriangle, FileText, FileSpreadsheet, MessageCircleQuestion, Inbox, ChevronRight, X, History } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn, formatCurrency } from "@/lib/utils";
import { uploadReceipt, getReceiptThumbnailUrls } from "@/actions/receipt-storage";
import {
  triageInboxDocument,
  processInboxReceipt,
  processInboxStatement,
  classifyInboxTable,
  listInboxItems,
  type InboxItem,
  type InboxReceiptResult,
  type StatementSuggestion,
} from "@/actions/ai-inbox";
import { inboxFileKind, splitTable, classifyTable, MAX_DOCUMENT_BYTES, INBOX_REASON_LABELS, type TableKind } from "@/lib/inbox";
import { decodeText, gridFromText, gridsFromExcel } from "@/lib/payroll-file";
import { AiOrb, AiWorkingLine, STAGE_ORB, useDocTheme } from "./thinking";
import { InboxChat } from "./inbox-chat";

type Stage = "waiting" | "upload" | "triage" | "read" | "statement" | "table" | "done" | "review" | "error";

type QueueItem = {
  id: string;
  file: File;
  previewUrl: string | null;
  stage: Stage;
  /** 書類の種類（AIの見分け） */
  label?: string;
  message?: string;
  link?: { href: string; text: string };
  results?: InboxReceiptResult[];
};

const STAGE_TEXT: Partial<Record<Stage, string>> = {
  waiting: "待っています",
  upload: "アップロードしています…",
  triage: "書類の種類を見分けています…",
  read: "文字を読み取り、仕訳を考えています…",
  statement: "明細の行を読み取っています…",
  table: "表を読み込んでいます…",
};

const STAGE_ORB_STATE: Partial<Record<Stage, keyof typeof STAGE_ORB>> = {
  upload: "upload",
  triage: "triage",
  read: "read",
  statement: "journal",
  table: "question",
};

export type InboxTable = { header: string[]; rows: string[][] };

/** 写真がJPG・PNG以外（HEIC・WebP など）か、大きすぎるときは、JPEG に直して小さくする */
async function prepareImage(file: File): Promise<File> {
  const ok = file.type === "image/jpeg" || file.type === "image/png";
  if (ok && file.size <= MAX_DOCUMENT_BYTES) return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file; // 直せなければそのまま送る（サーバー側で知らせる）
  const max = 3000;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.88));
  if (!blob) return file;
  return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
}

/** CSV・Excel を表にする（通帳のCSVは Shift_JIS が多いので文字コードも見分ける） */
async function readTable(file: File): Promise<InboxTable> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "xlsx" || ext === "xlsm") {
    const sheets = await gridsFromExcel(await file.arrayBuffer());
    const first = sheets.find((s) => s.grid.length > 1) ?? sheets[0];
    return splitTable(first?.grid ?? []);
  }
  return splitTable(gridFromText(decodeText(new Uint8Array(await file.arrayBuffer()))));
}

export function AiInbox({
  clientId,
  canWrite,
  onTable,
  onStatement,
}: {
  clientId: string;
  canWrite: boolean;
  /** 仕訳・通帳・カードの表を、画面の既存の確認の表に渡す */
  onTable: (kind: "journal" | "bank" | "card", file: File, table: InboxTable) => void;
  /** 通帳・カード明細のPDFから作った仕訳の候補を、画面の確認の表に渡す */
  onStatement: (file: File, result: { suggestions: StatementSuggestion[]; warnings: string[]; subtype: "bank" | "card" }) => void;
}) {
  const theme = useDocTheme();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [running, setRunning] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [memo, setMemo] = useState("");
  const [items, setItems] = useState<InboxItem[]>([]);
  const [showClosed, setShowClosed] = useState(false);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [chat, setChat] = useState<{ itemId: string | null } | null>(null);
  const runningRef = useRef(false);
  const queueRef = useRef<QueueItem[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  queueRef.current = queue;

  const loadItems = useCallback(async () => {
    try {
      const list = await listInboxItems(clientId, { includeClosed: showClosed });
      setItems(list);
      const ids = list.map((i) => i.receiptId).filter(Boolean) as string[];
      if (ids.length) setThumbs(await getReceiptThumbnailUrls(clientId, ids).catch(() => ({})));
    } catch {
      // 一覧が読めなくても取込は使える
    }
  }, [clientId, showClosed]);
  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const patch = (id: string, p: Partial<QueueItem>) => setQueue((q) => q.map((x) => (x.id === id ? { ...x, ...p } : x)));

  const processOne = async (q: QueueItem) => {
    const kind = inboxFileKind(q.file.name, q.file.type);
    if (kind === "unsupported") {
      patch(q.id, { stage: "error", message: "この形式は読み取れません（写真・PDF・CSV・Excel に対応）" });
      return;
    }
    if (kind === "table") {
      patch(q.id, { stage: "table" });
      const table = await readTable(q.file);
      if (table.rows.length === 0) throw new Error("データの行が見つかりませんでした");
      // 見出しで分かれば、AIに聞かずに決める
      let tk: TableKind = classifyTable(table.header);
      if (tk === "unknown") tk = await classifyInboxTable(clientId, table.header, table.rows.slice(0, 8));
      if (tk === "payroll") {
        patch(q.id, { stage: "done", label: "給与台帳", message: "給与台帳の表です。給与台帳の画面で取り込めます。", link: { href: `/clients/${clientId}/payroll`, text: "給与台帳を開く" } });
        return;
      }
      if (tk === "unknown") tk = "bank";
      onTable(tk, q.file, table);
      patch(q.id, {
        stage: "done",
        label: tk === "journal" ? "仕訳の表" : tk === "card" ? "カード明細の表" : "通帳の表",
        message: `${table.rows.length}行を読み込みました。下の表でAIの仕訳の候補を確かめて登録してください。`,
      });
      return;
    }

    // 写真・PDF
    patch(q.id, { stage: "upload" });
    const file = kind === "image" ? await prepareImage(q.file) : q.file;
    if (file.size > MAX_DOCUMENT_BYTES) throw new Error("ファイルが10MBを超えています。ページを分けるか、小さくしてから入れてください");
    const fd = new FormData();
    fd.append("file", file);
    fd.append("client_id", clientId);
    const saved = await uploadReceipt(fd);

    patch(q.id, { stage: "triage" });
    const triage = await triageInboxDocument(saved.id);
    patch(q.id, { label: triage.label });

    if (triage.kind === "statement") {
      patch(q.id, { stage: "statement" });
      const subtype = triage.subtype ?? "bank";
      const res = await processInboxStatement(saved.id, subtype);
      onStatement(q.file, { ...res, subtype });
      patch(q.id, {
        stage: "done",
        message: `${res.lineCount}行の取引を読み取りました。下の「${subtype === "card" ? "カード明細" : "銀行明細"}」の表で仕訳の候補を確かめて登録してください。`,
      });
      return;
    }
    if (triage.kind === "payroll") {
      patch(q.id, { stage: "done", message: "給与明細として証憑に保存しました。給与の仕訳は給与台帳で作れます。", link: { href: `/clients/${clientId}/payroll`, text: "給与台帳を開く" } });
      return;
    }

    patch(q.id, { stage: "read" });
    const results = await processInboxReceipt(saved.id, q.file.name, memo.trim() || null);
    const review = results.filter((r) => r.itemId).length;
    patch(q.id, {
      stage: review > 0 ? "review" : "done",
      results,
      message:
        results.length > 1
          ? `${results.length}件の証憑を読み取りました。写っている枚数と合っているか確かめてください。`
          : review > 0
            ? "確認したいことがあります。右の要確認ボックスから答えてください。"
            : "仕訳（下書き）を作りました。",
    });
  };

  const run = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    // 1件ずつ順に（同時に送るとAIの制限・処理時間の上限にかかりやすい）
    for (;;) {
      const next = queueRef.current.find((x) => x.stage === "waiting");
      if (!next) break;
      try {
        await processOne(next);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "処理に失敗しました";
        patch(next.id, { stage: "error", message: msg });
      }
      await loadItems();
      // 状態の反映を待ってから次を探す
      await new Promise((r) => setTimeout(r, 0));
    }
    runningRef.current = false;
    setRunning(false);
  };

  const addFiles = (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (arr.length === 0 || !canWrite) return;
    const added = arr.map((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
      stage: "waiting" as const,
    }));
    queueRef.current = [...queueRef.current, ...added];
    setQueue(queueRef.current);
    // 入れたらすぐ始める
    setTimeout(run, 0);
  };

  const clearDone = () => {
    setQueue((q) => {
      q.filter((x) => x.stage === "done" || x.stage === "error" || x.stage === "review").forEach((x) => x.previewUrl && URL.revokeObjectURL(x.previewUrl));
      return q.filter((x) => !(x.stage === "done" || x.stage === "error" || x.stage === "review"));
    });
  };

  const active = queue.filter((x) => !["done", "review", "error"].includes(x.stage));
  const doneCount = queue.length - active.length;
  const current = queue.find((x) => STAGE_TEXT[x.stage] && x.stage !== "waiting");
  const openItems = items.filter((i) => i.status === "open");

  return (
    <>
      <Card className="mb-6 p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
          <div>
            <h2 className="text-base font-bold text-foreground flex items-center gap-2">
              <Inbox className="size-5 text-primary" />
              AIで取り込む
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              レシート・領収書・請求書・売上日報の写真やPDF、通帳・カード明細（PDF・CSV）、会計ソフトの仕訳（CSV・Excel）を、まとめてこの箱に入れてください。
              AIが種類を見分けて読み取り、迷った点は質問します。
            </p>
          </div>
          <button
            onClick={() => setChat({ itemId: null })}
            className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/5 px-3 py-1.5 text-sm font-bold text-primary hover:bg-primary/10"
          >
            <MessageCircleQuestion className="size-4" />
            AIに相談
          </button>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          {/* 左: 箱と取込の状況 */}
          <div className="min-w-0 space-y-3">
            <input
              ref={fileRef}
              type="file"
              multiple
              accept="image/*,application/pdf,.pdf,.csv,.tsv,.txt,.xlsx,.xlsm"
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <BorderBeam size="md" colorVariant="forest" theme={theme} active={running} strength={0.7}>
              <div
                role="button"
                tabIndex={0}
                aria-disabled={!canWrite}
                onClick={() => canWrite && fileRef.current?.click()}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && canWrite && fileRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
                }}
                className={cn(
                  "flex flex-wrap items-center justify-center gap-4 rounded-xl border-2 border-dashed p-5 text-center transition-colors",
                  canWrite ? "cursor-pointer" : "cursor-not-allowed opacity-60",
                  dragOver ? "border-primary bg-primary/10" : "border-muted-foreground/30 bg-muted/20 hover:border-primary/50 hover:bg-muted/30"
                )}
              >
                {running ? (
                  <AiOrb state={STAGE_ORB[STAGE_ORB_STATE[current?.stage ?? "read"] ?? "read"]} size={64} label="AIが分析中" />
                ) : (
                  <div className="size-12 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
                    <Upload className="size-6" />
                  </div>
                )}
                <div className="min-w-0 text-left">
                  {running ? (
                    <>
                      <p className="text-base font-bold text-foreground">
                        AIが分析中です（{Math.min(doneCount + 1, queue.length)}/{queue.length}件）
                      </p>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {current ? `${current.file.name}：${STAGE_TEXT[current.stage]}` : "準備しています…"} 続けてファイルを入れても大丈夫です。
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-base font-bold text-foreground">ここにファイルを入れる（クリック・ドラッグ＆ドロップ・複数可）</p>
                      <p className="text-sm text-muted-foreground mt-0.5">写真（JPG・PNG・HEIC）・PDF・CSV・Excel / 1つ10MBまで / 1枚に複数のレシートが写っていても分けて読みます</p>
                    </>
                  )}
                </div>
              </div>
            </BorderBeam>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => cameraRef.current?.click()}
                disabled={!canWrite}
                className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm font-bold text-primary hover:bg-primary/10 sm:hidden"
              >
                <Camera className="size-4" />
                写真を撮る
              </button>
              <input
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="AIへのひとこと（任意）例: 今回のレシートは全部 取引先との打合せです"
                className="min-w-0 flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground"
              />
            </div>

            {queue.length > 0 && (
              <div className="rounded-xl border border-border">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
                  <p className="text-sm font-bold text-foreground">今回の取込（{queue.length}件）</p>
                  {!running && (
                    <button onClick={clearDone} className="text-xs font-bold text-muted-foreground hover:text-foreground">
                      終わった分を片づける
                    </button>
                  )}
                </div>
                <ul className="max-h-[420px] overflow-y-auto divide-y divide-border">
                  {queue.map((q) => (
                    <QueueRow key={q.id} q={q} onOpenItem={(id) => setChat({ itemId: id })} />
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* 右: 要確認ボックス */}
          <div className="min-w-0 rounded-xl border border-border bg-muted/10">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
              <p className="text-sm font-bold text-foreground flex items-center gap-1.5">
                <AlertTriangle className="size-4 text-warning" />
                要確認ボックス
                <span className={cn("rounded-full px-2 py-0.5 text-xs", openItems.length ? "bg-warning/15 text-warning" : "bg-muted/50 text-muted-foreground")}>{openItems.length}</span>
              </p>
              <button onClick={() => setShowClosed((v) => !v)} className="inline-flex items-center gap-1 text-xs font-bold text-muted-foreground hover:text-foreground">
                <History className="size-3.5" />
                {showClosed ? "未確認だけ" : "確認済みも見る"}
              </button>
            </div>
            {items.length === 0 ? (
              <p className="px-3 py-6 text-sm text-muted-foreground text-center">
                AIが迷ったもの・読み取りにくいものはここに入ります。
                <br />
                いまはありません。
              </p>
            ) : (
              <ul className="max-h-[480px] overflow-y-auto divide-y divide-border">
                {items.map((it) => (
                  <li key={it.id}>
                    <button onClick={() => setChat({ itemId: it.id })} className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-muted/30">
                      {it.receiptId && thumbs[it.receiptId] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumbs[it.receiptId]} alt="" className="size-12 shrink-0 rounded-md border border-border object-cover" />
                      ) : (
                        <div className="size-12 shrink-0 rounded-md border border-border bg-card flex items-center justify-center text-muted-foreground">
                          {it.kind === "consult" ? <MessageCircleQuestion className="size-5" /> : <FileText className="size-5" />}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={cn(
                              "rounded px-1.5 py-0.5 text-[11px] font-bold",
                              it.status === "open"
                                ? it.reason === "unreadable" || it.reason === "duplicate"
                                  ? "bg-destructive/10 text-destructive"
                                  : "bg-warning/15 text-warning"
                                : "bg-success/10 text-success"
                            )}
                          >
                            {it.status === "open" ? INBOX_REASON_LABELS[it.reason] : "確認済み"}
                          </span>
                          <span className="truncate text-xs text-muted-foreground">{it.fileName ?? ""}</span>
                        </div>
                        <p className="mt-0.5 text-sm text-foreground line-clamp-2">{it.question}</p>
                      </div>
                      <ChevronRight className="mt-3 size-4 shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Card>

      {chat && (
        <InboxChat
          clientId={clientId}
          itemId={chat.itemId}
          canWrite={canWrite}
          onClose={() => setChat(null)}
          onChanged={loadItems}
        />
      )}
    </>
  );
}

function QueueRow({ q, onOpenItem }: { q: QueueItem; onOpenItem: (itemId: string) => void }) {
  const kind = inboxFileKind(q.file.name, q.file.type);
  const busy = !!STAGE_TEXT[q.stage] && q.stage !== "waiting";
  return (
    <li className="px-3 py-2.5">
      <div className="flex items-start gap-3">
        {q.previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={q.previewUrl} alt="" className="size-10 shrink-0 rounded object-cover" />
        ) : kind === "table" ? (
          <FileSpreadsheet className="size-9 shrink-0 text-primary" />
        ) : (
          <FileText className="size-9 shrink-0 text-primary" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-foreground">
            {q.file.name}
            {q.label && <span className="ml-2 text-xs font-normal text-muted-foreground">{q.label}</span>}
          </p>
          {busy ? (
            <AiWorkingLine text={STAGE_TEXT[q.stage] ?? ""} state={STAGE_ORB[STAGE_ORB_STATE[q.stage] ?? "read"]} className="mt-0.5" />
          ) : (
            <p
              className={cn(
                "mt-0.5 text-sm",
                q.stage === "error" ? "text-destructive" : q.stage === "review" ? "text-warning" : q.stage === "waiting" ? "text-muted-foreground" : "text-foreground"
              )}
            >
              {q.stage === "waiting" ? STAGE_TEXT.waiting : q.message}
              {q.link && (
                <Link href={q.link.href} className="ml-2 font-bold text-primary underline underline-offset-2">
                  {q.link.text}
                </Link>
              )}
            </p>
          )}
          {q.results && q.results.length > 0 && (
            <ul className="mt-1.5 space-y-1">
              {q.results.map((r) => (
                <li key={r.receiptId} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                  {r.itemId ? <AlertTriangle className="size-3.5 text-warning" /> : r.journalEntryId ? <Check className="size-3.5 text-success" /> : <X className="size-3.5 text-muted-foreground" />}
                  <span className="text-muted-foreground">{r.date ?? "日付不明"}</span>
                  <span className="text-foreground">{r.vendor ?? "支払先不明"}</span>
                  {r.amount != null && <span className="font-mono">{formatCurrency(r.amount)}</span>}
                  {r.account && <span className="text-muted-foreground">→ {r.account}</span>}
                  {r.itemId && (
                    <button onClick={() => onOpenItem(r.itemId!)} className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-bold text-warning hover:bg-warning/25">
                      {r.reasonTitle ?? "要確認"}に答える
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        {q.stage === "waiting" && <span className="shrink-0 rounded-full bg-muted/40 px-2 py-0.5 text-[11px] font-bold text-muted-foreground">待機中</span>}
        {(q.stage === "done" || q.stage === "review") && !q.results?.some((r) => r.itemId) && <Check className="size-5 shrink-0 text-success" />}
      </div>
    </li>
  );
}
