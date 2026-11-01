<script lang="ts">
  import { app } from "../state.svelte";
  import {
    downloadFile,
    emptyProjectTemplate,
    participantCsvTemplate,
    participantXlsxTemplate,
    projectJson,
  } from "../io/export";

  let fileInput: HTMLInputElement | null = $state(null);
  let message = $state<{ kind: "ok" | "err"; text: string } | null>(null);

  function save() {
    const date = new Date().toISOString().slice(0, 10);
    downloadFile(`workshop-projekt-${date}.json`, projectJson(app.project), "application/json");
  }

  function downloadProjectTemplate() {
    downloadFile("workshop-projekt-vorlage.json", emptyProjectTemplate(), "application/json");
  }

  function downloadCsvTemplate() {
    downloadFile("import-vorlage.csv", participantCsvTemplate(app.project), "text/csv");
  }

  function downloadXlsxTemplate() {
    downloadFile(
      "import-vorlage.xlsx",
      participantXlsxTemplate(app.project),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
  }

  async function loadFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text());
      app.replaceProject(raw);
      message = { kind: "ok", text: `Projekt „${file.name}“ geladen.` };
    } catch (err) {
      message = {
        kind: "err",
        text: err instanceof Error ? err.message : String(err),
      };
    } finally {
      input.value = "";
    }
  }

  function loadSample() {
    if (
      app.project.persons.length === 0 ||
      confirm("Beispielprojekt laden? Aktuelle Daten werden ersetzt (Autosave wird überschrieben).")
    ) {
      app.loadSample();
      message = { kind: "ok", text: "Beispielprojekt geladen." };
    }
  }

  function reset() {
    if (
      app.project.persons.length === 0 ||
      confirm("Wirklich das komplette Projekt zurücksetzen? Alle Daten gehen verloren.")
    ) {
      app.reset();
      message = { kind: "ok", text: "Projekt zurückgesetzt." };
    }
  }

  const savedAtText = $derived(
    app.savedAt ? new Date(app.savedAt).toLocaleTimeString("de-DE") : "–",
  );
</script>

<div class="row g-4">
  <div class="col-lg-4">
    <div class="card h-100">
      <div class="card-header"><i class="bi bi-hdd me-2"></i>Projekt speichern &amp; laden</div>
      <div class="card-body">
        {#if message}
          <div
            class="alert {message.kind === 'ok'
              ? 'alert-success'
              : 'alert-danger'} alert-dismissible"
          >
            {message.text}
            <button
              type="button"
              class="btn-close"
              aria-label="Schließen"
              onclick={() => (message = null)}
            ></button>
          </div>
        {/if}

        <div class="d-flex flex-wrap gap-2">
          <button class="btn btn-primary" onclick={save}>
            <i class="bi bi-download me-1"></i>Als JSON-Datei speichern
          </button>
          <button class="btn btn-outline-primary" onclick={() => fileInput?.click()}>
            <i class="bi bi-upload me-1"></i>JSON-Datei laden
          </button>
          <input
            class="d-none"
            type="file"
            accept=".json,application/json"
            bind:this={fileInput}
            onchange={loadFile}
          />
        </div>

        <hr />
        <div class="d-flex flex-wrap gap-2">
          <button class="btn btn-outline-secondary" onclick={loadSample}>
            <i class="bi bi-magic me-1"></i>Beispielprojekt laden
          </button>
          <button class="btn btn-outline-danger" onclick={reset}>
            <i class="bi bi-trash me-1"></i>Zurücksetzen
          </button>
        </div>

        <hr />
        <p class="small text-secondary mb-0">
          <i class="bi bi-arrow-repeat me-1"></i>
          Autosave: jede Änderung wird automatisch im Browser gespeichert (localStorage, zuletzt {savedAtText}).
          Das Projekt bleibt beim nächsten Öffnen der Seite erhalten — „Zurücksetzen“ oder das Laden
          einer Datei überschreibt den Stand.
        </p>
      </div>
    </div>
  </div>

  <div class="col-lg-4">
    <div class="card h-100">
      <div class="card-header">
        <i class="bi bi-file-earmark-arrow-down me-2"></i>Vorlagen
      </div>
      <div class="card-body">
        <p class="small text-secondary">
          Leere Vorlagen zum Befüllen außerhalb der App — anschließend über den Import-Button im
          Kopf der Seite laden:
        </p>
        <div class="d-grid gap-2">
          <button class="btn btn-outline-primary" onclick={downloadXlsxTemplate}>
            <i class="bi bi-filetype-xlsx me-1"></i>Import-Vorlage (Excel, mit Anleitung)
          </button>
          <button class="btn btn-outline-primary" onclick={downloadCsvTemplate}>
            <i class="bi bi-filetype-csv me-1"></i>Import-Vorlage (CSV)
          </button>
          <button class="btn btn-outline-primary" onclick={downloadProjectTemplate}>
            <i class="bi bi-filetype-json me-1"></i>Leeres Projekt (JSON)
          </button>
        </div>
        <p class="small text-secondary mb-0 mt-3">
          Die Excel-Vorlage enthält Blätter für Konfiguration, Workshops und Wünsche (jeweils mit
          Beispielzeile bzw. aktuellen Werten) sowie ein Anleitungsblatt. Die CSV-Vorlage entspricht
          dem Wunschblatt (Semikolon-getrennt). Workshop-Namen müssen exakt zu „Slots &amp;
          Workshops“ passen.
        </p>
      </div>
    </div>
  </div>

  <div class="col-lg-4">
    <div class="card h-100 border-success">
      <div class="card-header"><i class="bi bi-shield-lock me-2"></i>Datenschutz</div>
      <div class="card-body small">
        <ul class="mb-0">
          <li>
            Alle Daten (Teilnehmer, Wünsche, Ergebnisse) bleiben ausschließlich in Ihrem Browser.
          </li>
          <li>
            Die App stellt keine Netzwerkverbindungen für Personendaten her — es gibt kein Backend,
            keine Konten, keine Datenbank.
          </li>
          <li>
            Speichern erfolgt nur lokal: localStorage (Autosave) und von Ihnen ausgelöste
            CSV/JSON-Downloads.
          </li>
          <li>Importdateien (CSV/XLSX) werden lokal gelesen und niemals als HTML ausgeführt.</li>
        </ul>
      </div>
    </div>
  </div>
</div>
