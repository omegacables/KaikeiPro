// CSV / Excel(.xlsx/.xlsm) をヘッダ行＋データ行に解析する共通ユーティリティ（クライアント側）。
// 仕訳入力ページ・入金消込ページなど複数箇所のアップロード処理で共有する。

export type ParsedTable = { header: string[]; rows: string[][] };

// RFC 4180 準拠のCSV行分割（引用符内のカンマ・改行・"" エスケープに対応）
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field.trim());
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field.trim());
      field = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field.trim());
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}

// ExcelJS のセル値を表示文字列へ変換（リッチテキスト・数式・ハイパーリンク対応）
function excelCellToString(x: unknown): string {
  if (x == null) return "";
  if (x instanceof Date) return x.toISOString().slice(0, 10);
  if (typeof x === "object") {
    const obj = x as {
      richText?: { text: string }[];
      text?: unknown;
      result?: unknown;
      hyperlink?: string;
      error?: string;
    };
    if (Array.isArray(obj.richText)) return obj.richText.map((r) => r.text).join("");
    if (obj.result !== undefined) return excelCellToString(obj.result); // 数式セル
    if (obj.text !== undefined) return excelCellToString(obj.text); // ハイパーリンク等
    if (obj.error !== undefined) return "";
    return String(x);
  }
  return String(x);
}

export async function parseTabularFile(file: File): Promise<ParsedTable> {
  const ext = file.name.split(".").pop()?.toLowerCase();

  if (ext === "csv") {
    const text = (await file.text()).replace(/^﻿/, "");
    const rows = parseCsv(text);
    if (rows.length === 0) return { header: [], rows: [] };
    return { header: rows[0], rows: rows.slice(1) };
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
        cols.push(excelCellToString(values[i]));
      }
      allRows.push(cols);
    });
    if (allRows.length === 0) return { header: [], rows: [] };
    return { header: allRows[0], rows: allRows.slice(1) };
  }

  throw new Error("対応形式: .csv / .xlsx");
}
