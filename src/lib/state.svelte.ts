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

  private removeWorkshopsByIds(ids: Set<string>) {
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
    const nextRank = wishes.reduce((acc, w) => Math.max(acc, w.rank), 0) + 1;
    wishes.push({ workshopId, rank: nextRank });
  }

  removeWish(personId: string, workshopId: string) {
    const wishes = this.wishesOf(personId);
    const idx = wishes.findIndex((w) => w.workshopId === workshopId);
    if (idx >= 0) wishes.splice(idx, 1);
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
