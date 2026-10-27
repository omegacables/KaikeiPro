/**
 * 給与台帳のファイルを「行×セルの文字」（grid）にする（ブラウザでも Node でも動く）。
 * 読み取りは src/lib/payroll-import.ts の parsePayrollGrid。
 *
 *   CSV・TSV・TXT … UTF-8 で読めなければ Shift_JIS（給与ソフトの書き出しに多い）
 *   Excel（.xlsx・.xlsm）… すべてのシートを読む（数式の結果が保存されていなければ空として扱う）
 *   PDF … 文字の入ったPDFだけ。文字の位置から表を組み立てる。文字の無い（スキャンした）PDFは空を返す
 */

import { excelCellToString, parseCsv } from "./parse-tabular";
import { gridFromPositionedText } from "./payroll-import";

export type PayrollFileKind = "text" | "excel" | "pdf" | "image" | "unsupported";

export function payrollFileKind(name: string, type = ""): PayrollFileKind {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["csv", "tsv", "txt"].includes(ext) || type === "text/csv") return "text";
  if (["xlsx", "xlsm"].includes(ext)) return "excel";
  if (ext === "pdf" || type === "application/pdf") return "pdf";
  if (["jpg", "jpeg", "png", "heic", "webp"].includes(ext) || type.startsWith("image/")) return "image";
  return "unsupported";
}

/** UTF-8 として正しく読めなければ Shift_JIS で読む */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, "");
  } catch {
    return new TextDecoder("shift_jis").decode(bytes);
  }
}

export function gridFromText(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = (firstLine.match(/\t/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? "\t" : ",";
  return parseCsv(text, delimiter);
}

/** Excel のシートごとの grid。列の位置はそのまま保つ（空のセルは ""） */
export async function gridsFromExcel(buffer: ArrayBuffer): Promise<{ sheet: string; grid: string[][] }[]> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb.worksheets.map((ws) => {
    const grid: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const values = row.values as unknown[];
      const cols: string[] = [];
      for (let i = 1; i < values.length; i++) {
        const v = values[i];
        // 数式で、計算結果が保存されていないセルは空（式の文字を金額と取り違えない）
        const isFormula = typeof v === "object" && v !== null && "formula" in v && (v as { result?: unknown }).result === undefined;
        cols.push(isFormula ? "" : excelCellToString(v));
      }
      grid.push(cols);
    });
    return { sheet: ws.name, grid };
  });
}

/** 文字の入ったPDFのページごとの grid。文字が無ければ空の配列 */
export async function gridsFromPdf(bytes: Uint8Array): Promise<string[][][]> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  const pages: string[][][] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const items = (tc.items as { str?: string; transform?: number[]; width?: number }[])
      .filter((it) => typeof it.str === "string" && it.transform)
      .map((it) => ({ str: it.str!, x: it.transform![4], y: it.transform![5], width: it.width ?? 0 }));
    pages.push(gridFromPositionedText(items));
  }
  return pages;
}
