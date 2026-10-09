// Solver-Contract gemäß Projektplan, Abschnitt 6:
//   solve(input: SolveInput): SolveResult
// Reine Funktion, unabhängig von der UI, unit-testbar (A7).

import type { PenaltyProfile, Person, Slot, Wish, Workshop } from "../model";

export interface SolveConfig {
  n: number;
  penaltyProfile: PenaltyProfile;
  timeLimitSec: number;
}

export interface SolveInput {
  persons: Person[];
  workshops: Workshop[];
  slots: Slot[];
  config: SolveConfig;
  /** personId -> Wünsche (workshopIds müssen gültig sein) */
  wishes: Record<string, Wish[]>;
}

export interface Assignment {
  personId: string;
  workshopId: string;
  /** true, wenn der Workshop auf dem Wunschzettel stand */
  fromWish: boolean;
  /** Wunsch-Rang (1 = Erstwunsch) oder null bei „kein Wunsch“ */
  rank: number | null;
}

export interface SolveStats {
  totalAssignments: number;
  fromWishes: number;
  nonWish: number;
  /** Ø erfüllter Wunsch-Rang (null, wenn keine Wünsche erfüllt wurden) */
  avgWishRank: number | null;
  /** Rang -> Anzahl Zuweisungen */
  rankDistribution: Record<number, number>;
  /** workshopId -> Belegung */
  workshopCounts: Record<string, number>;
  /** Gesamte Rangstrafe der Lösung */
  penalty: number;
  solveMs: number;
}

export type SolveResult =
  | {
      status: "optimal";
      assignments: Assignment[];
      stats: SolveStats;
      /** "wishes": nur Wunsch-Zuweisungen nötig; "full": zusätzlich Platz-Zuweisungen */
      stage: "wishes" | "full";
    }
  | {
      /** Nicht optimal gelöst innerhalb des Zeitlimits */
      status: "timeout";
    }
  | {
      status: "infeasible";
      /** Konkrete Ursachen, z. B. „Slot A: min-Summe 24 > 12 Personen“ */
      reasons: string[];
    }
  | {
      status: "error";
      message: string;
    };
