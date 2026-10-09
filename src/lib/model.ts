// Datenmodell gemäß Projektplan, Abschnitt 5.
// `wishes` ist pro Person gruppiert (personId -> Wünsche) und entspricht damit
// der ER-Relation Wish { personId, workshopId, rank }.

export const PROJECT_VERSION = 1;

export interface Slot {
  id: string;
  name: string;
}

export interface Workshop {
  id: string;
  name: string;
  slotId: string;
  min: number;
  max: number;
  /**
   * Instanzen-Gruppe: Workshops mit derselben groupId sind Instanzen desselben
   * Workshops in (i. d. R.) verschiedenen Slots. Eine Person erhält davon
   * höchstens eine Instanz.
   */
  groupId?: string | null;
  /**
   * Koppel-Partner (Workshop-Id): Gekoppelte Workshops werden von einer Person
   * nur zusammen oder gar nicht besucht (x[a] = x[b] pro Person).
   */
  pairedWith?: string | null;
}

export interface Person {
  id: string;
  name: string;
}

export interface Wish {
  workshopId: string;
  rank: number;
}

export type PenaltyProfile = "linear" | "fair";

export interface ProjectConfig {
  /** Anzahl Workshops pro Person (n) */
  n: number;
  /** Strafprofil für Wunsch-Ränge: linear = „Effizient“, quadratisch = „Fair“ */
  penaltyProfile: PenaltyProfile;
  /** Solver-Zeitlimit in Sekunden */
  timeLimitSec: number;
}

export interface Project {
  version: number;
  slots: Slot[];
  workshops: Workshop[];
  persons: Person[];
  wishes: Record<string, Wish[]>;
  config: ProjectConfig;
  meta: { created: string; updated: string };
}

export function uid(): string {
  return crypto.randomUUID();
}

export function emptyProject(): Project {
  const now = new Date().toISOString();
  return {
    version: PROJECT_VERSION,
    slots: [],
    workshops: [],
    persons: [],
    wishes: {},
    config: {
      n: 1,
      penaltyProfile: "linear",
      timeLimitSec: 60,
    },
    meta: { created: now, updated: now },
  };
}

/**
 * Bringt ein geladenes/gemischtes Projekt-Objekt in eine gültige Form.
 * Wirft bei inkompatiblen oder kaputten Daten.
 */
export function normalizeProject(raw: unknown): Project {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Ungültige Projektdatei: kein JSON-Objekt.");
  }
  const data = raw as Record<string, unknown>;
  const version = Number(data.version);
  if (!Number.isInteger(version) || version < 1) {
    throw new Error("Ungültige Projektdatei: fehlendes oder unbekanntes Version-Feld.");
  }
  if (version > PROJECT_VERSION) {
    throw new Error(
      `Die Projektdatei hat Version ${version}, unterstützt wird Version ${PROJECT_VERSION}. Bitte neuere App-Version verwenden.`,
    );
  }

  const base = emptyProject();
  const str = (v: unknown, fallback: string): string => (typeof v === "string" ? v : fallback);
  const id = (v: unknown, fallback: string): string =>
    typeof v === "string" && v.length > 0 ? v : fallback;

  const slots: Slot[] = Array.isArray(data.slots)
    ? (data.slots as Record<string, unknown>[]).map((s, i) => ({
        id: id(s.id, uid()),
        name: str(s.name, `Slot ${i + 1}`),
      }))
    : [];

  const slotIds = new Set(slots.map((s) => s.id));
  const workshops: Workshop[] = Array.isArray(data.workshops)
    ? (data.workshops as Record<string, unknown>[])
        .map((w, i) => ({
          id: id(w.id, uid()),
          name: str(w.name, `Workshop ${i + 1}`),
          slotId: id(w.slotId, slots[0]?.id ?? ""),
          min: Math.max(0, Math.floor(Number(w.min) || 0)),
          max: Math.max(0, Math.floor(Number(w.max) || 0)),
          groupId: typeof w.groupId === "string" && w.groupId.length > 0 ? w.groupId : null,
          pairedWith:
            typeof w.pairedWith === "string" && w.pairedWith.length > 0 ? w.pairedWith : null,
        }))
        .filter((w) => slotIds.has(w.slotId))
    : [];

  // Koppel-Verweise säubern (self-referenzen / ins Leere laufende Verweise)
  const workshopIds = new Set(workshops.map((w) => w.id));
  for (const w of workshops) {
    if (w.pairedWith === w.id || (w.pairedWith && !workshopIds.has(w.pairedWith))) {
      w.pairedWith = null;
    }
  }

  const persons: Person[] = Array.isArray(data.persons)
    ? (data.persons as Record<string, unknown>[]).map((p, i) => ({
        id: id(p.id, uid()),
        name: str(p.name, `Person ${i + 1}`),
      }))
    : [];

  const rawWishes =
    data.wishes && typeof data.wishes === "object" ? (data.wishes as Record<string, unknown>) : {};
  const wishes: Record<string, Wish[]> = {};
  for (const p of persons) {
    const list = Array.isArray(rawWishes[p.id])
      ? (rawWishes[p.id] as Record<string, unknown>[])
      : [];
    // gültige Wünsche, je Workshop der beste Rang, Ränge dann als 1..n
    const byWorkshop = new Map<string, number>();
    for (const raw of list) {
      const workshopId = str(raw.workshopId, "");
      if (!workshopIds.has(workshopId)) continue;
      const rank = Math.max(1, Math.floor(Number(raw.rank) || 1));
      byWorkshop.set(workshopId, Math.min(byWorkshop.get(workshopId) ?? rank, rank));
    }
    wishes[p.id] = [...byWorkshop.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([workshopId], i) => ({ workshopId, rank: i + 1 }));
  }

  const rawConfig = (data.config ?? {}) as Record<string, unknown>;
  const config: ProjectConfig = {
    n: Math.max(1, Math.floor(Number(rawConfig.n) || base.config.n)),
    penaltyProfile: rawConfig.penaltyProfile === "fair" ? "fair" : "linear",
    timeLimitSec: Math.min(
      600,
      Math.max(5, Math.floor(Number(rawConfig.timeLimitSec) || base.config.timeLimitSec)),
    ),
  };

  const meta = (data.meta ?? {}) as Record<string, unknown>;
  const now = new Date().toISOString();

  return {
    version: PROJECT_VERSION,
    slots,
    workshops,
    persons,
    wishes,
    config,
    meta: {
      created: str(meta.created, now),
      updated: str(meta.updated, now),
    },
  };
}

