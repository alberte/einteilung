# Workshop-Planner („Einteilung“)

Statische Webanwendung, mit der Veranstalter Workshop-Belegungen aus
Teilnehmerwünschen berechnen: Jede Person wählt Wünsche in Rangfolge und
bekommt **n Workshops** zugewiesen; jeder Workshop hat **Min- und
Höchstbelegung** und läuft in einem von mehreren **Zeit-Slots**
(höchstens ein Workshop pro Person und Slot).

**Alle Daten bleiben im Browser.** Kein Backend, keine Konten, keine
Datenbank, keine Uploads — Datenschutz per Design. Die Berechnung
(LP/Branch-&-Bound) läuft lokal in einem Web Worker.

Umsetzung des Plans in `projektplan-workshop-planner-web-client-seitig.md`.

## Bedienung (Kurzführung)

1. **Slots & Workshops** — Slots (Zeitblöcke) anlegen, Workshops mit
   min/max je Slot eintragen. Die Workshopliste ist über die
   Spaltenköpfe sortierbar (Name, Slot, min, max — aufsteigend/
   absteigend). Das Kopier-Symbol klont einen Workshop in einen
   anderen Slot (min/max werden übernommen). Über das Ketten-Symbol
   lassen sich Workshops verbinden:
   - **Gleicher Workshop — weitere Durchführungen**: Pro Slot eine
     Instanz auswählen (bis zu einer Durchführung je Slot). Der
     Workshop „läuft mehrfach“, jede Person erhält ihn höchstens
     einmal; ein Wunsch auf eine Durchführung zählt für alle.
   - **Gekoppelter Partner** (immer zusammen): Beide Workshops werden
     von jeder Person nur zusammen oder gar nicht besucht — für
     zweiteilige Workshops über zwei Slots.
2. **Teilnehmer & Wünsche** — CSV/XLSX importieren (Spalten-Mapping im
   Dialog) oder Personen von Hand anlegen; Wünsche per Hoch/Runter-
   Pfeilen in der Priorität sortieren (Rang = Position, kein Tippen).
   Importformat: eine Zeile pro Person, eine Namens-Spalte und
   Wunsch-Spalten in Rangfolge (Wunsch 1 = Erstwunsch, Workshop-Namen wie
   angelegt, Groß-/Kleinschreibung egal).
3. **Konfiguration** — n (Workshops pro Person), Straf-Profil
   (linear „Effizient“ / quadratisch „Fair“), Zeitlimit.
4. **Ergebnis** — Belegung berechnen: Statistiken, Workshop-Kacheln pro
   Slot, Personenübersicht; Zuweisungen ohne erfüllten Wunsch rot;
   CSV-Export (Person × Workshop × Slot, `;`-getrennt).
5. **Projekt** — JSON speichern/laden, Beispielprojekt, Zurücksetzen,
   leere Vorlagen zum Download (Teilnehmer-CSV mit den aktuellen
   Workshop-Namen, leeres Projekt-JSON). Die CSV-Vorlage hängt auch im
   Import-Dialog. Autosave: jede Änderung landet automatisch im
   `localStorage`.

Unlösbare Fälle melden konkrete Ursachen, z. B.
„Slot ‚Block 1‘: Die Mindestbelegungen ergeben 24 Plätze, es gibt aber nur
12 Teilnehmer“ oder „Gesamtkapazität reicht nicht für n × Teilnehmer“.

## Entwicklung

```bash
npm install
npm run dev        # Vite-Dev-Server
npm test           # Vitest (Solver-Kern, 13 Tests inkl. Unlösbar-Fälle)
npm run check      # svelte-check (Typen)
npm run lint       # Prettier-Check + ESLint
npm run format     # Prettier formatieren
npm run build      # Production-Build nach dist/
npm run preview    # Build lokal ansehen
```

Performance-Messung (nicht in der Standard-CI):

```bash
VITE_PERF=1 npx vitest run src/lib/solver/perf.test.ts
```

## Architektur

```
src/
├── App.svelte                  Tab-Navigation, Autosave-Effect, Solver-Overlay
├── lib/
│   ├── model.ts                Slots/Workshops/Personen/Wünsche, (De-)Serialisierung
│   ├── state.svelte.ts         Zentraler $state-Store, CRUD, solve()
│   ├── validation.ts           Vorab-Prüfungen (Fehler/Blocker vs. Warnungen)
│   ├── solver/
│   │   ├── types.ts            SolveInput/SolveResult-Contract
│   │   ├── diagnose.ts         exakte Unlösbarkeitsanalyse mit Ursachen
│   │   ├── build.ts            MIP-Modell für javascript-lp-solver
│   │   ├── solve.ts            2-stufige, optimale Zuweisung
│   │   ├── solver.worker.ts    Solver im Web Worker (UI friert nicht ein)
│   │   └── runSolve.ts         Worker-Start + Zeitlimit-Erzwingung
│   ├── io/                     CSV/XLSX-Import (papaparse/sheetjs), CSV/JSON-Export
│   └── components/             5 Tabs + Import-Dialog
```

