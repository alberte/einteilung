// Datei-Import (CSV via papaparse, XLSX via sheetjs) — Projektplan A6.
// Importdateien werden ausschließlich als Daten geparst, niemals als HTML
// gerendert (Projektplan, Risiko XSS).

import Papa from "papaparse";
import * as XLSX from "xlsx";

export interface ParsedTable {
  columns: string[];
  rows: Record<string, string>[];
  source: "csv" | "xlsx";
  sheetName?: string;
}

export async function parseTable(file: File): Promise<ParsedTable> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".txt") || file.type === "text/csv") {
    return parseCsv(file);
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    return parseXlsx(file);
  }
  throw new Error(
    `Nicht unterstützter Dateityp „${file.name}“. Erlaubt sind .csv, .xlsx und .xls.`,
  );
}

async function parseCsv(file: File): Promise<ParsedTable> {
  const text = await file.text();
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => h.trim(),
  });
  const columns = (result.meta.fields ?? []).filter((c) => c.length > 0);
  if (columns.length === 0) {
    throw new Error("Die CSV-Datei enthält keine brauchbare Kopfzeile mit Spaltennamen.");
  }
  const rows = result.data
    .map((row) => normalizeRow(columns, row))
    .filter((row) => columns.some((c) => row[c].length > 0));
  return { columns, rows, source: "csv" };
}

async function parseXlsx(file: File): Promise<ParsedTable> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf);
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    throw new Error("Die Tabelle enthält keine Arbeitsblätter.");
  }
  const ws = wb.Sheets[sheetName];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
  if (raw.length === 0) {
    throw new Error("Das erste Arbeitsblatt enthält keine Zeilen.");
  }
  const columns = [...new Set(raw.flatMap((r) => Object.keys(r)))];
  const rows = raw.map((r) => normalizeRow(columns, r));
  return { columns, rows, source: "xlsx", sheetName };
}

function normalizeRow(columns: string[], row: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of columns) {
    const v = row[c];
    out[c] = v === null || v === undefined ? "" : String(v).trim();
  }
  return out;
}
