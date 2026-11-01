// Tests für den Import der Projekt-Konfiguration aus einem Arbeitsblatt
// (Spalten „Einstellung“/„Wert“, z. B. das Blatt „Konfiguration“ der Vorlage).

import { describe, expect, it } from "vitest";
import { applyConfigImport, isConfigTable, parseConfigTable } from "./importConfig";
import { parseSheets, type ParsedTable } from "./importFile";
import { participantXlsxTemplate } from "./export";
import { emptyProject, sampleProject } from "../model";

function table(rows: Record<string, string>[]): ParsedTable {
  return { columns: Object.keys(rows[0] ?? {}), rows, source: "csv" };
}

describe("isConfigTable", () => {
  it("erkennt Einstellungs-/Wert-Spalten und lehnt andere Blätter ab", () => {
    expect(isConfigTable(table([{ Einstellung: "n", Wert: "3" }]))).toBe(true);
    expect(isConfigTable(table([{ Schlüssel: "n", value: "3" }]))).toBe(true);
    expect(isConfigTable(table([{ Name: "Anna", "Wunsch 1": "Kochen" }]))).toBe(false);
    expect(isConfigTable(table([{ Workshop: "Kochen", Slot: "Block 1" }]))).toBe(false);
    expect(isConfigTable(table([{ Einstellung: "n" }]))).toBe(false); // keine Wert-Spalte
  });
});

describe("parseConfigTable / applyConfigImport", () => {
  it("parst alle drei Einstellungen, clamped Werte und meldet ungültige Zeilen", () => {
    const parsed = parseConfigTable(
      table([
        { Einstellung: "Workshops pro Person (n)", Wert: "5" },
        { Einstellung: "Strafprofil", Wert: "quadratisch" },
        { Einstellung: "Solver-Zeitlimit (Sekunden)", Wert: "9999" },
        { Einstellung: "Unbekannt", Wert: "x" },
        { Einstellung: "n", Wert: "abc" },
        { Einstellung: "", Wert: "" },
      ]),
    );
    expect(parsed.changes).toEqual([
      { key: "n", value: "5", parsed: 5 },
      { key: "penaltyProfile", value: "fair", parsed: "fair" },
      { key: "timeLimitSec", value: "600", parsed: 600 },
    ]);
    expect(parsed.skipped).toHaveLength(2);
    expect(parsed.skipped[0]).toContain("Unbekannt");
    expect(parsed.skipped[1]).toContain("ungültiger Wert");

    const project = emptyProject();
    const summary = applyConfigImport(project, parsed);
    expect(project.config).toMatchObject({ n: 5, penaltyProfile: "fair", timeLimitSec: 600 });
    expect(summary.applied).toHaveLength(3);
    expect(summary.applied.map((a) => a.key)).toContain("Workshops pro Person (n)");
    expect(summary.skipped).toHaveLength(2);
  });

  it("akzeptiert „effizient“ als linear und „linear“ direkt", () => {
    expect(
      parseConfigTable(table([{ Einstellung: "Strafprofil", Wert: "Effizient" }])).changes[0]
        .parsed,
    ).toBe("linear");
    expect(
      parseConfigTable(table([{ Einstellung: "Strafprofil", Wert: "linear" }])).changes[0].parsed,
    ).toBe("linear");
  });

  it("clampet n auf mindestens 1 und das Zeitlimit auf 5–600 s", () => {
    const parsed = parseConfigTable(
      table([
        { Einstellung: "n", Wert: "0" },
        { Einstellung: "Zeitlimit", Wert: "1" },
      ]),
    );
    expect(parsed.changes).toEqual([
      { key: "n", value: "1", parsed: 1 },
      { key: "timeLimitSec", value: "5", parsed: 5 },
    ]);
  });
});

describe("Konfigurationsblatt der Import-Vorlage", () => {
  it("enthält die aktuellen Werte des Projekts und round-trippt", async () => {
    const project = sampleProject();
    project.config = { n: 4, penaltyProfile: "fair", timeLimitSec: 120 };
    const file = new File([participantXlsxTemplate(project)], "import-vorlage.xlsx");
    const sheets = await parseSheets(file);
    const cfg = sheets.filter((s) => s.rows.length > 0 && isConfigTable(s));
    expect(cfg.map((s) => s.sheetName)).toEqual(["Konfiguration"]);

    const parsed = parseConfigTable(cfg[0]);
    expect(parsed.skipped).toEqual([]);

    const target = emptyProject();
    const summary = applyConfigImport(target, parsed);
    expect(target.config).toEqual({ n: 4, penaltyProfile: "fair", timeLimitSec: 120 });
    expect(summary.applied.map((a) => a.key).sort()).toEqual([
      "Solver-Zeitlimit (Sekunden)",
      "Strafprofil",
      "Workshops pro Person (n)",
    ]);
  });
});
