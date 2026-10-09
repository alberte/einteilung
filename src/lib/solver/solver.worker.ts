// Solver läuft in einem Web Worker, damit die UI bei großen Instanzen
// nicht blockiert (Projektplan, Risiko R1).

import { solve } from "./solve";
import type { SolveInput, SolveResult } from "./types";

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage: (msg: SolveResult) => void;
};

ctx.onmessage = (e: MessageEvent) => {
  const input = e.data as SolveInput;
  let result: SolveResult;
  try {
    result = solve(input);
  } catch (err) {
    result = { status: "error", message: err instanceof Error ? err.message : String(err) };
  }
  ctx.postMessage(result);
};
