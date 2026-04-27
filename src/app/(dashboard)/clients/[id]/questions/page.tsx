"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import {
  MessageSquare,
  Send,
  Loader2,
  CheckCircle,
  Clock,
  Receipt as ReceiptIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { useData } from "@/lib/use-data";
import {
  getCommentsWithReplies,
  createComment,
  resolveComment,
} from "@/actions/comments";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Reply = {
  id: string;
  parent_id: string | null;
  author_id: string;
  author_role: "staff" | "client";
  author_name: string;
  body: string;
  status: "open" | "answered" | "resolved";
  created_at: string;
};

type Question = {
  id: string;
  receipt_id: string | null;
  journal_entry_id: string | null;
  parent_id: string | null;
  author_id: string;
  author_role: "staff" | "client";
  author_name: string;
  body: string;
  status: "open" | "answered" | "resolved";
  created_at: string;
  vendor_name: string | null;
  replies: Reply[];
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function QuestionsPage() {
  const { id } = useParams<{ id: string }>();
  const { data: questions, loading, refetch } = useData<Question[] | null>(
    () => getCommentsWithReplies(id) as Promise<Question[]>,
    null,
  );

  const [replyTexts, setReplyTexts] = useState<Record<string, string>>({});
  const [sendingReply, setSendingReply] = useState<string | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);

  // ---- Derived stats ----
  const list = questions ?? [];
  const unresolvedCount = list.filter((q) => q.status === "open").length;
  const answeredCount = list.filter((q) => q.status === "answered").length;
  const totalCount = list.length;

  // ---- Handlers ----

  async function handleSendReply(questionId: string) {
    const text = replyTexts[questionId]?.trim();
    if (!text) return;

    setSendingReply(questionId);
    try {
      await createComment({
        body: text,
        author_id: "system",
        author_role: "staff",
        status: "answered",
        parent_id: questionId,
        receipt_id: null,
        journal_entry_id: null,
      });
      setReplyTexts((prev) => ({ ...prev, [questionId]: "" }));
      refetch();
    } catch (err) {
      console.error("Failed to send reply:", err);
    } finally {
      setSendingReply(null);
    }
  }

  async function handleResolve(questionId: string) {
    setResolving(questionId);
    try {
      await resolveComment(questionId);
      refetch();
    } catch (err) {
      console.error("Failed to resolve:", err);
    } finally {
      setResolving(null);
    }
  }

  // ---- Loading state ----

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  // ---- Render ----

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <MessageSquare className="size-6 text-primary" />
        <h2 className="text-xl font-bold">質問管理</h2>
        {unresolvedCount > 0 && (
          <Badge variant="warning">{unresolvedCount} 件未回答</Badge>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="bg-warning/10 rounded-full p-2">
              <Clock className="size-5 text-warning" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">未回答</p>
              <p className="text-2xl font-bold">{unresolvedCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="bg-green-500/10 rounded-full p-2">
              <CheckCircle className="size-5 text-green-500" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">回答済</p>
              <p className="text-2xl font-bold">{answeredCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <div className="bg-primary/10 rounded-full p-2">
              <MessageSquare className="size-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">合計</p>
              <p className="text-2xl font-bold">{totalCount}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Question list */}
      {list.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <MessageSquare className="size-10 mb-3 opacity-40" />
            <p className="text-sm">質問はありません</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {list.map((q) => (
            <Card key={q.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Status badge */}
                    <Badge
                      variant={q.status === "open" ? "warning" : "success"}
                    >
                      {q.status === "open" ? "未回答" : "回答済"}
                    </Badge>

                    {/* Receipt context */}
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <ReceiptIcon className="size-3" />
                      {q.vendor_name ?? "一般質問"}
                    </span>
                  </div>

                  {/* Resolve button */}
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={resolving === q.id}
                    onClick={() => handleResolve(q.id)}
                  >
                    {resolving === q.id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <CheckCircle className="size-4" />
                    )}
                    <span>解決済みにする</span>
                  </Button>
                </div>
              </CardHeader>

              <CardContent className="space-y-4">
                {/* Question body */}
                <div className="rounded-lg bg-muted/20 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold">
                      {q.author_name}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(q.created_at)}
                    </span>
                  </div>
                  <p className="text-sm whitespace-pre-wrap">{q.body}</p>
                </div>

                {/* Replies */}
                {q.replies.length > 0 && (
                  <div className="ml-6 space-y-3 border-l-2 border-border pl-4">
                    {q.replies.map((r) => (
                      <div key={r.id} className="rounded-lg bg-muted/10 p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge
                            variant={
                              r.author_role === "staff" ? "default" : "accent"
                            }
                            className="text-[10px] px-1.5 py-0"
                          >
                            {r.author_role === "staff"
                              ? "スタッフ"
                              : "クライアント"}
                          </Badge>
                          <span className="text-sm font-semibold">
                            {r.author_name}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatDate(r.created_at)}
                          </span>
                        </div>
                        <p className="text-sm whitespace-pre-wrap">{r.body}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Staff reply input */}
                <div className="flex gap-2">
                  <textarea
                    placeholder="返信を入力..."
                    className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
                    rows={2}
                    value={replyTexts[q.id] ?? ""}
                    onChange={(e) =>
                      setReplyTexts((prev) => ({
                        ...prev,
                        [q.id]: e.target.value,
                      }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                        handleSendReply(q.id);
                      }
                    }}
                  />
                  <Button
                    size="icon"
                    disabled={
                      !replyTexts[q.id]?.trim() || sendingReply === q.id
                    }
                    onClick={() => handleSendReply(q.id)}
                  >
                    {sendingReply === q.id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Send className="size-4" />
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
