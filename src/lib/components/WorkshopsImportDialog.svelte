<script lang="ts">
  import { parseTable, type ParsedTable } from "../io/importFile";
  import {
    applyWorkshopImport,
    parseWorkshopTable,
    type WorkshopImportSummary,
  } from "../io/importWorkshops";
  import { downloadFile, workshopXlsxTemplate } from "../io/export";
  import { app } from "../state.svelte";

  let {
    open = $bindable(false),
    onDone,
  }: {
    open?: boolean;
    onDone?: (summary: WorkshopImportSummary) => void;
  } = $props();

  let fileInput: HTMLInputElement | null = $state(null);
  let currentFile = $state<File | null>(null);
  let table = $state<ParsedTable | null>(null);
  let mode = $state<"replace" | "append">("append");
  let error = $state<string | null>(null);
  let busy = $state(false);
  let summary = $state<WorkshopImportSummary | null>(null);

  async function loadTable(file: File, sheet?: string) {
    busy = true;
    error = null;
    table = null;
    try {
      const parsed = await parseTable(file, sheet);
      parseWorkshopTable(parsed); // Spalten-Validierung (wirft bei falschem Format)
      table = parsed;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
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

  function apply() {
    if (!table) return;
    summary = applyWorkshopImport(app.project, table, mode);
    onDone?.(summary);
  }

  function close() {
    open = false;
    table = null;
    summary = null;
    error = null;
    currentFile = null;
    if (fileInput) fileInput.value = "";
  }
</script>

{#if open}
  <div
    class="modal d-block"
    tabindex="-1"
    role="dialog"
    aria-modal="true"
    aria-label="Workshops importieren"
  >
    <div class="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">
            <i class="bi bi-file-import me-2"></i>Workshops importieren (Excel / CSV)
          </h5>
          <button type="button" class="btn-close" aria-label="Schließen" onclick={close}></button>
        </div>
        <div class="modal-body">
          <p class="text-secondary">
            Eine Zeile pro Workshop: Spalten <strong>Workshop</strong>, <strong>Slot</strong>,
            <strong>min</strong>, <strong>max</strong> (wie in der Vorlage). Neue Slots werden automatisch
            angelegt; Workshops mit vorhandenem Namen werden bei „ergänzen“ aktualisiert.
          </p>

          <div class="mb-3">
            <label class="form-label" for="ws-import-file">Datei (.xlsx, .xls, .csv)</label>
            <input
              id="ws-import-file"
              class="form-control"
              type="file"
              accept=".xlsx,.xls,.csv"
              bind:this={fileInput}
              onchange={onFileChange}
            />
            <div class="form-text">
              Noch keine Datei?
              <button
                type="button"
                class="btn btn-link btn-sm p-0 align-baseline"
                onclick={() =>
                  downloadFile(
                    "workshops-vorlage.xlsx",
                    workshopXlsxTemplate(app.project),
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                  )}
              >
                Excel-Vorlage herunterladen
              </button>
              (enthält bei vorhandenem Projekt die aktuelle Liste zum Bearbeiten)
            </div>
          </div>

          {#if table?.sheetNames && table.sheetNames.length > 1}
            <div class="mb-3">
              <label class="form-label" for="ws-import-sheet">Arbeitsblatt</label>
              <select
                id="ws-import-sheet"
                class="form-select"
                value={table.sheetName}
                onchange={(e) => switchSheet((e.target as HTMLSelectElement).value)}
              >
                {#each table.sheetNames as sheet (sheet)}
                  <option value={sheet}>{sheet}</option>
                {/each}
              </select>
            </div>
          {/if}

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
            <div class="mb-3 d-flex flex-wrap align-items-center gap-3">
              <div>
                <strong>{table.rows.length}</strong> Zeilen erkannt ({table.source === "csv"
                  ? "CSV"
                  : `Tabelle „${table.sheetName}“`})
              </div>
              <div class="form-check form-check-inline mb-0">
                <input
                  class="form-check-input"
                  type="radio"
                  id="ws-mode-append"
                  value="append"
                  bind:group={mode}
                />
                <label class="form-check-label" for="ws-mode-append">
                  ergänzen (vorhandene aktualisieren)
                </label>
              </div>
              <div class="form-check form-check-inline mb-0">
                <input
                  class="form-check-input"
                  type="radio"
                  id="ws-mode-replace"
                  value="replace"
                  bind:group={mode}
                />
                <label class="form-check-label" for="ws-mode-replace"> alles ersetzen </label>
              </div>
            </div>

            <div class="table-responsive border rounded" style="max-height: 16rem;">
              <table class="table table-sm table-striped mb-0">
                <thead>
                  <tr>
                    {#each table.columns as col (col)}
                      <th>{col}</th>
                    {/each}
                  </tr>
                </thead>
                <tbody>
                  {#each table.rows.slice(0, 6) as row, i (i)}
                    <tr>
                      {#each table.columns as col (col)}
                        <td class="text-truncate" style="max-width: 16rem;" title={row[col]}>
                          {row[col]}
                        </td>
                      {/each}
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}

          {#if summary}
            <div class="alert {summary.skipped.length ? 'alert-warning' : 'alert-success'}">
              <div>
                <strong>{summary.workshopsCreated}</strong> Workshops angelegt,
                <strong>{summary.workshopsUpdated}</strong> aktualisiert,
                <strong>{summary.slotsCreated}</strong> Slots angelegt ({summary.mode === "replace"
                  ? "ersetzt"
                  : "ergänzt"}).
              </div>
              {#if summary.skipped.length}
                <div class="mt-1">
                  Übersprungen:
                  <ul class="mb-0">
                    {#each summary.skipped as s (s)}
                      <li>{s}</li>
                    {/each}
                  </ul>
                </div>
              {/if}
            </div>
          {/if}
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" onclick={close}>Schließen</button>
          <button type="button" class="btn btn-primary" disabled={!table} onclick={apply}>
            <i class="bi bi-box-arrow-in-down me-1"></i>
            {summary ? "Erneut importieren" : "Importieren"}
          </button>
        </div>
      </div>
    </div>
  </div>
  <div class="modal-backdrop show"></div>
{/if}
