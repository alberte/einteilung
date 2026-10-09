// Export: Ergebnis-CSV und Projekt-JSON als Blob-Download (alles lokal).

import Papa from "papaparse";
import { emptyProject, type Project } from "../model";
import type { SolveResult } from "../solver/types";

export function downloadFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** CSV mit Zeilen Person × Workshop × Slot (Projektplan DoD). */
export function resultCsv(
  project: Project,
  result: Extract<SolveResult, { status: "optimal" }>,
): string {
  const personById = new Map(project.persons.map((p) => [p.id, p]));
  const workshopById = new Map(project.workshops.map((w) => [w.id, w]));
  const slotById = new Map(project.slots.map((s) => [s.id, s]));

  const rows = result.assignments.map((a) => {
    const workshop = workshopById.get(a.workshopId);
    const slot = workshop ? slotById.get(workshop.slotId) : undefined;
    return {
      Person: personById.get(a.personId)?.name ?? a.personId,
      Workshop: workshop?.name ?? a.workshopId,
      Slot: slot?.name ?? "",
      Wunsch: a.fromWish && a.rank !== null ? a.rank : "-",
    };
  });

  // Semikolon als Trenner: öffnet sauber in deutschem Excel/LibreOffice
  return Papa.unparse(rows, { delimiter: ";" });
}

export function projectJson(project: Project): string {
  return JSON.stringify(
    { ...project, meta: { ...project.meta, updated: new Date().toISOString() } },
    null,
    2,
  );
}

/** Leere Projektdatei als ausfüllbare Vorlage. */
export function emptyProjectTemplate(): string {
  return JSON.stringify(emptyProject(), null, 2);
}

/**
 * CSV-Vorlage für den Teilnehmer-Import. Die Beispielzeile enthält echte
 * Workshop-Namen des aktuellen Projekts (möglichst aus verschiedenen Slots),
 * damit die erwartete Schreibweise direkt sichtbar ist.
 */
export function participantCsvTemplate(project: Project): string {
  const wishColumns = Math.max(5, project.config.n + 2);
  const header = ["Name", ...Array.from({ length: wishColumns }, (_, i) => `Wunsch ${i + 1}`)];

  const example: string[] = [];
  for (const slot of project.slots) {
    const w = project.workshops.find((x) => x.slotId === slot.id && !example.includes(x.name));
    if (w) example.push(w.name);
  }
  for (const w of project.workshops) {
    if (example.length >= wishColumns) break;
    if (!example.includes(w.name)) example.push(w.name);
  }
  const row = ["Beispielperson", ...example.slice(0, wishColumns)];
  while (row.length < header.length) row.push("");

  // BOM, damit Excel/LibreOffice UTF-8 (Umlaute) korrekt erkennt
  return "\uFEFF" + Papa.unparse([header, row], { delimiter: ";" });
}
