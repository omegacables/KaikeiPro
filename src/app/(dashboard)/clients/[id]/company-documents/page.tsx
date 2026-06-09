"use client";

import { useState, useEffect, useCallback, use, useRef } from "react";
import {
  FolderArchive,
  Plus,
  Loader2,
  X,
  Pencil,
  Trash2,
  Download,
  FileText,
  Upload,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/components/providers/auth-provider";
import {
  getCompanyDocuments,
  uploadCompanyDocument,
  updateCompanyDocument,
  getCompanyDocumentUrl,
  deleteCompanyDocument,
} from "@/actions/company-documents";
import type { CompanyDocument, CompanyDocType } from "@/types/index";

const docTypeLabel: Record<CompanyDocType, string> = {
  articles: "定款",
  registry: "登記簿謄本",
  tax_filing: "届出控え",
  license: "許認可",
  other: "その他",
};
const docTypeOrder: CompanyDocType[] = [
  "articles",
  "registry",
  "tax_filing",
  "license",
  "other",
];

const inputCls =
  "w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/40";

function formatSize(bytes: number | null): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function CompanyDocumentsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { user } = useAuth();
  const [docs, setDocs] = useState<CompanyDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState<CompanyDocType>("articles");
  const [title, setTitle] = useState("");
  const [issuedDate, setIssuedDate] = useState("");
  const [memo, setMemo] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getCompanyDocuments(id);
      setDocs(data);
    } catch {
      // DB not available
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function openCreate() {
    setEditingId(null);
    setFile(null);
    setDocType("articles");
    setTitle("");
    setIssuedDate("");
    setMemo("");
    setShowForm(true);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function openEdit(d: CompanyDocument) {
    setEditingId(d.id);
    setFile(null);
    setDocType(d.doc_type);
    setTitle(d.title);
    setIssuedDate(d.issued_date ?? "");
    setMemo(d.memo ?? "");
    setShowForm(true);
    setError(null);
  }

  async function handleSave() {
    setBusy("save");
    setError(null);
    try {
      if (editingId) {
        await updateCompanyDocument(editingId, {
          doc_type: docType,
          title: title.trim() || "無題",
          issued_date: issuedDate || null,
          memo: memo.trim() || null,
        });
      } else {
        if (!file) {
          setError("ファイルを選択してください");
          setBusy(null);
          return;
        }
        const fd = new FormData();
        fd.append("file", file);
        fd.append("client_id", id);
        if (user?.id) fd.append("uploaded_by", user.id);
        fd.append("doc_type", docType);
        fd.append("title", title.trim());
        if (issuedDate) fd.append("issued_date", issuedDate);
        if (memo.trim()) fd.append("memo", memo.trim());
        await uploadCompanyDocument(fd);
      }
      setShowForm(false);
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setBusy(null);
    }
  }

  async function handleDownload(d: CompanyDocument) {
    setBusy(d.id);
    try {
      const url = await getCompanyDocumentUrl(d.file_path);
      if (url) window.open(url, "_blank", "noopener,noreferrer");
      else setError("ファイルURLの取得に失敗しました");
    } catch (e) {
      setError(e instanceof Error ? e.message : "取得に失敗しました");
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete(d: CompanyDocument) {
    if (!confirm(`「${d.title}」を削除しますか？（ファイルも削除されます）`)) return;
    setBusy(d.id);
    try {
      await deleteCompanyDocument(d.id);
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除に失敗しました");
    } finally {
      setBusy(null);
    }
  }

  const grouped = docTypeOrder
    .map((t) => ({ type: t, items: docs.filter((d) => d.doc_type === t) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="space-y-6">
      {/* ヘッダー */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FolderArchive className="size-6 text-primary" />
          <h1 className="text-xl font-bold">会社書類</h1>
        </div>
        <Button onClick={openCreate}>
          <Plus className="size-4" />
          書類を追加
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        定款・登記簿謄本・税務署等への届出控え・許認可など、取引に紐づかない会社の参照書類を保管します（PDF / JPG / PNG・最大10MB）。
      </p>

      {error && (
        <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="size-5 animate-spin mr-2" />
          読み込み中...
        </div>
      ) : docs.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            会社書類はまだありません。「書類を追加」からアップロードしてください。
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {grouped.map(({ type, items }) => (
            <Card key={type}>
              <CardHeader>
                <CardTitle className="text-base">
                  {docTypeLabel[type]}（{items.length}件）
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {items.map((d) => {
                    const isBusy = busy === d.id;
                    return (
                      <div
                        key={d.id}
                        className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5"
                      >
                        <FileText className="size-5 text-muted-foreground shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate" title={d.title}>
                            {d.title}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {d.original_filename}
                            {d.file_size ? ` ・ ${formatSize(d.file_size)}` : ""}
                            {d.issued_date ? ` ・ ${d.issued_date}` : ""}
                          </p>
                          {d.memo && (
                            <p className="text-xs text-muted-foreground/80 truncate">
                              {d.memo}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => handleDownload(d)}
                            disabled={isBusy}
                            title="表示・ダウンロード"
                            className="p-1.5 rounded hover:bg-muted text-primary"
                          >
                            {isBusy ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <Download className="size-4" />
                            )}
                          </button>
                          <button
                            onClick={() => openEdit(d)}
                            className="p-1.5 rounded hover:bg-muted text-muted-foreground"
                            title="編集"
                          >
                            <Pencil className="size-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(d)}
                            disabled={isBusy}
                            className="p-1.5 rounded hover:bg-muted text-destructive"
                            title="削除"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* フォーム（モーダル） */}
      {showForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={() => setShowForm(false)}
        >
          <div
            className="bg-card border border-border rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="font-bold">{editingId ? "書類を編集" : "書類を追加"}</h2>
              <button onClick={() => setShowForm(false)} className="p-1 rounded hover:bg-muted">
                <X className="size-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {!editingId && (
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    ファイル（PDF / JPG / PNG・最大10MB）
                  </label>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full flex items-center justify-center gap-2 p-3 rounded-lg border border-dashed border-border text-sm text-muted-foreground hover:bg-muted/30 transition-colors"
                  >
                    <Upload className="size-4" />
                    {file ? file.name : "ファイルを選択"}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,application/pdf"
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      setFile(f);
                      if (f && !title.trim())
                        setTitle(f.name.replace(/\.[^.]+$/, ""));
                    }}
                    className="hidden"
                  />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">種類</label>
                  <select
                    value={docType}
                    onChange={(e) => setDocType(e.target.value as CompanyDocType)}
                    className={inputCls}
                  >
                    {docTypeOrder.map((t) => (
                      <option key={t} value={t}>
                        {docTypeLabel[t]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    作成日・取得日
                  </label>
                  <input
                    type="date"
                    value={issuedDate}
                    onChange={(e) => setIssuedDate(e.target.value)}
                    className={inputCls}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">書類名</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className={inputCls}
                  placeholder="例: 定款（2024年改定）"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">メモ</label>
                <input
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  className={inputCls}
                  placeholder="（任意）"
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
              <Button variant="outline" onClick={() => setShowForm(false)}>
                キャンセル
              </Button>
              <Button onClick={handleSave} disabled={busy === "save"}>
                {busy === "save" && <Loader2 className="size-4 animate-spin" />}
                {editingId ? "保存" : "アップロード"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
