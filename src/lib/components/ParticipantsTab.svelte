<script lang="ts">
  import { app } from "../state.svelte";
  import { validateProject } from "../validation";

  let newPersonName = $state("");
  let search = $state("");
  let expandedId = $state<string | null>(null);

  const validation = $derived(validateProject(app.project));

  const filteredPersons = $derived(
    app.project.persons.filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase())),
  );

  function addPerson() {
    const person = app.addPerson(newPersonName);
    newPersonName = "";
    if (person) expandedId = person.id;
  }

  function removePersonConfirm(id: string, name: string) {
    if (confirm(`Teilnehmer „${name}“ (inkl. Wünsche) löschen?`)) {
      app.removePerson(id);
      if (expandedId === id) expandedId = null;
    }
  }

  function workshopName(id: string): string {
    return app.project.workshops.find((w) => w.id === id)?.name ?? "?";
  }

  function slotName(workshopId: string): string {
    const w = app.project.workshops.find((ws) => ws.id === workshopId);
    return w ? (app.project.slots.find((s) => s.id === w.slotId)?.name ?? "?") : "?";
  }

  /** Wünsche in Prioritätsreihenfolge (Rang 1 zuerst). */
  function sortedWishes(personId: string) {
    return [...app.wishesOf(personId)].sort((a, b) => a.rank - b.rank);
  }

  /** Workshops, die für eine zusätzliche Wunschauswahl noch verfügbar sind. */
  function availableWorkshops(personId: string, currentWorkshopId: string) {
    const used = new Set(
      app
        .wishesOf(personId)
        .map((w) => w.workshopId)
        .filter((id) => id !== currentWorkshopId),
    );
    return app.project.workshops.filter((w) => !used.has(w.id));
  }
</script>

<div class="d-flex flex-wrap gap-2 align-items-center mb-3">
  <form
    class="d-flex gap-2"
    onsubmit={(e) => {
      e.preventDefault();
      addPerson();
    }}
  >
    <input
      class="form-control"
      placeholder="Teilnehmer von Hand hinzufügen"
      bind:value={newPersonName}
      aria-label="Neuer Teilnehmer"
    />
    <button
      class="btn btn-outline-primary text-nowrap"
      type="submit"
      disabled={!newPersonName.trim()}
      title="Teilnehmer hinzufügen"
      aria-label="Teilnehmer hinzufügen"
    >
      <i class="bi bi-person-plus"></i>
    </button>
  </form>
  <input
    class="form-control ms-auto"
    style="max-width: 16rem;"
    placeholder="Suchen …"
    bind:value={search}
    aria-label="Teilnehmer suchen"
  />
</div>

