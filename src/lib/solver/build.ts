// Baut das MIP-Modell für javascript-lp-solver (Projektplan A4).
//
// Binärvariablen x[p,w] ∈ {0,1} für Zuweisung Person p -> Workshop w.
// Nebenbedingungen:
//   pro Person:      Σ_w x[p,w]  = n          (n Workshops pro Person)
//   pro Person+Slot: Σ_w∈slot x[p,w] ≤ 1      (höchstens 1 Workshop pro Slot)
//   pro Workshop:    min ≤ Σ_p x[p,w] ≤ max   (Belegungsgrenzen)
// Ziel: minimiere Σ rankCost(rank(p,w)) bzw. NO_WISH_COST.

import type { Model as LpModel, SolveResult as LpResult } from "javascript-lp-solver";
import solver from "javascript-lp-solver";
import type { SolveInput } from "./types";
import { NO_WISH_COST, rankCost } from "./penalties";

export interface VarMeta {
  personId: string;
  workshopId: string;
  fromWish: boolean;
  rank: number | null;
}

export interface BuiltModel {
  model: LpModel;
  varMeta: Record<string, VarMeta>;
  varCount: number;
}

/**
 * @param includeNonWish false: nur Wunsch-Variablen (Stufe A — schnell).
 *                       true: zusätzlich alle restlichen Paare (Stufe B,
 *                       nötig sobald Mindestbelegungen oder n ohne Wünsche
 *                       nicht aus Wünschen gedeckt werden können).
 */
export function buildModel(
  input: SolveInput,
  includeNonWish: boolean,
  timeoutMs: number,
): BuiltModel {
  const { persons, workshops, slots, config } = input;
  const workshopById = new Map(workshops.map((w) => [w.id, w]));
  const constraints: Record<string, { min?: number; max?: number; equal?: number }> = {};
  const variables: Record<string, Record<string, number>> = {};
  const varMeta: Record<string, VarMeta> = {};
  const ints: Record<string, 0 | 1> = {};

  for (const p of persons) {
    constraints[`p_${p.id}`] = { equal: config.n };
    for (const s of slots) {
      constraints[`ps_${p.id}_${s.id}`] = { max: 1 };
    }
  }
  for (const w of workshops) {
    constraints[`w_${w.id}`] = { min: w.min, max: w.max };
  }

  const addVar = (meta: VarMeta, cost: number) => {
    const w = workshopById.get(meta.workshopId)!;
    const name = `x_${meta.personId}|${meta.workshopId}`;
    if (variables[name]) return;
    variables[name] = {
      [`p_${meta.personId}`]: 1,
      [`ps_${meta.personId}_${w.slotId}`]: 1,
      [`w_${w.id}`]: 1,
      cost,
    };
    varMeta[name] = meta;
    ints[name] = 1;
  };

  // Stufe A: Wunsch-Variablen (Duplikate pro Person/Workshop: bester Rang)
  const bestRank = new Map<string, number>();
  for (const p of persons) {
    bestRank.clear();
    for (const wish of input.wishes[p.id] ?? []) {
      if (!workshopById.has(wish.workshopId)) continue;
      const prev = bestRank.get(wish.workshopId);
      if (prev === undefined || wish.rank < prev) bestRank.set(wish.workshopId, wish.rank);
    }
    for (const [workshopId, rank] of bestRank) {
      addVar(
        { personId: p.id, workshopId, fromWish: true, rank },
        rankCost(config.penaltyProfile, rank),
      );
    }
  }

  // Stufe B: alle übrigen Paare als „kein Wunsch“-Zuweisungen
  if (includeNonWish) {
    for (const p of persons) {
      for (const w of workshops) {
        addVar({ personId: p.id, workshopId: w.id, fromWish: false, rank: null }, NO_WISH_COST);
      }
    }
  }

  const model: LpModel = {
    optimize: "cost",
    opType: "min",
    constraints,
    variables,
    ints,
    timeout: timeoutMs,
    options: { timeout: timeoutMs },
  };

  return { model, varMeta, varCount: Object.keys(variables).length };
}

export function lpSolve(model: LpModel): LpResult | undefined {
  const res = solver.Solve(model) as LpResult | undefined;
  return res && typeof res === "object" ? res : undefined;
}
