import { serializeCsv } from "../../src/csv";

export function downloadCsv(baseName: string, headers: string[], rows: string[][]) {
  // The UTF-8 BOM makes Excel decode non-ASCII names correctly.
  const blob = new Blob(["\uFEFF", serializeCsv(headers, rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${baseName}-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}
