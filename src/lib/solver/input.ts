// Projekt -> Solver-Eingabe.
// Wichtig:Das Ergebnis muss frei von Svelte-$state-Proxies sein — der
// Solver-Worker erhält die Daten via postMessage (structured clone), und
// Proxy-Objekte sind nicht klonbar ("Proxy object could not be cloned").
// Deshalb werden alle Daten hier vollständig in Plain-Objects kopiert.

import type { Project } from "../model";
import type { SolveInput } from "./types";

export function toSolveInput(project: Project): SolveInput {
  return {
    persons: project.persons.map((p) => ({ id: p.id, name: p.name })),
    workshops: project.workshops.map((w) => ({
      id: w.id,
      name: w.name,
      slotId: w.slotId,
      min: w.min,
      max: w.max,
      groupId: w.groupId ?? null,
      pairedWith: w.pairedWith ?? null,
    })),
    slots: project.slots.map((s) => ({ id: s.id, name: s.name })),
    config: {
      n: project.config.n,
      penaltyProfile: project.config.penaltyProfile,
      timeLimitSec: project.config.timeLimitSec,
    },
    wishes: Object.fromEntries(
      Object.entries(project.wishes).map(([personId, list]) => [
        personId,
        list.map((w) => ({ workshopId: w.workshopId, rank: w.rank })),
      ]),
    ),
  };
}
