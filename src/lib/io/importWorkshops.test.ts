// Tests für den Workshop-Import (CSV/XLSX-Tabellen).

import { describe, expect, it } from "vitest";
import { applyWorkshopImport, isWorkshopTable, parseWorkshopTable } from "./importWorkshops";
import { mergeTables, parseSheets, type ParsedTable } from "./importFile";
import { emptyProject, normalizeProject, sampleProject } from "../model";
import { participantXlsxTemplate } from "./export";

function mkTable(rows: Record<string, string>[], columns?: string[]): ParsedTable {
  return {
    columns: columns ?? Object.keys(rows[0] ?? {}),
    rows,
    source: "csv",
  };
}

describe("parseWorkshopTable", () => {
  it("erkennt die Spalten unabhängig von Groß-/Kleinschreibung", () => {
    const rows = parseWorkshopTable(
      mkTable([{ Workshop: "Kochen", Slot: "Block 1", min: "2", max: "4", Hinweis: "x" }]),
    );
    expect(rows).toEqual([{ name: "Kochen", slot: "Block 1", min: 2, max: 4 }]);
  });

  it("wirft bei fehlender Workshop- oder Slot-Spalte", () => {
    expect(() => parseWorkshopTable(mkTable([{ Name: "Kochen", Zeit: "Block 1" }]))).toThrow(
      /Spalten/,
    );
  });

  it("überspringt komplett leere Zeilen und verzeiht leere min/max", () => {
    const rows = parseWorkshopTable(
      mkTable([
        { Workshop: "Kochen", Slot: "Block 1", min: "", max: "" },
        { Workshop: "", Slot: "" },
      ]),
    );
    expect(rows).toEqual([{ name: "Kochen", slot: "Block 1", min: 0, max: 0 }]);
  });
});

describe("isWorkshopTable", () => {
  it("erkennt das Workshop-Format und lehnt Anleitungsblätter ab", () => {
    expect(isWorkshopTable(mkTable([{ Workshop: "Kochen", Slot: "Block 1" }]))).toBe(true);
    expect(isWorkshopTable(mkTable([{ Name: "Kochen", Slot: "Block 1" }]))).toBe(true);
    expect(isWorkshopTable(mkTable([{ "Anleitung — Workshop-Programm eintragen": "Text" }]))).toBe(
      false,
    );
    expect(isWorkshopTable(mkTable([{ Workshop: "Kochen" }]))).toBe(false);
  });
});

describe("applyWorkshopImport — ergänzen", () => {
  it("legt Slots und Workshops an", () => {
    const project = emptyProject();
    const summary = applyWorkshopImport(
      project,
      mkTable([
        { Workshop: "Kochen", Slot: "Block 1", min: "2", max: "4" },
        { Workshop: "Theater", Slot: "Block 2", min: "0", max: "8" },
      ]),
      "append",
    );
    expect(summary).toMatchObject({
      slotsCreated: 2,
      workshopsCreated: 2,
      workshopsUpdated: 0,
      skipped: [],
    });
    expect(project.slots.map((s) => s.name)).toEqual(["Block 1", "Block 2"]);
    expect(project.workshops.map((w) => w.name)).toEqual(["Kochen", "Theater"]);
    expect(project.workshops[0]).toMatchObject({ min: 2, max: 4 });
  });

  it("aktualisiert Workshops mit vorhandenem Namen und behält Wünsche/Verbindungen", () => {
    const project = sampleProject();
    const kochen = project.workshops.find((w) => w.name === "Kochen")!;
    const before = project.wishes[project.persons[0].id].slice();
    const summary = applyWorkshopImport(
      project,
      mkTable([{ Workshop: "kochen", Slot: "Block 1 — Fr 10:00", min: "1", max: "9" }]),
      "append",
    );
    expect(summary.workshopsUpdated).toBe(1);
    expect(summary.workshopsCreated).toBe(0);
    expect(kochen.min).toBe(1);
    expect(kochen.max).toBe(9);
    expect(project.wishes[project.persons[0].id]).toEqual(before);
    expect(project.workshops.length).toBe(sampleProject().workshops.length);
  });

  it("überspringt doppelte Namen und Zeilen ohne Slot", () => {
    const project = emptyProject();
    const summary = applyWorkshopImport(
      project,
      mkTable([
        { Workshop: "Kochen", Slot: "Block 1", min: "", max: "" },
        { Workshop: "Kochen", Slot: "Block 2", min: "", max: "" },
        { Workshop: "Theater", Slot: "", min: "", max: "" },
      ]),
      "append",
    );
    expect(summary.workshopsCreated).toBe(1);
    expect(summary.skipped.length).toBe(2);
    expect(project.workshops.map((w) => w.name)).toEqual(["Kochen"]);
  });
});

describe("applyWorkshopImport — ersetzen", () => {
  it("ersetzt Slots und Workshops komplett und leert Wünsche", () => {
    const project = sampleProject();
    const summary = applyWorkshopImport(
      project,
      mkTable([{ Workshop: "Kochen", Slot: "Früh", min: "1", max: "2" }]),
      "replace",
    );
    expect(summary.workshopsCreated).toBe(1);
    expect(project.workshops.map((w) => w.name)).toEqual(["Kochen"]);
    expect(project.slots.map((s) => s.name)).toEqual(["Früh"]);
    for (const personId of Object.keys(project.wishes)) {
      expect(project.wishes[personId]).toEqual([]);
    }
  });
});

describe("Roundtrip: Import-Vorlage exportieren und wieder importieren", () => {
  it("das Workshopblatt der Vorlage eines befüllten Projekts ist idempotent importierbar", async () => {
    const project = sampleProject();
    const file = new File([participantXlsxTemplate(project)], "import-vorlage.xlsx");
    const sheets = await parseSheets(file);
    expect(sheets.map((s) => s.sheetName)).toEqual([
      "Wünsche",
      "Workshops",
      "Konfiguration",
      "Anleitung",
    ]);
    const wsSheets = sheets.filter((s) => s.rows.length > 0 && isWorkshopTable(s));
    expect(wsSheets.map((s) => s.sheetName)).toEqual(["Workshops"]);

    const before = project.workshops.map((w) => [w.name, w.min, w.max]);
    const summary = applyWorkshopImport(project, mergeTables(wsSheets), "append");
    expect(summary.workshopsCreated).toBe(0);
    expect(summary.workshopsUpdated).toBe(before.length);
    expect(summary.skipped).toEqual([]);
    expect(project.workshops.map((w) => [w.name, w.min, w.max])).toEqual(before);
  });

  it("Vorlage eines leeren Projekts enthält Beispielzeilen im Workshopblatt", async () => {
    const file = new File([participantXlsxTemplate(emptyProject())], "import-vorlage.xlsx");
    const sheets = await parseSheets(file);
    const ws = sheets.find((s) => s.rows.length > 0 && isWorkshopTable(s));
    expect(ws?.rows[0]?.["Workshop"]).toBe("Kochen");
  });

  it("Vorlage bleibt ein ladbares Projekt, wenn sie als JSON missverstanden wird", () => {
    // normalizeProject darf an importierten Daten nicht hängen
    const project = normalizeProject(sampleProject());
    expect(project.workshops.length).toBeGreaterThan(0);
  });
});
