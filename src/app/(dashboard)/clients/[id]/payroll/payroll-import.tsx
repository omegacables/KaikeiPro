"use client";

/**
 * 給与台帳・給与明細の取り込み（ドラッグ&ドロップ）。
 *
 *   CSV・TSV（UTF-8 / Shift_JIS）・Excel（.xlsx）・文字の入ったPDF … このブラウザの中で表に直して読む
 *   画像・スキャンしたPDF … 「AIで読み取る」を押したときだけ、AI（Google Gemini）に表を書き写してもらう
 *
 * 読んだ結果は登録の前に一覧で見せ、氏名・区分・対象月を直してから登録する。
 * 同じ月・同じ氏名が登録済みなら飛ばす（同じファイルを2回入れても二重にならない）。
 */

import { useRef, useState } from "react";
import { UploadCloud, Loader2, AlertTriangle, Sparkles, X, Check } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MonthInput } from "@/components/ui/month-input";
import { cn, formatCurrency } from "@/lib/utils";
import { parsePayrollGrid, type PayrollDraft } from "@/lib/payroll-import";
import { decodeText, gridFromText, gridsFromExcel, gridsFromPdf, payrollFileKind } from "@/lib/payroll-file";
import { importPayrollRecords, transcribePayrollWithAi } from "@/actions/payroll";

type Row = PayrollDraft & { key: string; file: string; include: boolean };
type FileNote = { file: string; message: string; aiFile?: File };

const MAX_SIZE = 10 * 1024 * 1024;
const cellCls = "px-2 py-1 rounded-md border border-border bg-background text-xs";

const deductionsOf = (r: PayrollDraft) =>
  r.income_tax + r.resident_tax + r.health_insurance + r.pension_insurance + r.employment_insurance + r.other_deduction;

let seq = 0;
const toRows = (file: string, drafts: PayrollDraft[]): Row[] =>
  drafts.map((d) => ({ ...d, key: `r${++seq}`, file, include: Boolean(d.employee_name && d.pay_month) }));

/** 1つのファイルを読む。読めなければ理由（AIで読めるならそのファイル）を返す */
async function readFile(file: File): Promise<{ rows: Row[]; note?: FileNote }> {
  const kind = payrollFileKind(file.name, file.type);
  if (file.size > MAX_SIZE) return { rows: [], note: { file: file.name, message: "10MBを超えています" } };
  if (kind === "unsupported") {
    const xls = /\.xls$/i.test(file.name);
    return {
      rows: [],
      note: {
        file: file.name,
        message: xls
          ? "古い Excel（.xls）は読めません。Excel で「.xlsx」として保存し直してください"
          : "対応形式: CSV・TSV・Excel（.xlsx）・PDF・画像（JPG・PNG）",
      },
    };
  }
  if (kind === "image") {
    return { rows: [], note: { file: file.name, message: "画像は AI で読み取ります", aiFile: file } };
  }
  const opts = { fileName: file.name };
  if (kind === "text") {
    const r = parsePayrollGrid(gridFromText(decodeText(new Uint8Array(await file.arrayBuffer()))), opts);
    return { rows: toRows(file.name, r.records), note: r.records.length ? undefined : { file: file.name, message: r.warnings.join(" ") } };
  }
  if (kind === "excel") {
    const sheets = await gridsFromExcel(await file.arrayBuffer());
    const drafts = sheets.flatMap((s) => parsePayrollGrid(s.grid, opts).records);
    return {
      rows: toRows(file.name, drafts),
      note: drafts.length ? undefined : { file: file.name, message: "給与の項目（氏名・支給額・控除など）が見つかりませんでした" },
    };
  }
  // PDF: 文字が入っていればそのまま読む。読めなければ（スキャンしたPDFなど）AIへ
  const pages = await gridsFromPdf(new Uint8Array(await file.arrayBuffer())).catch(() => [] as string[][][]);
  const drafts = pages.flatMap((g) => parsePayrollGrid(g, opts).records);
  if (drafts.length) return { rows: toRows(file.name, drafts) };
  return {
    rows: [],
    note: { file: file.name, message: "PDFから給与の文字を読み取れませんでした（スキャンしたPDFなど）", aiFile: file },
  };
}

