// Tests für den Mehrblatt-Import: alle Arbeitsblätter einer XLSX-Datei
// werden gelesen, alle mit passendem Format werden zusammengeführt und
// importiert (Blätter wie „Anleitung“ werden übersprungen).

import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { mergeTables, parseSheets } from "./importFile";
import { applyWorkshopImport, isWorkshopTable, parseWorkshopTable } from "./importWorkshops";
import {
  applyImport,
  collectUnmatchedTitles,
  guessMapping,
  isParticipantTable,
  resolveTitleAssignments,
  suggestWorkshopId,
  virtualWorkshopId,
} from "./applyImport";
import { applyConfigImport, isConfigTable, parseConfigTable } from "./importConfig";
import { participantXlsxTemplate } from "./export";
import { emptyProject, sampleProject } from "../model";

function xlsxFile(sheets: Record<string, (string | number)[][]>, name = "test.xlsx"): File {
  const wb = XLSX.utils.book_new();
  for (const [sheetName, aoa] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), sheetName);
  }
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return new File([buf], name);
}

describe("parseSheets", () => {
  it("liefert bei CSV genau eine Tabelle", async () => {
    const sheets = await parseSheets(new File(["Name;Wunsch 1\nAnna;Kochen"], "liste.csv"));
    expect(sheets).toHaveLength(1);
    expect(sheets[0].source).toBe("csv");
    expect(sheets[0].columns).toEqual(["Name", "Wunsch 1"]);
    expect(sheets[0].rows).toEqual([{ Name: "Anna", "Wunsch 1": "Kochen" }]);
  });

  it("liest bei XLSX alle Arbeitsblätter einzeln", async () => {
    const file = xlsxFile({
      "Klasse 5a": [
        ["Name", "Wunsch 1"],
        ["Anna", "Kochen"],
      ],
      "Klasse 5b": [
        ["Name", "Wunsch 1"],
        ["Ben", "Theater"],
      ],
      Anleitung: [["Anleitung — Text"]],
    });
    const sheets = await parseSheets(file);
    expect(sheets.map((s) => s.sheetName)).toEqual(["Klasse 5a", "Klasse 5b", "Anleitung"]);
    expect(sheets[0].sheetNames).toEqual(["Klasse 5a", "Klasse 5b", "Anleitung"]);
    expect(sheets[1].rows).toEqual([{ Name: "Ben", "Wunsch 1": "Theater" }]);
  });

  it("wirft bei nicht unterstütztem Dateityp", async () => {
    await expect(parseSheets(new File(["{}"], "data.json"))).rejects.toThrow(
      /Nicht unterstützter Dateityp/,
    );
  });
});

describe("mergeTables", () => {
  it("hängt die Zeilen an und vereinigt die Spalten", async () => {
    const file = xlsxFile({
      A: [
        ["Name", "Wunsch 1"],
        ["Anna", "Kochen"],
      ],
      B: [
        ["Name", "Wunsch 1", "Wunsch 2"],
        ["Ben", "Theater", "Malen"],
      ],
    });
    const merged = mergeTables(await parseSheets(file));
    expect(merged.columns).toEqual(["Name", "Wunsch 1", "Wunsch 2"]);
    expect(merged.rows).toEqual([
      { Name: "Anna", "Wunsch 1": "Kochen", "Wunsch 2": "" },
      { Name: "Ben", "Wunsch 1": "Theater", "Wunsch 2": "Malen" },
    ]);
    expect(merged.usedSheetNames).toEqual(["A", "B"]);
    expect(merged.sheetName).toBe("A, B");
  });

  it("wirft bei leerer Liste", () => {
    expect(() => mergeTables([])).toThrow(/Keine Tabellen/);
  });
});

