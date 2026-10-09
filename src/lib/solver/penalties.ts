import type { PenaltyProfile } from "../model";

/**
 * Strafkosten für eine Zuweisung.
 * - "linear" („Effizient“): Rang r kostet r → minimiert die Summe der Ränge.
 * - "fair" („Fair“): Rang r kostet r² → hohe Ränge werden überproportional
 *   bestraft, dadurch werden Erstwünsche gleichmäßiger verteilt.
 */
export function rankCost(profile: PenaltyProfile, rank: number): number {
  return profile === "fair" ? rank * rank : rank;
}

/**
 * Kosten einer Zuweisung ohne erfüllten Wunsch („Rotzuweisung“).
 * Muss über jeder möglichen Summe echter Wunsch-Strafen liegen, damit
 * solche Zuweisungen nur erfolgen, wenn es anders nicht geht.
 */
export const NO_WISH_COST = 1_000_000;
