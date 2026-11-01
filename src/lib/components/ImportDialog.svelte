<script lang="ts">
  import { mergeTables, parseSheets, type ParsedTable } from "../io/importFile";
  import {
    applyImport,
    collectUnmatchedTitles,
    guessMapping,
    isParticipantTable,
    resolveTitleAssignments,
    suggestWorkshopId,
    virtualWorkshopId,
    type CentralImportSummary,
    type UnmatchedTitle,
  } from "../io/applyImport";
  import { applyWorkshopImport, isWorkshopTable, parseWorkshopTable } from "../io/importWorkshops";
  import { applyConfigImport, isConfigTable, parseConfigTable } from "../io/importConfig";
  import { downloadFile, participantCsvTemplate, participantXlsxTemplate } from "../io/export";
  import { app } from "../state.svelte";

  let {
    open = $bindable(false),
    onDone,
  }: {
    open?: boolean;
    onDone?: (summary: CentralImportSummary) => void;
  } = $props();

  let fileInput: HTMLInputElement | null = $state(null);
  /** gemergte Blätter pro Import-Bereich (null = nicht in der Datei) */
  let configTable = $state<ParsedTable | null>(null);
  let workshopTable = $state<ParsedTable | null>(null);
  let participantTable = $state<ParsedTable | null>(null);
  /** was importiert werden soll (vorbelegt: alles, was in der Datei gefunden wurde) */
  let importConfig = $state(false);
  let importWorkshops = $state(false);
  let importWishes = $state(false);
  let mapping = $state<{ nameColumn: string | null; wishColumns: Map<string, number> }>({
    nameColumn: null,
    wishColumns: new Map(),
  });
  let mode = $state<"replace" | "append">("replace");
  let error = $state<string | null>(null);
  let busy = $state(false);
  let summary = $state<CentralImportSummary | null>(null);
  /** Blätter der Datei ohne bekanntes Format (z. B. „Anleitung“) — werden nicht importiert */
  let skippedSheets = $state<string[]>([]);

  const MAX_WISHES = 12;

  /** Workshop-Zeilen aus den Workshop-Blättern der Datei (noch nicht angelegt) */
  const newWorkshopRows = $derived(workshopTable ? parseWorkshopTable(workshopTable) : []);
  /** vorhandene Workshops plus virtuelle Einträge für die neuen aus der Datei */
  const virtualWorkshops = $derived([
    ...app.project.workshops,
    ...newWorkshopRows.map((r) => ({ id: virtualWorkshopId(r.name), name: r.name })),
  ]);

  const mappingValid = $derived(
    mapping.nameColumn !== null &&
      mapping.wishColumns.size > 0 &&
      new Set(mapping.wishColumns.values()).size === mapping.wishColumns.size,
  );

  const canApply = $derived(
    (importConfig && configTable !== null) ||
      (importWorkshops && workshopTable !== null) ||
      (importWishes && participantTable !== null && mappingValid),
  );

  async function loadTable(file: File) {
    busy = true;
    error = null;
    try {
      // alle Arbeitsblätter lesen und nach Import-Bereich sortieren
      const sheets = await parseSheets(file);
      const nonEmpty = sheets.filter((t) => t.rows.length > 0);
      const cfgSheets = nonEmpty.filter(isConfigTable);
      const wsSheets = nonEmpty.filter(isWorkshopTable);
      const pSheets = nonEmpty.filter(isParticipantTable);
      if (cfgSheets.length === 0 && wsSheets.length === 0 && pSheets.length === 0) {
        throw new Error(
          "Kein bekanntes Arbeitsblatt gefunden — erwartet werden Blätter mit „Einstellung“/„Wert“ " +
            "(Konfiguration), „Workshop“/„Slot“ (Workshops) oder „Name“/„Wunsch …“ (Teilnehmer). " +
            "Am einfachsten die Excel-Vorlage verwenden.",
        );
      }
      configTable = cfgSheets.length > 0 ? mergeTables(cfgSheets) : null;
      workshopTable = wsSheets.length > 0 ? mergeTables(wsSheets) : null;
      participantTable = pSheets.length > 0 ? mergeTables(pSheets) : null;
      skippedSheets = nonEmpty
        .filter((t) => !cfgSheets.includes(t) && !wsSheets.includes(t) && !pSheets.includes(t))
        .map((t) => t.sheetName ?? "?");
      importConfig = configTable !== null;
      importWorkshops = workshopTable !== null;
      importWishes = participantTable !== null;
      if (participantTable) mapping = guessMapping(participantTable);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      configTable = null;
      workshopTable = null;
      participantTable = null;
    } finally {
      busy = false;
    }
  }

  async function onFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    error = null;
    summary = null;
    configTable = null;
    workshopTable = null;
    participantTable = null;
    skippedSheets = [];
    importConfig = false;
    importWorkshops = false;
    importWishes = false;
    if (!file) return;
    await loadTable(file);
  }

  function setRole(column: string, role: string) {
    if (role === "name") {
      mapping.nameColumn = column;
      if (mapping.wishColumns.has(column)) mapping.wishColumns.delete(column);
      return;
    }
    if (mapping.nameColumn === column) mapping.nameColumn = null;
    if (role === "ignore") {
      mapping.wishColumns.delete(column);
    } else {
      const rank = Number(role);
      mapping.wishColumns.set(column, rank);
    }
  }

  function roleOf(column: string): string {
    if (mapping.nameColumn === column) return "name";
    const rank = mapping.wishColumns.get(column);
    if (rank !== undefined) return String(rank);
    return "ignore";
  }

  // --- Schritt 2: unbekannte Workshop-Titel zuordnen --------------------
  let assignStep = $state(false);
  let unmatchedTitles = $state<UnmatchedTitle[]>([]);
  let titleAssignments = $state<Record<string, string>>({});

  function startApply() {
    if (!canApply) return;
    summary = null;
    // auch Workshops aus derselben Datei beim Matching berücksichtigen (virtuelle Ids)
    if (importWishes && participantTable && mappingValid) {
      const unmatched = collectUnmatchedTitles(participantTable, mapping, virtualWorkshops);
      if (unmatched.length > 0) {
        unmatchedTitles = unmatched;
        titleAssignments = Object.fromEntries(
          unmatched.map((u) => [u.title, suggestWorkshopId(u.title, virtualWorkshops) ?? ""]),
        );
        assignStep = true;
        return;
      }
    }
    doApply();
  }

  function doApply() {
    const result: CentralImportSummary = { mode };
    // Reihenfolge: Konfiguration -> Workshops -> Wünsche (Wunsch-Titel matchen gegen neue Workshops)
    if (importConfig && configTable) {
      result.configImport = applyConfigImport(app.project, parseConfigTable(configTable));
    }
    if (importWorkshops && workshopTable) {
      result.workshopImport = applyWorkshopImport(app.project, workshopTable, mode);
    }
    if (importWishes && participantTable) {
      const resolvedTitles = resolveTitleAssignments(titleAssignments, app.project.workshops);
      result.participantImport = applyImport(
        app.project,
        participantTable,
        mapping,
        mode,
        resolvedTitles,
      );
    }
    summary = result;
    if (onDone && summary) onDone(summary);
  }

  const assignedWorkshop = (title: string) => {
    const id = titleAssignments[title];
    return id ? (app.project.workshops.find((w) => w.id === id) ?? null) : null;
  };

  function slotNameOf(slotId: string): string {
    return app.project.slots.find((s) => s.id === slotId)?.name ?? "?";
  }

  function connectionHint(w: { pairedWith?: string | null; groupId?: string | null }): string[] {
    const hints: string[] = [];
    if (w.pairedWith) {
      const partner = app.project.workshops.find((x) => x.id === w.pairedWith);
      if (partner) hints.push(`gekoppelt mit „${partner.name}“ — der Partner wird mitvergeben`);
    }
    if (w.groupId) {
      const others = app.project.workshops.filter(
        (x) => x.groupId === w.groupId && x.id !== (w as { id: string }).id,
      );
      if (others.length > 0)
        hints.push(`Wunsch gilt für alle Durchführungen (${others.map((x) => x.name).join(", ")})`);
    }
    return hints;
  }

  function apply() {
    if (assignStep) {
      doApply();
      return;
    }
    startApply();
  }

  const summaryHasWarnings = $derived(
    (summary?.participantImport?.unmatchedWorkshops.length ?? 0) > 0 ||
      (summary?.workshopImport?.skipped.length ?? 0) > 0 ||
      (summary?.configImport?.skipped.length ?? 0) > 0,
  );

  function close() {
    open = false;
    configTable = null;
    workshopTable = null;
    participantTable = null;
    summary = null;
    error = null;
    skippedSheets = [];
    importConfig = false;
    importWorkshops = false;
    importWishes = false;
    assignStep = false;
    unmatchedTitles = [];
    titleAssignments = {};
    if (fileInput) fileInput.value = "";
  }
