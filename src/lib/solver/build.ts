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

/** Kanonischer Schlüssel eines Koppel-Paars (unabhängig von der Richtung). */
export function pairKeyOf(aId: string, bId: string): string {
  return [aId, bId].sort().join("|");
}

/** Instanzen-Gruppen: groupId -> Workshops (nur Gruppen mit >= 2 Instanzen). */
function groupsOf(workshops: { id: string; groupId?: string | null }[]) {
  const groups = new Map<string, { id: string; groupId?: string | null }[]>();
  for (const w of workshops) {
    if (!w.groupId) continue;
    const list = groups.get(w.groupId) ?? [];
    list.push(w);
    groups.set(w.groupId, list);
  }
  for (const [gid, list] of groups) {
    if (list.length < 2) groups.delete(gid);
  }
  return groups;
}

/** Kanonische Koppel-Paare (jedes Paar genau einmal). */
function pairsOf(
  workshops: { id: string; pairedWith?: string | null }[],
  workshopById: Map<string, { id: string; pairedWith?: string | null }>,
): { a: string; b: string; key: string }[] {
  const pairs: { a: string; b: string; key: string }[] = [];
  const seen = new Set<string>();
  for (const w of workshops) {
    const partner = w.pairedWith ? workshopById.get(w.pairedWith) : undefined;
    if (!partner || partner.id === w.id) continue;
    const key = pairKeyOf(w.id, partner.id);
    if (seen.has(key)) continue;
    seen.add(key);
    const [a, b] = [w.id, partner.id].sort();
    pairs.push({ a, b, key });
  }
  return pairs;
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

  // Instanzen-Gruppen: höchstens eine Instanz pro Person
  const groups = groupsOf(workshops);
  const groupIds = new Set(groups.keys());
  for (const gid of groupIds) {
    for (const p of persons) {
      constraints[`g_${p.id}_${gid}`] = { max: 1 };
    }
  }

  /** Alle Instanzen der Gruppe eines Workshops (oder nur der Workshop selbst). */
  const groupMembersOf = (workshopId: string): string[] => {
    const w = workshopById.get(workshopId);
    if (!w?.groupId) return [workshopId];
    const list = groups.get(w.groupId);
    return list && list.length >= 2 ? list.map((x) => x.id) : [workshopId];
  };

  // Koppel-Paare: x[a] = x[b] pro Person (a + b = 0 mit Vorzeichen +/-1)
  const pairs = pairsOf(workshops, workshopById);
  const pairOf = new Map<string, { key: string; sign: number }>();
  for (const pair of pairs) {
    pairOf.set(pair.a, { key: pair.key, sign: 1 });
    pairOf.set(pair.b, { key: pair.key, sign: -1 });
    for (const p of persons) {
      constraints[`pair_${p.id}_${pair.key}`] = { equal: 0 };
    }
  }

  const addVar = (meta: VarMeta, cost: number) => {
    const w = workshopById.get(meta.workshopId)!;
    const name = `x_${meta.personId}|${meta.workshopId}`;
    if (variables[name]) return;
    const coefficients: Record<string, number> = {
      [`p_${meta.personId}`]: 1,
      [`ps_${meta.personId}_${w.slotId}`]: 1,
      [`w_${w.id}`]: 1,
    };
    if (w.groupId && groupIds.has(w.groupId)) {
      coefficients[`g_${meta.personId}_${w.groupId}`] = 1;
    }
    const pair = pairOf.get(w.id);
    if (pair) {
      coefficients[`pair_${meta.personId}_${pair.key}`] = pair.sign;
    }
    coefficients.cost = cost;
    variables[name] = coefficients;
    varMeta[name] = meta;
    ints[name] = 1;
  };

  // Stufe A: Wunsch-Variablen.
  // Ein Wunsch auf eine Instanz einer verbundenen Gruppe gilt für ALLE
  // Durchführungen des Workshops (gleicher Rang) — es ist egal, welche
  // Instanz die Person am Ende besucht.
  // (Duplikate pro Person/Workshop: bester Rang)
  const bestRank = new Map<string, number>();
  for (const p of persons) {
    bestRank.clear();
    for (const wish of input.wishes[p.id] ?? []) {
      if (!workshopById.has(wish.workshopId)) continue;
      const members = groupMembersOf(wish.workshopId);
      for (const memberId of members) {
        const prev = bestRank.get(memberId);
        if (prev === undefined || wish.rank < prev) bestRank.set(memberId, wish.rank);
      }
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
