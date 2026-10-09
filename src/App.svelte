<script lang="ts">
  import { app, STORAGE_KEY } from "./lib/state.svelte";
  import WorkshopsTab from "./lib/components/WorkshopsTab.svelte";
  import ParticipantsTab from "./lib/components/ParticipantsTab.svelte";
  import ConfigTab from "./lib/components/ConfigTab.svelte";
  import ResultsTab from "./lib/components/ResultsTab.svelte";
  import ProjectTab from "./lib/components/ProjectTab.svelte";

  const tabs = [
    { id: "workshops", label: "Slots & Workshops", icon: "bi-grid-3x3-gap" },
    { id: "participants", label: "Teilnehmer & Wünsche", icon: "bi-people" },
    { id: "config", label: "Konfiguration", icon: "bi-sliders" },
    { id: "result", label: "Ergebnis", icon: "bi-clipboard-data" },
    { id: "project", label: "Projekt", icon: "bi-hdd" },
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

<nav class="navbar navbar-dark bg-primary sticky-top">
  <div class="container-xl">
    <span class="navbar-brand fw-semibold">
      <i class="bi bi-grid-3x3-gap me-2"></i>Workshop-Planner
    </span>
    <span class="badge text-bg-light d-none d-md-inline-flex align-items-center gap-1">
      <i class="bi bi-shield-lock"></i>
      Alle Daten bleiben im Browser — kein Upload, kein Backend
    </span>
  </div>
</nav>

<div class="container-xl">
  <ul class="nav nav-tabs pt-2">
    {#each tabs as tab (tab.id)}
      <li class="nav-item">
        <button
          class="nav-link {app.activeTab === tab.id ? 'active' : ''}"
          onclick={() => (app.activeTab = tab.id)}
        >
          <i class="bi {tab.icon} me-1"></i>{tab.label}
        </button>
      </li>
    {/each}
  </ul>

  <main class="bg-white border border-top-0 p-3 p-lg-4 mb-4 shadow-sm rounded-bottom">
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

{#if app.solving}
  <div
    class="position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center"
    style="background: rgba(33,37,41,.35); z-index: 2000;"
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
