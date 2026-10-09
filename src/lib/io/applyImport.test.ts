// Tests für den Titel-Zuordnungs-Import (unbekannte Workshop-Titel)
// und die zugehörige Validierung.

import { describe, expect, it } from "vitest";
import {
  applyImport,
  collectUnmatchedTitles,
  normalizeTitle,
  suggestWorkshopId,
  type ImportMapping,
} from "./applyImport";
import type { ParsedTable } from "./importFile";
import { emptyProject, sampleProject, type Project } from "../model";
import { validateProject } from "../validation";

function table(rows: Record<string, string>[]): ParsedTable {
  return { columns: Object.keys(rows[0]), rows, source: "csv" };
}

function mapping(name: string, wishes: string[]): ImportMapping {
  return {
    nameColumn: name,
    wishColumns: new Map(wishes.map((c, i) => [c, i + 1] as const)),
  };
}

function projectWith(workshops: [string, string, number, number][]): Project {
  const project = emptyProject();
  const slotIds = new Map<string, string>();
  for (const [, slotName] of workshops) {
    if (!slotIds.has(slotName)) {
      const id = crypto.randomUUID();
      slotIds.set(slotName, id);
      project.slots.push({ id, name: slotName });
    }
  }
  for (const [name, slotName, min, max] of workshops) {
    project.workshops.push({
      id: crypto.randomUUID(),
      name,
      slotId: slotIds.get(slotName)!,
      min,
      max,
    });
  }
  return project;
}

describe("normalizeTitle / suggestWorkshopId", () => {
  it("ignoriert Groß-/Kleinschreibung, Umlaute und Satzzeichen", () => {
    expect(normalizeTitle("Kochen (Wiederholung)")).toBe("kochenwiederholung");
    expect(normalizeTitle("FUSSBALL!")).toBe("fussball");
  });

  it("schlägt Workshops mit gleichem normalisiertem Namen vor", () => {
    const project = projectWith([
      ["Kochen (Wiederholung)", "Block 3", 0, 4],
      ["Theater", "Block 1", 0, 8],
    ]);
    expect(suggestWorkshopId("Kochen Wiederholung", project.workshops)).toBe(
      project.workshops[0].id,
    );
    expect(suggestWorkshopId("kochEn", project.workshops)).toBeNull(); // kein Präfix-Match
  });

  it("verzeiht Schreibfehler (Levenshtein)", () => {
    const project = projectWith([
      ["Robotik", "Block 1", 2, 6],
      ["Naturexkursion", "Block 3", 2, 8],
    ]);
    expect(suggestWorkshopId("Robotick", project.workshops)).toBe(project.workshops[0].id);
    expect(suggestWorkshopId("Naturexcursion", project.workshops)).toBe(project.workshops[1].id);
    expect(suggestWorkshopId("Töpfern", project.workshops)).toBeNull();
  });
});

describe("collectUnmatchedTitles", () => {
  it("zählt unbekannte Titel, sortiert nach Häufigkeit", () => {
    const project = projectWith([
      ["Kochen", "Block 1", 2, 4],
      ["Theater", "Block 2", 0, 8],
    ]);
    const t = table([
      { Name: "A", W1: "kochen", W2: "Koch en" },
      { Name: "B", W1: "Koch en", W2: "Theater" },
    ]);
    const unmatched = collectUnmatchedTitles(t, mapping("Name", ["W1", "W2"]), project.workshops);
    expect(unmatched).toEqual([{ title: "Koch en", count: 2 }]);
  });
});

describe("applyImport mit Titel-Zuordnung", () => {
  it("ordnet unbekannte Titel dem gewählten Workshop zu", () => {
    const project = projectWith([
      ["Kochen", "Block 1", 2, 4],
      ["Theater", "Block 1", 0, 8],
    ]);
    const t = table([
      { Name: "Anna", W1: "Kochn", W2: "Theater" },
      { Name: "Ben", W1: "Kochn", W2: "" },
    ]);
    const kochenId = project.workshops[0].id;
    const summary = applyImport(project, t, mapping("Name", ["W1", "W2"]), "replace", {
      Kochn: kochenId,
    });
    expect(summary.personsAdded).toBe(2);
    expect(summary.wishesAdded).toBe(3);
    expect(summary.mappedTitles).toEqual([{ title: "Kochn", workshop: "Kochen" }]);
    expect(summary.unmatchedWorkshops).toEqual([]);
    // Wünsche zeigen auf den echten Workshop
    for (const p of project.persons) {
      expect(project.wishes[p.id].some((w) => w.workshopId === kochenId)).toBe(true);
    }
  });

  it("nicht zugeordnete Titel verfallen und werden gemeldet", () => {
    const project = projectWith([["Kochen", "Block 1", 2, 4]]);
    const t = table([{ Name: "Anna", W1: "Pferdepflege", W2: "Kochen" }]);
    const summary = applyImport(project, t, mapping("Name", ["W1", "W2"]), "replace");
    expect(summary.wishesAdded).toBe(1);
    expect(summary.unmatchedWorkshops).toEqual(["Pferdepflege"]);
    expect(project.wishes[project.persons[0].id]).toEqual([
      { workshopId: project.workshops[0].id, rank: 2 },
    ]);
  });

  it("Zuordnung auf eine Gruppen-Instanz deckt den Wunsch für alle ab", () => {
    // Titel „Kochen (2. Termin)“ wird auf die Gruppe „Kochen“ zugeordnet —
    // der Solver zählt später jede Durchführung als erfüllten Wunsch.
    const project = sampleProject();
    const kochen = project.workshops.find((w) => w.name === "Kochen")!;
    const t = table([{ Name: "Zora", W1: "Kochen (2. Termin)" }]);
    const summary = applyImport(project, t, mapping("Name", ["W1"]), "append", {
      "Kochen (2. Termin)": kochen.id,
    });
    expect(summary.mappedTitles).toEqual([{ title: "Kochen (2. Termin)", workshop: "Kochen" }]);
    expect(project.wishes[project.persons.at(-1)!.id]).toEqual([
      { workshopId: kochen.id, rank: 1 },
    ]);
  });
});

describe("Validierung: verbundene Workshops in Wünschen", () => {
  it("warnt bei Wünschen auf mehrere Durchführungen derselben Gruppe", () => {
    const project = sampleProject();
    const kochen = project.workshops.find((w) => w.name === "Kochen")!;
    const kochenWdh = project.workshops.find((w) => w.name === "Kochen (Wiederholung)")!;
    const person = project.persons[0];
    project.wishes[person.id] = [
      { workshopId: kochen.id, rank: 1 },
      { workshopId: kochenWdh.id, rank: 2 },
    ];
    const { warnings } = validateProject(project);
    expect(
      warnings.some((w) => w.includes("mehrere Durchführungen desselben verbundenen Workshops")),
    ).toBe(true);
  });
});
