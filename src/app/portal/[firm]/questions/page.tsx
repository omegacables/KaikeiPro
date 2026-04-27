"use client";

import { useState, useRef, useCallback } from "react";
import { useAuth } from "@/components/providers/auth-provider";
import { useData } from "@/lib/use-data";
import { getCommentsWithReplies, createComment } from "@/actions/comments";
import {
  Send,
  Plus,
  Loader2,
  Clock,
  CheckCircle,
  Receipt,
  HelpCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * Auto-resize a textarea to fit its content.
 * Called on mount (via ref callback) and on every input change.
 */
function autoResize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

export default function QuestionsPage() {
  const { user } = useAuth();

  const { data: questions, loading, refetch } = useData(
    () => {
      if (!user?.clientId) return Promise.resolve([]);
      return getCommentsWithReplies(user.clientId);
    },
    []
  );

  // New question form state
  const [showNewForm, setShowNewForm] = useState(false);
  const [newBody, setNewBody] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Reply state per question
  const [replyTexts, setReplyTexts] = useState<Record<string, string>>({});
  const [replyingTo, setReplyingTo] = useState<string | null>(null);

  // Ref for auto-resizing new question textarea
  const newTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Ref callback to set up auto-resize on reply textareas
  const replyTextareaRef = useCallback((el: HTMLTextAreaElement | null) => {
    if (el) autoResize(el);
  }, []);

  const handleCreateQuestion = async () => {
    const text = newBody.trim();
    if (!text || !user) return;

    setSubmitting(true);
    try {
      await createComment({
        body: text,
        author_id: user.id,
        author_role: "client",
        status: "open",
        parent_id: null,
        receipt_id: null,
        journal_entry_id: null,
      });
      setNewBody("");
      setShowNewForm(false);
      refetch();
    } catch (e) {
      alert(e instanceof Error ? e.message : "送信に失敗しました");
    } finally {
      setSubmitting(false);
    }
  };

  const handleReply = async (questionId: string) => {
    const text = replyTexts[questionId]?.trim();
    if (!text || !user) return;

    setReplyingTo(questionId);
    try {
      await createComment({
        body: text,
        author_id: user.id,
        author_role: "client",
        status: "open",
        parent_id: questionId,
        receipt_id: null,
        journal_entry_id: null,
      });
      setReplyTexts((prev) => ({ ...prev, [questionId]: "" }));
      refetch();
    } catch (e) {
      alert(e instanceof Error ? e.message : "送信に失敗しました");
    } finally {
      setReplyingTo(null);
    }
  };

  const formatDate = (dateStr: string) =>
    dateStr.slice(0, 16).replace("T", " ");

  // Loading state
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[40vh] gap-3">
        <Loader2 className="size-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">読み込み中...</p>
      </div>
    );
  }

  return (
    <>
      {/* Header - no button here, moved to FAB */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-foreground">質問・回答</h2>
      </div>

      {/* New question form (slides open when FAB is tapped) */}
      {showNewForm && (
        <Card className="p-4 mb-4">
          <p className="text-sm font-bold text-foreground mb-2">
            新しい質問を投稿
          </p>
          <textarea
            ref={(el) => {
              newTextareaRef.current = el;
              autoResize(el);
            }}
            placeholder="質問内容を入力してください..."
            value={newBody}
            onChange={(e) => {
              setNewBody(e.target.value);
              autoResize(e.target);
            }}
            rows={3}
            className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none overflow-hidden"
          />
          <div className="flex justify-end gap-2 mt-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setShowNewForm(false);
                setNewBody("");
              }}
            >
              キャンセル
            </Button>
            <Button
              size="sm"
              onClick={handleCreateQuestion}
              disabled={!newBody.trim() || submitting}
            >
              {submitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              送信
            </Button>
          </div>
        </Card>
      )}

      {/* Question list */}
      <div className="space-y-4 pb-16">
        {questions.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <HelpCircle className="size-12 mb-4 opacity-30" />
            <p className="text-sm font-medium text-foreground/70">
              質問はまだありません
            </p>
            <p className="text-xs mt-2 text-center leading-relaxed max-w-[240px]">
              税理士に何でも質問できます。
              <br />
              領収書や経費についてお気軽にどうぞ。
            </p>
            <Button
              size="sm"
              className="mt-4"
              onClick={() => setShowNewForm(true)}
            >
              <Plus className="size-4" />
              質問を投稿する
            </Button>
          </div>
        )}

        {questions.map((q) => {
          const isOpen = q.status === "open";

          return (
            <Card key={q.id} className="p-4">
              {/* Status + context header */}
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {q.vendor_name ? (
                    <>
                      <Receipt className="size-3" />
                      <span>{q.vendor_name}</span>
                    </>
                  ) : (
                    <span>一般質問</span>
                  )}
                </div>
                <Badge variant={isOpen ? "warning" : "success"}>
                  {isOpen ? (
                    <Clock className="size-3 mr-1" />
                  ) : (
                    <CheckCircle className="size-3 mr-1" />
                  )}
                  {isOpen ? "未回答" : "回答済"}
                </Badge>
              </div>

              {/* Question body */}
              <div className="bg-muted/20 rounded-lg p-3 mb-2">
                <p className="text-sm text-foreground whitespace-pre-wrap">
                  {q.body}
                </p>
              </div>

              {/* Author + timestamp */}
              <p className="text-xs text-muted-foreground mb-3">
                {q.author_name} &middot; {formatDate(q.created_at)}
              </p>

              {/* Replies thread */}
              {q.replies.length > 0 && (
                <div className="space-y-2 mb-3">
                  {q.replies.map((reply) => (
                    <div
                      key={reply.id}
                      className="ml-3 pl-3 border-l-2 border-primary/30"
                    >
                      <div className="bg-primary/5 rounded-lg p-3">
                        <p className="text-sm text-foreground whitespace-pre-wrap">
                          {reply.body}
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-1.5">
                          {reply.author_name} &middot;{" "}
                          {formatDate(reply.created_at)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Reply input - auto-resize textarea */}
              <div className="flex gap-2 items-end">
                <textarea
                  ref={replyTextareaRef}
                  placeholder="返信を入力..."
                  value={replyTexts[q.id] || ""}
                  onChange={(e) => {
                    setReplyTexts((prev) => ({
                      ...prev,
                      [q.id]: e.target.value,
                    }));
                    autoResize(e.target);
                  }}
                  rows={1}
                  className="flex-1 bg-card border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none overflow-hidden"
                />
                <Button
                  size="icon"
                  className="shrink-0"
                  onClick={() => handleReply(q.id)}
                  disabled={
                    !replyTexts[q.id]?.trim() || replyingTo === q.id
                  }
                >
                  {replyingTo === q.id ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      {/* FAB - floating "新しい質問" button above bottom nav */}
      <button
        onClick={() => setShowNewForm(!showNewForm)}
        className={`
          fixed bottom-[72px] right-4 z-20
          flex items-center gap-2 px-5 py-3
          rounded-full shadow-lg
          text-sm font-bold
          transition-all active:scale-95 cursor-pointer
          ${showNewForm
            ? "bg-muted/80 text-muted-foreground"
            : "bg-primary text-primary-foreground hover:bg-primary-dark"
          }
        `}
        style={{ maxWidth: "calc(100vw - 32px)" }}
      >
        <Plus className={`size-5 transition-transform ${showNewForm ? "rotate-45" : ""}`} />
        {showNewForm ? "閉じる" : "新しい質問"}
      </button>
    </>
  );
}
