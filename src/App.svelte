<script lang="ts">
  import { app, STORAGE_KEY } from "./lib/state.svelte";
  import WorkshopsTab from "./lib/components/WorkshopsTab.svelte";
  import ParticipantsTab from "./lib/components/ParticipantsTab.svelte";
  import ConfigTab from "./lib/components/ConfigTab.svelte";
  import ResultsTab from "./lib/components/ResultsTab.svelte";
  import ProjectTab from "./lib/components/ProjectTab.svelte";
  import ImportDialog from "./lib/components/ImportDialog.svelte";
  import type { CentralImportSummary } from "./lib/io/applyImport";

  let showImport = $state(false);
  let lastImport = $state<CentralImportSummary | null>(null);

  const importHasWarnings = $derived(
    (lastImport?.participantImport?.unmatchedWorkshops.length ?? 0) > 0 ||
      (lastImport?.workshopImport?.skipped.length ?? 0) > 0 ||
      (lastImport?.configImport?.skipped.length ?? 0) > 0,
  );

  const tabs = [
    { id: "workshops", label: "Slots & Workshops" },
    { id: "participants", label: "Teilnehmer & Wünsche" },
    { id: "config", label: "Konfiguration" },
    { id: "result", label: "Ergebnis" },
  ] as const;

  // localStorage-Autosave (Projektplan A5): schreibt bei jeder Änderung ins
  // localStorage — JSON.stringify liest das $state tief, dadurch wirkt der
  // Effekt auf jede Mutation.
  $effect(() => {
    const updated = new Date().toISOString();
    const payload = JSON.stringify({
      ...app.project,
      meta: { ...app.project.meta, updated },
    });
    localStorage.setItem(STORAGE_KEY, payload);
    app.savedAt = updated;
  });
</script>

<header class="app-header sticky-top">
  <div class="container-xl d-flex flex-wrap justify-content-between align-items-center gap-2">
    <span class="brand">
      Einteilung
      <small>Workshop-Belegung aus Teilnehmerwünschen</small>
    </span>
    <span class="d-flex align-items-center gap-3">
      <span class="privacy-note d-none d-md-inline-flex">
        <i class="bi bi-shield-lock"></i>
        Alle Daten bleiben im Browser — kein Upload, kein Backend
      </span>
      <button
        class="btn btn-sm btn-outline-light text-nowrap"
        onclick={() => {
          lastImport = null;
          showImport = true;
        }}
      >
        <i class="bi bi-file-import me-1"></i>Import
      </button>
    </span>
  </div>
</header>

<div class="container-xl">
  <nav class="workflow" aria-label="Arbeitsschritte">
    {#each tabs as tab, i (tab.id)}
      <button
        class="step {app.activeTab === tab.id ? 'active' : ''}"
        onclick={() => (app.activeTab = tab.id)}
        aria-current={app.activeTab === tab.id ? "page" : undefined}
      >
        <span class="num">{i + 1}</span>{tab.label}
      </button>
    {/each}
    <button
      class="step utility {app.activeTab === 'project' ? 'active' : ''}"
      onclick={() => (app.activeTab = "project")}
      aria-current={app.activeTab === "project" ? "page" : undefined}
    >
      <i class="bi bi-hdd me-1"></i>Projekt
    </button>
  </nav>

  {#if lastImport}
    <div
      class="alert {importHasWarnings
        ? 'alert-warning'
        : 'alert-success'} alert-dismissible mt-3 mb-0 py-2 small"
    >
      {#if lastImport.configImport}
        <div>
          <strong>Konfiguration:</strong>
          {#if lastImport.configImport.applied.length > 0}
            {lastImport.configImport.applied.map((a) => `${a.key} = ${a.value}`).join(", ")}
          {:else}
            keine gültigen Einstellungen gefunden
          {/if}
          {#if lastImport.configImport.skipped.length}
            — übersprungen: {lastImport.configImport.skipped.join("; ")}
          {/if}
        </div>
      {/if}
      {#if lastImport.workshopImport}
        <div>
          <strong>Workshops:</strong>
          <strong>{lastImport.workshopImport.workshopsCreated}</strong> angelegt,
          <strong>{lastImport.workshopImport.workshopsUpdated}</strong> aktualisiert,
          <strong>{lastImport.workshopImport.slotsCreated}</strong> Slots angelegt
          {#if lastImport.workshopImport.skipped.length}
            — übersprungen: {lastImport.workshopImport.skipped.join("; ")}
          {/if}
        </div>
      {/if}
      {#if lastImport.participantImport}
        <div>
          <strong>Teilnehmer:</strong>
          <strong>{lastImport.participantImport.personsAdded}</strong> importiert,
          <strong>{lastImport.participantImport.wishesAdded}</strong> Wünsche zugeordnet
          {lastImport.participantImport.skippedRows
            ? `, ${lastImport.participantImport.skippedRows} Zeile(n) ohne Namen übersprungen`
            : ""}
          ({lastImport.mode === "replace" ? "ersetzt" : "ergänzt"}).
          {#if lastImport.participantImport.unmatchedWorkshops.length}
            Nicht zugeordnet (Wünsche verfallen):
            <strong>{lastImport.participantImport.unmatchedWorkshops.join(", ")}</strong>
          {/if}
        </div>
      {/if}
      <button
        type="button"
        class="btn-close"
        aria-label="Schließen"
        onclick={() => (lastImport = null)}
      ></button>
    </div>
  {/if}

  <main class="app-main p-3 p-lg-4 mb-4">
    {#if app.activeTab === "workshops"}
      <WorkshopsTab />
    {:else if app.activeTab === "participants"}
      <ParticipantsTab />
    {:else if app.activeTab === "config"}
      <ConfigTab />
    {:else if app.activeTab === "result"}
      <ResultsTab />
    {:else}
      <ProjectTab />
    {/if}
  </main>
</div>

<ImportDialog bind:open={showImport} onDone={(s) => (lastImport = s)} />

{#if app.solving}
  <div
    class="solver-overlay position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
    style="z-index: 2000;"
  >
    <div class="card shadow-lg">
      <div class="card-body d-flex align-items-center gap-3">
        <span class="spinner-border text-primary" role="status" aria-hidden="true"></span>
        <div>
          <strong>Belegung wird berechnet …</strong>
          <div class="text-secondary small">Der Solver läuft lokal in Ihrem Browser.</div>
        </div>
      </div>
    </div>
  </div>
{/if}