{#if validation.warnings.length}
  <div class="alert alert-warning py-2 small">
    <i class="bi bi-exclamation-triangle me-1"></i>
    {#each validation.warnings as w, i (i)}
      <div>{w}</div>
    {/each}
  </div>
{/if}

{#if app.project.persons.length === 0}
  <div class="alert alert-info">
    Noch keine Teilnehmer. entweder importieren oder von Hand hinzufügen.
  </div>
{:else}
  <div class="table-responsive">
    <table class="table table-hover align-middle">
      <thead>
        <tr>
          <th style="width: 3rem;"></th>
          <th style="width: 3rem;" class="text-secondary">#</th>
          <th style="min-width: 12rem;">Name</th>
          <th>Wünsche</th>
          <th style="width: 4rem;"></th>
        </tr>
      </thead>
      <tbody>
        {#each filteredPersons as person, i (person.id)}
          <tr>
            <td>
              <button
                class="btn btn-sm btn-outline-secondary"
                aria-label="Wünsche bearbeiten"
                onclick={() => (expandedId = expandedId === person.id ? null : person.id)}
              >
                <i class="bi {expandedId === person.id ? 'bi-chevron-up' : 'bi-chevron-down'}"></i>
              </button>
            </td>
            <td class="text-secondary">{i + 1}</td>
            <td
              ><input
                class="form-control form-control-sm border-0 bg-transparent px-1"
                bind:value={person.name}
                aria-label="Name"
              /></td
            >
            <td>
              {#if app.wishesOf(person.id).length === 0}
                <span class="text-danger"
                  ><i class="bi bi-exclamation-circle me-1"></i>keine Wünsche</span
                >
              {:else}
                {#each [...app.wishesOf(person.id)].sort((a, b) => a.rank - b.rank) as wish (wish.workshopId)}
                  <span class="badge text-bg-light border me-1">
                    <strong>{wish.rank}.</strong>
                    {workshopName(wish.workshopId)}
                    <span class="text-secondary small">({slotName(wish.workshopId)})</span>
                  </span>
                {/each}
              {/if}
            </td>
            <td>
              <button
                class="btn btn-sm btn-outline-danger"
                title="Löschen"
                onclick={() => removePersonConfirm(person.id, person.name)}
              >
                <i class="bi bi-trash"></i>
              </button>
            </td>
          </tr>
          {#if expandedId === person.id}
            <tr>
              <td colspan="5" class="bg-light">
                <div class="row g-2 align-items-center">
                  {#each sortedWishes(person.id) as wish, idx (wish.workshopId)}
                    <div class="col-12 col-md-6 col-lg-4 d-flex gap-2 align-items-center">
                      <div class="d-flex flex-column gap-1">
                        <button
                          class="btn btn-sm btn-outline-secondary py-0 px-1"
                          title="höher priorisieren"
                          aria-label="Wunsch „{workshopName(wish.workshopId)}“ nach oben"
                          disabled={idx === 0}
                          onclick={() => app.moveWish(person.id, wish.workshopId, -1)}
                        >
                          <i class="bi bi-chevron-up"></i>
                        </button>
                        <button
                          class="btn btn-sm btn-outline-secondary py-0 px-1"
                          title="niedriger priorisieren"
                          aria-label="Wunsch „{workshopName(wish.workshopId)}“ nach unten"
                          disabled={idx === sortedWishes(person.id).length - 1}
                          onclick={() => app.moveWish(person.id, wish.workshopId, 1)}
                        >
                          <i class="bi bi-chevron-down"></i>
                        </button>
                      </div>
                      <span class="badge text-bg-primary" title="Priorität">{idx + 1}.</span>
                      <select
                        class="form-select form-select-sm"
                        bind:value={wish.workshopId}
                        aria-label="Workshop"
                      >
                        <option value={wish.workshopId}>{workshopName(wish.workshopId)}</option>
                        {#each availableWorkshops(person.id, wish.workshopId) as w (w.id)}
                          <option value={w.id}>{w.name} ({slotName(w.id)})</option>
                        {/each}
                      </select>
                      <button
                        class="btn btn-sm btn-outline-danger"
                        title="Wunsch entfernen"
                        onclick={() => app.removeWish(person.id, wish.workshopId)}
                      >
                        <i class="bi bi-x-lg"></i>
                      </button>
                    </div>
                  {/each}
                  {#if app.project.workshops.length > app.wishesOf(person.id).length}
                    <div class="col-12 col-md-6 col-lg-4">
                      <select
                        class="form-select form-select-sm"
                        aria-label="Wunsch hinzufügen"
                        onchange={(e) => {
                          const id = (e.target as HTMLSelectElement).value;
                          if (id) app.addWish(person.id, id);
                          (e.target as HTMLSelectElement).value = "";
                        }}
                      >
                        <option value="">+ Wunsch hinzufügen …</option>
                        {#each availableWorkshops(person.id, "") as w (w.id)}
                          <option value={w.id}>{w.name} ({slotName(w.id)})</option>
                        {/each}
                      </select>
                    </div>
                  {/if}
                </div>
                <p class="small text-secondary mb-0 mt-2">
                  Reihenfolge per Pfeil = Priorität (1. = Erstwunsch). Bei verbundenen Workshops
                  gilt der Wunsch für alle Durchführungen; bei gekoppelten Paaren deckt ein Wunsch
                  auf einen Teil beide Teile ab. Workshops im selben Slot konkurrieren.
                </p>
              </td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>
  </div>
{/if}
