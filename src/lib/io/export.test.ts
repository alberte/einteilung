// Tests für Export/Vorlagen: CSV, XLSX (Roundtrip über XLSX.read) und JSON.

import { describe, expect, it } from "vitest";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import {
  emptyProjectTemplate,
  participantCsvTemplate,
  participantXlsxTemplate,
  resultCsv,
  resultXlsx,
} from "./export";
import { emptyProject, normalizeProject, sampleProject } from "../model";
import { solve, toSolveInput } from "../solver";

function readWorkbook(buf: ArrayBuffer) {
  return XLSX.read(buf, { type: "buffer" });
}

describe("Vorlagen", () => {
  it("leere Projekt-Vorlage ist gültiges, ladbares JSON", () => {
    const raw = emptyProjectTemplate();
    const parsed = JSON.parse(raw);
    const project = normalizeProject(parsed);
    expect(project.version).toBe(emptyProject().version);
    expect(project.slots).toEqual([]);
    expect(project.workshops).toEqual([]);
    expect(project.persons).toEqual([]);
  });

  it("Teilnehmer-CSV-Vorlage: Kopfzeile, Beispielzeile, Semikolon, BOM", () => {
    const project = sampleProject();
    const csv = participantCsvTemplate(project);
    expect(csv.startsWith("\uFEFF")).toBe(true);

    const parsed = Papa.parse<Record<string, string>>(csv.replace(/^\uFEFF/, ""), {
      header: true,
      skipEmptyLines: "greedy",
    });
    expect(parsed.meta.delimiter).toBe(";");
    expect(parsed.meta.fields?.[0]).toBe("Name");
    expect(parsed.meta.fields?.[1]).toBe("Wunsch 1");
    expect(parsed.data.length).toBe(1);

    // Beispielzeile enthält echte Workshop-Namen des Projekts
    const row = parsed.data[0];
    const names = project.workshops.map((w) => w.name);
    const wished = Object.values(row).filter((v) => v.length > 0 && v !== "Beispielperson");
    expect(wished.length).toBeGreaterThan(0);
    expect(wished.every((v) => names.includes(v))).toBe(true);
  });

  it("Teilnehmer-CSV-Vorlage eines leeren Projekts bleibt parsebar", () => {
    const csv = participantCsvTemplate(emptyProject());
    const parsed = Papa.parse<Record<string, string>>(csv.replace(/^\uFEFF/, ""), {
      header: true,
      skipEmptyLines: "greedy",
    });
    expect(parsed.meta.fields?.[0]).toBe("Name");
    expect(parsed.data.length).toBe(1);
    expect(parsed.data[0]["Name"]).toBe("Beispielperson");
  });
});

describe("XLSX-Teilnehmervorlage", () => {
  it("hat Blätter Wünsche (zuerst, import-fähig), Anleitung, Workshops", () => {
    const project = sampleProject();
    const wb = readWorkbook(participantXlsxTemplate(project));
    expect(wb.SheetNames[0]).toBe("Wünsche");
    expect(wb.SheetNames).toContain("Anleitung");
    expect(wb.SheetNames).toContain("Workshops");

    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Wünsche"], {
      defval: "",
    });
    expect(Object.keys(rows[0])[0]).toBe("Name");
    expect(String(Object.keys(rows[0])[1])).toBe("Wunsch 1");
    const wished = Object.values(rows[0]).filter(
      (v) => String(v).length > 0 && v !== "Beispielperson",
    );
    expect(wished.every((v) => project.workshops.some((w) => w.name === v))).toBe(true);
  });

  it("referenziert alle Workshops inkl. Verbindungs-Hinweisen", () => {
    const project = sampleProject();
    const wb = readWorkbook(participantXlsxTemplate(project));
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Workshops"], {
      defval: "",
    });
    expect(rows.length).toBe(project.workshops.length);
    // Kopplungshinweis für „Robotik“ enthält den Partner
    const robotik = rows.find((r) => r["Workshop"] === "Robotik");
    expect(String(robotik?.["Hinweis"] ?? "")).toContain("Robotik Aufbau");
  });
});

describe("XLSX-Ergebnisexport", () => {
  it("erzeugt Zuweisungen, Pro Person, Pro Workshop und Statistik", () => {
    const project = sampleProject();
    const result = solve(toSolveInput(project));
    if (result.status !== "optimal") throw new Error("Beispielprojekt muss optimal sein");

    const wb = readWorkbook(resultXlsx(project, result));
    expect(wb.SheetNames).toEqual(["Zuweisungen", "Pro Person", "Pro Workshop", "Statistik"]);

    const assignments = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      wb.Sheets["Zuweisungen"],
      { defval: "" },
    );
    expect(assignments.length).toBe(12 * 3);
    expect(Object.keys(assignments[0])).toEqual(["Person", "Workshop", "Slot", "Wunsch"]);

    const perPerson = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Pro Person"], {
      defval: "",
    });
    expect(perPerson.length).toBe(12);

    const perWorkshop = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      wb.Sheets["Pro Workshop"],
      { defval: "" },
    );
    expect(perWorkshop.length).toBe(project.workshops.length);
  });

  it("CSV-Export enthält Kopfzeile und alle Zuweisungen", () => {
    const project = sampleProject();
    const result = solve(toSolveInput(project));
    if (result.status !== "optimal") throw new Error("Beispielprojekt muss optimal sein");
    const csv = resultCsv(project, result);
    const parsed = Papa.parse<string[]>(csv, { delimiter: ";" });
    expect(parsed.data[0]).toEqual(["Person", "Workshop", "Slot", "Wunsch"]);
    expect(parsed.data.length).toBe(12 * 3 + 1);
  });
});
