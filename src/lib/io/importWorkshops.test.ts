// Tests für den Workshop-Import (CSV/XLSX-Tabellen).

import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { applyWorkshopImport, parseWorkshopTable } from "./importWorkshops";
import type { ParsedTable } from "./importFile";
import { emptyProject, normalizeProject, sampleProject } from "../model";
import { workshopXlsxTemplate } from "./export";

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

describe("Roundtrip: Vorlage exportieren und wieder importieren", () => {
  it("workshops-vorlage.xlsx eines befüllten Projekts ist idempotent importierbar", () => {
    const project = sampleProject();
    const wb = XLSX.read(workshopXlsxTemplate(project), { type: "buffer" });
    expect(wb.SheetNames).toEqual(["Workshops", "Anleitung"]);

    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Workshops"], {
      defval: "",
    });
    const columns = Object.keys(json[0]);
    const table: ParsedTable = {
      columns,
      rows: json.map((r) => Object.fromEntries(columns.map((c) => [c, String(r[c] ?? "").trim()]))),
      source: "xlsx",
      sheetName: "Workshops",
    };

    const before = project.workshops.map((w) => [w.name, w.min, w.max]);
    const summary = applyWorkshopImport(project, table, "append");
    expect(summary.workshopsCreated).toBe(0);
    expect(summary.workshopsUpdated).toBe(before.length);
    expect(summary.skipped).toEqual([]);
    expect(project.workshops.map((w) => [w.name, w.min, w.max])).toEqual(before);
  });

  it("Vorlage eines leeren Projekts enthält Beispielzeilen", () => {
    const wb = XLSX.read(workshopXlsxTemplate(emptyProject()), { type: "buffer" });
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Workshops"], {
      defval: "",
    });
    expect(json.length).toBeGreaterThan(0);
    expect(String(json[0]["Workshop"])).toBe("Kochen");
  });

  it("Vorlage bleibt ein ladbares Projekt, wenn sie als JSON missverstanden wird", () => {
    // normalizeProject darf an importierten Daten nicht hängen
    const project = normalizeProject(sampleProject());
    expect(project.workshops.length).toBeGreaterThan(0);
  });
});
