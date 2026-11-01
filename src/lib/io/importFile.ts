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
  /** alle Blätter der Datei (nur XLSX) */
  sheetNames?: string[];
  /** Blätter, die in dieser Tabelle zusammengeführt wurden (nur XLSX-Mehrblatt) */
  usedSheetNames?: string[];
}

/**
 * Parst die Datei in eine Tabelle pro Arbeitsblatt (CSV liefert genau eine).
 * Alle Blätter einer XLSX-Datei werden gelesen — welche davon importiert
 * werden, entscheiden die Aufrufer anhand des Formats (siehe mergeTables).
 */
export async function parseSheets(file: File): Promise<ParsedTable[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv") || name.endsWith(".txt") || file.type === "text/csv") {
    return [await parseCsv(file)];
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    return parseXlsxSheets(file);
  }
  throw new Error(
    `Nicht unterstützter Dateityp „${file.name}“. Erlaubt sind .csv, .xlsx und .xls.`,
  );
}

/**
 * Führt mehrere Tabellen (z. B. alle passenden Arbeitsblätter einer XLSX)
 * zu einer Tabelle zusammen: Zeilen werden angehängt, Spalten sind die
 * Vereinigung aller Spalten (fehlende Werte bleiben leer).
 */
export function mergeTables(tables: ParsedTable[]): ParsedTable {
  if (tables.length === 0) {
    throw new Error("Keine Tabellen zum Zusammenführen.");
  }
  const first = tables[0];
  const columns = [...first.columns];
  for (const t of tables.slice(1)) {
    for (const c of t.columns) {
      if (!columns.includes(c)) columns.push(c);
    }
  }
  const rows = tables.flatMap((t) => t.rows.map((r) => normalizeRow(columns, r)));
  const used = tables.map((t) => t.sheetName ?? "?");
  return {
    columns,
    rows,
    source: first.source,
    sheetName: used.join(", "),
    sheetNames: first.sheetNames,
    usedSheetNames: used,
  };
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

async function parseXlsxSheets(file: File): Promise<ParsedTable[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf);
  if (wb.SheetNames.length === 0) {
    throw new Error("Die Tabelle enthält keine Arbeitsblätter.");
  }
  return wb.SheetNames.map((sheetName) => {
    const ws = wb.Sheets[sheetName];
    if (!ws) {
      throw new Error(`Das Arbeitsblatt „${sheetName}“ existiert nicht.`);
    }
    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
    const columns = [...new Set(raw.flatMap((r) => Object.keys(r)))];
    const rows = raw.map((r) => normalizeRow(columns, r));
    return { columns, rows, source: "xlsx", sheetName, sheetNames: wb.SheetNames };
  });
}

function normalizeRow(columns: string[], row: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of columns) {
    const v = row[c];
    out[c] = v === null || v === undefined ? "" : String(v).trim();
  }
  return out;
}

/** Titel-Vergleich ohne Groß-/Kleinschreibung, Umlaute und Satzzeichen. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replaceAll("ä", "a")
    .replaceAll("ö", "o")
    .replaceAll("ü", "u")
    .replaceAll("ß", "ss")
    .replace(/[^a-z0-9]/g, "");
}
