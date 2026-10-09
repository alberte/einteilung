// Startet solve() im Web Worker und erzwingt das Zeitlimit zusätzlich
// per Worker-Terminierung (der Worker selbst bekommt das Limit ebenfalls
// als Timeout im LP-Modell mit).

import type { SolveInput, SolveResult } from "./types";

export function runSolve(input: SolveInput): Promise<SolveResult> {
  return new Promise<SolveResult>((resolve) => {
    let settled = false;
    const finish = (result: SolveResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      resolve(result);
    };

    const worker = new Worker(new URL("./solver.worker.ts", import.meta.url), {
      type: "module",
    });

    const limitMs = Math.max(1, input.config.timeLimitSec || 60) * 1000;
    const timer = setTimeout(() => finish({ status: "timeout" }), limitMs + 1000);

    worker.onmessage = (e: MessageEvent<SolveResult>) => finish(e.data);
    worker.onerror = (e) => {
      e.preventDefault?.();
      finish({
        status: "error",
        message: `Solver-Worker fehlgeschlagen: ${e.message ?? "unbekannter Fehler"}`,
      });
    };

    worker.postMessage(input);
  });
}
