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
  const workshopById = new Map(project.workshops.map((w) => [w.id, w]));
  const hasPairs = project.workshops.some((w) => w.pairedWith);
  const seenPairs = new Set<string>();
  for (const w of project.workshops) {
    if (w.min > w.max) errors.push(`Workshop „${w.name}“: min (${w.min}) > max (${w.max}).`);
    if (!project.slots.some((s) => s.id === w.slotId)) {
      errors.push(`Workshop „${w.name}“ gehört zu keinem existierenden Slot.`);
    }
    if (w.groupId) {
      const sameSlotInstances = project.workshops.filter(
        (x) => x.groupId === w.groupId && x.slotId === w.slotId && x.id !== w.id,
      );
      if (sameSlotInstances.length > 0) {
        warnings.push(
          `Slot „${project.slots.find((s) => s.id === w.slotId)?.name ?? "?"}“ enthält mehrere verbundene Instanzen von „${w.name}“ — redundant, da pro Slot ohnehin nur ein Workshop möglich ist.`,
        );
      }
    }
    const partner = w.pairedWith ? workshopById.get(w.pairedWith) : undefined;
    if (w.pairedWith && !partner) {
      errors.push(`Workshop „${w.name}“ verweist auf einen nicht existierenden Koppel-Partner.`);
      continue;
    }
    if (!partner) continue;
    const key = [w.id, partner.id].sort().join("|");
    if (seenPairs.has(key)) continue;
    seenPairs.add(key);
    if (partner.slotId === w.slotId) {
      errors.push(
        `„${w.name}“ und „${partner.name}“ sind gekoppelt, liegen aber im selben Slot — beide zusammen sind dort nicht möglich.`,
      );
    } else if (w.min !== partner.min || w.max !== partner.max) {
      const lo = Math.max(w.min, partner.min);
      const hi = Math.min(w.max, partner.max);
      warnings.push(
        `Gekoppelt „${w.name}“/„${partner.name}“: abweichende Belegungsgrenzen — effektiv gilt ${lo}–${hi} Personen für beide.`,
      );
    }
  }
  if (hasPairs && project.config.n < 2) {
    warnings.push(
      "Bei n < 2 können gekoppelte Workshops niemandem zugeteilt werden (beide belegen je einen Slot).",
    );
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
  let groupWishPersons = 0;
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
    // Mehrere Wünsche auf Durchführungen desselben Workshops (Instanzen-Gruppe)
    const groupsSeen = new Set<string>();
    for (const wish of wishes) {
      const g = workshopById.get(wish.workshopId)?.groupId;
      if (g && groupsSeen.has(g)) {
        groupWishPersons += 1;
        break;
      }
      if (g) groupsSeen.add(g);
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
  if (groupWishPersons > 0) {
    warnings.push(
      `${groupWishPersons} Person(en) wünschen mehrere Durchführungen desselben verbundenen Workshops — davon zählt nur eine (die mit dem besten Rang).`,
    );
  }

  return { errors, warnings };
}
