// Import der Workshopliste aus CSV/XLSX. Format = Exportformat der
// Workshopliste (Spalten Workshop, Slot, min, max[, Hinweis]) — damit
// lässt sich eine exportierte Liste extern bearbeiten und wieder
// importieren. Neue Slots werden automatisch angelegt, Workshops mit
// bereits vorhandenem Namen werden aktualisiert.

import { uid, type Project, type Slot, type Workshop } from "../model";
import type { ParsedTable } from "./importFile";

export interface WorkshopRow {
  name: string;
  slot: string;
  min: number;
  max: number;
}

export interface WorkshopImportSummary {
  mode: "replace" | "append";
  slotsCreated: number;
  workshopsCreated: number;
  workshopsUpdated: number;
  /** Übersprungene Zeilen mit Grund, z. B. „Zeile 3 ‚Kochen‘: kein Slot“ */
  skipped: string[];
}

/**
 * Prüft die Spalten und liefert die Workshop-Zeilen.
 * Wirft mit klarem Text, wenn „Workshop“ oder „Slot“ fehlen.
 */
export function parseWorkshopTable(table: ParsedTable): WorkshopRow[] {
  const col = (re: RegExp) => table.columns.find((c) => re.test(c.trim()));
  const nameCol = col(/^(workshop|name)$/i);
  const slotCol = col(/^slot/i);
  const minCol = col(/^min/i);
  const maxCol = col(/^max/i);
  if (!nameCol || !slotCol) {
    throw new Error(
      "Die Tabelle benötigt die Spalten „Workshop“ und „Slot“ (dazu optional „min“ und „max“). " +
        "Am einfachsten die Excel-Vorlage verwenden.",
    );
  }
  const rows: WorkshopRow[] = [];
  for (const row of table.rows) {
    const name = (row[nameCol] ?? "").trim();
    const slot = (row[slotCol] ?? "").trim();
    if (!name && !slot) continue; // komplett leere Zeile
    const num = (colName: string | undefined) =>
      colName ? Math.max(0, Math.floor(Number(row[colName] ?? 0) || 0)) : 0;
    rows.push({ name, slot, min: num(minCol), max: num(maxCol) });
  }
  return rows;
}

export function applyWorkshopImport(
  project: Project,
  table: ParsedTable,
  mode: "replace" | "append",
): WorkshopImportSummary {
  const rows = parseWorkshopTable(table);
  const summary: WorkshopImportSummary = {
    mode,
    slotsCreated: 0,
    workshopsCreated: 0,
    workshopsUpdated: 0,
    skipped: [],
  };

  if (mode === "replace") {
    project.slots = [];
    project.workshops = [];
    for (const personId of Object.keys(project.wishes)) {
      project.wishes[personId] = [];
    }
  }

  const slotByKey = new Map<string, Slot>(
    project.slots.map((s) => [s.name.trim().toLowerCase(), s]),
  );
  const workshopByKey = new Map<string, Workshop>(
    project.workshops.map((w) => [w.name.trim().toLowerCase(), w]),
  );
  const seen = new Set<string>();

  rows.forEach((r, i) => {
    const line = `Zeile ${i + 1}`;
    if (!r.name) {
      summary.skipped.push(`${line}: kein Workshop-Name`);
      return;
    }
    if (!r.slot) {
      summary.skipped.push(`${line} „${r.name}“: kein Slot angegeben`);
      return;
    }
    const key = r.name.toLowerCase();
    if (seen.has(key)) {
      summary.skipped.push(`${line} „${r.name}“: Name kommt mehrfach vor`);
      return;
    }
    seen.add(key);

    const slotKey = r.slot.toLowerCase();
    let slot = slotByKey.get(slotKey);
    if (!slot) {
      slot = { id: uid(), name: r.slot };
      slotByKey.set(slotKey, slot);
      project.slots.push(slot);
      summary.slotsCreated += 1;
    }

    const existing = workshopByKey.get(key);
    if (existing) {
      existing.slotId = slot.id;
      existing.min = r.min;
      existing.max = r.max;
      summary.workshopsUpdated += 1;
    } else {
      const w: Workshop = {
        id: uid(),
        name: r.name,
        slotId: slot.id,
        min: r.min,
        max: r.max,
        groupId: null,
        pairedWith: null,
      };
      workshopByKey.set(key, w);
      project.workshops.push(w);
      summary.workshopsCreated += 1;
    }
  });

  return summary;
}
