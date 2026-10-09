// Zentraler Zustand der Anwendung (Svelte-5-Runes).
// localStorage-Autosave erfolgt über den $effect in App.svelte.

import { emptyProject, normalizeProject, sampleProject, uid } from "./model";
import type { Person, Project, Slot, Workshop, Wish } from "./model";
import { runSolve, toSolveInput } from "./solver";
import type { SolveResult } from "./solver/types";

export const STORAGE_KEY = "workshop-planner/project/v1";

function loadStored(): Project | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalizeProject(JSON.parse(raw));
  } catch {
    return null;
  }
}

class AppState {
  project: Project = $state(loadStored() ?? emptyProject());
  result: SolveResult | null = $state<SolveResult | null>(null);
  solving = $state(false);
  activeTab = $state("workshops");
  savedAt = $state<string | null>(null);

  // --- Slots ------------------------------------------------------------
  addSlot(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    this.project.slots.push({ id: uid(), name: trimmed });
  }

  removeSlot(id: string) {
    const workshopIds = new Set(
      this.project.workshops.filter((w) => w.slotId === id).map((w) => w.id),
    );
    this.project.slots = this.project.slots.filter((s) => s.id !== id);
    this.removeWorkshopsByIds(workshopIds);
  }

  // --- Workshops ---------------------------------------------------------
  addWorkshop(name: string, slotId: string, min: number, max: number) {
    const trimmed = name.trim();
    if (!trimmed || !this.project.slots.some((s) => s.id === slotId)) return;
    this.project.workshops.push({ id: uid(), name: trimmed, slotId, min, max });
  }

  removeWorkshop(id: string) {
    this.removeWorkshopsByIds(new Set([id]));
  }

  /** Klont einen Workshop in einen anderen Slot (gleiche min/max). */
  cloneWorkshop(workshopId: string, targetSlotId: string, name: string, asSameGroup: boolean) {
    const w = this.project.workshops.find((x) => x.id === workshopId);
    const trimmed = name.trim();
    if (!w || !trimmed) return;
    if (!this.project.slots.some((s) => s.id === targetSlotId)) return;
    const copy: Workshop = {
      id: uid(),
      name: trimmed,
      slotId: targetSlotId,
      min: w.min,
      max: w.max,
      groupId: null,
      pairedWith: null,
    };
    this.project.workshops.push(copy);
    if (asSameGroup) {
      const gid = w.groupId ?? uid();
      w.groupId = gid;
      copy.groupId = gid;
    }
  }

  // --- Verbindungen zwischen Workshops -------------------------------
  /**
   * Instanzen-Gruppe: setzt die Durchführung des Workshops in einem bestimmten
   * Slot. Pro Slot ist maximal eine Instanz möglich; dadurch kann eine Gruppe
   * höchstens so viele Instanzen haben wie es Slots gibt. null entfernt die
   * Instanz aus der Gruppe.
   */
  setGroupInstance(workshopId: string, slotId: string, targetId: string | null) {
    const w = this.project.workshops.find((x) => x.id === workshopId);
    if (!w) return;
    // Bisherige Instanz der Gruppe in diesem Slot ersetzen
    if (w.groupId) {
      for (const x of this.project.workshops) {
        if (x.groupId === w.groupId && x.slotId === slotId && x.id !== w.id) {
          x.groupId = null;
        }
      }
    }
    if (!targetId) return;
    const t = this.project.workshops.find((x) => x.id === targetId);
    if (!t || t.id === w.id || t.slotId !== slotId) return;
    if (!w.groupId) w.groupId = uid();
    t.groupId = w.groupId;
  }

  /** Kopplung: beide Workshops nur zusammen oder gar nicht (symmetrisch). */
  pairWorkshops(workshopId: string, targetId: string | null) {
    const w = this.project.workshops.find((x) => x.id === workshopId);
    if (!w) return;
    this.unpair(w);
    if (!targetId) return;
    const t = this.project.workshops.find((x) => x.id === targetId);
    if (!t || t.id === w.id) return;
    this.unpair(t);
    w.pairedWith = t.id;
    t.pairedWith = w.id;
  }

