"use client";

/**
 * 要確認ボックスの1件（または相談）についての、AIとのチャット。
 *   - 左上に証憑の写真（押すと大きく開く）と、今の仕訳
 *   - AIの質問と利用者の答え。すぐ答えられる候補のボタン
 *   - 入力欄（Enter で送る・Shift+Enter で改行・音声入力）。AIが答えている間は入力欄のふちが光り、
 *     「AIエージェントが回答中…」を出す（libraries.dev の Border Beam・Thinking Orbs）
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { BorderBeam } from "border-beam";
import { X, Send, Check, Trash2, Loader2, FileText, ExternalLink, MessageCircleQuestion } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import {
  answerInboxItem,
  deleteInboxDuplicate,
  getInboxItemDetail,
  setInboxItemStatus,
  startInboxConsult,
  type InboxItemDetail,
  type InboxMessage,
} from "@/actions/ai-inbox";
import { INBOX_REASON_LABELS } from "@/lib/inbox";
import { AiOrb, AiWorkingLine, useDocTheme } from "./thinking";
import { unwrap } from "./unwrap";
import { VoiceInputButton } from "./voice-input";

export function InboxChat({
  clientId,
  itemId,
  canWrite,
  onClose,
  onChanged,
}: {
  clientId: string;
  /** null は相談（証憑を指定しない） */
  itemId: string | null;
  canWrite: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const theme = useDocTheme();
  const [currentId, setCurrentId] = useState<string | null>(itemId);
  const [detail, setDetail] = useState<InboxItemDetail | null>(null);
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [loading, setLoading] = useState(Boolean(itemId));
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState<"dismiss" | "delete" | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const sendingRef = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const d = unwrap(await getInboxItemDetail(id));
      setDetail(d);
      setMessages(d.messages);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setCurrentId(itemId);
    setDetail(null);
    setMessages([]);
    setError(null);
    if (itemId) load(itemId);
    else setLoading(false);
  }, [itemId, load]);

  // 新しい発言が来たら下まで送る
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, sending]);

  // Esc で閉じる
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !sending && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, sending]);

  const send = async (raw: string) => {
    const body = raw.trim();
    // 連打は ref で止める（state の反映は間に合わない）
    if (!body || sendingRef.current || !canWrite) return;
    sendingRef.current = true;
    setSending(true);
    setError(null);
    setText("");
    setMessages((m) => [...m, { role: "user", text: body, at: new Date().toISOString() }]);
    try {
      const item = unwrap(currentId ? await answerInboxItem(currentId, body) : await startInboxConsult(clientId, body));
      if (!currentId) setCurrentId(item.id);
      setMessages(item.messages);
      await load(item.id);
      onChanged();
    } catch (e) {
      // 失敗しても書いた内容は消さない（入力欄に戻す）
      setMessages((m) => m.slice(0, -1));
      setText(body);
      setError(e instanceof Error ? e.message : "送れませんでした");
    } finally {
      sendingRef.current = false;
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const close = async (kind: "dismiss" | "delete") => {
    if (!currentId || busy) return;
    if (kind === "delete" && !window.confirm("この証憑と、この証憑から作った仕訳を削除します。よろしいですか？")) return;
    setBusy(kind);
    setError(null);
    try {
      if (kind === "delete") unwrap(await deleteInboxDuplicate(currentId));
      else unwrap(await setInboxItemStatus(currentId, "dismissed"));
      onChanged();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "できませんでした");
    } finally {
      setBusy(null);
    }
  };

  const isConsult = !currentId || detail?.kind === "consult";
  const open = detail ? detail.status === "open" : true;
  const isPdf = detail?.mimeType === "application/pdf";

  return (
    <div className="fixed inset-0 z-[60] flex justify-end" role="dialog" aria-label="AIとのチャット">
      <button className="absolute inset-0 bg-foreground/30" aria-label="閉じる" onClick={() => !sending && onClose()} />
      <div className="relative flex h-full w-full max-w-xl flex-col bg-background shadow-2xl border-l border-border">
        {/* 見出し */}
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <AiOrb state={sending ? "composing" : loading ? "searching" : "breathing"} size={32} paused={!sending && !loading} label="AIエージェント" />
          <div className="min-w-0 flex-1">
            <p className="font-bold text-foreground">{isConsult ? "AIに相談" : detail?.title ?? "要確認"}</p>
            <p className="text-xs text-muted-foreground truncate">
              {isConsult ? "経理の疑問を、この会社の決まりに沿って答えます" : `${detail ? INBOX_REASON_LABELS[detail.reason] : ""}${detail?.fileName ? `・${detail.fileName}` : ""}`}
            </p>
          </div>
          <button onClick={onClose} disabled={sending} className="text-muted-foreground hover:text-foreground disabled:opacity-40" aria-label="閉じる">
            <X className="size-5" />
          </button>
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {/* 証憑と今の仕訳 */}
          {detail && !isConsult && (
            <div className="flex flex-wrap gap-3 rounded-xl border border-border bg-card p-3">
              {detail.imageUrl ? (
                isPdf ? (
                  <a href={detail.imageUrl} target="_blank" rel="noreferrer" className="flex size-24 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-border bg-muted/30 text-xs text-primary">
                    <FileText className="size-8" />
                    PDFを開く
                  </a>
                ) : (
                  <a href={detail.imageUrl} target="_blank" rel="noreferrer" className="shrink-0" title="大きく表示">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={detail.imageUrl} alt="証憑" className="size-24 rounded-lg border border-border object-cover" />
                  </a>
                )
              ) : null}
              <div className="min-w-0 flex-1 text-sm">
                {detail.journal ? (
                  <>
                    <p className="font-bold text-foreground">
                      今の仕訳 <span className="font-normal text-muted-foreground">{detail.journal.entryDate}</span>
                    </p>
                    <p className="text-muted-foreground truncate">{detail.journal.description}</p>
                    <table className="mt-1 w-full text-xs">
                      <tbody>
                        {detail.journal.lines.map((l, i) => (
                          <tr key={i} className="border-t border-border/50">
                            <td className="py-0.5 pr-2">{l.debit > 0 ? l.accountName : ""}</td>
                            <td className="py-0.5 pr-2 text-right font-mono">{l.debit > 0 ? formatCurrency(l.debit) : ""}</td>
                            <td className="py-0.5 pr-2">{l.credit > 0 ? l.accountName : ""}</td>
                            <td className="py-0.5 text-right font-mono">{l.credit > 0 ? formatCurrency(l.credit) : ""}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {detail.journal.lines.some((l) => l.attendees) && (
                      <p className="mt-1 text-xs text-muted-foreground">参加人数 {detail.journal.lines.find((l) => l.attendees)?.attendees}名</p>
                    )}
                  </>
                ) : (
                  <p className="text-muted-foreground">まだ仕訳はありません。内容を教えていただければ作ります。</p>
                )}
              </div>
            </div>
          )}

          {loading && !detail && <AiWorkingLine text="読み込み中…" state="searching" />}

          {isConsult && messages.length === 0 && !sending && (
            <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
              <p className="font-bold text-foreground flex items-center gap-1.5">
                <MessageCircleQuestion className="size-4 text-primary" />
                たとえば
              </p>
              <ul className="mt-1 list-disc pl-5 space-y-0.5">
                <li>取引先との会食は何人までなら会議費にできますか？</li>
                <li>10万円のパソコンを買いました。経費にできますか？</li>
                <li>家賃の一部を自宅として使っています。どう仕訳しますか？</li>
              </ul>
            </div>
          )}

          {messages.map((m, i) =>
            m.role === "ai" ? (
              <div key={i} className="flex items-start gap-2">
                <div className="mt-0.5 size-8 shrink-0 rounded-full bg-primary/10 flex items-center justify-center">
                  <AiOrb state="breathing" size={20} paused label="AI" />
                </div>
                <div className="max-w-[85%] rounded-2xl rounded-tl-sm border border-border bg-card px-3.5 py-2.5 text-[15px] leading-relaxed text-foreground whitespace-pre-wrap">
                  {m.text}
                </div>
              </div>
            ) : (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-primary px-3.5 py-2.5 text-[15px] leading-relaxed text-primary-foreground whitespace-pre-wrap">{m.text}</div>
              </div>
            )
          )}

          {sending && (
            <div className="flex items-start gap-2">
              <div className="mt-0.5 size-8 shrink-0 rounded-full bg-primary/10 flex items-center justify-center">
                <AiOrb state="composing" size={20} label="AIが回答中" />
              </div>
              <div className="rounded-2xl rounded-tl-sm border border-border bg-card px-3.5 py-2.5">
                <AiWorkingLine text="AIエージェントが回答中…" />
              </div>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        {/* 答えの候補と操作 */}
        <div className="border-t border-border px-4 pt-3 pb-4 space-y-3 bg-background">
          {detail && open && !isConsult && detail.options.length > 0 && !sending && canWrite && (
            <div className="flex flex-wrap gap-2">
              {detail.options.map((o) => (
                <button
                  key={o}
                  onClick={() => send(o)}
                  className="rounded-full border border-primary/40 bg-primary/5 px-3 py-1.5 text-sm font-bold text-primary hover:bg-primary/10"
                >
                  {o}
                </button>
              ))}
            </div>
          )}
          {detail && !isConsult && canWrite && (
            <div className="flex flex-wrap items-center gap-2">
              {detail.suggestDelete && (
                <button
                  onClick={() => close("delete")}
                  disabled={busy !== null || sending}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/40 px-3 py-1.5 text-sm font-bold text-destructive hover:bg-destructive/10 disabled:opacity-50"
                >
                  {busy === "delete" ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                  重複を削除
                </button>
              )}
              {open && (
                <button
                  onClick={() => close("dismiss")}
                  disabled={busy !== null || sending}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-bold text-foreground hover:bg-muted/30 disabled:opacity-50"
                >
                  {busy === "dismiss" ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                  このままでよい
                </button>
              )}
              {!open && <span className="text-sm font-bold text-success">確認済みです</span>}
              <a href={`/clients/${clientId}/documents`} className="ml-auto inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline">
                証憑管理で見る
                <ExternalLink className="size-3.5" />
              </a>
            </div>
          )}

          {canWrite ? (
            <BorderBeam size="md" colorVariant="forest" theme={theme} active={sending} strength={0.8}>
              <div className="flex items-end gap-2 rounded-xl border border-border bg-card p-2">
                <textarea
                  ref={inputRef}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    // 日本語の変換中の Enter では送らない
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      send(text);
                    }
                  }}
                  rows={2}
                  disabled={sending}
                  placeholder={isConsult ? "経理の疑問を書いてください（Enterで送信）" : "AIの質問に答えてください（Enterで送信・Shift+Enterで改行）"}
                  className="min-h-11 flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
                />
                <VoiceInputButton disabled={sending} onText={(t) => setText((prev) => (prev ? `${prev} ${t}` : t))} />
                <button
                  onClick={() => send(text)}
                  disabled={sending || !text.trim()}
                  className={cn(
                    "shrink-0 size-10 rounded-full flex items-center justify-center",
                    text.trim() && !sending ? "bg-primary text-primary-foreground" : "bg-muted/50 text-muted-foreground"
                  )}
                  aria-label="送信"
                >
                  {sending ? <Loader2 className="size-5 animate-spin" /> : <Send className="size-5" />}
                </button>
              </div>
            </BorderBeam>
          ) : (
            <p className="text-sm text-muted-foreground">閲覧専用のため、答えることはできません。</p>
          )}
        </div>
      </div>
    </div>
  );
}