### Solver

- Binär-LP/MIP mit `javascript-lp-solver` (reines JS, A4). Variablen
  `x[Person, Workshop]`, Nebenbedingungen: Σ pro Person = n, Σ pro
  Person+Slot ≤ 1, min ≤ Σ pro Workshop ≤ max, Instanzen-Gruppen
  (Σ pro Person+Gruppe ≤ 1, „gleicher Workshop“), Koppel-Paare
  (x[a] = x[b] pro Person, „immer zusammen“); Ziel: minimierte
  Rangstrafe (linear oder quadratisch, konfigurierbar).
- **Zwei Stufen**: Zuerst nur Wunsch-Variablen — ist dieses Modell
  lösbar, ist die Lösung global optimal (Zuweisungen ohne Wunsch sind
  mit Kosten 10⁶ so teuer, dass sie nur bei Unvermeidbarkeit auftreten).
  Erst wenn Mindestbelegungen/n sonst nicht erfüllbar sind, wird das
  vollständige Modell (inkl. „kein Wunsch“-Paare) gelöst.
- `diagnose()` prüft die Machbarkeit **vor** dem Lösen und ist notwendig
  _und_ hinreichend (die Wünsche schränken die Machbarkeit nicht ein,
  nur die Kapazitäten): min > max, min-Summe pro Slot > Teilnehmer,
  Gesamtkapazität < n × Teilnehmer, Σ min > n × Teilnehmer, n > Slots.
- Solver ist hinter dem Interface `solve(input): SolveResult`
  gekapselt — ein Wechsel auf `highs-js` (WASM) ist Drop-in möglich.

### Performance (gemessen mit `perf.test.ts`, Node 26 / Desktop-CPU)

| Instanz                                    | Zeit  | Status  |
| ------------------------------------------ | ----- | ------- |
| 200 Personen × 30 Workshops × 6 Slots, n=5 | 0,1 s | optimal |
| 1.000 × 50 × 10, n=5                       | 4,0 s | optimal |

Damit wird das Planziel (< 10 s für 1.000 × 50 × 10) auf der gemessenen
Instanz erreicht. `javascript-lp-solver` (JS-Simplex +
Branch-&-Bound) hat jedoch keine Worst-Case-Laufzeitschranke (Risiko
R1) — das konfigurierbare Zeitlimit bricht dann ab, ohne die UI zu
blockieren; die dokumentierte Milderung bleibt der Wechsel auf
`highs-js` (WASM) hinter dem Solver-Interface.

## Deployment (Codeberg Pages via Forgejo Actions)

Pipeline: `.forgejo/workflows/pages.yml` — bei Push auf `main` werden
Tests + Build ausgeführt und `dist/` auf den `pages`-Branch gepusht.
Erreichbar danach unter `https://<user>.codeberg.page/<repo>/`.

Einmalige Einrichtung:

```bash
tea login add   # Codeberg-Anmeldung im CLI (Projektplan: tea als gh-Pendant)
```

1. Repo auf Codeberg anlegen und `main` pushen:
   `git remote add origin https://codeberg.org/<user>/<repo>.git && git push -u origin main`
2. PAT mit `repository`-Scope erstellen (Codeberg → Einstellungen →
   Anwendungen → Access Tokens) und im Repo als Secret `PAGES_TOKEN`
   hinterlegen (Einstellungen → Actions → Secrets).
3. Forgejo Actions im Repo aktivieren (Einstellungen → Actions).
4. Nach dem ersten Pipeline-Lauf: Repo → Einstellungen → Standard-Branch
   ist `main`; Pages werden automatisch vom `pages`-Branch ausgeliefert.

Der Build ist bewusst hoster-agnostic (`dist/` ist statisch); identisch
auf GitHub Pages oder Cloudflare deploybar (Fallback aus Risiko R5).

## Datenschutz-DoD

- Kein Netzwerk-Request mit Personendaten; einzig externe Requests sind
  Asset-Loads aus dem eigenen Bundle (Bootstrap-Icons, JS/CSS).
- Gespeichert wird nur lokal: `localStorage` (Autosave) und vom Nutzer
  ausgelöste Downloads (CSV/JSON).
