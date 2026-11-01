// Import der Projekt-Konfiguration aus einem Arbeitsblatt (Key-Value-Format:
// Spalten „Einstellung“ und „Wert“, z. B. das Blatt „Konfiguration“ der Vorlage).

import type { PenaltyProfile, Project } from "../model";
import { normalizeTitle, type ParsedTable } from "./importFile";

export interface ConfigChange {
  key: "n" | "penaltyProfile" | "timeLimitSec";
  /** anzuzeigender Wert (so wie geparst) */
  value: string;
  parsed: number | PenaltyProfile;
}

export interface ParsedConfig {
  changes: ConfigChange[];
  /** Zeilen, die nicht zugeordnet werden konnten, z. B. „Zeile 4 ‚Foo‘: unbekannte Einstellung“ */
  skipped: string[];
}

export interface ConfigImportSummary {
  applied: { key: string; value: string }[];
  skipped: string[];
}

const KEY_LABEL: Record<ConfigChange["key"], string> = {
  n: "Workshops pro Person (n)",
  penaltyProfile: "Strafprofil",
  timeLimitSec: "Solver-Zeitlimit (Sekunden)",
};

/** Erkennt ein Konfigurationsblatt an den Spalten „Einstellung“ + „Wert“. */
export function isConfigTable(table: ParsedTable): boolean {
  const key = table.columns.find((c) =>
    /^(einstellung|schlüssel|schluessel|key|config|konfiguration|name)$/i.test(c.trim()),
  );
  const value = table.columns.find((c) => /^(wert|value)$/i.test(c.trim()));
  return Boolean(key && value);
}

function configKeyOf(raw: string): ConfigChange["key"] | null {
  const k = normalizeTitle(raw);
  if (["n", "workshopsproperson", "workshopspropersonn", "anzahlworkshopsproperson"].includes(k)) {
    return "n";
  }
  if (["penaltyprofile", "strafprofil", "profil"].includes(k)) {
    return "penaltyProfile";
  }
  if (
    [
      "timelimitsec",
      "zeitlimit",
      "solverzeitlimit",
      "zeitlimitsekunden",
      "solverzeitlimitsekunden",
    ].includes(k)
  ) {
    return "timeLimitSec";
  }
  return null;
}

function parseValue(key: ConfigChange["key"], raw: string): ConfigChange["parsed"] | null {
  const v = raw.trim();
  if (key === "penaltyProfile") {
    const n = normalizeTitle(v);
    if (n === "linear" || n === "effizient") return "linear";
    if (n === "fair" || n === "quadratisch") return "fair";
    return null;
  }
  const num = Number(v);
  if (!Number.isFinite(num)) return null;
  if (key === "n") return Math.max(1, Math.floor(num));
  return Math.min(600, Math.max(5, Math.floor(num))); // timeLimitSec wie ConfigTab (5–600 s)
}

/** Parst ein Konfigurationsblatt; unbekannte/ungültige Zeilen landen in „skipped“. */
export function parseConfigTable(table: ParsedTable): ParsedConfig {
  const keyCol = table.columns.find((c) =>
    /^(einstellung|schlüssel|schluessel|key|config|konfiguration|name)$/i.test(c.trim()),
  )!;
  const valueCol = table.columns.find((c) => /^(wert|value)$/i.test(c.trim()))!;
  const changes: ConfigChange[] = [];
  const skipped: string[] = [];
  table.rows.forEach((row, i) => {
    const key = (row[keyCol] ?? "").trim();
    const value = (row[valueCol] ?? "").trim();
    if (!key && !value) return; // leere Zeile
    const line = `Zeile ${i + 1}`;
    const ck = configKeyOf(key);
    if (!ck) {
      skipped.push(`${line} „${key}“: unbekannte Einstellung`);
      return;
    }
    const parsed = parseValue(ck, value);
    if (parsed === null) {
      skipped.push(`${line} „${key}“: ungültiger Wert „${value}“`);
      return;
    }
    changes.push({ key: ck, value: String(parsed), parsed });
  });
  return { changes, skipped };
}

/** Wendet geparste Konfigurationswerte auf das Projekt an. */
export function applyConfigImport(project: Project, parsed: ParsedConfig): ConfigImportSummary {
  const applied: { key: string; value: string }[] = [];
  for (const c of parsed.changes) {
    if (c.key === "n") project.config.n = Number(c.parsed);
    else if (c.key === "penaltyProfile") project.config.penaltyProfile = c.parsed as PenaltyProfile;
    else project.config.timeLimitSec = Number(c.parsed);
    applied.push({ key: KEY_LABEL[c.key], value: c.value });
  }
  return { applied, skipped: parsed.skipped };
}
