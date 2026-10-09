// Gruppierungs-Helfer für die Ergebnis-Ansicht (reine Funktionen, bewusst
// außerhalb der Komponenten, damit keine reaktiven Map-Klassen nötig sind).

import type { Project } from "./model";
import type { Assignment } from "./solver/types";

/** personId -> (slotId -> Assignment) */
export function groupByPersonSlot(
  project: Project,
  assignments: Assignment[],
): Map<string, Map<string, Assignment>> {
  const slotOf = new Map(project.workshops.map((w) => [w.id, w.slotId]));
  const map = new Map<string, Map<string, Assignment>>();
  for (const a of assignments) {
    const slotId = slotOf.get(a.workshopId);
    if (!slotId) continue;
    const inner = map.get(a.personId) ?? new Map<string, Assignment>();
    inner.set(slotId, a);
    map.set(a.personId, inner);
  }
  return map;
}

/** workshopId -> Assignments */
export function groupByWorkshop(assignments: Assignment[]): Map<string, Assignment[]> {
  const map = new Map<string, Assignment[]>();
  for (const a of assignments) {
    const list = map.get(a.workshopId) ?? [];
    list.push(a);
    map.set(a.workshopId, list);
  }
  return map;
}
