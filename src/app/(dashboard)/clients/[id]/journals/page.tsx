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
  FileSpreadsheet,
  Download,
  AlertTriangle,
  Banknote,
  Sparkles,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AccountLookup } from "@/components/ui/account-lookup";
import { cn, formatCurrency } from "@/lib/utils";
import {
  createJournalEntry,
  importJournalEntries,
  getDescriptionSuggestions,
  type JournalImportRow,
  type JournalImportResult,
} from "@/actions/journals";
import {
  analyzeBankCsv,
  importBankJournalEntries,
  type BankCsvSuggestion,
  type BankImportResult,
} from "@/actions/bank-csv-ai";
import {
  analyzeJournalCsv,
  type JournalCsvSuggestion,
} from "@/actions/journal-csv-ai";
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

  // 摘要の予測候補（過去の摘要から）
  const [descSuggestions, setDescSuggestions] = useState<string[]>([]);
  useEffect(() => {
    getDescriptionSuggestions(id).then(setDescSuggestions).catch(() => setDescSuggestions([]));
  }, [id]);

  // ---- Receipt upload state (multi-file) ----
  type ReceiptItem = {
    id: string;
    file: File;
    previewUrl: string | null;
    status: "pending" | "uploading" | "done" | "error";
    error?: string;
  };
  const [receiptItems, setReceiptItems] = useState<ReceiptItem[]>([]);
  const [receiptUploading, setReceiptUploading] = useState(false);
  const [receiptDragOver, setReceiptDragOver] = useState(false);
  const [receiptSummary, setReceiptSummary] = useState<{ done: number; failed: number; withMemo: boolean } | null>(null);
  const [receiptMemo, setReceiptMemo] = useState("");
  const [receiptDirection, setReceiptDirection] = useState<"received" | "issued">("received");
  const receiptInputRef = useRef<HTMLInputElement>(null);

  const addReceiptFiles = (files: FileList | File[]) => {
    const arr = Array.from(files);
    if (arr.length === 0) return;
    setReceiptSummary(null);
    setReceiptItems((prev) => [
      ...prev,
      ...arr.map((file) => ({
        id: crypto.randomUUID(),
        file,
        previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
        status: "pending" as const,
      })),
    ]);
  };

  const handleReceiptFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addReceiptFiles(e.target.files);
  };

  const handleRemoveReceiptItem = (itemId: string) => {
    setReceiptItems((prev) => {
      const target = prev.find((p) => p.id === itemId);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== itemId);
    });
  };

  const handleClearAllReceipts = () => {
    receiptItems.forEach((it) => {
      if (it.previewUrl) URL.revokeObjectURL(it.previewUrl);
    });
    setReceiptItems([]);
    setReceiptSummary(null);
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
    if (e.dataTransfer.files) addReceiptFiles(e.dataTransfer.files);
  }, []);

  // ---- CSV/Excel AI解析インポート state ----
  type EditableJournalSuggestion = JournalCsvSuggestion & { selected: boolean };
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importAnalyzing, setImportAnalyzing] = useState(false);
  const [importSuggestions, setImportSuggestions] = useState<EditableJournalSuggestion[]>([]);
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [importParseError, setImportParseError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<JournalImportResult | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const parseFileToRows = async (file: File): Promise<{ header: string[]; rows: string[][] }> => {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext === "csv") {
      const text = await file.text();
      const lines = text.replace(/﻿/g, "").split(/\r?\n/).filter((l) => l.trim());
      if (lines.length === 0) return { header: [], rows: [] };
      const splitCsv = (line: string) => line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      return { header: splitCsv(lines[0]), rows: lines.slice(1).map(splitCsv) };
    }
    if (ext === "xlsx" || ext === "xlsm") {
      const ExcelJS = (await import("exceljs")).default;
      const buffer = await file.arrayBuffer();
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const sheet = wb.worksheets[0];
      if (!sheet) return { header: [], rows: [] };
      const allRows: string[][] = [];
      sheet.eachRow((row) => {
        const values = row.values as unknown[];
        const cols: string[] = [];
        for (let i = 1; i < values.length; i++) {
          const x = values[i];
          if (x == null) cols.push("");
          else if (x instanceof Date) cols.push(x.toISOString().slice(0, 10));
          else cols.push(String(x));
        }
        allRows.push(cols);
      });
      if (allRows.length === 0) return { header: [], rows: [] };
      return { header: allRows[0], rows: allRows.slice(1) };
    }
    throw new Error("対応形式: .csv / .xlsx");
  };

  const handleImportFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFile(file);
    setImportParseError(null);
    setImportResult(null);
    setImportSuggestions([]);
    setImportWarnings([]);

    setImportAnalyzing(true);
    try {
      const { header, rows } = await parseFileToRows(file);
      if (rows.length === 0) throw new Error("有効なデータ行が見つかりません");
      const analysis = await analyzeJournalCsv(id, header, rows);
      setImportSuggestions(
        analysis.suggestions.map((s) => ({ ...s, selected: s.confidence >= 0.5 }))
      );
      setImportWarnings(analysis.warnings);
    } catch (err) {
      setImportParseError(err instanceof Error ? err.message : "AI解析に失敗しました");
    } finally {
      setImportAnalyzing(false);
    }
  };

  const handleClearImport = () => {
    setImportFile(null);
    setImportSuggestions([]);
    setImportWarnings([]);
    setImportParseError(null);
    setImportResult(null);
    if (importInputRef.current) importInputRef.current.value = "";
  };

  const updateImportSuggestion = (rowIdx: number, patch: Partial<EditableJournalSuggestion>) => {
    setImportSuggestions((prev) =>
      prev.map((s) => (s.rowIdx === rowIdx ? { ...s, ...patch } : s))
    );
  };

  const handleRunImport = async () => {
    const selected = importSuggestions.filter((s) => s.selected);
    if (selected.length === 0) return;
    setImporting(true);
    try {
      const rows: JournalImportRow[] = selected.map((s) => ({
        date: s.date,
        debitAccountCode: s.debitAccountCode,
        debitAmount: s.debitAmount,
        creditAccountCode: s.creditAccountCode,
        creditAmount: s.creditAmount,
        description: s.description,
      }));
      const result = await importJournalEntries(id, rows);
      setImportResult(result);
      if (result.errors.length === 0) {
        handleClearImport();
      }
    } catch (err) {
      setImportParseError(err instanceof Error ? err.message : "インポートに失敗しました");
    } finally {
      setImporting(false);
    }
  };

  // ---- 銀行CSV AIインポート state ----
  type EditableSuggestion = BankCsvSuggestion & { selected: boolean };
  const [bankFile, setBankFile] = useState<File | null>(null);
  const [bankAnalyzing, setBankAnalyzing] = useState(false);
  const [bankSuggestions, setBankSuggestions] = useState<EditableSuggestion[]>([]);
  const [bankWarnings, setBankWarnings] = useState<string[]>([]);
  const [bankParseError, setBankParseError] = useState<string | null>(null);
  const [bankImporting, setBankImporting] = useState(false);
  const [bankResult, setBankResult] = useState<BankImportResult | null>(null);
  const bankInputRef = useRef<HTMLInputElement>(null);

  const parseBankFile = async (file: File): Promise<{ header: string[]; rows: string[][] }> => {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext === "csv") {
      const text = await file.text();
      const lines = text.replace(/﻿/g, "").split(/\r?\n/).filter((l) => l.trim());
      if (lines.length === 0) return { header: [], rows: [] };
      const splitCsv = (line: string) => line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      return {
        header: splitCsv(lines[0]),
        rows: lines.slice(1).map(splitCsv),
      };
    }
    if (ext === "xlsx" || ext === "xlsm") {
      const ExcelJS = (await import("exceljs")).default;
      const buffer = await file.arrayBuffer();
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      const sheet = wb.worksheets[0];
      if (!sheet) return { header: [], rows: [] };
      const allRows: string[][] = [];
      sheet.eachRow((row) => {
        const values = row.values as unknown[];
        const cols: string[] = [];
        for (let i = 1; i < values.length; i++) {
          const x = values[i];
          if (x == null) cols.push("");
          else if (x instanceof Date) cols.push(x.toISOString().slice(0, 10));
          else cols.push(String(x));
        }
        allRows.push(cols);
      });
      if (allRows.length === 0) return { header: [], rows: [] };
      return { header: allRows[0], rows: allRows.slice(1) };
    }
    throw new Error("対応形式: .csv / .xlsx");
  };

  const handleBankFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBankFile(file);
    setBankSuggestions([]);
    setBankWarnings([]);
    setBankParseError(null);
    setBankResult(null);

    setBankAnalyzing(true);
    try {
      const { header, rows } = await parseBankFile(file);
      if (rows.length === 0) throw new Error("有効なデータ行が見つかりません");

      const analysis = await analyzeBankCsv(id, header, rows);
      setBankSuggestions(
        analysis.suggestions.map((s) => ({ ...s, selected: s.confidence >= 0.5 }))
      );
      setBankWarnings(analysis.warnings);
    } catch (err) {
      setBankParseError(err instanceof Error ? err.message : "AI解析に失敗しました");
    } finally {
      setBankAnalyzing(false);
    }
  };

  const handleClearBank = () => {
    setBankFile(null);
    setBankSuggestions([]);
    setBankWarnings([]);
    setBankParseError(null);
    setBankResult(null);
    if (bankInputRef.current) bankInputRef.current.value = "";
  };

  const updateSuggestion = (rowIdx: number, patch: Partial<EditableSuggestion>) => {
    setBankSuggestions((prev) =>
      prev.map((s) => (s.rowIdx === rowIdx ? { ...s, ...patch } : s))
    );
  };

  const handleBankImport = async () => {
    const selected = bankSuggestions.filter((s) => s.selected);
    if (selected.length === 0) return;
    setBankImporting(true);
    try {
      const result = await importBankJournalEntries(
        id,
        selected.map((s) => ({
          date: s.date,
          debitAccountCode: s.debitAccountCode,
          creditAccountCode: s.creditAccountCode,
          amount: s.amount,
          description: s.memo,
        }))
      );
      setBankResult(result);
      if (result.errors.length === 0) {
        // 全件成功時はクリア
        handleClearBank();
      }
    } catch (err) {
      setBankParseError(err instanceof Error ? err.message : "登録に失敗しました");
    } finally {
      setBankImporting(false);
    }
  };

  const handleReceiptUpload = async () => {
    if (receiptItems.length === 0 || !user?.id) return;
    setReceiptUploading(true);
    setReceiptSummary(null);
    const hasMemo = receiptMemo.trim().length > 0;
    const memo = hasMemo ? receiptMemo.trim() : undefined;

    let doneCount = 0;
    let failedCount = 0;

    // 順次処理（並列実行はVercel Functionタイムアウト/レート制限の原因になるため避ける）
    for (const item of receiptItems) {
      // status=uploading
      setReceiptItems((prev) =>
        prev.map((p) => (p.id === item.id ? { ...p, status: "uploading", error: undefined } : p))
      );

      try {
        const formData = new FormData();
        formData.append("file", item.file);
        formData.append("client_id", id);
        formData.append("uploaded_by", user.id);
        formData.append("direction", receiptDirection);
        const result = await uploadReceipt(formData);

        // OCR/仕訳はバックグラウンド（await しない）
        if (item.file.type.startsWith("image/") || item.file.type === "application/pdf") {
          processReceiptOcr(result.id, memo).catch((err) =>
            console.error("OCR/仕訳エラー:", err instanceof Error ? err.message : err)
          );
        }

        setReceiptItems((prev) =>
          prev.map((p) => (p.id === item.id ? { ...p, status: "done" } : p))
        );
        doneCount++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "アップロードに失敗しました";
        setReceiptItems((prev) =>
          prev.map((p) => (p.id === item.id ? { ...p, status: "error", error: msg } : p))
        );
        failedCount++;
      }
    }

    setReceiptSummary({ done: doneCount, failed: failedCount, withMemo: hasMemo });
    setReceiptUploading(false);
    setReceiptMemo("");
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
      {/* 摘要の予測候補（過去の摘要） */}
      <datalist id="memo-suggestions">
        {descSuggestions.map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>
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

      {/* 領収書アップロード（複数ファイル対応） */}
      <Card className="mb-6 border-dashed border-primary/40">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Receipt className="size-5 text-primary" />
              領収書アップロード
              {receiptItems.length > 0 && (
                <span className="text-xs font-normal text-muted-foreground">
                  （{receiptItems.length}件）
                </span>
              )}
            </CardTitle>
            {receiptItems.length > 0 && !receiptUploading && (
              <button
                onClick={handleClearAllReceipts}
                className="text-xs text-muted-foreground hover:text-destructive"
              >
                すべてクリア
              </button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <input
            ref={receiptInputRef}
            type="file"
            accept="image/jpeg,image/png,application/pdf"
            multiple
            onChange={handleReceiptFileSelect}
            className="hidden"
          />

          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 min-w-0">
              {/* Drop zone（常時表示、追加可能） */}
              <div
                className={cn(
                  "flex items-center justify-center gap-3 p-4 cursor-pointer transition-all rounded-lg",
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
                    {receiptItems.length > 0
                      ? "ファイルを追加（クリックまたはドラッグ&ドロップ）"
                      : "クリックまたはドラッグ&ドロップで選択（複数可）"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    JPG, PNG, PDF対応 / 各最大10MB / 1PDF内の複数レシートも自動分割
                  </p>
                </div>
              </div>

              {/* ファイル一覧 */}
              {receiptItems.length > 0 && (
                <ul className="mt-3 space-y-2 max-h-60 overflow-y-auto">
                  {receiptItems.map((item) => (
                    <li
                      key={item.id}
                      className={cn(
                        "flex items-center gap-3 p-2 rounded-lg border",
                        item.status === "done"
                          ? "border-emerald-500/30 bg-emerald-500/5"
                          : item.status === "error"
                          ? "border-destructive/30 bg-destructive/5"
                          : item.status === "uploading"
                          ? "border-primary/30 bg-primary/5"
                          : "border-border bg-muted/30"
                      )}
                    >
                      {item.previewUrl ? (
                        <img
                          src={item.previewUrl}
                          alt=""
                          className="size-10 object-cover rounded shrink-0"
                        />
                      ) : (
                        <FileText className="size-8 text-primary shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{item.file.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {(item.file.size / 1024).toFixed(0)} KB
                          {item.error && ` — ${item.error}`}
                        </p>
                      </div>
                      <div className="shrink-0">
                        {item.status === "uploading" ? (
                          <Loader2 className="size-4 animate-spin text-primary" />
                        ) : item.status === "done" ? (
                          <Check className="size-4 text-emerald-600" />
                        ) : item.status === "error" ? (
                          <AlertTriangle className="size-4 text-destructive" />
                        ) : (
                          !receiptUploading && (
                            <button
                              onClick={() => handleRemoveReceiptItem(item.id)}
                              className="size-6 rounded-full bg-foreground/70 text-background flex items-center justify-center"
                            >
                              <X className="size-3.5" />
                            </button>
                          )
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Upload button */}
            <div className="flex items-end shrink-0">
              <Button
                size="sm"
                onClick={handleReceiptUpload}
                disabled={receiptItems.length === 0 || receiptUploading}
              >
                {receiptUploading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    処理中...
                  </>
                ) : (
                  <>
                    <Upload className="size-4" />
                    {receiptItems.length > 1 ? `${receiptItems.length}件アップロード` : "アップロード"}
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* 発行/受領 区分 */}
          {receiptItems.length > 0 && (
            <div className="mt-3">
              <label className="text-xs font-bold text-muted-foreground mb-1 block">
                区分（全ファイル共通）
              </label>
              <div className="inline-flex gap-1 bg-muted/20 p-1 rounded-lg">
                <button
                  type="button"
                  onClick={() => setReceiptDirection("received")}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-xs font-bold transition-all",
                    receiptDirection === "received" ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  受領（取引先から受取）
                </button>
                <button
                  type="button"
                  onClick={() => setReceiptDirection("issued")}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-xs font-bold transition-all",
                    receiptDirection === "issued" ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  発行（自社が発行）
                </button>
              </div>
            </div>
          )}

          {/* 確認メモ（任意） */}
          {receiptItems.length > 0 && (
            <div className="mt-3">
              <label className="text-xs font-bold text-muted-foreground mb-1 block">
                確認メモ（任意・全ファイル共通）
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

          {/* Summary */}
          {receiptSummary && (
            <div className={cn(
              "mt-3 p-2.5 rounded-lg flex items-center justify-between",
              receiptSummary.failed > 0
                ? "bg-amber-500/10 border border-amber-500/20"
                : receiptSummary.withMemo
                ? "bg-amber-500/10 border border-amber-500/20"
                : "bg-emerald-500/10 border border-emerald-500/20"
            )}>
              <div className="flex items-center gap-2">
                {receiptSummary.failed > 0 ? (
                  <AlertTriangle className="size-4 shrink-0 text-amber-600" />
                ) : (
                  <Check className="size-4 shrink-0 text-emerald-600" />
                )}
                <p className="text-sm">
                  {receiptSummary.done} 件アップロード完了
                  {receiptSummary.failed > 0 && ` / ${receiptSummary.failed} 件失敗`}
                  {receiptSummary.failed === 0 && (
                    receiptSummary.withMemo
                      ? " — 税理士の確認後に仕訳帳に反映されます"
                      : " — バックグラウンドで読取・仕訳を処理中"
                  )}
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

      {/* CSV/Excel AI仕訳インポート */}
      <Card className="mb-6 border-dashed border-primary/40">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <FileSpreadsheet className="size-5 text-primary" />
              CSV / Excel から仕訳を一括登録
              <span className="inline-flex items-center gap-1 text-xs font-normal text-primary bg-primary/10 rounded px-1.5 py-0.5">
                <Sparkles className="size-3" />
                AI解析
              </span>
            </CardTitle>
            <a
              href="/journal-import-template.csv"
              download
              className="inline-flex items-center gap-1.5 text-xs font-bold text-primary hover:underline"
            >
              <Download className="size-3.5" />
              テンプレートをダウンロード
            </a>
          </div>
          <p className="text-muted-foreground text-xs mt-1">
            列の並び・名称は任意。AIが自動マッピングし、勘定科目名→コード解決も行います。最大50行/回。
          </p>
        </CardHeader>
        <CardContent>
          <input
            ref={importInputRef}
            type="file"
            accept=".csv,.xlsx,.xlsm"
            onChange={handleImportFileSelect}
            className="hidden"
          />

          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 min-w-0">
              {importFile ? (
                <div className="relative flex items-center gap-3 p-4 rounded-lg border border-border bg-muted/30">
                  <FileSpreadsheet className="size-8 text-primary shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{importFile.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {(importFile.size / 1024).toFixed(0)} KB
                      {importAnalyzing && " / AI解析中..."}
                      {!importAnalyzing && importSuggestions.length > 0 && ` / ${importSuggestions.length}件の仕訳候補`}
                    </p>
                  </div>
                  {!importAnalyzing && !importing && (
                    <button
                      onClick={handleClearImport}
                      className="size-6 rounded-full bg-foreground/70 text-background flex items-center justify-center"
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                </div>
              ) : (
                <div
                  className="flex items-center justify-center gap-3 p-6 cursor-pointer transition-all rounded-lg border-2 border-dashed border-muted-foreground/30 bg-muted/20 hover:border-primary/50 hover:bg-muted/30"
                  onClick={() => importInputRef.current?.click()}
                >
                  <div className="size-10 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
                    <Upload className="size-5" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      クリックしてCSV / Excelファイルを選択
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      フォーマット自由 / AIが列を自動判別・勘定科目を解決
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-end shrink-0">
              <Button
                size="sm"
                onClick={handleRunImport}
                disabled={importSuggestions.length === 0 || importing || importAnalyzing}
              >
                {importing ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    登録中...
                  </>
                ) : (
                  <>
                    <Plus className="size-4" />
                    選択行を一括登録（{importSuggestions.filter((s) => s.selected).length}件）
                  </>
                )}
              </Button>
            </div>
          </div>

          {importAnalyzing && (
            <div className="mt-4 p-3 rounded-lg bg-primary/5 border border-primary/20 flex items-center gap-2">
              <Loader2 className="size-4 animate-spin text-primary" />
              <p className="text-sm">AIが仕訳データを解析中... (10〜30秒)</p>
            </div>
          )}

          {/* AIプレビュー（編集可能） */}
          {importSuggestions.length > 0 && (
            <div className="mt-4 overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead className="bg-muted/30 sticky top-0">
                  <tr>
                    <th className="px-2 py-1.5 w-8">
                      <input
                        type="checkbox"
                        checked={importSuggestions.every((s) => s.selected)}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setImportSuggestions((prev) => prev.map((s) => ({ ...s, selected: checked })));
                        }}
                      />
                    </th>
                    <th className="text-left px-2 py-1.5 font-bold text-muted-foreground">日付</th>
                    <th className="text-left px-2 py-1.5 font-bold text-muted-foreground">借方</th>
                    <th className="text-right px-2 py-1.5 font-bold text-muted-foreground">借方金額</th>
                    <th className="text-left px-2 py-1.5 font-bold text-muted-foreground">貸方</th>
                    <th className="text-right px-2 py-1.5 font-bold text-muted-foreground">貸方金額</th>
                    <th className="text-left px-2 py-1.5 font-bold text-muted-foreground">摘要</th>
                    <th className="text-center px-2 py-1.5 font-bold text-muted-foreground">信頼度</th>
                  </tr>
                </thead>
                <tbody>
                  {importSuggestions.map((s) => (
                    <tr key={s.rowIdx} className={cn("border-t border-border/50", !s.selected && "opacity-50")}>
                      <td className="px-2 py-1 text-center">
                        <input
                          type="checkbox"
                          checked={s.selected}
                          onChange={(e) => updateImportSuggestion(s.rowIdx, { selected: e.target.checked })}
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="date"
                          value={s.date}
                          onChange={(e) => updateImportSuggestion(s.rowIdx, { date: e.target.value })}
                          className="bg-transparent border-0 text-xs w-28"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="text"
                          value={s.debitAccountCode}
                          onChange={(e) => updateImportSuggestion(s.rowIdx, { debitAccountCode: e.target.value })}
                          className="bg-transparent border-0 text-xs w-16"
                          title={s.debitAccountName}
                        />
                        <span className="text-muted-foreground text-[10px] block">{s.debitAccountName}</span>
                      </td>
                      <td className="px-2 py-1 text-right">
                        <input
                          type="number"
                          value={s.debitAmount}
                          onChange={(e) => updateImportSuggestion(s.rowIdx, { debitAmount: Number(e.target.value) })}
                          className="bg-transparent border-0 text-xs w-24 text-right"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="text"
                          value={s.creditAccountCode}
                          onChange={(e) => updateImportSuggestion(s.rowIdx, { creditAccountCode: e.target.value })}
                          className="bg-transparent border-0 text-xs w-16"
                          title={s.creditAccountName}
                        />
                        <span className="text-muted-foreground text-[10px] block">{s.creditAccountName}</span>
                      </td>
                      <td className="px-2 py-1 text-right">
                        <input
                          type="number"
                          value={s.creditAmount}
                          onChange={(e) => updateImportSuggestion(s.rowIdx, { creditAmount: Number(e.target.value) })}
                          className="bg-transparent border-0 text-xs w-24 text-right"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="text"
                          value={s.description}
                          onChange={(e) => updateImportSuggestion(s.rowIdx, { description: e.target.value })}
                          className="bg-transparent border-0 text-xs w-full"
                        />
                      </td>
                      <td className="px-2 py-1 text-center">
                        <span className={cn(
                          "inline-block px-1.5 py-0.5 rounded text-[10px]",
                          s.confidence >= 0.7 ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" :
                          s.confidence >= 0.5 ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" :
                          "bg-destructive/10 text-destructive"
                        )}>
                          {(s.confidence * 100).toFixed(0)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* AI警告 */}
          {importWarnings.length > 0 && (
            <div className="mt-3 p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/20 max-h-40 overflow-y-auto">
              <p className="text-xs font-bold text-amber-700 dark:text-amber-400 mb-1">AI警告:</p>
              <ul className="text-xs text-amber-700 dark:text-amber-400 space-y-0.5">
                {importWarnings.map((w, i) => (
                  <li key={i}>・{w}</li>
                ))}
              </ul>
            </div>
          )}

          {/* パースエラー */}
          {importParseError && (
            <div className="mt-3 p-2.5 rounded-lg bg-destructive/10 border border-destructive/20">
              <p className="text-sm text-destructive">{importParseError}</p>
            </div>
          )}

          {/* インポート結果 */}
          {importResult && (
            <div className="mt-3 space-y-2">
              <div className={cn(
                "p-2.5 rounded-lg border flex items-center gap-2",
                importResult.errors.length === 0
                  ? "bg-emerald-500/10 border-emerald-500/20"
                  : "bg-amber-500/10 border-amber-500/20"
              )}>
                {importResult.errors.length === 0 ? (
                  <Check className="size-4 text-emerald-600 shrink-0" />
                ) : (
                  <AlertTriangle className="size-4 text-amber-600 shrink-0" />
                )}
                <p className={cn(
                  "text-sm",
                  importResult.errors.length === 0
                    ? "text-emerald-700 dark:text-emerald-400"
                    : "text-amber-700 dark:text-amber-400"
                )}>
                  {importResult.created} 件登録
                  {importResult.errors.length > 0 && ` / ${importResult.errors.length} 件エラー`}
                </p>
              </div>
              {importResult.errors.length > 0 && (
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 max-h-40 overflow-y-auto">
                  <ul className="text-xs divide-y divide-amber-500/10">
                    {importResult.errors.map((e, i) => (
                      <li key={i} className="px-3 py-1.5">
                        <span className="font-bold">行 {e.row}:</span> {e.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 銀行取引CSV → AI仕訳 */}
      <Card className="mb-6 border-dashed border-primary/40">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Banknote className="size-5 text-primary" />
            銀行取引CSV
            <span className="inline-flex items-center gap-1 text-xs font-normal text-primary bg-primary/10 rounded px-1.5 py-0.5">
              <Sparkles className="size-3" />
              AI仕訳
            </span>
          </CardTitle>
          <p className="text-muted-foreground text-xs mt-1">
            銀行明細のCSV/Excel（フォーマット任意・最大50行）をアップロードすると、AIが摘要を解析して仕訳を自動提案します。
          </p>
        </CardHeader>
        <CardContent>
          <input
            ref={bankInputRef}
            type="file"
            accept=".csv,.xlsx,.xlsm"
            onChange={handleBankFileSelect}
            className="hidden"
          />

          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 min-w-0">
              {bankFile ? (
                <div className="relative flex items-center gap-3 p-4 rounded-lg border border-border bg-muted/30">
                  <Banknote className="size-8 text-primary shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{bankFile.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {(bankFile.size / 1024).toFixed(0)} KB
                      {bankAnalyzing && " / AI解析中..."}
                      {!bankAnalyzing && bankSuggestions.length > 0 && ` / ${bankSuggestions.length}件の仕訳候補`}
                    </p>
                  </div>
                  {!bankAnalyzing && !bankImporting && (
                    <button
                      onClick={handleClearBank}
                      className="size-6 rounded-full bg-foreground/70 text-background flex items-center justify-center"
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                </div>
              ) : (
                <div
                  className="flex items-center justify-center gap-3 p-6 cursor-pointer transition-all rounded-lg border-2 border-dashed border-muted-foreground/30 bg-muted/20 hover:border-primary/50 hover:bg-muted/30"
                  onClick={() => bankInputRef.current?.click()}
                >
                  <div className="size-10 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
                    <Upload className="size-5" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      銀行明細CSV / Excel ファイルを選択
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      列の並びは自由 / 日付・摘要・金額が含まれていればAIが自動マッピング
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-end shrink-0">
              <Button
                size="sm"
                onClick={handleBankImport}
                disabled={bankSuggestions.length === 0 || bankImporting || bankAnalyzing}
              >
                {bankImporting ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    登録中...
                  </>
                ) : (
                  <>
                    <Plus className="size-4" />
                    選択行を一括登録（{bankSuggestions.filter((s) => s.selected).length}件）
                  </>
                )}
              </Button>
            </div>
          </div>

          {bankAnalyzing && (
            <div className="mt-4 p-3 rounded-lg bg-primary/5 border border-primary/20 flex items-center gap-2">
              <Loader2 className="size-4 animate-spin text-primary" />
              <p className="text-sm">AIが摘要・取引内容を解析中... (10〜30秒)</p>
            </div>
          )}

          {/* AIプレビュー */}
          {bankSuggestions.length > 0 && (
            <div className="mt-4 overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead className="bg-muted/30 sticky top-0">
                  <tr>
                    <th className="px-2 py-1.5 w-8">
                      <input
                        type="checkbox"
                        checked={bankSuggestions.every((s) => s.selected)}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setBankSuggestions((prev) => prev.map((s) => ({ ...s, selected: checked })));
                        }}
                      />
                    </th>
                    <th className="text-left px-2 py-1.5 font-bold text-muted-foreground">日付</th>
                    <th className="text-left px-2 py-1.5 font-bold text-muted-foreground">摘要</th>
                    <th className="text-right px-2 py-1.5 font-bold text-muted-foreground">金額</th>
                    <th className="text-left px-2 py-1.5 font-bold text-muted-foreground">借方</th>
                    <th className="text-left px-2 py-1.5 font-bold text-muted-foreground">貸方</th>
                    <th className="text-center px-2 py-1.5 font-bold text-muted-foreground">信頼度</th>
                  </tr>
                </thead>
                <tbody>
                  {bankSuggestions.map((s) => (
                    <tr
                      key={s.rowIdx}
                      className={cn(
                        "border-t border-border/50",
                        !s.selected && "opacity-50"
                      )}
                    >
                      <td className="px-2 py-1 text-center">
                        <input
                          type="checkbox"
                          checked={s.selected}
                          onChange={(e) => updateSuggestion(s.rowIdx, { selected: e.target.checked })}
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="date"
                          value={s.date}
                          onChange={(e) => updateSuggestion(s.rowIdx, { date: e.target.value })}
                          className="bg-transparent border-0 text-xs w-28"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="text"
                          value={s.memo}
                          onChange={(e) => updateSuggestion(s.rowIdx, { memo: e.target.value })}
                          className="bg-transparent border-0 text-xs w-full"
                        />
                      </td>
                      <td className="px-2 py-1 text-right">
                        <input
                          type="number"
                          value={s.amount}
                          onChange={(e) => updateSuggestion(s.rowIdx, { amount: Number(e.target.value) })}
                          className="bg-transparent border-0 text-xs w-24 text-right"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="text"
                          value={s.debitAccountCode}
                          onChange={(e) => updateSuggestion(s.rowIdx, { debitAccountCode: e.target.value })}
                          className="bg-transparent border-0 text-xs w-16"
                          title={s.debitAccountName}
                        />
                        <span className="text-muted-foreground text-[10px] block">{s.debitAccountName}</span>
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="text"
                          value={s.creditAccountCode}
                          onChange={(e) => updateSuggestion(s.rowIdx, { creditAccountCode: e.target.value })}
                          className="bg-transparent border-0 text-xs w-16"
                          title={s.creditAccountName}
                        />
                        <span className="text-muted-foreground text-[10px] block">{s.creditAccountName}</span>
                      </td>
                      <td className="px-2 py-1 text-center">
                        <span className={cn(
                          "inline-block px-1.5 py-0.5 rounded text-[10px]",
                          s.confidence >= 0.7 ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" :
                          s.confidence >= 0.5 ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" :
                          "bg-destructive/10 text-destructive"
                        )}>
                          {(s.confidence * 100).toFixed(0)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 警告 */}
          {bankWarnings.length > 0 && (
            <div className="mt-3 p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/20 max-h-40 overflow-y-auto">
              <p className="text-xs font-bold text-amber-700 dark:text-amber-400 mb-1">AI警告:</p>
              <ul className="text-xs text-amber-700 dark:text-amber-400 space-y-0.5">
                {bankWarnings.map((w, i) => (
                  <li key={i}>・{w}</li>
                ))}
              </ul>
            </div>
          )}

          {/* パースエラー */}
          {bankParseError && (
            <div className="mt-3 p-2.5 rounded-lg bg-destructive/10 border border-destructive/20">
              <p className="text-sm text-destructive">{bankParseError}</p>
            </div>
          )}

          {/* 登録結果 */}
          {bankResult && (
            <div className="mt-3 space-y-2">
              <div className={cn(
                "p-2.5 rounded-lg border flex items-center gap-2",
                bankResult.errors.length === 0
                  ? "bg-emerald-500/10 border-emerald-500/20"
                  : "bg-amber-500/10 border-amber-500/20"
              )}>
                {bankResult.errors.length === 0 ? (
                  <Check className="size-4 text-emerald-600 shrink-0" />
                ) : (
                  <AlertTriangle className="size-4 text-amber-600 shrink-0" />
                )}
                <p className="text-sm">
                  {bankResult.created} 件登録（status: draft）
                  {bankResult.errors.length > 0 && ` / ${bankResult.errors.length} 件エラー`}
                </p>
              </div>
              {bankResult.errors.length > 0 && (
                <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 max-h-40 overflow-y-auto">
                  <ul className="text-xs divide-y divide-amber-500/10">
                    {bankResult.errors.map((e, i) => (
                      <li key={i} className="px-3 py-1.5">
                        <span className="font-bold">行 {e.row}:</span> {e.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
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
                                list="memo-suggestions"
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