export function PayrollImport({ clientId, onImported }: { clientId: string; onImported: (month: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [reading, setReading] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [notes, setNotes] = useState<FileNote[]>([]);
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 連打で二重に登録しないよう、state の反映を待たずに止める
  const lock = useRef(false);

  const handleFiles = async (files: File[]) => {
    if (!files.length) return;
    setReading(true);
    setError(null);
    setResult(null);
    const newRows: Row[] = [];
    const newNotes: FileNote[] = [];
    for (const f of files) {
      try {
        const r = await readFile(f);
        newRows.push(...r.rows);
        if (r.note) newNotes.push(r.note);
      } catch (e) {
        newNotes.push({ file: f.name, message: e instanceof Error ? e.message : "読み込めませんでした" });
      }
    }
    setRows((prev) => [...prev, ...newRows]);
    setNotes((prev) => [...prev, ...newNotes]);
    setReading(false);
  };

  const readWithAi = async (note: FileNote) => {
    if (!note.aiFile) return;
    setAiBusy(note.file);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", note.aiFile);
      const grid = await transcribePayrollWithAi(clientId, fd);
      const r = parsePayrollGrid(grid, { fileName: note.file });
      if (!r.records.length) throw new Error("AIでも給与の項目を読み取れませんでした");
      setRows((prev) => [...prev, ...toRows(note.file, r.records)]);
      setNotes((prev) => prev.filter((n) => n !== note));
    } catch (e) {
      setError(`${note.file}: ${e instanceof Error ? e.message : "AIで読み取れませんでした"}`);
    } finally {
      setAiBusy(null);
    }
  };

  const update = (key: string, patch: Partial<Row>) =>
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        const next = { ...r, ...patch };
        // 氏名・対象月がそろったら、取り込む印を付ける
        if (("employee_name" in patch || "pay_month" in patch) && next.employee_name && next.pay_month) next.include = true;
        return next;
      })
    );

  const targets = rows.filter((r) => r.include && r.employee_name.trim() && r.pay_month);

  const register = async () => {
    if (lock.current || targets.length === 0) return;
    lock.current = true;
    setSaving(true);
    setError(null);
    try {
      const res = await importPayrollRecords(
        clientId,
        targets.map((r) => ({
          employee_name: r.employee_name.trim(),
          employee_type: r.employee_type,
          pay_month: r.pay_month!,
          pay_date: r.pay_date,
          gross_salary: r.gross_salary,
          income_tax: r.income_tax,
          resident_tax: r.resident_tax,
          health_insurance: r.health_insurance,
          pension_insurance: r.pension_insurance,
          employment_insurance: r.employment_insurance,
          other_deduction: r.other_deduction,
        }))
      );
      const skippedText = res.skipped.map((s) => `${s.employee_name}（${s.pay_month}）: ${s.reason}`).join(" / ");
      setResult(`${res.created}件を登録しました。${res.skipped.length ? `飛ばしたもの ${res.skipped.length}件: ${skippedText}` : ""}`);
      // 登録したものだけ一覧から外す（失敗・飛ばしたものは残す）
      const done = new Set(targets.map((r) => r.key));
      const skippedKeys = new Set(res.skipped.map((s) => `${s.employee_name}|${s.pay_month}`));
      setRows((prev) => prev.filter((r) => !done.has(r.key) || skippedKeys.has(`${r.employee_name.trim()}|${r.pay_month}`)));
      if (res.created > 0) onImported(targets[0].pay_month!);
    } catch (e) {
      setError(e instanceof Error ? e.message : "登録に失敗しました");
    } finally {
      setSaving(false);
      lock.current = false;
    }
  };

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(Array.from(e.dataTransfer.files));
        }}
        onClick={() => !reading && inputRef.current?.click()}
        className={cn(
          "flex flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-xl border-2 border-dashed px-4 py-3 text-center transition-colors cursor-pointer",
          dragOver ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40"
        )}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".csv,.tsv,.txt,.xlsx,.xlsm,.pdf,image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) handleFiles(Array.from(e.target.files));
            e.target.value = "";
          }}
        />
        {reading ? (
          <Loader2 className="size-6 shrink-0 text-primary animate-spin" />
        ) : (
          <UploadCloud className={cn("size-6 shrink-0", dragOver ? "text-primary" : "text-muted-foreground")} />
        )}
        <div className="text-left">
          <div className="text-sm font-bold text-foreground">給与台帳・給与明細をドラッグ&ドロップ、またはクリックして選択</div>
          <p className="text-xs text-muted-foreground">
            CSV・Excel（.xlsx）・PDF・画像（複数可）。給与ソフトの書き出し・自作の明細のどちらも読み、登録の前に確かめられます
          </p>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {result && (
        <p className="flex items-center gap-1.5 text-sm text-success">
          <Check className="size-4" />
          {result}
        </p>
      )}

      {notes.map((n) => (
        <div
          key={n.file + n.message}
          className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs"
        >
          <AlertTriangle className="size-4 shrink-0 text-warning" />
          <span className="font-bold">{n.file}</span>
          <span className="text-muted-foreground">{n.message}</span>
          {n.aiFile && (
            <Button size="sm" variant="outline" onClick={() => readWithAi(n)} disabled={aiBusy === n.file}>
              {aiBusy === n.file ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              AIで読み取る（画像をGoogle Geminiに送ります）
            </Button>
          )}
          <button
            onClick={() => setNotes((prev) => prev.filter((x) => x !== n))}
            className="ml-auto text-muted-foreground hover:text-foreground cursor-pointer"
            aria-label="閉じる"
          >
            <X className="size-4" />
          </button>
        </div>
      ))}

      {rows.length > 0 && (
        <Card className="p-0 overflow-x-auto">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
            <div className="text-sm font-bold">読み取った給与（{rows.length}件）— 確かめてから登録してください</div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => setRows([])}>
                すべて取り消す
              </Button>
              <Button size="sm" onClick={register} disabled={saving || targets.length === 0}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                {targets.length}件を登録
              </Button>
            </div>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-2 py-2">登録</th>
                <th className="px-2 py-2">氏名</th>
                <th className="px-2 py-2">区分</th>
                <th className="px-2 py-2">対象月</th>
                <th className="px-2 py-2">支給日</th>
                <th className="px-2 py-2 text-right">総支給額</th>
                <th className="px-2 py-2 text-right">控除合計</th>
                <th className="px-2 py-2 text-right">差引支給額</th>
                <th className="px-2 py-2">注意・ファイル</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-border last:border-0 align-top">
                  <td className="px-2 py-1.5">
                    <input
                      type="checkbox"
                      checked={r.include}
                      onChange={(e) => update(r.key, { include: e.target.checked })}
                      className="size-4 cursor-pointer"
                      aria-label="登録する"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      className={cn(cellCls, "w-32")}
                      value={r.employee_name}
                      onChange={(e) => update(r.key, { employee_name: e.target.value })}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <select
                      className={cellCls}
                      value={r.employee_type}
                      onChange={(e) => update(r.key, { employee_type: e.target.value as Row["employee_type"] })}
                    >
                      <option value="employee">従業員</option>
                      <option value="officer">役員</option>
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <MonthInput
                      value={r.pay_month ?? ""}
                      onChange={(v) => update(r.key, { pay_month: v || null })}
                      allowEmpty
                      wrapperClassName="w-28"
                      className={cn(cellCls, "w-full pr-6", !r.pay_month && "border-warning")}
                    />
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{r.pay_date ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(r.gross_salary)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(deductionsOf(r))}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-bold">
                    {formatCurrency(r.gross_salary - deductionsOf(r))}
                  </td>
                  <td className="px-2 py-1.5">
                    {r.warnings.map((w) => (
                      <div key={w} className="text-warning">
                        {w}
                      </div>
                    ))}
                    <div className="text-muted-foreground">{r.file}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
