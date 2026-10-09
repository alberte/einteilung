// solve() — reine Solver-Funktion (Projektplan, Solver-Contract).
//
// Vorgehen:
//  1. diagnose(): exakte Unlösbarkeitsprüfung mit konkreten Ursachen.
//  2. Stufe A: MIP nur mit Wunsch-Variablen. Ist das lösbar, ist es auch
//     global optimal (NO_WISH_COST dominiert jede Wunschstrafe).
//  3. Stufe B: vollständiges Modell inkl. „kein Wunsch“-Zuweisungen, falls
//     Stufe A unlösbar ist (z. B. Mindestbelegungen nur aus Wünschen nicht
//     erreichbar, oder Personen mit zu wenigen Wünschen).

import { diagnose } from "./diagnose";
import { buildModel, lpSolve, type VarMeta } from "./build";
import type { Assignment, SolveInput, SolveResult, SolveStats } from "./types";

const THRESHOLD = 0.5;

export function solve(input: SolveInput): SolveResult {
  const t0 = performance.now();
  const limitSec = Math.max(1, Math.min(600, input.config.timeLimitSec || 60));
  const timeoutMs = limitSec * 1000;

  const reasons = diagnose(input);
  if (reasons.length > 0) {
    return { status: "infeasible", reasons };
  }

  const personById = new Map(input.persons.map((p) => [p.id, p]));
  const workshopById = new Map(input.workshops.map((w) => [w.id, w]));

  const run = (includeNonWish: boolean) => {
    const built = buildModel(input, includeNonWish, timeoutMs);
    const res = lpSolve(built.model);
    return { built, res, includeNonWish };
  };

  let attempt = run(false);
  if (!attempt.res?.feasible) {
    attempt = run(true);
  }
  const res = attempt.res;
  const elapsed = performance.now() - t0;

  if (!res?.feasible) {
    if (elapsed >= timeoutMs * 0.9) {
      return { status: "timeout" };
    }
    // Diagnose hat „lösbar“ gesagt — sollte nicht passieren. Häufigster
    // Grund in der Praxis: Koppel-Paare, die die aggregierten Prüfungen
    // nicht abdecken.
    return {
      status: "infeasible",
      reasons: [
        "Keine Lösung gefunden, obwohl die Kapazitätsprüfungen bestanden haben. " +
          "Bitte Kopplungen („immer zusammen“-Workshops) und Verbindungen prüfen " +
          "oder als Fehler melden (am besten mit dem gespeicherten Projekt-JSON).",
      ],
    };
  }

  // Zuweisungen extrahieren
  const assignments: Assignment[] = [];
  const rankDistribution: Record<number, number> = {};
  const workshopCounts: Record<string, number> = {};
  let fromWishes = 0;
  let rankSum = 0;

  for (const [name, meta] of Object.entries(attempt.built.varMeta) as [string, VarMeta][]) {
    const value = (res as Record<string, unknown>)[name];
    if (typeof value !== "number" || value < THRESHOLD) continue;
    assignments.push({ ...meta });
    workshopCounts[meta.workshopId] = (workshopCounts[meta.workshopId] ?? 0) + 1;
    if (meta.fromWish && meta.rank !== null) {
      fromWishes += 1;
      rankSum += meta.rank;
      rankDistribution[meta.rank] = (rankDistribution[meta.rank] ?? 0) + 1;
    }
  }

  // Stabile Reihenfolge: Person (Name), dann Slot, dann Workshopname
  assignments.sort((a, b) => {
    const pa = personById.get(a.personId)?.name ?? "";
    const pb = personById.get(b.personId)?.name ?? "";
    if (pa !== pb) return pa.localeCompare(pb, "de");
    const sa = slotIndexOf(a.workshopId);
    const sb = slotIndexOf(b.workshopId);
    if (sa !== sb) return sa - sb;
    const wa = workshopById.get(a.workshopId)?.name ?? "";
    const wb = workshopById.get(b.workshopId)?.name ?? "";
    return wa.localeCompare(wb, "de");
  });

  const stats: SolveStats = {
    totalAssignments: assignments.length,
    fromWishes,
    nonWish: assignments.length - fromWishes,
    avgWishRank: fromWishes > 0 ? rankSum / fromWishes : null,
    rankDistribution,
    workshopCounts,
    penalty: typeof res.result === "number" ? res.result : 0,
    solveMs: Math.round(elapsed),
  };

  return {
    status: "optimal",
    assignments,
    stats,
    stage: attempt.includeNonWish ? "full" : "wishes",
  };

  function slotIndexOf(workshopId: string): number {
    const w = workshopById.get(workshopId);
    const idx = w ? input.slots.findIndex((s) => s.id === w.slotId) : -1;
    return idx < 0 ? Number.MAX_SAFE_INTEGER : idx;
  }
}
