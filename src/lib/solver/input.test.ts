// Regressionstest: Der Solver-Worker erhält die Eingabe via postMessage
// (structured clone). Svelte-$state-Proxies sind dort nicht klonbar
// ("Proxy object could not be cloned") — toSolveInput muss deshalb
// unabhängig von der Reaktivitätsschicht immer Plain-Objects liefern.

import { describe, expect, it } from "vitest";
import { sampleProject, type Project } from "../model";
import { toSolveInput } from "./input";

/** Bildest das Verhalten von Svelte-5-$state-Proxies nach (deep read-Proxy). */
function deepProxy<T extends object>(obj: T): T {
  return new Proxy(obj, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (value !== null && typeof value === "object") {
        return deepProxy(value as object);
      }
      return value;
    },
  }) as T;
}

describe("toSolveInput", () => {
  it("liefert structured-clone-fähige Plain-Objects (keine Proxies)", () => {
    const project: Project = deepProxy(sampleProject());

    // Sanity: der rohe $state-Proxy ist nicht klonbar — genau der Fehler
    // aus dem Produktionsfehler "Proxy object could not be cloned"
    expect(() => structuredClone(project.wishes)).toThrow();

    const input = toSolveInput(project);
    expect(() => structuredClone(input)).not.toThrow();

    expect(input.persons.length).toBeGreaterThan(0);
    expect(input.workshops.length).toBeGreaterThan(0);
    expect(Object.values(input.wishes).flat().length).toBeGreaterThan(0);
  });
});
