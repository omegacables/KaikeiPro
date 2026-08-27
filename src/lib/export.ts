/**
 * Export utilities for CSV download and print/PDF
 */

/**
 * CSVセルを安全にエスケープする。
 *
 * セキュリティ: 先頭が = + - @ TAB CR のセルは Excel/Sheets で数式として
 * 実行されうる（CSVフォーミュラインジェクション）。摘要や科目名には
 * OCR/AI由来の文字列が入るため、先頭に ' を付けて無害化する。
 */
export function escapeCsvValue(val: string | number): string {
  let s = String(val);
  if (/^[=+\-@\t\r]/.test(s)) {
    s = "'" + s;
  }
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** ヘッダーと行からCSV本文（BOM付き）を組み立てる */
export function buildCsvContent(headers: string[], rows: (string | number)[][]): string {
  const BOM = "\uFEFF";
  return (
    BOM +
    [headers.map(escapeCsvValue).join(",")]
      .concat(rows.map((row) => row.map(escapeCsvValue).join(",")))
      .join("\r\n")
  );
}

/** Download a BOM-prefixed UTF-8 CSV file */
export function downloadCSV(
  filename: string,
  headers: string[],
  rows: (string | number)[][]
) {
  const csvContent = buildCsvContent(headers, rows);
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Trigger browser print dialog (for PDF output) */
export function printPage() {
  window.print();
}