describe("Mehrblatt-Import nach Vorlage", () => {
  it("Import-Vorlage: Blätter werden eindeutig nach Format erkannt", async () => {
    const file = new File([participantXlsxTemplate(sampleProject())], "import-vorlage.xlsx");
    const sheets = await parseSheets(file);
    expect(sheets.map((s) => s.sheetName)).toEqual([
      "Wünsche",
      "Workshops",
      "Konfiguration",
      "Anleitung",
    ]);

    const nonEmpty = sheets.filter((s) => s.rows.length > 0);
    expect(nonEmpty.filter(isConfigTable).map((s) => s.sheetName)).toEqual(["Konfiguration"]);
    expect(nonEmpty.filter(isWorkshopTable).map((s) => s.sheetName)).toEqual(["Workshops"]);
    expect(nonEmpty.filter(isParticipantTable).map((s) => s.sheetName)).toEqual(["Wünsche"]);
    // Anleitung bleibt übrig
    expect(
      nonEmpty
        .filter((s) => !isConfigTable(s) && !isWorkshopTable(s) && !isParticipantTable(s))
        .map((s) => s.sheetName),
    ).toEqual(["Anleitung"]);
  });

  it("Workshopblatt der Vorlage eines befüllten Projekts ist idempotent importierbar", async () => {
    const project = sampleProject();
    const file = new File([participantXlsxTemplate(project)], "import-vorlage.xlsx");
    const sheets = await parseSheets(file);
    const usable = sheets.filter((s) => s.rows.length > 0 && isWorkshopTable(s));
    expect(usable.map((s) => s.sheetName)).toEqual(["Workshops"]);

    const before = project.workshops.map((w) => [w.name, w.min, w.max]);
    const summary = applyWorkshopImport(project, mergeTables(usable), "append");
    expect(summary.workshopsCreated).toBe(0);
    expect(summary.workshopsUpdated).toBe(before.length);
    expect(summary.skipped).toEqual([]);
    expect(project.workshops.map((w) => [w.name, w.min, w.max])).toEqual(before);
  });

  it("importiert Workshops aus mehreren Arbeitsblättern", async () => {
    const project = emptyProject();
    const file = xlsxFile({
      "Block 1": [
        ["Workshop", "Slot", "min", "max"],
        ["Kochen", "Block 1", 2, 4],
      ],
      "Block 2": [
        ["Workshop", "Slot", "min", "max"],
        ["Theater", "Block 2", 0, 8],
      ],
      Anleitung: [["Anleitung — Workshop-Programm eintragen"]],
    });
    const sheets = await parseSheets(file);
    const usable = sheets.filter((s) => s.rows.length > 0 && isWorkshopTable(s));
    expect(usable.map((s) => s.sheetName)).toEqual(["Block 1", "Block 2"]);

    const summary = applyWorkshopImport(project, mergeTables(usable), "append");
    expect(summary.workshopsCreated).toBe(2);
    expect(summary.slotsCreated).toBe(2);
    expect(project.workshops.map((w) => w.name).sort()).toEqual(["Kochen", "Theater"]);
  });

  it("importiert Teilnehmer aus mehreren Arbeitsblättern", async () => {
    const project = sampleProject();
    const file = xlsxFile({
      "Klasse 5a": [
        ["Name", "Wunsch 1", "Wunsch 2"],
        ["Anna", "Kochen", "Theater"],
      ],
      "Klasse 5b": [
        ["Name", "Wunsch 1", "Wunsch 2"],
        ["Ben", "Robotik", "Malen"],
      ],
      Anleitung: [["Anleitung — Workshop-Wünsche eintragen"], ["1. Blatt „Wünsche“ ausfüllen"]],
    });
    const sheets = await parseSheets(file);
    const usable = sheets.filter((s) => s.rows.length > 0 && isParticipantTable(s));
    expect(usable.map((s) => s.sheetName)).toEqual(["Klasse 5a", "Klasse 5b"]);

    const merged = mergeTables(usable);
    const summary = applyImport(project, merged, guessMapping(merged), "replace");
    expect(summary.personsAdded).toBe(2);
    expect(summary.wishesAdded).toBe(4);
    expect(summary.unmatchedWorkshops).toEqual([]);
    expect(project.persons.map((p) => p.name).sort()).toEqual(["Anna", "Ben"]);
  });

  it("Anleitungsblatt mit „Wünsche“-Kopfzeile gilt nicht als Teilnehmerblatt", async () => {
    const file = xlsxFile({
      Anleitung: [["Anleitung — Workshop-Wünsche eintragen"], ["1. Erstwunsch zuerst"]],
    });
    const sheets = await parseSheets(file);
    expect(sheets[0].rows.length).toBeGreaterThan(0);
    expect(isParticipantTable(sheets[0])).toBe(false);
  });
});

