// Export: Ergebnis-CSV/XLSX und Projekt-JSON als Blob-Download (alles lokal).

import Papa from "papaparse";
import * as XLSX from "xlsx";
import { emptyProject, type Project } from "../model";
import { groupByPersonSlot } from "../resultView";
import type { SolveResult } from "../solver/types";

export function downloadFile(filename: string, content: string | ArrayBuffer, mime: string): void {
  const blob =
    content instanceof ArrayBuffer
      ? new Blob([content], { type: mime })
      : new Blob([content], { type: `${mime};charset=utf-8` });
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
  // Semikolon als Trenner: öffnet sauber in deutschem Excel/LibreOffice
  return Papa.unparse(
    [["Person", "Workshop", "Slot", "Wunsch"], ...assignmentRows(project, result)],
    { delimiter: ";" },
  );
}

function assignmentRows(
  project: Project,
  result: Extract<SolveResult, { status: "optimal" }>,
): (string | number)[][] {
  const personById = new Map(project.persons.map((p) => [p.id, p]));
  const workshopById = new Map(project.workshops.map((w) => [w.id, w]));
  const slotById = new Map(project.slots.map((s) => [s.id, s]));

  return result.assignments.map((a) => {
    const workshop = workshopById.get(a.workshopId);
    const slot = workshop ? slotById.get(workshop.slotId) : undefined;
    return [
      personById.get(a.personId)?.name ?? a.personId,
      workshop?.name ?? a.workshopId,
      slot?.name ?? "",
      a.fromWish && a.rank !== null ? a.rank : "kein Wunsch",
    ];
  });
}

function workshopHint(project: Project, workshopId: string): string {
  const w = project.workshops.find((x) => x.id === workshopId);
  if (!w) return "";
  const hints: string[] = [];
  if (w.pairedWith) {
    const partner = project.workshops.find((x) => x.id === w.pairedWith);
    if (partner) hints.push(`gekoppelt mit „${partner.name}“ (immer zusammen)`);
  }
  if (w.groupId) {
    const others = project.workshops
      .filter((x) => x.groupId === w.groupId && x.id !== w.id)
      .map((x) => x.name);
    if (others.length > 0) hints.push(`gleicher Workshop wie ${others.join(", ")}`);
  }
  return hints.join("; ");
}

function workshopListAoa(project: Project): (string | number)[][] {
  const slotNameOf = (slotId: string) => project.slots.find((s) => s.id === slotId)?.name ?? "";
  return [
    ["Workshop", "Slot", "min", "max", "Hinweis"],
    ...project.workshops.map((w) => [
      w.name,
      slotNameOf(w.slotId),
      w.min,
      w.max,
      workshopHint(project, w.id),
    ]),
  ];
}

function aoaToSheet(
  wb: XLSX.WorkBook,
  aoa: (string | number)[][],
  widths: number[],
  name: string,
): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = widths.map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, ws, name);
  return ws;
}

/**
 * Workshopliste als XLSX (Name, Slot, min/max, Verbindungshinweise) —
 * z. B. als Programm-Übersicht zum Austeilen.
 */
export function workshopListXlsx(project: Project): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  aoaToSheet(wb, workshopListAoa(project), [26, 22, 6, 6, 50], "Workshops");
  return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}

/**
 * XLSX-Vorlage für den Workshop-Import: Anleitungsblatt plus
 * Ausfüllblatt im Exportformat. Enthält das Projekt bereits Workshops,
 * wird die aktuelle Liste eingetragen (exportieren → bearbeiten →
 * wieder importieren); andernfalls Beispielzeilen.
 */
