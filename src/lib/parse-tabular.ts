// CSV / Excel(.xlsx/.xlsm) をヘッダ行＋データ行に解析する共通ユーティリティ（クライアント側）。
// 仕訳入力ページ・入金消込ページなど複数箇所のアップロード処理で共有する。

export type ParsedTable = { header: string[]; rows: string[][] };

export async function parseTabularFile(file: File): Promise<ParsedTable> {
  const ext = file.name.split(".").pop()?.toLowerCase();

  if (ext === "csv") {
    const text = await file.text();
    const lines = text
      .replace(/﻿/g, "")
      .split(/\r?\n/)
      .filter((l) => l.trim());
    if (lines.length === 0) return { header: [], rows: [] };
    const splitCsv = (line: string) =>
      line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
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
}
