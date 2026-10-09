// Unit-Tests für den Solver-Kern (Projektplan DoD: mindestens 6 Fälle
// inkl. Unlösbarkeit). Kleine, handgerechnete Instanzen.

import { describe, expect, it } from "vitest";
import { solve } from "./solve";
import { diagnose } from "./diagnose";
import { sampleProject } from "../model";
import { toSolveInput } from "./input";
import type { SolveInput } from "./types";

interface MkArgs {
  slots: string[];
  /** [name, slot, min, max, pairedWith?, groupId?] */
  workshops: [string, string, number, number, (string | null)?, (string | null)?][];
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
    workshops: workshops.map(([name, slot, min, max, pairedWith, groupId]) => ({
      id: name,
      name,
      slotId: slot,
      min,
      max,
      pairedWith: pairedWith ?? null,
      groupId: groupId ?? null,
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

describe("solve — Beispielprojekt", () => {
  it("ist lösbar (Instanzen-Gruppe + Kopplung im Demo-Datensatz)", () => {
    const project = sampleProject();
    const input = toSolveInput(project);
    expect(diagnose(input)).toEqual([]);
    const r = solve(input);
    expect(r.status).toBe("optimal");
    if (r.status !== "optimal") return;
    expect(r.assignments.length).toBe(12 * 3);

    const idOf = (name: string) => project.workshops.find((w) => w.name === name)!.id;

    // Kopplung „Robotik“/„Robotik Aufbau“: nie ohne Partner
    const inRobotik = new Set(
      r.assignments.filter((a) => a.workshopId === idOf("Robotik")).map((a) => a.personId),
    );
    const inAufbau = new Set(
      r.assignments.filter((a) => a.workshopId === idOf("Robotik Aufbau")).map((a) => a.personId),
    );
    expect([...inRobotik].every((p) => inAufbau.has(p))).toBe(true);
    expect([...inAufbau].every((p) => inRobotik.has(p))).toBe(true);

    // Instanzen-Gruppe „Kochen“: niemand in beiden Terminen
    const kochen = r.assignments.filter(
      (a) => a.workshopId === idOf("Kochen") || a.workshopId === idOf("Kochen (Wiederholung)"),
    );
    expect(kochen.length).toBe(new Set(kochen.map((a) => a.personId)).size);
  });
});

describe("solve — Verbindungen", () => {
  it("Instanzen-Gruppe: Person erhält denselben Workshop nur einmal", () => {
    const r = solve(
      mk({
        slots: ["S1", "S2"],
        workshops: [
          ["A1", "S1", 0, 5, null, "G"],
          ["A2", "S2", 0, 5, null, "G"],
          ["B1", "S1", 0, 5],
          ["B2", "S2", 0, 5],
        ],
        wishes: {
          p1: [
            ["A1", 1],
            ["A2", 2],
            ["B2", 1],
          ],
        },
        n: 2,
      }),
    );
    expect(r.status).toBe("optimal");
    if (r.status !== "optimal") return;
    const ids = r.assignments.map((a) => a.workshopId);
    // p1 erhält „A“ genau einmal (A1 oder A2) plus Erstwunsch B2
    expect(ids.filter((id) => id === "A1" || id === "A2").length).toBe(1);
    expect(ids).toContain("B2");
    expect(r.assignments.length).toBe(2);
    expect(r.stats.nonWish).toBe(0);
  });

  it("Wunsch auf eine Durchführung gilt für alle Instanzen der Gruppe", () => {
    // p1 und p2 wünschen nur A1 — A1 fasst eine Person. Dank Gruppen-Wunsch
    // bekommt die zweite Person A2 (andere Durchführung) als Erstwunsch.
    const r = solve(
      mk({
        slots: ["S1", "S2"],
        workshops: [
          ["A1", "S1", 0, 1, null, "G"],
          ["A2", "S2", 0, 1, null, "G"],
          ["B1", "S1", 0, 1],
          ["B2", "S2", 0, 1],
        ],
        wishes: { p1: [["A1", 1]], p2: [["A1", 1]] },
        n: 1,
      }),
    );
    expect(r.status).toBe("optimal");
    if (r.status !== "optimal") return;
    const aP = r.assignments.filter((a) => a.workshopId === "A1" || a.workshopId === "A2");
    expect(aP.length).toBe(2);
    expect(aP.filter((a) => a.workshopId === "A1").length).toBe(1);
    expect(aP.filter((a) => a.workshopId === "A2").length).toBe(1);
    // beide Zuweisungen zählen als erfüllter Erstwunsch
    expect(aP.every((a) => a.fromWish && a.rank === 1)).toBe(true);
    expect(r.stats.nonWish).toBe(0);
  });

  it("Instanzen-Gruppe: Zweitinstanz statt Überlauf bei vollem Ersttermin", () => {
    // A1 ist voll (max 1, p1 belegt ihn) -> p2 weicht auf A2 aus,
    // obwohl p2 den Workshop nicht als Erstwunsch in dem Slot hat.
    const r = solve(
      mk({
        slots: ["S1", "S2"],
        workshops: [
          ["A1", "S1", 0, 1, null, "G"],
          ["A2", "S2", 0, 1, null, "G"],
          ["B1", "S1", 0, 1],
          ["B2", "S2", 0, 1],
        ],
        wishes: {
          p1: [
            ["A1", 1],
            ["B2", 2],
          ],
          p2: [
            ["A1", 1],
            ["B2", 2],
          ],
        },
        n: 2,
      }),
    );
    expect(r.status).toBe("optimal");
    if (r.status !== "optimal") return;
    // p1 und p2 besuchen beide „A“ — jeder genau eine Instanz, jede Instanz genau eine Person
    const aVisitors = r.assignments.filter((a) => a.workshopId === "A1" || a.workshopId === "A2");
    expect(aVisitors.length).toBe(2);
    expect(aVisitors.filter((a) => a.workshopId === "A1").length).toBe(1);
    expect(aVisitors.filter((a) => a.workshopId === "A2").length).toBe(1);
    expect(aVisitors.filter((a) => a.personId === "p1").length).toBe(1);
    expect(aVisitors.filter((a) => a.personId === "p2").length).toBe(1);
    // beide „A“-Zuweisungen sind erfüllte Wünsche (Gruppe deckt beide Durchführungen ab)
    expect(aVisitors.every((a) => a.fromWish)).toBe(true);
  });

  it("Kopplung: gekoppelter Partner wird mitgezogen, auch ohne Wunsch", () => {
    // p1 wünscht a@1 (S1) und e@2 (S2). a ist mit b gekoppelt.
    // a+b kostet 1 + 1e6, Alternative d+e kostet 1e6 + 2 -> optimal ist a+b.
    const r = solve(
      mk({
        slots: ["S1", "S2"],
        workshops: [
          ["a", "S1", 0, 1, "b"],
          ["b", "S2", 0, 1, "a"],
          ["d", "S1", 0, 1],
          ["e", "S2", 0, 1],
        ],
        wishes: {
          p1: [
            ["a", 1],
            ["e", 2],
          ],
        },
        n: 2,
      }),
    );
    expect(r.status).toBe("optimal");
    if (r.status !== "optimal") return;
    expect(assignmentOf(r, "p1", "a")).toBeTruthy();
    expect(assignmentOf(r, "p1", "b")).toBeTruthy();
    expect(r.assignments.some((a) => a.workshopId === "d")).toBe(false);
  });

  it("Kopplung: bei n=1 kann ein gekoppeltes Paar niemandem zugeteilt werden", () => {
    const r = solve(
      mk({
        slots: ["S1", "S2"],
        workshops: [
          ["a", "S1", 0, 1, "b"],
          ["b", "S2", 0, 1, "a"],
          ["d", "S1", 0, 1],
          ["e", "S2", 0, 1],
        ],
        wishes: {
          p1: [
            ["a", 1],
            ["e", 2],
          ],
        },
        n: 1,
      }),
    );
    expect(r.status).toBe("optimal");
    if (r.status !== "optimal") return;
    // a ohne b ist nicht erlaubt, a+b übersteigt n=1 -> Ausweichlösung e
    expect(r.assignments.some((a) => a.workshopId === "a")).toBe(false);
    expect(assignmentOf(r, "p1", "e")).toBeTruthy();
  });

  it("Kopplung: beide Workshops zusammen bei Erstwünschen", () => {
    const r = solve(
      mk({
        slots: ["S1", "S2"],
        workshops: [
          ["a", "S1", 0, 1, "b"],
          ["b", "S2", 0, 1, "a"],
          ["d", "S1", 0, 1],
          ["e", "S2", 0, 1],
        ],
        wishes: {
          p1: [
            ["a", 1],
            ["b", 1],
          ],
        },
        n: 2,
      }),
    );
    expect(r.status).toBe("optimal");
    if (r.status !== "optimal") return;
    expect(assignmentOf(r, "p1", "a")).toBeTruthy();
    expect(assignmentOf(r, "p1", "b")).toBeTruthy();
    expect(r.stats.nonWish).toBe(0);
  });

  it("Unlösbar: gekoppeltes Paar mit widersprüchlichen Belegungsgrenzen", () => {
    const r = solve(
      mk({
        slots: ["S1", "S2"],
        workshops: [
          ["a", "S1", 2, 5, "b"],
          ["b", "S2", 0, 1, "a"],
        ],
        wishes: {
          p1: [
            ["a", 1],
            ["b", 1],
          ],
          p2: [
            ["a", 1],
            ["b", 1],
          ],
        },
        n: 1,
      }),
    );
    expect(r.status).toBe("infeasible");
    if (r.status !== "infeasible") return;
    expect(r.reasons.join(" ")).toContain("gekoppelt");
  });

  it("Person ohne Wünsche erhält trotzdem n Zuweisungen", () => {
    const r = solve(
      mk({
        slots: ["S1"],
        workshops: [
          ["A", "S1", 0, 2],
          ["B", "S1", 0, 2],
        ],
        wishes: { p1: [["A", 1]], p2: [] },
        n: 1,
      }),
    );
    expect(r.status).toBe("optimal");
    if (r.status !== "optimal") return;
    expect(r.assignments.filter((a) => a.personId === "p2").length).toBe(1);
    expect(r.assignments.length).toBe(2);
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
