<script lang="ts">
  import { parseTable, type ParsedTable } from "../io/importFile";
  import {
    applyImport,
    collectUnmatchedTitles,
    guessMapping,
    suggestWorkshopId,
    type ImportSummary,
    type UnmatchedTitle,
  } from "../io/applyImport";
  import { downloadFile, participantCsvTemplate, participantXlsxTemplate } from "../io/export";
  import { app } from "../state.svelte";

  let {
    open = $bindable(false),
    onDone,
  }: {
    open?: boolean;
    onDone?: (summary: ImportSummary) => void;
  } = $props();

  let fileInput: HTMLInputElement | null = $state(null);
  let table = $state<ParsedTable | null>(null);
  let mapping = $state<{ nameColumn: string | null; wishColumns: Map<string, number> }>({
    nameColumn: null,
    wishColumns: new Map(),
  });
  let mode = $state<"replace" | "append">("replace");
  let error = $state<string | null>(null);
  let busy = $state(false);
  let summary = $state<ImportSummary | null>(null);
  let currentFile = $state<File | null>(null);

  const MAX_WISHES = 12;

  async function loadTable(file: File, sheet?: string) {
    busy = true;
    error = null;
    try {
      table = await parseTable(file, sheet);
      mapping = guessMapping(table);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      table = null;
    } finally {
      busy = false;
    }
  }

  async function onFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    error = null;
    summary = null;
    table = null;
    currentFile = file ?? null;
    if (!file) return;
    await loadTable(file);
  }

  async function switchSheet(sheet: string) {
    if (!currentFile || !table || table.sheetName === sheet) return;
    summary = null;
    await loadTable(currentFile, sheet);
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

  const canApply = $derived(
    table !== null &&
      mapping.nameColumn !== null &&
      mapping.wishColumns.size > 0 &&
      new Set(mapping.wishColumns.values()).size === mapping.wishColumns.size,
  );

  // --- Schritt 2: unbekannte Workshop-Titel zuordnen --------------------
  let assignStep = $state(false);
  let unmatchedTitles = $state<UnmatchedTitle[]>([]);
  let titleAssignments = $state<Record<string, string>>({});

  function startApply() {
    if (!table || !canApply) return;
    summary = null;
    const unmatched = collectUnmatchedTitles(table, mapping, app.project.workshops);
    if (unmatched.length === 0) {
      doApply();
      return;
    }
    unmatchedTitles = unmatched;
    titleAssignments = Object.fromEntries(
      unmatched.map((u) => [u.title, suggestWorkshopId(u.title, app.project.workshops) ?? ""]),
    );
    assignStep = true;
  }

  function doApply() {
    if (!table) return;
    summary = applyImport(app.project, table, mapping, mode, titleAssignments);
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

  function close() {
    open = false;
    table = null;
    summary = null;
    error = null;
    assignStep = false;
    unmatchedTitles = [];
    titleAssignments = {};
    if (fileInput) fileInput.value = "";
  }
</script>

{#snippet columnsHint()}
  Ordnen Sie jeder Spalte eine Rolle zu: genau eine Namens-Spalte und die Wunsch-Spalten in
  Rangfolge (Wunsch 1 = Erstwunsch). Workshop-Namen müssen zu den im Tab „Slots &amp; Workshops“
  angelegten Workshops passen (Groß-/Kleinschreibung ist egal).
{/snippet}

{#if open}
  <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-label="Import">
    <div class="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">
            <i class="bi bi-file-import me-2"></i>Teilnehmer importieren (CSV / XLSX)
          </h5>
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

            {#if summary}
              <div
                class="alert {summary.unmatchedWorkshops.length
                  ? 'alert-warning'
                  : 'alert-success'}"
              >
                <div>
                  <strong>{summary.personsAdded}</strong> Teilnehmer importiert,
                  <strong>{summary.wishesAdded}</strong> Wünsche zugeordnet
                  {summary.skippedRows
                    ? `, ${summary.skippedRows} Zeile(n) ohne Namen übersprungen`
                    : ""}.
                </div>
                {#if summary.mappedTitles.length > 0}
                  <div class="mt-1">
                    Zugeordnete Titel:
                    {summary.mappedTitles.map((m) => `${m.title} → ${m.workshop}`).join(", ")}
                  </div>
                {/if}
                {#if summary.unmatchedWorkshops.length}
                  <div class="mt-1">
                    Nicht zugeordnet (Wünsche verfallen):
                    {summary.unmatchedWorkshops.join(", ")}
                  </div>
                {/if}
              </div>
            {/if}
          {:else}
            <p class="text-secondary">{@render columnsHint()}</p>

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
                      "teilnehmer-import-vorlage.xlsx",
                      participantXlsxTemplate(app.project),
                      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    )}
                >
                  Excel-Vorlage
                </button>
                (mit Anleitung und Workshop-Liste) oder
                <button
                  type="button"
                  class="btn btn-link btn-sm p-0 align-baseline"
                  onclick={() =>
                    downloadFile(
                      "teilnehmer-import-vorlage.csv",
                      participantCsvTemplate(app.project),
                      "text/csv",
                    )}
                >
                  CSV-Vorlage
                </button>
              </div>
            </div>

            {#if table?.sheetNames && table.sheetNames.length > 1}
              <div class="mb-3">
                <label class="form-label" for="import-sheet">Arbeitsblatt</label>
                <select
                  id="import-sheet"
                  class="form-select"
                  value={table.sheetName}
                  onchange={(e) => switchSheet((e.target as HTMLSelectElement).value)}
                >
                  {#each table.sheetNames as sheet (sheet)}
                    <option value={sheet}>{sheet}</option>
                  {/each}
                </select>
                <div class="form-text">
                  Mehrere Arbeitsblätter erkannt — hier auswählen, welches die Teilnehmer enthält.
                </div>
              </div>
            {/if}

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

            {#if table}
              <div class="mb-2 d-flex flex-wrap align-items-center">
                <strong>{table.rows.length}</strong>&nbsp;Zeilen erkannt ({table.source === "csv"
                  ? "CSV"
                  : `Tabelle „${table.sheetName}“`}) —&nbsp;
                <div class="form-check form-check-inline mb-0">
                  <input
                    class="form-check-input"
                    type="radio"
                    id="mode-replace"
                    value="replace"
                    bind:group={mode}
                  />
                  <label class="form-check-label" for="mode-replace"
                    >vorhandene Teilnehmer ersetzen</label
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
                  <label class="form-check-label" for="mode-append">anhängen</label>
                </div>
              </div>

              <div class="table-responsive border rounded mb-3" style="max-height: 18rem;">
                <table class="table table-sm table-striped mb-0">
                  <thead>
                    <tr>
                      <th>#</th>
                      {#each table.columns as col (col)}
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
                    {#each table.rows.slice(0, 6) as row, i (i)}
                      <tr>
                        <td class="text-secondary">{i + 1}</td>
                        {#each table.columns as col (col)}
                          <td class="text-truncate" style="max-width: 14rem;" title={row[col]}
                            >{row[col]}</td
                          >
                        {/each}
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>

              {#if !canApply}
                <div class="alert alert-warning">
                  Bitte genau eine <strong>Name</strong>-Spalte und mindestens eine
                  <strong>Wunsch</strong>-Spalte wählen — Wunsch-Ränge dürfen nur je einmal vergeben
                  werden.
                  <button
                    class="btn btn-sm btn-outline-secondary ms-2"
                    onclick={() => table && (mapping = guessMapping(table))}
                  >
                    Zuordnung zurücksetzen
                  </button>
                </div>
              {/if}
            {/if}

            {#if summary}
              <div
                class="alert {summary.unmatchedWorkshops.length
                  ? 'alert-warning'
                  : 'alert-success'}"
              >
                <div>
                  <strong>{summary.personsAdded}</strong> Teilnehmer importiert,
                  <strong>{summary.wishesAdded}</strong> Wünsche zugeordnet
                  {summary.skippedRows
                    ? `, ${summary.skippedRows} Zeile(n) ohne Namen übersprungen`
                    : ""}.
                </div>
                {#if summary.unmatchedWorkshops.length}
                  <div class="mt-1">
                    Unbekannte Workshop-Namen (Wunsch wurde verworfen — bitte Workshops anlegen oder
                    Datei korrigieren):
                    {summary.unmatchedWorkshops.join(", ")}
                  </div>
                {/if}
                {#if summary.mappedTitles.length > 0}
                  <div class="mt-1">
                    Zugeordnete Titel:
                    {summary.mappedTitles.map((m) => `${m.title} → ${m.workshop}`).join(", ")}
                  </div>
                {/if}
              </div>
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
