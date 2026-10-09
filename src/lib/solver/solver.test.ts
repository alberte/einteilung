// Unit-Tests für den Solver-Kern (Projektplan DoD: mindestens 6 Fälle
// inkl. Unlösbarkeit). Kleine, handgerechnete Instanzen.

import { describe, expect, it } from "vitest";
import { solve } from "./solve";
import { diagnose } from "./diagnose";
import type { SolveInput } from "./types";

interface MkArgs {
  slots: string[];
  /** [name, slot, min, max] */
  workshops: [string, string, number, number][];
  /** personId -> [workshopName, rank][] */
  wishes: Record<string, [string, number][]>;
  n?: number;
  penaltyProfile?: "linear" | "fair";
}

// IDs = Namen, damit die Tests lesbar bleiben
function mk(args: MkArgs): SolveInput {
  const { slots, workshops, wishes } = args;
  const workshopIds = new Set(workshops.map((w) => w[0]));
  return {
    slots: slots.map((name) => ({ id: name, name })),
    workshops: workshops.map(([name, slot, min, max]) => ({
      id: name,
      name,
      slotId: slot,
      min,
      max,
    })),
    persons: Object.keys(wishes).map((name) => ({ id: name, name })),
    wishes: Object.fromEntries(
      Object.entries(wishes).map(([person, list]) => [
        person,
        list
          .filter(([w]) => workshopIds.has(w))
          .map(([workshopId, rank]) => ({ workshopId, rank })),
      ]),
    ),
    config: {
      n: args.n ?? 1,
      penaltyProfile: args.penaltyProfile ?? "linear",
      timeLimitSec: 30,
    },
  };
}

function assignmentOf(result: ReturnType<typeof solve>, person: string, workshop: string) {
  if (result.status !== "optimal") throw new Error(`nicht optimal: ${JSON.stringify(result)}`);
  return result.assignments.find((a) => a.personId === person && a.workshopId === workshop);
}

describe("solve — Machbarkeit", () => {
  it("weist allen Teilnehmern ihre Erstwünsche zu", () => {
    const r = solve(
      mk({
        slots: ["S1"],
        workshops: [
          ["A", "S1", 1, 1],
          ["B", "S1", 1, 1],
        ],
        wishes: {
          p1: [
            ["A", 1],
            ["B", 2],
          ],
          p2: [
            ["B", 1],
            ["A", 2],
          ],
        },
      }),
    );
    expect(r.status).toBe("optimal");
    if (r.status !== "optimal") return;
    expect(assignmentOf(r, "p1", "A")?.rank).toBe(1);
    expect(assignmentOf(r, "p2", "B")?.rank).toBe(1);
    expect(r.stats.nonWish).toBe(0);
    expect(r.stats.avgWishRank).toBe(1);
  });

  it("erzwingt Mindestbelegungen auch ohne passende Wünsche (rote Zuweisung)", () => {
    const r = solve(
      mk({
        slots: ["S1"],
        workshops: [
          ["A", "S1", 2, 2],
          ["B", "S1", 0, 1],
        ],
        wishes: { p1: [["A", 1]], p2: [] },
      }),
    );
    expect(r.status).toBe("optimal");
    if (r.status !== "optimal") return;
    // A braucht min 2, nur p1 wünscht A -> p2 wird ohne Wunsch zugeordnet.
    const inA = r.assignments.filter((a) => a.workshopId === "A");
    expect(inA.length).toBe(2);
    expect(r.stats.nonWish).toBe(1);
    expect(r.stats.totalAssignments).toBe(2);
  });

  it("respektiert Höchstbelegungen (Überlauf auf Zweitwunsch)", () => {
    const r = solve(
      mk({
        slots: ["S1"],
        workshops: [
          ["A", "S1", 0, 1],
          ["B", "S1", 0, 1],
        ],
        wishes: {
          p1: [
            ["A", 1],
            ["B", 2],
          ],
          p2: [
            ["A", 1],
            ["B", 2],
          ],
        },
      }),
    );
    expect(r.status).toBe("optimal");
    if (r.status !== "optimal") return;
    const ranks = r.assignments.map((a) => a.rank).sort();
    expect(ranks).toEqual([1, 2]);
    expect(r.stats.penalty).toBe(3);
  });

  it("erlaubt höchstens einen Workshop pro Slot", () => {
    const r = solve(
      mk({
        slots: ["S1"],
        workshops: [
          ["A", "S1", 0, 5],
          ["B", "S1", 0, 5],
        ],
        wishes: {
          p1: [
            ["A", 1],
            ["B", 2],
          ],
        },
      }),
    );
    expect(r.status).toBe("optimal");
    if (r.status !== "optimal") return;
    expect(r.assignments.length).toBe(1);
    expect(r.assignments[0].workshopId).toBe("A");
  });

  it("weist n Workshops über mehrere Slots zu", () => {
    const r = solve(
      mk({
        slots: ["S1", "S2"],
        workshops: [
          ["A", "S1", 1, 1],
          ["B", "S2", 1, 1],
        ],
        wishes: {
          p1: [
            ["A", 1],
            ["B", 1],
          ],
        },
        n: 2,
      }),
    );
    expect(r.status).toBe("optimal");
    if (r.status !== "optimal") return;
    expect(r.assignments.length).toBe(2);
    expect(r.assignments.map((a) => a.workshopId).sort()).toEqual(["A", "B"]);
  });

  it("findet das Optimum dort, wo gierige Erstwunsch-Vergabe scheitert", () => {
    // p1: A@1, B@2 ; p2: A@1 (nur A). A min/max 1, B min 1, C min 0.
    // Gierig: p1->A, dann p2 ohne Wunsch -> Strafe 1e6.
    // Optimal: p1->B (Rang 2), p2->A (Rang 1) -> Strafe 3.
    const r = solve(
      mk({
        slots: ["S1", "S2"],
        workshops: [
          ["A", "S1", 1, 1],
          ["B", "S1", 1, 1],
          ["C", "S2", 0, 1],
        ],
        wishes: {
          p1: [
            ["A", 1],
            ["B", 2],
          ],
          p2: [["A", 1]],
        },
      }),
    );
    expect(r.status).toBe("optimal");
    if (r.status !== "optimal") return;
    expect(assignmentOf(r, "p1", "B")).toBeTruthy();
    expect(assignmentOf(r, "p2", "A")).toBeTruthy();
    expect(r.stats.nonWish).toBe(0);
    expect(r.stats.penalty).toBe(3);
  });

  it("Strafprofil „fair“ bevorzugt gleichmäßigere Ränge", () => {
    // p1: A@1, B@2 ; p2: A@2, B@3. Optionen (n=1, A max 1, B max 1):
    //  X: p1->A(1), p2->B(3)  linear 4, fair 1+9=10
    //  Y: p1->B(2), p2->A(2)  linear 4, fair 4+4=8
    // linear: beide optimal (4). fair: nur Y optimal (8).
    const fair = solve(
      mk({
        slots: ["S1"],
        workshops: [
          ["A", "S1", 0, 1],
          ["B", "S1", 0, 1],
        ],
        wishes: {
          p1: [
            ["A", 1],
            ["B", 2],
          ],
          p2: [
            ["A", 2],
            ["B", 3],
          ],
        },
        penaltyProfile: "fair",
      }),
    );
    expect(fair.status).toBe("optimal");
    if (fair.status !== "optimal") return;
    expect(assignmentOf(fair, "p1", "B")).toBeTruthy();
    expect(assignmentOf(fair, "p2", "A")).toBeTruthy();
    expect(fair.stats.penalty).toBe(8);
  });
});

