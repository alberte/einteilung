// Performance-Test (Projektplan Phase 3 / Ziel 4): ~1.000 Personen × 50
// Workshops × 10 Slots. Läuft nur mit VITE_PERF=1, damit die CI schnell
// bleibt — die gemessene Zeit wird in der README dokumentiert.

import { describe, expect, it } from "vitest";
import { solve } from "./solve";
import type { SolveInput } from "./types";

function bigInput(
  persons: number,
  workshopCount: number,
  slots: number,
  min: number,
  max: number,
): SolveInput {
  const perSlot = workshopCount / slots;
  if (!Number.isInteger(perSlot)) {
    throw new Error("workshopCount muss durch slots teilbar sein");
  }
  const slotList = Array.from({ length: slots }, (_, i) => ({
    id: `s${i}`,
    name: `Slot ${i + 1}`,
  }));
  const workshops = Array.from({ length: workshopCount }, (_, i) => ({
    id: `w${i}`,
    name: `Workshop ${i + 1}`,
    slotId: `s${Math.floor(i / perSlot)}`,
    min,
    max,
  }));
  const people = Array.from({ length: persons }, (_, i) => ({
    id: `p${i}`,
    name: `Person ${i + 1}`,
  }));
  const wishes: SolveInput["wishes"] = {};
  for (let i = 0; i < people.length; i++) {
    const list = [];
    // 5 Wünsche, deterministisch verteilt in 5 verschiedene Slots
    for (let k = 0; k < 5; k++) {
      const slotIdx = (i + k) % slots;
      const within = (i * 3 + k * 2) % perSlot;
      list.push({ workshopId: `w${slotIdx * perSlot + within}`, rank: k + 1 });
    }
    wishes[`p${i}`] = list;
  }
  return {
    slots: slotList,
    workshops,
    persons: people,
    wishes,
    config: { n: 5, penaltyProfile: "linear", timeLimitSec: 600 },
  };
}

describe.skipIf(!import.meta.env?.VITE_PERF)("Solver-Performance", () => {
  it("löst 200 Personen × 30 Workshops × 6 Slots", { timeout: 300_000 }, () => {
    const input = bigInput(200, 30, 6, 10, 80);
    const t0 = performance.now();
    const result = solve(input);
    const elapsed = (performance.now() - t0) / 1000;
    console.log(`[perf] 200×30×6: ${elapsed.toFixed(1)} s, status=${result.status}`);
    expect(result.status).toBe("optimal");
  });

  it("löst 1.000 Personen × 50 Workshops × 10 Slots", { timeout: 600_000 }, () => {
    const input = bigInput(1000, 50, 10, 40, 120);
    const t0 = performance.now();
    const result = solve(input);
    const elapsed = (performance.now() - t0) / 1000;
    console.log(`[perf] 1000×50×10: ${elapsed.toFixed(1)} s, status=${result.status}`);
    expect(result.status).toBe("optimal");
  });
});
