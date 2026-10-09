// Unlösbarkeits-Diagnose (Projektplan Phase 3).
//
// Die Prüfungen hier sind notwendig UND hinreichend: Weil jede Person
// grundsätzlich jeden Workshop besuchen kann (auch ohne Wunsch), reduziert
// sich die Machbarkeit auf ein Transportproblem mit aggregierten Schranken
// pro Slot. Sind alle Prüfungen bestanden, existiert eine gültige Belegung —
// der Solver muss dann nur noch die beste finden.

import type { SolveInput } from "./types";

export function diagnose(input: SolveInput): string[] {
  const reasons: string[] = [];
  const { persons, workshops, slots, config } = input;
  const P = persons.length;
  const n = config.n;

  const slotName = (id: string) => slots.find((s) => s.id === id)?.name ?? id;
  const workshopsBySlot = new Map<string, typeof workshops>();
  for (const w of workshops) {
    const list = workshopsBySlot.get(w.slotId) ?? [];
    list.push(w);
    workshopsBySlot.set(w.slotId, list);
  }

  // Workshop-interne Widersprüche
  for (const w of workshops) {
    if (w.min > w.max) {
      reasons.push(
        `Workshop „${w.name}“: Mindestbelegung (${w.min}) ist größer als Höchstbelegung (${w.max}).`,
      );
    }
    if (w.min > P && P > 0) {
      reasons.push(
        `Workshop „${w.name}“: Mindestbelegung ${w.min}, aber es gibt nur ${P} Teilnehmer.`,
      );
    }
  }

  if (P === 0) {
    if (workshops.some((w) => w.min > 0)) {
      reasons.push("Es gibt keine Teilnehmer, aber Workshops mit Mindestbelegung größer 0.");
    }
    return reasons;
  }

  // n Workshops pro Person, höchstens einer pro Slot
  if (n > slots.length) {
    reasons.push(
      `n = ${n} Workshops pro Person ist größer als die Zahl der Slots (${slots.length}) — pro Slot ist nur ein Workshop möglich.`,
    );
  }

  // Aggregierte Kapazität pro Slot
  let totalMin = 0;
  let totalUpper = 0;
  for (const s of slots) {
    const ws = workshopsBySlot.get(s.id) ?? [];
    const minSum = ws.reduce((acc, w) => acc + w.min, 0);
    const maxSum = ws.reduce((acc, w) => acc + w.max, 0);
    totalMin += minSum;
    totalUpper += Math.min(P, maxSum);
    if (minSum > P) {
      reasons.push(
        `Slot „${slotName(s.id)}“: Die Mindestbelegungen der Workshops ergeben ${minSum} Plätze, es gibt aber nur ${P} Teilnehmer.`,
      );
    }
  }

  const needTotal = n * P;
  if (totalUpper < needTotal) {
    reasons.push(
      `Die Gesamtkapazität (${totalUpper} Plätze) reicht nicht für ${n} Workshops × ${P} Teilnehmer = ${needTotal} Plätze.`,
    );
  }
  if (totalMin > needTotal) {
    reasons.push(
      `Die Summe aller Mindestbelegungen (${totalMin}) übersteigt die Zahl der zu vergebenden Plätze (${needTotal}).`,
    );
  }

  return reasons;
}