export function workshopXlsxTemplate(project: Project): ArrayBuffer {
  const exampleRows: (string | number)[][] =
    project.workshops.length > 0
      ? workshopListAoa(project).slice(1)
      : [
          ["Kochen", "Block 1 — 10:00", 2, 4, ""],
          ["Theater", "Block 2 — 14:00", 0, 8, ""],
        ];

  const wb = XLSX.utils.book_new();
  aoaToSheet(
    wb,
    [["Workshop", "Slot", "min", "max", "Hinweis"], ...exampleRows],
    [26, 22, 6, 6, 50],
    "Workshops",
  );
  aoaToSheet(
    wb,
    [
      ["Anleitung — Workshop-Programm eintragen"],
      [""],
      ["1. Pro Zeile ein Workshop: Name, Slot, Mindest- (min) und Höchstbelegung (max)."],
      ["2. „Slot“ = Name des Zeitblocks. Neue Slot-Namen werden beim Import automatisch angelegt."],
      [
        "3. Modus „ergänzen“: Workshops mit bereits vorhandenem Namen werden aktualisiert (Slot, min, max).",
      ],
      ["4. Modus „ersetzen“: die komplette bisherige Workshop- und Slot-Liste wird ersetzt."],
      ["5. Die Spalte „Hinweis“ ist nur zur Information und wird beim Import ignoriert —"],
      [
        "   Verbindungen (gleicher Workshop in mehreren Slots, gekoppelte Paare) in der App pflegen.",
      ],
      ["6. Beispielzeilen ersetzen oder löschen."],
      ["7. Import in der App: Tab „Slots & Workshops“ → „Excel-Import“."],
    ],
    [110],
    "Anleitung",
  );
  return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}