describe("Kombinierter Import: Workshops und Wünsche aus einer Datei", () => {
  it("legt Workshops an und ordnet Wünsche gegen die neuen Workshops zu", async () => {
    const project = emptyProject();
    const file = xlsxFile({
      Workshops: [
        ["Workshop", "Slot", "min", "max"],
        ["Kochen", "Block 1", 2, 4],
        ["Theater", "Block 2", 0, 8],
      ],
      "Klasse 5a": [
        ["Name", "Wunsch 1"],
        ["Anna", "Kochen"],
      ],
      "Klasse 5b": [
        ["Name", "Wunsch 1"],
        ["Ben", "Theater"],
      ],
      Anleitung: [["Anleitung — Workshop-Wünsche eintragen"]],
    });
    const sheets = await parseSheets(file);
    const wsSheets = sheets.filter((s) => s.rows.length > 0 && isWorkshopTable(s));
    const pSheets = sheets.filter((s) => s.rows.length > 0 && isParticipantTable(s));
    expect(wsSheets.map((s) => s.sheetName)).toEqual(["Workshops"]);
    expect(pSheets.map((s) => s.sheetName)).toEqual(["Klasse 5a", "Klasse 5b"]);

    const wsTable = mergeTables(wsSheets);
    const pTable = mergeTables(pSheets);
    const mapping = guessMapping(pTable);

    // virtuelle Workshop-Liste wie im Dialog: vorhandene + neue aus der Datei
    const virtual = [
      ...project.workshops,
      ...parseWorkshopTable(wsTable).map((r) => ({ id: virtualWorkshopId(r.name), name: r.name })),
    ];
    // „Kochen“/„Theater“ matchen gegen die neuen Workshops -> keine unmatched titles
    expect(collectUnmatchedTitles(pTable, mapping, virtual)).toEqual([]);

    const wsSummary = applyWorkshopImport(project, wsTable, "append");
    expect(wsSummary.workshopsCreated).toBe(2);
    expect(wsSummary.slotsCreated).toBe(2);

    const summary = applyImport(project, pTable, mapping, "append", {});
    expect(summary.personsAdded).toBe(2);
    expect(summary.wishesAdded).toBe(2);
    expect(summary.unmatchedWorkshops).toEqual([]);
    const anna = project.persons.find((p) => p.name === "Anna")!;
    const kochen = project.workshops.find((w) => w.name === "Kochen")!;
    expect(project.wishes[anna.id]).toEqual([{ workshopId: kochen.id, rank: 1 }]);
  });

  it("Schreibfehler in Wunsch-Titeln wird einem neuen Workshop aus der Datei zugeordnet", async () => {
    const project = emptyProject();
    const file = xlsxFile({
      Workshops: [
        ["Workshop", "Slot", "min", "max"],
        ["Kochen", "Block 1", 2, 4],
      ],
      Wünsche: [
        ["Name", "Wunsch 1"],
        ["Anna", "Koche"], // Tippfehler
      ],
    });
    const sheets = await parseSheets(file);
    const wsTable = mergeTables(sheets.filter((s) => s.rows.length > 0 && isWorkshopTable(s)));
    const pTable = mergeTables(sheets.filter((s) => s.rows.length > 0 && isParticipantTable(s)));
    const mapping = guessMapping(pTable);

    const virtual = parseWorkshopTable(wsTable).map((r) => ({
      id: virtualWorkshopId(r.name),
      name: r.name,
    }));
    const unmatched = collectUnmatchedTitles(pTable, mapping, virtual);
    expect(unmatched.map((u) => u.title)).toEqual(["Koche"]);
    const suggested = suggestWorkshopId("Koche", virtual);
    expect(suggested).toBe(virtualWorkshopId("Kochen"));

    // Dialog-Flow: erst Workshops importieren, dann „new:“-Zuordnung auflösen
    applyWorkshopImport(project, wsTable, "append");
    const resolved = resolveTitleAssignments({ Koche: suggested! }, project.workshops);
    expect(resolved["Koche"]).toBe(project.workshops[0].id);

    const summary = applyImport(project, pTable, mapping, "append", resolved);
    expect(summary.mappedTitles).toEqual([{ title: "Koche", workshop: "Kochen" }]);
    expect(summary.wishesAdded).toBe(1);
    expect(summary.unmatchedWorkshops).toEqual([]);
  });

  it("resolveTitleAssignments ignoriert leere und unbekannte „new:“-Markierungen", () => {
    const workshops = [{ id: "w1", name: "Kochen" }];
    expect(resolveTitleAssignments({ A: "", B: "new:unbekannt", C: "w1" }, workshops)).toEqual({
      C: "w1",
    });
  });
});

