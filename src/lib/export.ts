/**
 * Export utilities for CSV download and print/PDF
 */

/** Download a BOM-prefixed UTF-8 CSV file */
export function downloadCSV(
  filename: string,
  headers: string[],
  rows: (string | number)[][]
) {
  const BOM = "\uFEFF";
  const escape = (val: string | number) => {
    let s = String(val);
    // CSV\u30D5\u30A9\u30FC\u30DF\u30E5\u30E9\u30A4\u30F3\u30B8\u30A7\u30AF\u30B7\u30E7\u30F3\u5BFE\u7B56:
    // \u5148\u982D\u304C = + - @ / TAB / CR \u306E\u30BB\u30EB\u306F Excel/Sheets \u3067\u6570\u5F0F\u3068\u3057\u3066\u89E3\u91C8\u3055\u308C\u308B\u305F\u3081\u3001
    // \u5148\u982D\u306B ' \u3092\u4ED8\u4E0E\u3057\u3066\u7121\u5BB3\u5316\u3059\u308B\uFF08\u6458\u8981\u30FB\u79D1\u76EE\u540D\u7B49\u306BOCR/AI\u7531\u6765\u306E\u6587\u5B57\u5217\u304C\u6D41\u5165\u3059\u308B\u305F\u3081\uFF09\u3002
    if (/^[=+\-@\t\r]/.test(s)) {
      s = "'" + s;
    }
    if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const csvContent =
    BOM +
    [headers.map(escape).join(",")]
      .concat(rows.map((row) => row.map(escape).join(",")))
      .join("\r\n");

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