/** Kleines Beispielprojekt zum Ausprobieren (Button im Projekt-Tab). */
export function sampleProject(): Project {
  const p = emptyProject();
  p.slots = [
    { id: uid(), name: "Block 1 — Fr 10:00" },
    { id: uid(), name: "Block 2 — Fr 14:00" },
    { id: uid(), name: "Block 3 — Sa 10:00" },
  ];
  const [b1, b2, b3] = p.slots;

  const ws = (name: string, slot: Slot, min: number, max: number): Workshop => ({
    id: uid(),
    name,
    slotId: slot.id,
    min,
    max,
  });
  const kochen = ws("Kochen", b1, 2, 4);
  const robotic = ws("Robotik", b1, 2, 6);
  const theater = ws("Theater", b1, 0, 8);
  const malen = ws("Malen", b2, 1, 5);
  const sport = ws("Sportspiele", b2, 3, 10);
  const musik = ws("Band", b2, 0, 6);
  const journalismus = ws("Journalismus", b3, 2, 6);
  const nature = ws("Naturexkursion", b3, 2, 8);
  const codes = ws("Crashkurs Codes", b3, 0, 10);
  // Gleicher Workshop in zwei Slots (Instanzen-Gruppe): max. 1× pro Person
  const kochenWdh = ws("Kochen (Wiederholung)", b3, 0, 4);
  kochen.groupId = uid();
  kochenWdh.groupId = kochen.groupId;
  // Gekoppelter zweiteiliger Workshop: nur zusammen oder gar nicht
  const robotikAufbau = ws("Robotik Aufbau", b2, 2, 6);
  robotic.pairedWith = robotikAufbau.id;
  robotikAufbau.pairedWith = robotic.id;
  p.workshops = [
    kochen,
    robotic,
    theater,
    malen,
    sport,
    musik,
    robotikAufbau,
    journalismus,
    nature,
    codes,
    kochenWdh,
  ];

  const personNames = [
    "Anna",
    "Ben",
    "Clara",
    "David",
    "Emre",
    "Fiona",
    "Jonas",
    "Lena",
    "Malik",
    "Nora",
    "Oskar",
    "Sofia",
  ];
  const wishMatrix: [string, number][][] = [
    [
      ["Kochen", 1],
      ["Malen", 2],
      ["Journalismus", 3],
    ],
    [
      ["Robotik", 1],
      ["Robotik Aufbau", 2],
      ["Naturexkursion", 3],
    ],
    [
      ["Theater", 1],
      ["Band", 2],
      ["Crashkurs Codes", 3],
    ],
    [
      ["Kochen", 1],
      ["Sportspiele", 2],
      ["Kochen (Wiederholung)", 3],
    ],
    [
      ["Robotik", 1],
      ["Malen", 2],
      ["Crashkurs Codes", 3],
    ],
    [
      ["Sportspiele", 1],
      ["Band", 2],
      ["Naturexkursion", 3],
    ],
    [
      ["Robotik", 1],
      ["Theater", 2],
      ["Crashkurs Codes", 3],
    ],
    [
      ["Kochen", 1],
      ["Band", 2],
      ["Journalismus", 3],
    ],
    [
      ["Sportspiele", 1],
      ["Malen", 2],
      ["Naturexkursion", 3],
    ],
    [
      ["Theater", 1],
      ["Robotik", 2],
      ["Journalismus", 3],
    ],
    [
      ["Malen", 1],
      ["Naturexkursion", 2],
      ["Crashkurs Codes", 3],
    ],
    [
      ["Band", 1],
      ["Sportspiele", 2],
      ["Journalismus", 3],
    ],
  ];
  const byName = new Map(p.workshops.map((w) => [w.name, w]));
  p.persons = personNames.map((name) => ({ id: uid(), name }));
  p.persons.forEach((person, i) => {
    p.wishes[person.id] = wishMatrix[i]
      .map(([name, rank]) => ({ workshopId: byName.get(name)!.id, rank }))
      .sort((a, b) => a.rank - b.rank);
  });

  p.config = { n: 3, penaltyProfile: "linear", timeLimitSec: 60 };
  return p;
}
