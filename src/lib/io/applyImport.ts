// Anwendung eines gemappten Imports auf das Projekt.

import type { Project, Wish } from "../model";
import { uid } from "../model";
import { normalizeTitle, type ParsedTable } from "./importFile";
import type { WorkshopImportSummary } from "./importWorkshops";
import type { ConfigImportSummary } from "./importConfig";

export { normalizeTitle } from "./importFile";

export interface ImportMapping {
  nameColumn: string | null;
  /** Spalte -> Wunsch-Rang (1 = Erstwunsch) */
  wishColumns: Map<string, number>;
}

export interface ImportSummary {
  personsAdded: number;
  wishesAdded: number;
  /** Workshop-Titel aus der Datei, die im Projekt nicht existieren (nicht zugeordnet) */
  unmatchedWorkshops: string[];
  /** erfolgreich zugeordnete Titel (Datei-Titel -> Workshop) */
  mappedTitles: { title: string; workshop: string }[];
  /** Zeilen ohne Namen (übersprungen) */
  skippedRows: number;
  mode: "replace" | "append";
}

/** Ergebnis des zentralen Imports: die angehakten Bereiche einer Datei. */
export interface CentralImportSummary {
  mode: "replace" | "append";
  configImport?: ConfigImportSummary;
  workshopImport?: WorkshopImportSummary;
  participantImport?: ImportSummary;
}

/** Präfix für virtuelle Ids von Workshops, die erst durch dieselbe Importdatei angelegt werden. */
export const NEW_WORKSHOP_PREFIX = "new:";

export function virtualWorkshopId(name: string): string {
  return NEW_WORKSHOP_PREFIX + name.trim().toLowerCase();
}

/**
 * Löst die Zuordnung unbekannter Titel auf: „new:<name>“-Markierungen zeigen auf
 * Workshops, die soeben aus derselben Datei importiert wurden, und werden gegen
 * die dann tatsächlich angelegten Workshops aufgelöst.
 */
export function resolveTitleAssignments(
  assignments: Record<string, string>,
  workshops: { id: string; name: string }[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [title, id] of Object.entries(assignments)) {
    if (!id) continue;
    if (id.startsWith(NEW_WORKSHOP_PREFIX)) {
      const name = id.slice(NEW_WORKSHOP_PREFIX.length);
      const w = workshops.find((x) => x.name.trim().toLowerCase() === name);
      if (w) out[title] = w.id;
    } else {
      out[title] = id;
    }
  }
  return out;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = curr;
  }
  return prev[b.length];
}

/**
 * Vorschlag für einen unbekannten Titel: Workshop mit identischem
 * normalisiertem Namen, sonst der ähnlichste (Schreibfehler-Toleranz).
 * Gibt die Workshop-Id zurück oder null.
 */
export function suggestWorkshopId(
  title: string,
  workshops: { id: string; name: string }[],
): string | null {
  const norm = normalizeTitle(title);
  if (!norm) return null;
  let best: { id: string; dist: number } | null = null;
  for (const w of workshops) {
    const wn = normalizeTitle(w.name);
    if (wn === norm) return w.id;
    const dist = levenshtein(norm, wn);
    if (!best || dist < best.dist) best = { id: w.id, dist };
  }
  if (!best) return null;
  const threshold = norm.length >= 8 ? 2 : 1;
  return best.dist <= threshold ? best.id : null;
}

export interface UnmatchedTitle {
  title: string;
  count: number;
}

/**
 * Workshop-Titel aus den Wunsch-Spalten, die im Projekt nicht vorkommen —
 * sortiert nach Häufigkeit. Grundlage für den Zuordnungs-Schritt.
 */
export function collectUnmatchedTitles(
  table: ParsedTable,
  mapping: ImportMapping,
  workshops: { name: string }[],
): UnmatchedTitle[] {
  const known = new Set(workshops.map((w) => w.name.toLowerCase()));
  const counts = new Map<string, number>();
  for (const row of table.rows) {
    for (const column of mapping.wishColumns.keys()) {
      const title = (row[column] ?? "").trim();
      if (title && !known.has(title.toLowerCase())) {
        counts.set(title, (counts.get(title) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .map(([title, count]) => ({ title, count }))
    .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title, "de"));
}

/**
 * Erkennt ein Arbeitsblatt am Teilnehmer-Format (Namens- plus mindestens eine
 * Wunsch-Spalte). Die Namensspalte darf nicht zugleich Wunsch-Spalte sein —
 * sonst würde z. B. ein Anleitungsblatt („… Workshop-Wünsche eintragen“) als
 * Teilnehmerblatt missverstanden.
 */
export function isParticipantTable(table: ParsedTable): boolean {
  const m = guessMapping(table);
  return m.nameColumn !== null && m.wishColumns.size > 0 && !m.wishColumns.has(m.nameColumn);
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
  /** Datei-Titel -> Workshop-Id (Zuordnung unbekannter Titel, siehe Zuordnungs-Schritt) */
  titleMap: Record<string, string> = {},
): ImportSummary {
  const workshopByName = new Map(
    project.workshops.map((w) => [w.name.toLowerCase(), w.id] as const),
  );
  const workshopIds = new Set(project.workshops.map((w) => w.id));
  const workshopById = new Map(project.workshops.map((w) => [w.id, w] as const));

  const unmatched = new Set<string>();
  const mappedTitles = new Map<string, string>();
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
      let workshopId = workshopByName.get(workshopName.toLowerCase());
      if (!workshopId) {
        const mapped = titleMap[workshopName];
        if (mapped && workshopIds.has(mapped)) {
          workshopId = mapped;
          mappedTitles.set(workshopName, workshopById.get(mapped)?.name ?? mapped);
        }
      }
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
    mappedTitles: [...mappedTitles.entries()]
      .map(([title, workshop]) => ({ title, workshop }))
      .sort((a, b) => a.title.localeCompare(b.title, "de")),
    skippedRows,
    mode,
  };
}