describe("solve — Unlösbarkeit", () => {
  it("meldet Mindestbelegungen pro Slot, die die Teilnehmerzahl übersteigen", () => {
    const r = solve(
      mk({
        slots: ["S1"],
        workshops: [
          ["A", "S1", 5, 10],
          ["B", "S1", 5, 10],
        ],
        wishes: { p1: [["A", 1]], p2: [["B", 1]], p3: [["A", 1]] },
      }),
    );
    expect(r.status).toBe("infeasible");
    if (r.status !== "infeasible") return;
    expect(r.reasons.length).toBeGreaterThan(0);
    expect(r.reasons.join(" ")).toContain("Slot");
    expect(r.reasons.join(" ")).toContain("10");
  });

  it("meldet zu geringe Gesamtkapazität für n × Teilnehmer", () => {
    const r = solve(
      mk({
        slots: ["S1", "S2"],
        workshops: [
          ["A", "S1", 0, 2],
          ["B", "S2", 0, 2],
        ],
        wishes: {
          p1: [
            ["A", 1],
            ["B", 1],
          ],
          p2: [
            ["A", 1],
            ["B", 1],
          ],
          p3: [
            ["A", 1],
            ["B", 1],
          ],
          p4: [
            ["A", 1],
            ["B", 1],
          ],
        },
        n: 2,
      }),
    );
    expect(r.status).toBe("infeasible");
    if (r.status !== "infeasible") return;
    expect(r.reasons.join(" ")).toContain("Gesamtkapazität");
  });

  it("meldet n > Zahl der Slots", () => {
    const r = solve(
      mk({
        slots: ["S1"],
        workshops: [["A", "S1", 0, 10]],
        wishes: { p1: [["A", 1]] },
        n: 2,
      }),
    );
    expect(r.status).toBe("infeasible");
    if (r.status !== "infeasible") return;
    expect(r.reasons.join(" ")).toContain("größer als die Zahl der Slots");
  });

  it("meldet min > max pro Workshop", () => {
    const r = solve(
      mk({
        slots: ["S1"],
        workshops: [["A", "S1", 5, 2]],
        wishes: { p1: [["A", 1]] },
      }),
    );
    expect(r.status).toBe("infeasible");
    if (r.status !== "infeasible") return;
    expect(r.reasons.join(" ")).toContain("Mindestbelegung");
  });

  it("Summe der Mindestbelegungen > n × Teilnehmer wird erkannt", () => {
    const input = mk({
      slots: ["S1", "S2"],
      workshops: [
        ["A", "S1", 8, 10],
        ["B", "S2", 8, 10],
      ],
      wishes: { p1: [["A", 1]], p2: [["B", 1]], p3: [["A", 1]] },
      n: 1,
    });
    const reasons = diagnose(input);
    expect(reasons.join(" ")).toContain("Mindestbelegungen");
  });

  it("leere Instanz ohne Mindestbelegungen ist lösbar", () => {
    const r = solve(
      mk({
        slots: ["S1"],
        workshops: [["A", "S1", 0, 5]],
        wishes: {},
      }),
    );
    expect(r.status).toBe("optimal");
    if (r.status !== "optimal") return;
    expect(r.assignments.length).toBe(0);
  });
});