/** Ergebnis als mehrblättrige XLSX-Datei. */
export function resultXlsx(
  project: Project,
  result: Extract<SolveResult, { status: "optimal" }>,
): ArrayBuffer {
  const workshopById = new Map(project.workshops.map((w) => [w.id, w]));
  const slotNameOf = (slotId: string) => project.slots.find((s) => s.id === slotId)?.name ?? "";
  const workshopName = (id: string) => workshopById.get(id)?.name ?? id;

  const wb = XLSX.utils.book_new();

  const byPersonSlot = groupByPersonSlot(project, result.assignments);

  // Blatt 1: Zuweisungen (flach, wie CSV)
  const wsAssign = XLSX.utils.aoa_to_sheet([
    ["Person", "Workshop", "Slot", "Wunsch"],
    ...assignmentRows(project, result),
  ]);
  wsAssign["!cols"] = [{ wch: 22 }, { wch: 26 }, { wch: 22 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, wsAssign, "Zuweisungen");

  // Blatt 2: Pro Person — Matrix Person × Slot
  const personHeader = ["Person", ...project.slots.map((s) => s.name)];
  const personRows = project.persons.map((p) => [
    p.name,
    ...project.slots.map((s) => {
      const a = byPersonSlot.get(p.id)?.get(s.id);
      if (!a) return "–";
      return a.fromWish
        ? `${workshopName(a.workshopId)} (Wunsch ${a.rank})`
        : `${workshopName(a.workshopId)} (kein Wunsch)`;
    }),
  ]);
  const wsPerson = XLSX.utils.aoa_to_sheet([personHeader, ...personRows]);
  wsPerson["!cols"] = [{ wch: 22 }, ...project.slots.map(() => ({ wch: 26 }))];
  XLSX.utils.book_append_sheet(wb, wsPerson, "Pro Person");

  // Blatt 3: Pro Workshop — Belegung und Teilnehmerliste
  const workshopRows = project.workshops.map((w) => {
    const visitors = result.assignments.filter((a) => a.workshopId === w.id);
    const persons = visitors.map(
      (a) => project.persons.find((p) => p.id === a.personId)?.name ?? a.personId,
    );
    return [
      w.name,
      slotNameOf(w.slotId),
      w.min,
      w.max,
      visitors.length,
      persons.join(", "),
      workshopHint(project, w.id),
    ];
  });
  const wsWorkshop = XLSX.utils.aoa_to_sheet([
    ["Workshop", "Slot", "min", "max", "Belegung", "Personen", "Hinweis"],
    ...workshopRows,
  ]);
  wsWorkshop["!cols"] = [
    { wch: 26 },
    { wch: 22 },
    { wch: 6 },
    { wch: 6 },
    { wch: 10 },
    { wch: 40 },
    { wch: 40 },
  ];
  XLSX.utils.book_append_sheet(wb, wsWorkshop, "Pro Workshop");

  // Blatt 4: Statistik
  const stats = result.stats;
  const statRows: (string | number)[][] = [
    ["Kennzahl", "Wert"],
    ["Zuweisungen", stats.totalAssignments],
    ["aus Wünschen", stats.fromWishes],
    ["ohne Wunsch", stats.nonWish],
    ["Ø Wunsch-Rang", stats.avgWishRank === null ? "–" : Number(stats.avgWishRank.toFixed(2))],
    ...Object.entries(stats.rankDistribution)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([rank, count]) => [`Wünsche auf Rang ${rank}`, count] as (string | number)[]),
    ["Rechenzeit (s)", Number((stats.solveMs / 1000).toFixed(1))],
  ];
  const wsStats = XLSX.utils.aoa_to_sheet(statRows);
  wsStats["!cols"] = [{ wch: 24 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsStats, "Statistik");

  return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
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

/**
 * XLSX-Vorlage für den Teilnehmer-Import — für Nutzer ohne Tabellenkalkulations-
 * Erfahrung: erstes Blatt „Wünsche“ (landet automatisch im Import), dazu ein
 * Anleitungsblatt und ein Referenzblatt mit den angelegten Workshops.
 */
export function participantXlsxTemplate(project: Project): ArrayBuffer {
  const wishColumns = Math.max(5, project.config.n + 2);
  const example: string[] = [];
  for (const slot of project.slots) {
    const w = project.workshops.find((x) => x.slotId === slot.id && !example.includes(x.name));
    if (w) example.push(w.name);
  }
  for (const w of project.workshops) {
    if (example.length >= wishColumns) break;
    if (!example.includes(w.name)) example.push(w.name);
  }
  const exampleRow = ["Beispielperson", ...example.slice(0, wishColumns)];
  while (exampleRow.length < wishColumns + 1) exampleRow.push("");

  const wb = XLSX.utils.book_new();

  // Blatt 1: Wünsche (Ausfüllblatt; erstes Blatt -> Import greift es direkt auf)
  const wsWishes = XLSX.utils.aoa_to_sheet([
    ["Name", ...Array.from({ length: wishColumns }, (_, i) => `Wunsch ${i + 1}`)],
    exampleRow,
  ]);
  wsWishes["!cols"] = [{ wch: 24 }, ...Array.from({ length: wishColumns }, () => ({ wch: 24 }))];
  XLSX.utils.book_append_sheet(wb, wsWishes, "Wünsche");

  // Blatt 2: Anleitung
  const wsHelp = XLSX.utils.aoa_to_sheet([
    ["Anleitung — Workshop-Wünsche eintragen"],
    [""],
    ["1. Blatt „Wünsche“: eine Zeile pro Person, Name in Spalte A."],
    ["2. Wunsch 1 = Erstwunsch, Wunsch 2 = Zweitwunsch usw. (leere Spalten einfach frei lassen)"],
    [
      "3. Workshop-Namen bitte exakt wie auf dem Blatt „Workshops“ schreiben — am besten von dort kopieren (Groß-/Kleinschreibung ist egal).",
    ],
    ["4. Die Beispielzeile („Beispielperson“) löschen oder überschreiben."],
    ["5. Datei speichern und in der App unter „Teilnehmer & Wünsche“ importieren."],
    [""],
    ["Verbundene Workshops: ein Wunsch auf eine Durchführung gilt für alle."],
    ["Gekoppelte Workshops (z. B. Teil 1 + Teil 2): ein Wunsch auf einen Teil genügt."],
    [""],
    ["Tipp: Fehler lassen sich nach dem Import in der App korrigieren."],
  ]);
  wsHelp["!cols"] = [{ wch: 110 }];
  XLSX.utils.book_append_sheet(wb, wsHelp, "Anleitung");

  // Blatt 3: Workshops (Referenz)
  aoaToSheet(wb, workshopListAoa(project), [26, 22, 6, 6, 50], "Workshops");

  return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}
