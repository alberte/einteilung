// UI-Validierung vor dem Lösen (Warnungen) und harte Fehler.

import type { Project } from "./model";

export interface Validation {
  errors: string[];
  warnings: string[];
}

export function validateProject(project: Project): Validation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (project.slots.length === 0) errors.push("Es sind keine Slots angelegt.");
  if (project.workshops.length === 0) errors.push("Es sind keine Workshops angelegt.");
  if (project.persons.length === 0)
    warnings.push("Es sind keine Teilnehmer vorhanden — das Ergebnis wäre leer.");

  if (project.persons.length > 0 && project.config.n > project.slots.length) {
    errors.push(
      `n (${project.config.n}) ist größer als die Zahl der Slots (${project.slots.length}) — pro Slot ist nur ein Workshop möglich.`,
    );
  }

  const workshopIds = new Set(project.workshops.map((w) => w.id));
  for (const w of project.workshops) {
    if (w.min > w.max) errors.push(`Workshop „${w.name}“: min (${w.min}) > max (${w.max}).`);
    if (!project.slots.some((s) => s.id === w.slotId)) {
      errors.push(`Workshop „${w.name}“ gehört zu keinem existierenden Slot.`);
    }
  }

  const nameCount = new Map<string, number>();
  for (const w of project.workshops) {
    const key = w.name.trim().toLowerCase();
    nameCount.set(key, (nameCount.get(key) ?? 0) + 1);
  }
  for (const [name, count] of nameCount) {
    if (count > 1)
      warnings.push(
        `Der Workshop-Name „${name}“ kommt ${count}× vor — beim Import kann er nicht eindeutig zugeordnet werden.`,
      );
  }

  // Workshops ohne Slots / leere Slots
  for (const s of project.slots) {
    if (!project.workshops.some((w) => w.slotId === s.id)) {
      warnings.push(`Slot „${s.name}“ enthält keine Workshops.`);
    }
  }

  // Personen-Wünsche
  let noWishPersons = 0;
  let lowWishPersons = 0;
  for (const p of project.persons) {
    const wishes = project.wishes[p.id] ?? [];
    if (wishes.length === 0) {
      noWishPersons += 1;
      continue;
    }
    const slotsOfWishes = new Set(
      wishes
        .map((w) => project.workshops.find((ws) => ws.id === w.workshopId)?.slotId)
        .filter((x): x is string => Boolean(x)),
    );
    if (slotsOfWishes.size < project.config.n) {
      lowWishPersons += 1;
    }
    for (const wish of wishes) {
      if (!workshopIds.has(wish.workshopId)) {
        errors.push(`Person „${p.name}“ hat einen Wunsch auf einen nicht existierenden Workshop.`);
      }
      if (wish.rank < 1) {
        warnings.push(`Person „${p.name}“ hat einen Wunsch mit Rang < 1.`);
      }
    }
  }
  if (noWishPersons > 0) {
    warnings.push(
      `${noWishPersons} Person(en) haben gar keine Wünsche — sie erhalten „kein Wunsch“-Zuweisungen (rot markiert).`,
    );
  }
  if (lowWishPersons > 0) {
    warnings.push(
      `${lowWishPersons} Person(en) haben Wünsche in weniger als n = ${project.config.n} verschiedenen Slots — teils „kein Wunsch“-Zuweisungen wahrscheinlich.`,
    );
  }

  return { errors, warnings };
}
