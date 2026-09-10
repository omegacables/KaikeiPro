"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import {
  Shield,
  Calendar,
  Search,
  FileText,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency } from "@/lib/utils";
import { getAuditLogs, type AuditLogFilters } from "@/actions/audit";
import type { Database } from "@/types/database";
import { DateInput } from "@/components/ui/date-input";

type AuditLogRow = Database["public"]["Tables"]["audit_logs"]["Row"];

const tableLabels: Record<string, string> = {
  journal_entries: "仕訳",
  journal_entry_lines: "仕訳明細",
  receipts: "領収書",
};

const actionLabels: Record<string, { label: string; variant: "success" | "warning" | "destructive" }> = {
  INSERT: { label: "作成", variant: "success" },
  UPDATE: { label: "更新", variant: "warning" },
  DELETE: { label: "削除", variant: "destructive" },
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function ChangeSummary({ action, oldData, newData }: { action: string; oldData: unknown; newData: unknown }) {
  if (action === "INSERT" && newData && typeof newData === "object") {
    const d = newData as Record<string, unknown>;
    return (
      <div className="text-xs text-muted-foreground">
        {!!d.description && <span>摘要: {String(d.description)}</span>}
        {!!d.entry_date && <span className="ml-3">日付: {String(d.entry_date)}</span>}
        {!!d.status && <span className="ml-3">状態: {String(d.status)}</span>}
      </div>
    );
  }
  if (action === "UPDATE" && oldData && newData && typeof oldData === "object" && typeof newData === "object") {
    const o = oldData as Record<string, unknown>;
    const n = newData as Record<string, unknown>;
    const changes: string[] = [];
    for (const key of Object.keys(n)) {
      if (["updated_at", "created_at"].includes(key)) continue;
      if (JSON.stringify(o[key]) !== JSON.stringify(n[key])) {
        changes.push(key);
      }
    }
    return (
      <div className="text-xs text-muted-foreground">
        変更項目: {changes.length > 0 ? changes.join(", ") : "なし"}
      </div>
    );
  }
  if (action === "DELETE" && oldData && typeof oldData === "object") {
    const d = oldData as Record<string, unknown>;
    return (
      <div className="text-xs text-muted-foreground">
        {!!d.description && <span>摘要: {String(d.description)}</span>}
        {!!d.entry_date && <span className="ml-3">日付: {String(d.entry_date)}</span>}
      </div>
    );
  }
  return null;
}

function AuditLogDetail({ log }: { log: AuditLogRow }) {
  return (
    <div className="bg-muted/10 p-4 border-b border-border">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {log.old_data && (
          <div>
            <h4 className="text-xs font-bold text-muted-foreground mb-2">変更前</h4>
            <pre className="text-xs bg-card p-3 rounded-lg border border-border overflow-x-auto max-h-48">
              {JSON.stringify(log.old_data, null, 2)}
            </pre>
          </div>
        )}
        {log.new_data && (
          <div>
            <h4 className="text-xs font-bold text-muted-foreground mb-2">変更後</h4>
            <pre className="text-xs bg-card p-3 rounded-lg border border-border overflow-x-auto max-h-48">
              {JSON.stringify(log.new_data, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

export function AuditLogPageContent({ hideHeader = false }: { hideHeader?: boolean }) {
  const { id } = useParams<{ id: string }>();

  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Filters
  const [tableName, setTableName] = useState<string>("");
  const [action, setAction] = useState<string>("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const filters: AuditLogFilters = {};
      if (tableName) filters.tableName = tableName;
      if (action) filters.action = action as AuditLogFilters["action"];
      if (dateFrom) filters.dateFrom = dateFrom;
      if (dateTo) filters.dateTo = dateTo;

      const data = await getAuditLogs(id, filters);
      setLogs(data);
    } catch (e) {
      console.error("Audit log fetch error:", e);
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, [id, tableName, action, dateFrom, dateTo]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  return (
    <>
      {!hideHeader && (
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Shield className="size-6 text-primary" />
              監査ログ
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              仕訳・領収書の操作履歴（電子帳簿保存法対応）
            </p>
          </div>
        </div>
      )}

      {/* Filters */}
      <Card className="mb-6">
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Calendar className="size-4 text-muted-foreground" />
              <label className="text-xs text-muted-foreground font-bold">期間:</label>
              <DateInput allowEmpty value={dateFrom}
                onChange={(v) => setDateFrom(v)}
                className="px-3 py-1.5 rounded-lg border border-border bg-card text-foreground text-sm" />
              <span className="text-muted-foreground">〜</span>
              <DateInput allowEmpty value={dateTo}
                onChange={(v) => setDateTo(v)}
                className="px-3 py-1.5 rounded-lg border border-border bg-card text-foreground text-sm" />
            </div>
            <select
              value={tableName}
              onChange={(e) => setTableName(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-border bg-card text-foreground text-sm"
            >
              <option value="">全テーブル</option>
              <option value="journal_entries">仕訳</option>
              <option value="journal_entry_lines">仕訳明細</option>
              <option value="receipts">領収書</option>
            </select>
            <select
              value={action}
              onChange={(e) => setAction(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-border bg-card text-foreground text-sm"
            >
              <option value="">全操作</option>
              <option value="INSERT">作成</option>
              <option value="UPDATE">更新</option>
              <option value="DELETE">削除</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Log table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/20 border-b border-border">
                <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground">日時</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground">テーブル</th>
                <th className="text-center px-4 py-3 text-xs font-bold text-muted-foreground">操作</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground">概要</th>
                <th className="text-left px-4 py-3 text-xs font-bold text-muted-foreground">レコードID</th>
                <th className="text-center px-4 py-3 text-xs font-bold text-muted-foreground w-8"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                    読み込み中...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                    監査ログがありません
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const actionInfo = actionLabels[log.action] ?? { label: log.action, variant: "default" as const };
                  return (
                    <tr
                      key={log.id}
                      className="border-b border-border hover:bg-muted/10 cursor-pointer"
                      onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                    >
                      <td className="px-4 py-3 text-xs font-mono text-muted-foreground whitespace-nowrap">
                        {formatDateTime(log.performed_at)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="muted">{tableLabels[log.table_name] ?? log.table_name}</Badge>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge variant={actionInfo.variant}>{actionInfo.label}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <ChangeSummary action={log.action} oldData={log.old_data} newData={log.new_data} />
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-muted-foreground">
                        {log.record_id.slice(0, 8)}...
                      </td>
                      <td className="px-4 py-3 text-center">
                        {expandedId === log.id ? (
                          <ChevronUp className="size-4 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="size-4 text-muted-foreground" />
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Expanded detail (rendered outside table for layout) */}
      {expandedId && (
        <Card className="mt-2 overflow-hidden">
          <AuditLogDetail log={logs.find((l) => l.id === expandedId)!} />
        </Card>
      )}

      <div className="mt-4 text-xs text-muted-foreground">
        最新{logs.length}件を表示
      </div>
    </>
  );
}
