/**
 * A small RFC 4180 CSV reader.
 *
 * Written by hand rather than pulled in as a dependency because the campaign
 * CSV is a known, narrow shape and the failure mode that matters — a quoted
 * field containing a comma or a newline, which is how "Boyle, Charles" or a
 * multi-line note silently shifts every column — is a dozen lines to handle
 * correctly and worth owning.
 */

export type CsvRow = Record<string, string>;

export interface ParsedCsv {
  headers: string[];
  rows: CsvRow[];
  /** 1-based line number in the source file for each row, for error reporting. */
  lines: number[];
}

/** Split raw CSV text into fields, honouring quotes, escaped quotes and CRLF. */
function splitCells(text: string): { cells: string[][]; lines: number[] } {
  const cells: string[][] = [];
  const lines: number[] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let rowStart = 1;
  let sawAny = false;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    // Ignore blank trailing lines rather than reporting them as broken rows.
    if (row.length > 1 || row[0].trim() !== "") {
      cells.push(row);
      lines.push(rowStart);
    }
    row = [];
    rowStart = line + 1;
  };

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    sawAny = true;

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (c === "\n") line += 1;
        field += c;
      }
      continue;
    }

    if (c === '"' && field === "") {
      inQuotes = true;
    } else if (c === ",") {
      endField();
    } else if (c === "\r") {
      // Swallow; the \n that follows ends the row.
    } else if (c === "\n") {
      endRow();
      line += 1;
    } else {
      field += c;
    }
  }

  if (sawAny && (field !== "" || row.length > 0)) endRow();
  return { cells, lines };
}

/** Header names are matched loosely so "Client Ref" and "client_ref" both land. */
export const normaliseHeader = (h: string): string =>
  h.trim().toLowerCase().replace(/^﻿/, "").replace(/[\s-]+/g, "_");

export function parseCsv(text: string): ParsedCsv {
  const { cells, lines } = splitCells(text.replace(/^﻿/, ""));
  if (cells.length === 0) return { headers: [], rows: [], lines: [] };

  const headers = cells[0].map(normaliseHeader);
  const rows: CsvRow[] = [];
  const rowLines: number[] = [];

  for (let i = 1; i < cells.length; i += 1) {
    const row: CsvRow = {};
    headers.forEach((h, j) => {
      row[h] = (cells[i][j] ?? "").trim();
    });
    rows.push(row);
    rowLines.push(lines[i]);
  }

  return { headers, rows, lines: rowLines };
}