describe("Zentraler Import: Konfiguration + Workshops + Wünsche aus einer Datei", () => {
  it("wendet alle drei Bereiche in einem Lauf an (Reihenfolge wie im Dialog)", async () => {
    const project = emptyProject();
    const file = xlsxFile({
      Konfiguration: [
        ["Einstellung", "Wert"],
        ["Workshops pro Person (n)", 3],
        ["Strafprofil", "fair"],
        ["Solver-Zeitlimit (Sekunden)", 90],
      ],
      Workshops: [
        ["Workshop", "Slot", "min", "max"],
        ["Kochen", "Block 1", 2, 4],
      ],
      Wünsche: [
        ["Name", "Wunsch 1"],
        ["Anna", "Kochen"],
      ],
      Anleitung: [["Anleitung — Text"]],
    });
    const sheets = await parseSheets(file);
    const nonEmpty = sheets.filter((s) => s.rows.length > 0);
    const cfg = nonEmpty.filter(isConfigTable);
    const ws = nonEmpty.filter(isWorkshopTable);
    const p = nonEmpty.filter(isParticipantTable);
    expect(cfg.map((s) => s.sheetName)).toEqual(["Konfiguration"]);
    expect(ws.map((s) => s.sheetName)).toEqual(["Workshops"]);
    expect(p.map((s) => s.sheetName)).toEqual(["Wünsche"]);

    // Dialog-Reihenfolge: Konfiguration -> Workshops -> Wünsche
    const configSummary = applyConfigImport(project, parseConfigTable(mergeTables(cfg)));
    const wsSummary = applyWorkshopImport(project, mergeTables(ws), "append");
    const pTable = mergeTables(p);
    const pSummary = applyImport(project, pTable, guessMapping(pTable), "append", {});

    expect(configSummary.applied).toHaveLength(3);
    expect(project.config).toMatchObject({ n: 3, penaltyProfile: "fair", timeLimitSec: 90 });
    expect(wsSummary.workshopsCreated).toBe(1);
    expect(pSummary.personsAdded).toBe(1);
    expect(pSummary.wishesAdded).toBe(1);
    expect(pSummary.unmatchedWorkshops).toEqual([]);
    // Wunsch landet auf dem soeben importierten Workshop
    const anna = project.persons.find((x) => x.name === "Anna")!;
    const kochen = project.workshops.find((w) => w.name === "Kochen")!;
    expect(project.wishes[anna.id]).toEqual([{ workshopId: kochen.id, rank: 1 }]);
  });

  it("funktioniert auch, wenn nur einzelne Bereiche angehakt sind", async () => {
    const project = sampleProject();
    const file = xlsxFile({
      Konfiguration: [
        ["Einstellung", "Wert"],
        ["Workshops pro Person (n)", 2],
      ],
      Wünsche: [
        ["Name", "Wunsch 1"],
        ["Zoe", "Kochen"],
      ],
    });
    const sheets = await parseSheets(file);
    const nonEmpty = sheets.filter((s) => s.rows.length > 0);

    // nur Konfiguration angehakt: Workshops und Teilnehmer bleiben unverändert
    const cfg = nonEmpty.filter(isConfigTable);
    applyConfigImport(project, parseConfigTable(mergeTables(cfg)));
    expect(project.config.n).toBe(2);
    expect(project.workshops.length).toBe(sampleProject().workshops.length);
    expect(project.persons.length).toBe(sampleProject().persons.length);
  });
});