</script>

{#snippet columnsHint()}
  Ordnen Sie jeder Spalte eine Rolle zu: genau eine Namens-Spalte und die Wunsch-Spalten in
  Rangfolge (Wunsch 1 = Erstwunsch). Workshop-Namen müssen zu den angelegten Workshops passen
  (Groß-/Kleinschreibung ist egal; Workshops aus derselben Datei werden automatisch erkannt).
{/snippet}

{#snippet sheetNames(names: string[] | undefined)}
  {#if names && names.length > 1}
    {names.map((s) => `„${s}“`).join(", ")}
  {:else if names && names.length === 1}
    „{names[0]}“
  {/if}
{/snippet}

{#snippet summaryAlert()}
  {#if summary}
    <div class="alert {summaryHasWarnings ? 'alert-warning' : 'alert-success'}">
      {#if summary.configImport}
        <div>
          <strong>Konfiguration:</strong>
          {#if summary.configImport.applied.length > 0}
            {summary.configImport.applied.map((a) => `${a.key} = ${a.value}`).join(", ")}
          {:else}
            keine gültigen Einstellungen gefunden
          {/if}
          {#if summary.configImport.skipped.length}
            — übersprungen: {summary.configImport.skipped.join("; ")}
          {/if}
        </div>
      {/if}
      {#if summary.workshopImport}
        <div>
          <strong>Workshops:</strong>
          <strong>{summary.workshopImport.workshopsCreated}</strong> angelegt,
          <strong>{summary.workshopImport.workshopsUpdated}</strong> aktualisiert,
          <strong>{summary.workshopImport.slotsCreated}</strong> Slots angelegt
          {#if summary.workshopImport.skipped.length}
            — übersprungen: {summary.workshopImport.skipped.join("; ")}
          {/if}
        </div>
      {/if}
      {#if summary.participantImport}
        <div>
          <strong>Teilnehmer:</strong>
          <strong>{summary.participantImport.personsAdded}</strong> importiert,
          <strong>{summary.participantImport.wishesAdded}</strong> Wünsche zugeordnet
          {summary.participantImport.skippedRows
            ? `, ${summary.participantImport.skippedRows} Zeile(n) ohne Namen übersprungen`
            : ""}
          ({summary.mode === "replace" ? "ersetzt" : "ergänzt"}).
        </div>
        {#if summary.participantImport.mappedTitles.length > 0}
          <div class="mt-1">
            Zugeordnete Titel:
            {summary.participantImport.mappedTitles
              .map((m) => `${m.title} → ${m.workshop}`)
              .join(", ")}
          </div>
        {/if}
        {#if summary.participantImport.unmatchedWorkshops.length}
          <div class="mt-1">
            Nicht zugeordnet (Wünsche verfallen): {summary.participantImport.unmatchedWorkshops.join(
              ", ",
            )}
          </div>
        {/if}
      {/if}
    </div>
  {/if}
{/snippet}

{#if open}
  <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-label="Import">
    <div class="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title"><i class="bi bi-file-import me-2"></i>Import (Excel / CSV)</h5>
          <button type="button" class="btn-close" aria-label="Schließen" onclick={close}></button>
        </div>
        <div class="modal-body">
          {#if assignStep}
            <h6>Unbekannte Workshop-Titel zuordnen</h6>
            <p class="text-secondary small">
              Diese Titel kommen in der Datei vor, passen aber zu keinem angelegten Workshop. Ordnen
              Sie sie dem richtigen Workshop zu — die Zahl gibt an, wie oft der Titel vorkommt.
              Nicht zugeordnete Titel verfallen. Bei verbundenen Workshops genügt eine Zuordnung auf
              eine Durchführung (der Wunsch gilt für alle); bei gekoppelten Paaren wird der Partner
              automatisch mitvergeben.
            </p>
            <div class="table-responsive border rounded mb-3">
              <table class="table table-sm align-middle mb-0">
                <thead>
                  <tr>
                    <th>Titel in der Datei</th>
                    <th style="width: 5rem;">Anzahl</th>
                    <th style="min-width: 16rem;">Zuordnung</th>
                    <th style="min-width: 14rem;">Hinweis</th>
                  </tr>
                </thead>
                <tbody>
                  {#each unmatchedTitles as u (u.title)}
                    <tr>
                      <td>{u.title}</td>
                      <td><span class="badge text-bg-secondary">{u.count}×</span></td>
                      <td>
                        <select
                          class="form-select form-select-sm"
                          value={titleAssignments[u.title] ?? ""}
                          onchange={(e) =>
                            (titleAssignments[u.title] = (e.target as HTMLSelectElement).value)}
                          aria-label="Workshop für „{u.title}“"
                        >
                          <option value="">— nicht zuordnen (Wunsch entfällt) —</option>
                          {#each app.project.workshops as w (w.id)}
                            <option value={w.id}>{w.name} ({slotNameOf(w.slotId)})</option>
                          {/each}
                          {#each newWorkshopRows as r (r.name)}
                            <option value={virtualWorkshopId(r.name)}
                              >{r.name} (neu aus dieser Datei)</option
                            >
                          {/each}
                        </select>
                      </td>
                      <td class="small">
                        {#each connectionHint(assignedWorkshop(u.title) ?? {}) as hint (hint)}
                          <div class="text-secondary">{hint}</div>
                        {/each}
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
            {@render summaryAlert()}
          {:else}
            <p class="text-secondary">
              Alle Arbeitsblätter der Datei werden erkannt — wählen Sie per Häkchen, was importiert
              werden soll. Reihenfolge beim Import: Konfiguration, dann Workshops, dann Wünsche.
            </p>

            <div class="mb-3">
              <label class="form-label" for="import-file">Datei (.xlsx, .xls, .csv)</label>
              <input
                id="import-file"
                class="form-control"
                type="file"
                accept=".csv,.xlsx,.xls,text/csv"
                bind:this={fileInput}
                onchange={onFileChange}
              />
              <div class="form-text">
                Noch keine Datei? Vorlagen herunterladen:
                <button
                  type="button"
                  class="btn btn-link btn-sm p-0 align-baseline"
                  onclick={() =>
                    downloadFile(
                      "import-vorlage.xlsx",
                      participantXlsxTemplate(app.project),
                      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    )}
                >
                  Excel-Vorlage
                </button>
                (mit Konfigurations-, Workshop- und Wunschblatt sowie Anleitung) oder
                <button
                  type="button"
                  class="btn btn-link btn-sm p-0 align-baseline"
                  onclick={() =>
                    downloadFile(
                      "import-vorlage.csv",
                      participantCsvTemplate(app.project),
                      "text/csv",
                    )}
                >
                  CSV-Vorlage
                </button>
                (nur Wünsche).
              </div>
            </div>

            {#if busy}
              <div class="alert alert-secondary d-flex align-items-center gap-2">
                <span class="spinner-border spinner-border-sm" role="status"></span> Datei wird lokal
                gelesen …
              </div>
            {/if}

            {#if error}
              <div class="alert alert-danger">
                <i class="bi bi-exclamation-triangle me-1"></i>{error}
              </div>
            {/if}

            {#if configTable || workshopTable || participantTable}
              <div class="mb-3">
                <span class="form-label d-block">Was importieren?</span>
                <div class="form-check">
                  <input
                    class="form-check-input"
                    type="checkbox"
                    id="imp-config"
                    bind:checked={importConfig}
                    disabled={configTable === null}
                  />
                  <label class="form-check-label" for="imp-config">
                    Konfiguration {#if configTable}<span class="text-secondary"
                        >(Blatt {@render sheetNames(configTable.usedSheetNames)})</span
                      >{:else}<span class="text-secondary">(nicht in der Datei)</span>{/if}
                  </label>
                </div>
                <div class="form-check">
                  <input
                    class="form-check-input"
                    type="checkbox"
                    id="imp-workshops"
                    bind:checked={importWorkshops}
                    disabled={workshopTable === null}
                  />
                  <label class="form-check-label" for="imp-workshops">
                    Workshops &amp; Slots {#if workshopTable}<span class="text-secondary"
                        >(Blatt {@render sheetNames(workshopTable.usedSheetNames)})</span
                      >{:else}<span class="text-secondary">(nicht in der Datei)</span>{/if}
                  </label>
                </div>
                <div class="form-check">
                  <input
                    class="form-check-input"
                    type="checkbox"
                    id="imp-wishes"
                    bind:checked={importWishes}
                    disabled={participantTable === null}
                  />
                  <label class="form-check-label" for="imp-wishes">
                    Teilnehmer &amp; Wünsche {#if participantTable}<span class="text-secondary"
                        >(Blatt {@render sheetNames(participantTable.usedSheetNames)})</span
                      >{:else}<span class="text-secondary">(nicht in der Datei)</span>{/if}
                  </label>
                </div>
                {#if skippedSheets.length > 0}
                  <div class="text-secondary small mt-1">
                    Übersprungen (kein bekanntes Format): {skippedSheets
                      .map((s) => `„${s}“`)
                      .join(", ")}
                  </div>
                {/if}
              </div>

              {#if (importWorkshops && workshopTable) || (importWishes && participantTable)}
                <div class="mb-3 d-flex flex-wrap align-items-center gap-3">
                  <div class="form-check form-check-inline mb-0">
                    <input
                      class="form-check-input"
                      type="radio"
                      id="mode-replace"
                      value="replace"
                      bind:group={mode}
                    />
                    <label class="form-check-label" for="mode-replace"
                      >alles ersetzen (Workshops und Teilnehmer)</label
                    >
                  </div>
                  <div class="form-check form-check-inline mb-0">
                    <input
                      class="form-check-input"
                      type="radio"
                      id="mode-append"
                      value="append"
                      bind:group={mode}
                    />
                    <label class="form-check-label" for="mode-append"
                      >ergänzen (Workshops aktualisieren, Teilnehmer anhängen)</label
                    >
                  </div>
                </div>
              {/if}

              {#if importWishes && participantTable}
                <p class="text-secondary small">{@render columnsHint()}</p>
                <div class="mb-2">
                  <strong>{participantTable.rows.length}</strong> Zeilen erkannt ({participantTable.source ===
                  "csv"
                    ? "CSV"
                    : (participantTable.usedSheetNames?.length ?? 0) > 1
                      ? `aus ${participantTable.usedSheetNames?.length} Arbeitsblättern`
                      : `Tabelle „${participantTable.sheetName}“`})
                </div>

                <div class="table-responsive border rounded mb-3" style="max-height: 18rem;">
                  <table class="table table-sm table-striped mb-0">
                    <thead>
                      <tr>
                        <th>#</th>
                        {#each participantTable.columns as col (col)}
                          <th class="col-3">
                            {col}
                            <select
                              class="form-select form-select-sm mt-1"
                              value={roleOf(col)}
                              onchange={(e) => setRole(col, (e.target as HTMLSelectElement).value)}
                              aria-label="Rolle der Spalte {col}"
                            >
                              <option value="ignore">— ignorieren —</option>
                              <option value="name">Name</option>
                              {#each Array.from({ length: MAX_WISHES }, (_, i) => i + 1) as rank (rank)}
                                <option value={rank}>Wunsch {rank}</option>
                              {/each}
                            </select>
                          </th>
                        {/each}
                      </tr>
                    </thead>
                    <tbody>
                      {#each participantTable.rows.slice(0, 6) as row, i (i)}
                        <tr>
                          <td class="text-secondary">{i + 1}</td>
                          {#each participantTable.columns as col (col)}
                            <td class="text-truncate" style="max-width: 14rem;" title={row[col]}
                              >{row[col]}</td
                            >
                          {/each}
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>

                {#if !mappingValid}
                  <div class="alert alert-warning">
                    Bitte genau eine <strong>Name</strong>-Spalte und mindestens eine
                    <strong>Wunsch</strong>-Spalte wählen — Wunsch-Ränge dürfen nur je einmal
                    vergeben werden.
                    <button
                      class="btn btn-sm btn-outline-secondary ms-2"
                      onclick={() => participantTable && (mapping = guessMapping(participantTable))}
                    >
                      Zuordnung zurücksetzen
                    </button>
                  </div>
                {/if}
              {/if}

              {@render summaryAlert()}
            {/if}
          {/if}
        </div>
        <div class="modal-footer">
          {#if assignStep}
            <button
              type="button"
              class="btn btn-secondary"
              onclick={() => {
                assignStep = false;
                summary = null;
              }}
            >
              <i class="bi bi-arrow-left me-1"></i>Zurück
            </button>
            <button type="button" class="btn btn-primary" onclick={doApply}>
              <i class="bi bi-box-arrow-in-down me-1"></i>
              {summary ? "Erneut importieren" : "Jetzt importieren"}
            </button>
          {:else}
            <button type="button" class="btn btn-secondary" onclick={close}>Schließen</button>
            <button type="button" class="btn btn-primary" disabled={!canApply} onclick={apply}>
              <i class="bi bi-box-arrow-in-down me-1"></i>
              {summary ? "Erneut importieren" : "Importieren"}
            </button>
          {/if}
        </div>
      </div>
    </div>
  </div>
  <div class="modal-backdrop show"></div>
{/if}
