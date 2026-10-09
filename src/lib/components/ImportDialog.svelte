<script lang="ts">
  import { parseTable, type ParsedTable } from "../io/importFile";
  import { applyImport, guessMapping, type ImportSummary } from "../io/applyImport";
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

  const MAX_WISHES = 12;

  async function onFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    error = null;
    summary = null;
    table = null;
    if (!file) return;
    busy = true;
    try {
      table = await parseTable(file);
      mapping = guessMapping(table);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      table = null;
    } finally {
      busy = false;
    }
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

  function apply() {
    if (!table || !canApply) return;
    summary = applyImport(app.project, table, mapping, mode);
    if (onDone && summary) onDone(summary);
  }

  function close() {
    open = false;
    table = null;
    summary = null;
    error = null;
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
          <p class="text-secondary">{@render columnsHint()}</p>

          <div class="mb-3">
            <label class="form-label" for="import-file">Datei (.csv, .xlsx, .xls)</label>
            <input
              id="import-file"
              class="form-control"
              type="file"
              accept=".csv,.xlsx,.xls,text/csv"
              bind:this={fileInput}
              onchange={onFileChange}
            />
          </div>

          {#if busy}
            <div class="alert alert-secondary d-flex align-items-center gap-2">
              <span class="spinner-border spinner-border-sm" role="status"></span> Datei wird lokal gelesen
              …
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
              class="alert {summary.unmatchedWorkshops.length ? 'alert-warning' : 'alert-success'}"
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
            </div>
          {/if}
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" onclick={close}>Schließen</button>
          <button type="button" class="btn btn-primary" disabled={!canApply} onclick={apply}>
            <i class="bi bi-box-arrow-in-down me-1"></i>
            {summary ? "Erneut importieren" : "Importieren"}
          </button>
        </div>
      </div>
    </div>
  </div>
  <div class="modal-backdrop show"></div>
{/if}