  private unpair(w: Workshop) {
    if (!w.pairedWith) return;
    const partner = this.project.workshops.find((x) => x.id === w.pairedWith);
    if (partner && partner.pairedWith === w.id) partner.pairedWith = null;
    w.pairedWith = null;
  }

  private removeWorkshopsByIds(ids: Set<string>) {
    // Koppel-Partner der gelöschten Workshops freigeben
    for (const w of this.project.workshops) {
      if (w.pairedWith && ids.has(w.pairedWith)) w.pairedWith = null;
    }
    this.project.workshops = this.project.workshops.filter((w) => !ids.has(w.id));
    for (const personId of Object.keys(this.project.wishes)) {
      this.project.wishes[personId] = this.project.wishes[personId].filter(
        (w) => !ids.has(w.workshopId),
      );
    }
  }

  // --- Personen & Wünsche --------------------------------------------------
  addPerson(name: string): Person | null {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const person: Person = { id: uid(), name: trimmed };
    this.project.persons.push(person);
    this.project.wishes[person.id] = [];
    return person;
  }

  removePerson(id: string) {
    this.project.persons = this.project.persons.filter((p) => p.id !== id);
    delete this.project.wishes[id];
  }

  wishesOf(personId: string): Wish[] {
    let list = this.project.wishes[personId];
    if (!list) {
      list = [];
      this.project.wishes[personId] = list;
    }
    return list;
  }

  addWish(personId: string, workshopId: string) {
    const wishes = this.wishesOf(personId);
    if (wishes.some((w) => w.workshopId === workshopId)) return;
    wishes.push({ workshopId, rank: wishes.length + 1 });
  }

  removeWish(personId: string, workshopId: string) {
    const wishes = this.wishesOf(personId);
    const idx = wishes.findIndex((w) => w.workshopId === workshopId);
    if (idx < 0) return;
    wishes.splice(idx, 1);
    this.renumberWishes(wishes);
  }

  /** Wunsch in der Rangfolge um eine Position verschieben (-1 = hoch, +1 = runter). */
  moveWish(personId: string, workshopId: string, direction: -1 | 1) {
    const wishes = this.wishesOf(personId);
    const sorted = [...wishes].sort((a, b) => a.rank - b.rank);
    const idx = sorted.findIndex((w) => w.workshopId === workshopId);
    const target = idx + direction;
    if (idx < 0 || target < 0 || target >= sorted.length) return;
    const [moved] = sorted.splice(idx, 1);
    sorted.splice(target, 0, moved);
    this.wishesOf(personId).splice(0, wishes.length, ...sorted);
    this.renumberWishes(this.wishesOf(personId));
  }

  /** Ränge aufeinanderfolgend als 1..n vergeben (Position = Rang). */
  private renumberWishes(wishes: Wish[]) {
    const sorted = [...wishes].sort((a, b) => a.rank - b.rank);
    sorted.forEach((w, i) => (w.rank = i + 1));
  }

  // --- Projekt -----------------------------------------------------------
  replaceProject(raw: unknown) {
    this.project = normalizeProject(raw);
    this.result = null;
  }

  loadSample() {
    this.replaceProject(sampleProject());
  }

  reset() {
    this.replaceProject(emptyProject());
  }

  // --- Lösen ---------------------------------------------------------------
  async solve() {
    if (this.solving) return;
    this.solving = true;
    try {
      this.result = await runSolve(toSolveInput(this.project));
      this.activeTab = "result";
    } catch (err) {
      this.result = {
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      };
    } finally {
      this.solving = false;
    }
  }
}

export const app = new AppState();

export function slotById(project: Project, id: string): Slot | undefined {
  return project.slots.find((s) => s.id === id);
}

export function workshopById(project: Project, id: string): Workshop | undefined {
  return project.workshops.find((w) => w.id === id);
}

export function workshopsInSlot(project: Project, slotId: string): Workshop[] {
  return project.workshops.filter((w) => w.slotId === slotId);
}
