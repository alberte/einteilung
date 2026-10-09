// Anwendung eines gemappten Imports auf das Projekt.

import type { Project, Wish } from "../model";
import { uid } from "../model";
import type { ParsedTable } from "./importFile";

export interface ImportMapping {
  nameColumn: string | null;
  /** Spalte -> Wunsch-Rang (1 = Erstwunsch) */
  wishColumns: Map<string, number>;
}

export interface ImportSummary {
  personsAdded: number;
  wishesAdded: number;
  /** Workshop-Namen aus der Datei, die im Projekt nicht existieren */
  unmatchedWorkshops: string[];
  /** Zeilen ohne Namen (übersprungen) */
  skippedRows: number;
  mode: "replace" | "append";
}

export function guessMapping(table: ParsedTable): ImportMapping {
  let nameColumn: string | null = null;
  const wishColumns = new Map<string, number>();

  const nameRe = /^(name|vorname|nachname|person|teilnehmer|schüler|schueler)/i;
  const wishRe = /(wunsch|wish|präferenz|praeferenz|priorität|prioritaet|wahl)/i;
  let wishRank = 1;

  for (const col of table.columns) {
    if (!nameColumn && nameRe.test(col)) {
      nameColumn = col;
    } else if (wishRe.test(col)) {
      wishColumns.set(col, wishRank++);
    }
  }
  if (!nameColumn) {
    nameColumn = table.columns[0] ?? null;
  }
  return { nameColumn, wishColumns };
}

export function applyImport(
  project: Project,
  table: ParsedTable,
  mapping: ImportMapping,
  mode: "replace" | "append",
): ImportSummary {
  const workshopByName = new Map(
    project.workshops.map((w) => [w.name.toLowerCase(), w.id] as const),
  );

  const unmatched = new Set<string>();
  const newPersons: { id: string; name: string }[] = [];
  const newWishes: Record<string, Wish[]> = {};
  let wishesAdded = 0;
  let skippedRows = 0;

  for (const row of table.rows) {
    const name = mapping.nameColumn ? (row[mapping.nameColumn] ?? "") : "";
    if (name.trim().length === 0) {
      skippedRows += 1;
      continue;
    }
    const personId = uid();
    newPersons.push({ id: personId, name: name.trim() });
    const wishes: Wish[] = [];
    const seen = new Set<string>();
    for (const [column, rank] of [...mapping.wishColumns.entries()].sort((a, b) => a[1] - b[1])) {
      const workshopName = (row[column] ?? "").trim();
      if (!workshopName) continue;
      const workshopId = workshopByName.get(workshopName.toLowerCase());
      if (!workshopId) {
        unmatched.add(workshopName);
        continue;
      }
      if (seen.has(workshopId)) continue; // gleicher Workshop in mehreren Spalten
      seen.add(workshopId);
      wishes.push({ workshopId, rank });
    }
    wishes.sort((a, b) => a.rank - b.rank);
    newWishes[personId] = wishes;
    wishesAdded += wishes.length;
  }

  if (mode === "replace") {
    project.persons = newPersons;
    project.wishes = newWishes;
  } else {
    project.persons.push(...newPersons);
    for (const [personId, wishes] of Object.entries(newWishes)) {
      project.wishes[personId] = wishes;
    }
  }

  return {
    personsAdded: newPersons.length,
    wishesAdded,
    unmatchedWorkshops: [...unmatched].sort((a, b) => a.localeCompare(b, "de")),
    skippedRows,
    mode,
  };
}
