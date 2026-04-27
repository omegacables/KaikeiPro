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
    const s = String(val);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
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
