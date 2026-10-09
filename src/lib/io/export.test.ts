// Tests für die Vorlagen-Generierung (leeres Projekt-JSON, Teilnehmer-CSV).

import { describe, expect, it } from "vitest";
import { emptyProjectTemplate, participantCsvTemplate } from "./export";
import { emptyProject, normalizeProject, sampleProject } from "../model";
import Papa from "papaparse";

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
