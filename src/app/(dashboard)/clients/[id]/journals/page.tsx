"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import {
  Calculator,
  Plus,
  Upload,
  Loader2,
  X,
  Trash2,
  Camera,
  FileText,
  Check,
  Receipt,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AccountLookup } from "@/components/ui/account-lookup";
import { cn, formatCurrency } from "@/lib/utils";
import { createJournalEntry } from "@/actions/journals";
import { getAccounts } from "@/actions/accounts";
import { uploadReceipt } from "@/actions/receipt-storage";
import { processReceiptOcr } from "@/actions/ocr";
import { useAuth } from "@/components/providers/auth-provider";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AccountOption {
  id: string;
  code: string;
  name: string;
  categoryType: string;
  categoryName: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function JournalsPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();

  // ---- Receipt upload state ----
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreviewUrl, setReceiptPreviewUrl] = useState<string | null>(null);
  const [receiptUploading, setReceiptUploading] = useState(false);
  const [receiptDragOver, setReceiptDragOver] = useState(false);
  const [receiptSuccess, setReceiptSuccess] = useState(false);
  const [receiptSuccessWithMemo, setReceiptSuccessWithMemo] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [receiptMemo, setReceiptMemo] = useState("");
  const receiptInputRef = useRef<HTMLInputElement>(null);

  const handleReceiptFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processReceiptFile(file);
  };

  const processReceiptFile = (file: File) => {
    setReceiptError(null);
    setReceiptSuccess(false);
    setReceiptFile(file);
    if (file.type.startsWith("image/")) {
      setReceiptPreviewUrl(URL.createObjectURL(file));
    } else {
      setReceiptPreviewUrl(null);
    }
  };

  const handleClearReceiptFile = () => {
    setReceiptFile(null);
    if (receiptPreviewUrl) {
      URL.revokeObjectURL(receiptPreviewUrl);
      setReceiptPreviewUrl(null);
    }
    if (receiptInputRef.current) receiptInputRef.current.value = "";
  };

  const handleReceiptDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setReceiptDragOver(true);
  }, []);

  const handleReceiptDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setReceiptDragOver(false);
  }, []);

  const handleReceiptDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setReceiptDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processReceiptFile(file);
  }, []);

  const handleReceiptUpload = async () => {
    if (!receiptFile || !user?.id) return;
    setReceiptUploading(true);
    setReceiptError(null);
    const hasMemo = receiptMemo.trim().length > 0;
    const memo = hasMemo ? receiptMemo.trim() : undefined;
    const fileType = receiptFile.type;
    try {
      // ファイルアップロード（これだけ await）
      const formData = new FormData();
      formData.append("file", receiptFile);
      formData.append("client_id", id);
      formData.append("uploaded_by", user.id);
      const result = await uploadReceipt(formData);

      // OCR → AI仕訳はバックグラウンドで実行（await しない）
      if (fileType.startsWith("image/") || fileType === "application/pdf") {
        processReceiptOcr(result.id, memo).catch((err) =>
          console.error("OCR/仕訳エラー:", err instanceof Error ? err.message : err)
        );
      }

      setReceiptSuccessWithMemo(hasMemo);
      setReceiptSuccess(true);
      handleClearReceiptFile();
      setReceiptMemo("");
      setTimeout(() => { setReceiptSuccess(false); setReceiptSuccessWithMemo(false); }, 6000);
    } catch (err) {
      setReceiptError(err instanceof Error ? err.message : "アップロードに失敗しました");
    } finally {
      setReceiptUploading(false);
    }
  };

  // Load accounts from DB
  const [accounts, setAccounts] = useState<AccountOption[]>([]);

  useEffect(() => {
    getAccounts(id)
      .then((data) =>
        setAccounts(
          (data ?? []).map((a) => {
            const cat = a.account_categories as unknown as { type: string; name: string };
            return {
              id: a.id,
              code: a.code,
              name: a.name,
              categoryType: cat?.type ?? "",
              categoryName: cat?.name ?? "",
            };
          })
        )
      )
      .catch(console.error);
  }, [id]);

  const [saving, setSaving] = useState(false);
  const [newEntry, setNewEntry] = useState({
    date: new Date().toISOString().split("T")[0],
  });
  // 借方・貸方を独立した配列で管理（金額はstring型で入力途中の値を保持）
  const [debitLines, setDebitLines] = useState([{ account: "", amount: "" }]);
  const [creditLines, setCreditLines] = useState([{ account: "", amount: "" }]);
  // 摘要は行ごとに独立管理
  const [memos, setMemos] = useState([""]);

  const addDebitLine = () => {
    setDebitLines((prev) => [...prev, { account: "", amount: "" }]);
    setMemos((prev) => {
      const newLen = Math.max(debitLines.length + 1, creditLines.length);
      return newLen > prev.length ? [...prev, ...Array(newLen - prev.length).fill("")] : prev;
    });
  };
  const addCreditLine = () => {
    setCreditLines((prev) => [...prev, { account: "", amount: "" }]);
    setMemos((prev) => {
      const newLen = Math.max(debitLines.length, creditLines.length + 1);
      return newLen > prev.length ? [...prev, ...Array(newLen - prev.length).fill("")] : prev;
    });
  };
  const removeDebitLine = (idx: number) => setDebitLines((prev) => prev.filter((_, i) => i !== idx));
  const removeCreditLine = (idx: number) => setCreditLines((prev) => prev.filter((_, i) => i !== idx));
  const updateDebitLine = (idx: number, field: string, value: string | number) =>
    setDebitLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));
  const updateCreditLine = (idx: number, field: string, value: string | number) =>
    setCreditLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));

  // Arrow key navigation grid: [row][col] where cols = date, debitAccount, debitAmount, creditAccount, creditAmount, memo
  // The submit button is stored as a special extra row at grid[maxRows][0]
  const gridRefs = useRef<(HTMLElement | null)[][]>([]);
  const submitRef = useRef<HTMLButtonElement | null>(null);
  const setGridRef = useCallback((row: number, col: number, el: HTMLElement | null) => {
    if (!gridRefs.current[row]) gridRefs.current[row] = [];
    gridRefs.current[row][col] = el;
  }, []);
  const handleGridKeyDown = useCallback((row: number, col: number, e: React.KeyboardEvent) => {
    // IME変換中はナビゲーションしない
    if (e.nativeEvent.isComposing) return;
    const grid = gridRefs.current;
    // ArrowUp/ArrowDown: let native behavior handle (date increment, select dropdown, amount increment)
    if (e.key === "ArrowUp" || e.key === "ArrowDown") return;

    let targetRow = row;
    let targetCol = col;

    switch (e.key) {
      case "Enter":
        // Move right, wrap to next row's first available cell at end
        if (col < 5) {
          targetCol = col + 1;
        } else {
          targetRow = row + 1;
          targetCol = 0;
        }
        break;
      case "ArrowRight":
        // From 摘要 (col 5), go to submit button
        if (col === 5) {
          if (submitRef.current) {
            e.preventDefault();
            submitRef.current.focus();
          }
          return;
        }
        targetCol = col + 1;
        break;
      case "ArrowLeft": targetCol = col - 1; break;
      default: return;
    }
    // Clamp
    if (targetCol < 0 || targetCol > 5) return;
    const maxRow = grid.length;
    if (targetRow >= maxRow) {
      // Past last row → submit button
      if (submitRef.current) {
        e.preventDefault();
        submitRef.current.focus();
      }
      return;
    }
    let cell = grid[targetRow]?.[targetCol];
    if (!cell && (e.key === "Enter" || e.key === "ArrowRight")) {
      // Skip null cells
      for (let c = targetCol + 1; c <= 5; c++) {
        cell = grid[targetRow]?.[c];
        if (cell) break;
      }
    }
    if (cell) {
      e.preventDefault();
      cell.focus();
    }
  }, []);
  const handleSubmitKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft") return;
    const grid = gridRefs.current;
    const lastRow = grid.length - 1;
    // Go to last row's last available cell
    for (let c = 5; c >= 0; c--) {
      const cell = grid[lastRow]?.[c];
      if (cell) {
        e.preventDefault();
        cell.focus();
        return;
      }
    }
  }, []);

  const toHalfWidth = (v: string) => v.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
  const parseAmount = (v: string) => Number(toHalfWidth(v)) || 0;
  const lineTotalDebit = debitLines.reduce((s, l) => s + parseAmount(l.amount), 0);
  const lineTotalCredit = creditLines.reduce((s, l) => s + parseAmount(l.amount), 0);
  const linesBalanced = lineTotalDebit === lineTotalCredit && lineTotalDebit > 0;

  // Build description from memos
  const buildDescription = () => {
    const allMemos = memos
      .map((m) => m.trim())
      .filter((m) => !!m);
    const uniqueMemos = [...new Set(allMemos)];
    return uniqueMemos.join(" / ");
  };

  const handleCreateJournal = async () => {
    const desc = buildDescription();

    // 科目未選択チェック（金額入力済みの行）
    const debitWithAmount = debitLines.filter((l) => parseAmount(l.amount) > 0);
    const creditWithAmount = creditLines.filter((l) => parseAmount(l.amount) > 0);
    const debitNoAccount = debitLines.some((l) => !l.account && parseAmount(l.amount) === 0 && debitLines.length === 1);
    const creditNoAccount = creditLines.some((l) => !l.account && parseAmount(l.amount) === 0 && creditLines.length === 1);

    // 科目未選択チェック
    const allDebitsNoAccount = debitLines.every((l) => !l.account);
    const allCreditsNoAccount = creditLines.every((l) => !l.account);
    if (allDebitsNoAccount || allCreditsNoAccount) {
      alert("科目を選択してください");
      return;
    }

    // 金額入力済みだが科目未選択
    if (debitWithAmount.some((l) => !l.account) || creditWithAmount.some((l) => !l.account)) {
      alert("科目を選択してください");
      return;
    }

    // 何も入力されていない
    if (debitWithAmount.length === 0 && creditWithAmount.length === 0) {
      alert("金額を入力してください");
      return;
    }

    // 貸借不一致
    if (!linesBalanced) {
      alert(`貸借が一致していません（借方: ${formatCurrency(lineTotalDebit)} / 貸方: ${formatCurrency(lineTotalCredit)}）`);
      return;
    }

    const validDebits = debitWithAmount;
    const validCredits = creditWithAmount;

    const lines = [
      ...validDebits.map((l) => ({
        account_id: l.account,
        debit_amount: parseAmount(l.amount),
        credit_amount: 0,
      })),
      ...validCredits.map((l) => ({
        account_id: l.account,
        debit_amount: 0,
        credit_amount: parseAmount(l.amount),
      })),
    ];

    setSaving(true);
    try {
      await createJournalEntry(
        {
          client_id: id,
          entry_date: newEntry.date,
          description: desc,
          status: "draft",
          source: "manual",
          created_by: id,
        },
        lines
      );
      window.location.reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : "仕訳の作成に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {/* Page Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Calculator className="size-6 text-primary" />
            仕訳入力
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            クライアントID: {id}
          </p>
        </div>
      </div>

      {/* 領収書アップロード */}
      <Card className="mb-6 border-dashed border-primary/40">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Receipt className="size-5 text-primary" />
            領収書アップロード
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Hidden file input */}
          <input
            ref={receiptInputRef}
            type="file"
            accept="image/jpeg,image/png,application/pdf"
            onChange={handleReceiptFileSelect}
            className="hidden"
          />

          <div className="flex flex-col md:flex-row gap-4">
            {/* Drop zone / preview */}
            <div className="flex-1 min-w-0">
              {receiptFile && receiptPreviewUrl ? (
                <div className="relative rounded-lg overflow-hidden border border-border">
                  <img
                    src={receiptPreviewUrl}
                    alt="プレビュー"
                    className="w-full max-h-40 object-contain bg-muted/30"
                  />
                  <button
                    onClick={handleClearReceiptFile}
                    className="absolute top-1.5 right-1.5 size-6 rounded-full bg-foreground/70 text-background flex items-center justify-center"
                  >
                    <X className="size-3.5" />
                  </button>
                  <div className="px-3 py-1.5 bg-card border-t border-border">
                    <p className="text-xs text-muted-foreground truncate">
                      {receiptFile.name} ({(receiptFile.size / 1024).toFixed(0)} KB)
                    </p>
                  </div>
                </div>
              ) : receiptFile ? (
                <div className="relative flex items-center gap-3 p-4 rounded-lg border border-border bg-muted/30">
                  <FileText className="size-8 text-primary shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{receiptFile.name}</p>
                    <p className="text-xs text-muted-foreground">PDF / {(receiptFile.size / 1024).toFixed(0)} KB</p>
                  </div>
                  <button
                    onClick={handleClearReceiptFile}
                    className="absolute top-1.5 right-1.5 size-6 rounded-full bg-foreground/70 text-background flex items-center justify-center"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ) : (
                <div
                  className={cn(
                    "flex items-center justify-center gap-3 p-6 cursor-pointer transition-all rounded-lg",
                    "border-2 border-dashed",
                    receiptDragOver
                      ? "border-primary bg-primary/10"
                      : "border-muted-foreground/30 bg-muted/20 hover:border-primary/50 hover:bg-muted/30"
                  )}
                  onClick={() => receiptInputRef.current?.click()}
                  onDragOver={handleReceiptDragOver}
                  onDragLeave={handleReceiptDragLeave}
                  onDrop={handleReceiptDrop}
                >
                  <div className="size-10 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
                    <Camera className="size-5" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      クリックまたはドラッグ&ドロップで選択
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      JPG, PNG, PDF対応 / 最大10MB
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Upload button */}
            <div className="flex items-end shrink-0">
              <Button
                size="sm"
                onClick={handleReceiptUpload}
                disabled={!receiptFile || receiptUploading}
              >
                {receiptUploading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    アップロード中...
                  </>
                ) : (
                  <>
                    <Upload className="size-4" />
                    アップロード
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* 確認メモ（任意） */}
          {receiptFile && (
            <div className="mt-3">
              <label className="text-xs font-bold text-muted-foreground mb-1 block">
                確認メモ（任意）
              </label>
              <textarea
                value={receiptMemo}
                onChange={(e) => setReceiptMemo(e.target.value)}
                placeholder="不明点や質問があれば記入してください。記入すると税理士の確認後に仕訳帳に反映されます。"
                rows={2}
                className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm placeholder:text-muted-foreground resize-none"
              />
              {receiptMemo.trim() && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                  ※ メモが入力されているため、税理士の確認後に仕訳帳に反映されます
                </p>
              )}
            </div>
          )}

          {/* Error */}
          {receiptError && (
            <div className="mt-3 p-2.5 rounded-lg bg-destructive/10 border border-destructive/20">
              <p className="text-sm text-destructive">{receiptError}</p>
            </div>
          )}

          {/* Success */}
          {receiptSuccess && (
            <div className={cn(
              "mt-3 p-2.5 rounded-lg flex items-center justify-between",
              receiptSuccessWithMemo
                ? "bg-amber-500/10 border border-amber-500/20"
                : "bg-emerald-500/10 border border-emerald-500/20"
            )}>
              <div className="flex items-center gap-2">
                <Check className={cn("size-4 shrink-0", receiptSuccessWithMemo ? "text-amber-600" : "text-emerald-600")} />
                <p className={cn("text-sm", receiptSuccessWithMemo ? "text-amber-700 dark:text-amber-400" : "text-emerald-700 dark:text-emerald-400")}>
                  {receiptSuccessWithMemo
                    ? "アップロード完了 — 税理士の確認後に仕訳帳に反映されます"
                    : "アップロード完了 — バックグラウンドで読取・仕訳を処理中"}
                </p>
              </div>
              <Link
                href={`/clients/${id}/receipts`}
                className="text-xs font-bold text-primary hover:underline shrink-0"
              >
                領収書管理で確認 →
              </Link>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 新規仕訳フォーム（常時表示） */}
      <Card className="mb-6 border-primary/30">
        <CardHeader>
          <CardTitle>新規仕訳</CardTitle>
        </CardHeader>
          <CardContent>
            {(() => {
              const maxRows = Math.max(debitLines.length, creditLines.length);
              return (
                <table className="w-full text-sm mb-4">
                  <thead>
                    <tr className="border-b-2 border-border">
                      <th rowSpan={2} className="text-center py-2 text-xs font-bold text-muted-foreground border-r border-border w-[120px]">日付</th>
                      <th colSpan={2} className="text-center py-2 text-xs font-bold text-muted-foreground border-r border-border bg-blue-50/50 dark:bg-blue-950/20">借方</th>
                      <th colSpan={2} className="text-center py-2 text-xs font-bold text-muted-foreground border-r border-border bg-red-50/50 dark:bg-red-950/20">貸方</th>
                      <th rowSpan={2} className="text-center py-2 text-xs font-bold text-muted-foreground">摘要</th>
                      <th rowSpan={2} className="w-10" />
                    </tr>
                    <tr className="border-b border-border">
                      <th className="text-center py-1.5 px-2 text-xs font-bold text-muted-foreground border-r border-border/50 bg-blue-50/30 dark:bg-blue-950/10">勘定科目</th>
                      <th className="text-center py-1.5 px-2 text-xs font-bold text-muted-foreground border-r border-border bg-blue-50/30 dark:bg-blue-950/10 w-[15%]">金額</th>
                      <th className="text-center py-1.5 px-2 text-xs font-bold text-muted-foreground border-r border-border/50 bg-red-50/30 dark:bg-red-950/10">勘定科目</th>
                      <th className="text-center py-1.5 px-2 text-xs font-bold text-muted-foreground border-r border-border bg-red-50/30 dark:bg-red-950/10 w-[15%]">金額</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: maxRows }, (_, idx) => {
                      const dl = debitLines[idx];
                      const cl = creditLines[idx];
                      return (
                        <tr key={idx} className="border-b border-border/50">
                          {idx === 0 ? (
                            <td rowSpan={maxRows} className="py-1.5 px-1 border-r border-border align-top">
                              <input
                                ref={(el) => setGridRef(idx, 0, el)}
                                type="date"
                                value={newEntry.date}
                                onChange={(e) => {
                                  setNewEntry({ ...newEntry, date: e.target.value });
                                  e.target.focus();
                                }}
                                onKeyDown={(e) => { if (e.key === "Enter") handleGridKeyDown(idx, 0, e); }}
                                className="w-full bg-card border border-border rounded px-2 py-1.5 text-sm"
                              />
                            </td>
                          ) : null}
                          {/* 借方科目 */}
                          <td className="py-1.5 px-1 border-r border-border/50">
                            {dl ? (
                              <div className="flex items-center gap-1">
                                <AccountLookup accounts={accounts} value={dl.account} onChange={(v) => updateDebitLine(idx, "account", v)} inputRef={(el) => setGridRef(idx, 1, el)} onKeyDown={(e) => handleGridKeyDown(idx, 1, e)} />
                                {debitLines.length > 1 && (
                                  <button onClick={() => removeDebitLine(idx)} className="text-destructive hover:text-destructive/80 shrink-0">
                                    <Trash2 className="size-3.5" />
                                  </button>
                                )}
                              </div>
                            ) : null}
                          </td>
                          {/* 借方金額 */}
                          <td className="py-1.5 px-1 border-r border-border w-[15%]">
                            {dl ? (
                              <input
                                ref={(el) => setGridRef(idx, 2, el)}
                                type="number"
                                min="0"
                                step="1"
                                value={dl.amount}
                                onChange={(e) => updateDebitLine(idx, "amount", toHalfWidth(e.target.value))}
                                onKeyDown={(e) => { if (e.key === "e" || e.key === "E" || e.key === "+" || e.key === "-") e.preventDefault(); handleGridKeyDown(idx, 2, e); }}
                                placeholder="0"
                                className="w-full bg-card border border-border rounded px-2 py-1.5 text-sm text-right font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              />
                            ) : null}
                          </td>
                          {/* 貸方科目 */}
                          <td className="py-1.5 px-1 border-r border-border/50">
                            {cl ? (
                              <div className="flex items-center gap-1">
                                <AccountLookup accounts={accounts} value={cl.account} onChange={(v) => updateCreditLine(idx, "account", v)} inputRef={(el) => setGridRef(idx, 3, el)} onKeyDown={(e) => handleGridKeyDown(idx, 3, e)} />
                                {creditLines.length > 1 && (
                                  <button onClick={() => removeCreditLine(idx)} className="text-destructive hover:text-destructive/80 shrink-0">
                                    <Trash2 className="size-3.5" />
                                  </button>
                                )}
                              </div>
                            ) : null}
                          </td>
                          {/* 貸方金額 */}
                          <td className="py-1.5 px-1 border-r border-border w-[15%]">
                            {cl ? (
                              <input
                                ref={(el) => setGridRef(idx, 4, el)}
                                type="number"
                                min="0"
                                step="1"
                                value={cl.amount}
                                onChange={(e) => updateCreditLine(idx, "amount", toHalfWidth(e.target.value))}
                                onKeyDown={(e) => { if (e.key === "e" || e.key === "E" || e.key === "+" || e.key === "-") e.preventDefault(); handleGridKeyDown(idx, 4, e); }}
                                placeholder="0"
                                className="w-full bg-card border border-border rounded px-2 py-1.5 text-sm text-right font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              />
                            ) : null}
                          </td>
                          {/* 摘要 */}
                          <td className="py-1.5 px-1 border-l border-border">
                            {(dl || cl) ? (
                              <input
                                ref={(el) => setGridRef(idx, 5, el)}
                                type="text"
                                value={memos[idx] ?? ""}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setMemos((prev) => {
                                    const next = [...prev];
                                    next[idx] = v;
                                    return next;
                                  });
                                }}
                                onKeyDown={(e) => handleGridKeyDown(idx, 5, e)}
                                placeholder="摘要..."
                                className="w-full bg-card border border-border rounded px-2 py-1.5 text-sm"
                              />
                            ) : null}
                          </td>
                          <td />
                        </tr>
                      );
                    })}
                    <tr className="border-t border-border/50">
                      <td className="py-2 px-1 border-r border-border" />
                      <td colSpan={2} className="py-2 px-1 border-r border-border text-center">
                        <button
                          onClick={addDebitLine}
                          className="inline-flex items-center justify-center size-7 rounded-full border-2 border-blue-400 dark:border-blue-600 text-blue-500 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors"
                          title="借方行追加"
                        >
                          <Plus className="size-4" />
                        </button>
                      </td>
                      <td colSpan={2} className="py-2 px-1 border-r border-border text-center">
                        <button
                          onClick={addCreditLine}
                          className="inline-flex items-center justify-center size-7 rounded-full border-2 border-red-400 dark:border-red-600 text-red-500 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                          title="貸方行追加"
                        >
                          <Plus className="size-4" />
                        </button>
                      </td>
                      <td />
                      <td />
                    </tr>
                    <tr className="font-bold border-t-2 border-border">
                      <td className="py-2 px-2 text-center text-foreground border-r border-border">合計</td>
                      <td className="py-2 px-2 border-r border-border/50" />
                      <td className="py-2 px-2 text-right font-mono border-r border-border">{formatCurrency(lineTotalDebit)}</td>
                      <td className="py-2 px-2 border-r border-border/50" />
                      <td className="py-2 px-2 text-right font-mono border-r border-border">{formatCurrency(lineTotalCredit)}</td>
                      <td className="py-2 px-2" />
                      <td />
                    </tr>
                  </tbody>
                </table>
              );
            })()}

            <div className="flex items-center justify-end">
              <Button ref={submitRef} onClick={handleCreateJournal} disabled={saving} onKeyDown={handleSubmitKeyDown}>
                {saving && <Loader2 className="size-4 animate-spin" />}
                仕訳を登録
              </Button>
            </div>
          </CardContent>
        </Card>

    </>
  );
}
