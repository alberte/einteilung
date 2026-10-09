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
   anderen Slot (min/max werden übernommen). Die Workshopliste lässt
   sich per „Excel-Export“ als Datei `workshops.xlsx` ausgeben
   (Workshop, Slot, min/max, Verbindungshinweise) — und per
   „Excel-Import“ aus Excel/CSV wieder einlesen: neue Slots werden
   automatisch angelegt, Workshops mit vorhandenem Namen werden
   aktualisiert (Modus „ergänzen“) oder die komplette Liste wird
   ersetzt. Die Vorlage (`workshops-vorlage.xlsx`, mit Anleitung)
   enthält bei befülltem Projekt die aktuelle Liste — exportieren,
   bearbeiten, wieder importieren. Über das Ketten-Symbol lassen sich
   Workshops verbinden:
   - **Gleicher Workshop — weitere Durchführungen**: Pro Slot eine
     Instanz auswählen (bis zu einer Durchführung je Slot). Der
     Workshop „läuft mehrfach“, jede Person erhält ihn höchstens
     einmal; ein Wunsch auf eine Durchführung zählt für alle.
   - **Gekoppelter Partner** (immer zusammen): Beide Workshops werden
     von jeder Person nur zusammen oder gar nicht besucht — für
     zweiteilige Workshops über zwei Slots.
2. **Teilnehmer & Wünsche** — XLSX oder CSV importieren (Spalten-Mapping im
   Dialog; bei mehrblättrigen XLSX-Dateien wird das Blatt ausgewählt) oder
   Personen von Hand anlegen; Wünsche per Hoch/Runter-Pfeilen in der
   Priorität sortieren (Rang = Position, kein Tippen). Importformat: eine
   Zeile pro Person, eine Namens-Spalte und Wunsch-Spalten in Rangfolge
   (Wunsch 1 = Erstwunsch, Workshop-Namen wie angelegt,
   Groß-/Kleinschreibung egal). Bei abweichenden Titeln bietet der Import
   einen **Zuordnungs-Schritt**: Unbekannte Titel (mit Häufigkeit) werden
   dem richtigen Workshop zugeordnet, mit Vorschlag bei Tippfehlern/
   Varianten (Umlaute, Satzzeichen und Schreibfehler werden toleriert) und
   Hinweisen zu Verbindungen — eine Zuordnung auf eine Durchführung einer
   Instanzen-Gruppe gilt für alle, bei gekoppelten Paaren wird der Partner
   automatisch mitvergeben. Nicht zugeordnete Titel verfallen mit Meldung.
   Für Excel-Nutzer gibt es eine XLSX-Vorlage mit Anleitung-, Ausfüll- und
   Referenzblatt (im Import-Dialog und im Projekt-Tab).
3. **Konfiguration** — n (Workshops pro Person), Straf-Profil
   (linear „Effizient“ / quadratisch „Fair“), Zeitlimit.
4. **Ergebnis** — Belegung berechnen: Statistiken, Workshop-Kacheln pro
   Slot, Personenübersicht; Zuweisungen ohne erfüllten Wunsch rot;
   Export als mehrblättrige Excel-Datei (Zuweisungen, Pro Person als
   Slot-Matrix, Pro Workshop, Statistik) oder CSV
   (`;`-getrennt).
5. **Projekt** — JSON speichern/laden, Beispielprojekt, Zurücksetzen,
   leere Vorlagen zum Download (Teilnehmer-Import als Excel mit
   Anleitung-, Ausfüll- und Referenzblatt oder als CSV; leeres
   Projekt-JSON). Autosave: jede Änderung landet automatisch im
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
- Ein Wunsch deckt alle Durchführungen einer Instanzen-Gruppe **und**
  den Koppel-Partner ab (gleicher Rang): Der mitgezogene zweite Teil
  eines Paars zählt als erfüllter Wunsch, nicht als
  „kein Wunsch“-Zuweisung.
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

## Deployment auf GitHub Pages (Alternative)

Die Pipeline `.github/workflows/pages.yml` baut bei jedem Push auf `main`
und veröffentlicht über die GitHub-Pages-Actions. Einmalige Einrichtung:

```bash
# Repo anlegen (per Web oder gh CLI):
gh repo create <repo> --public --source . --push
```

1. In den Repo-Einstellungen: **Settings → Pages → Source: „GitHub Actions“**
2. Fertig — die App liegt unter `https://<user>.github.io/<repo>/`.

Details:

- Der Workflow setzt beim Build `--base=/<repo>/`, damit die Asset-Pfade
  unter dem Unterpfad stimmen. Bei einem User-Site-Repo
  (`<user>.github.io`, Auslieferung unter `/`) entfällt das automatisch.
- Der Workflow trägt einen Guard (`github.server_url == 'https://github.com'`),
  damit er auf Forgejo/Codeberg-Instanzen nicht mitläuft (Forgejo liest
  `.github/workflows` ebenfalls); dort ist die `.forgejo`-Pipeline zuständig.

Manueller Deploy ohne Actions (z. B. für einen schnellen Test):

```bash
npx vite build --base=/<repo>/
npx gh-pages -d dist   # einmalig npm install -D gh-pages
```

## Datenschutz-DoD

- Kein Netzwerk-Request mit Personendaten; einzig externe Requests sind
  Asset-Loads aus dem eigenen Bundle (Bootstrap-Icons, JS/CSS).
- Gespeichert wird nur lokal: `localStorage` (Autosave) und vom Nutzer
  ausgelöste Downloads (CSV/JSON).
