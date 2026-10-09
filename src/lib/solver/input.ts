// Projekt -> Solver-Eingabe (filtert ungültige Wünsche defensiv heraus).

import type { Project } from "../model";
import type { SolveInput } from "./types";

export function toSolveInput(project: Project): SolveInput {
  return {
    persons: project.persons.map((p) => ({ ...p })),
    workshops: project.workshops.map((w) => ({ ...w })),
    slots: project.slots.map((s) => ({ ...s })),
    config: { ...project.config },
    wishes: project.wishes,
  };
}
