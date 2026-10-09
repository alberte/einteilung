<script lang="ts">
  import { app, workshopsInSlot } from "../state.svelte";

  let newSlotName = $state("");
  let newWorkshop = $state({ name: "", slotId: "", min: 1, max: 10 });

  const personsCount = $derived(app.project.persons.length);

  function addSlot() {
    app.addSlot(newSlotName);
    newSlotName = "";
  }

  function addWorkshop() {
    app.addWorkshop(
      newWorkshop.name,
      newWorkshop.slotId || app.project.slots[0]?.id || "",
      newWorkshop.min,
      newWorkshop.max,
    );
    newWorkshop.name = "";
  }

  function removeSlotConfirm(id: string, name: string) {
    const ws = workshopsInSlot(app.project, id).length;
    const msg = ws
      ? `Slot „${name}“ und seine ${ws} Workshops (inkl. Wünsche) löschen?`
      : `Slot „${name}“ löschen?`;
    if (confirm(msg)) app.removeSlot(id);
  }

  function removeWorkshopConfirm(id: string, name: string) {
    if (confirm(`Workshop „${name}“ löschen? Zugehörige Wünsche werden entfernt.`)) {
      app.removeWorkshop(id);
    }
  }

  function slotMinSum(slotId: string): number {
    return workshopsInSlot(app.project, slotId).reduce((acc, w) => acc + w.min, 0);
  }
</script>

<div class="row g-4">
  <div class="col-lg-4">
    <div class="card">
      <div class="card-header"><i class="bi bi-clock-history me-2"></i>Slots (Zeitblöcke)</div>
      <div class="card-body">
        <form
          class="d-flex gap-2 mb-3"
          onsubmit={(e) => {
            e.preventDefault();
            addSlot();
          }}
        >
          <input
            class="form-control"
            placeholder="z. B. „Block 1 — Fr 10:00“"
            bind:value={newSlotName}
            aria-label="Neuer Slot"
          />
          <button class="btn btn-primary text-nowrap" type="submit" disabled={!newSlotName.trim()}>
            <i class="bi bi-plus-lg"></i> Slot
          </button>
        </form>

        {#if app.project.slots.length === 0}
          <p class="text-secondary mb-0">Noch keine Slots angelegt.</p>
        {:else}
          <ul class="list-group">
            {#each app.project.slots as slot (slot.id)}
              <li class="list-group-item d-flex align-items-center gap-2">
                <input
                  class="form-control form-control-sm border-0 bg-transparent px-1"
                  bind:value={slot.name}
                  aria-label="Slot-Name"
                />
                <span class="badge text-bg-secondary"
                  >{workshopsInSlot(app.project, slot.id).length} WS</span
                >
                <span
                  class="badge {slotMinSum(slot.id) > personsCount
                    ? 'text-bg-danger'
                    : 'text-bg-light text-secondary border'}"
                >
                  min Σ {slotMinSum(slot.id)} / {personsCount} Pers.
                </span>
                <button
                  class="btn btn-sm btn-outline-danger"
                  title="Slot löschen"
                  onclick={() => removeSlotConfirm(slot.id, slot.name)}
                >
                  <i class="bi bi-trash"></i>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  </div>

  <div class="col-lg-8">
    <div class="card">
      <div class="card-header">
        <i class="bi bi-grid-3x3-gap me-2"></i>Workshops
      </div>
      <div class="card-body">
        {#if app.project.slots.length === 0}
          <div class="alert alert-info mb-0">Bitte zuerst links einen Slot anlegen.</div>
        {:else}
          <form
            class="row g-2 align-items-end mb-3"
            onsubmit={(e) => {
              e.preventDefault();
              addWorkshop();
            }}
          >
            <div class="col-md-4">
              <label class="form-label mb-1 small" for="new-ws-name">Name</label>
              <input
                id="new-ws-name"
                class="form-control"
                bind:value={newWorkshop.name}
                placeholder="z. B. „Kochen“"
                required
              />
            </div>
            <div class="col-md-3">
              <label class="form-label mb-1 small" for="new-ws-slot">Slot</label>
              <select id="new-ws-slot" class="form-select" bind:value={newWorkshop.slotId}>
                {#each app.project.slots as slot (slot.id)}
                  <option value={slot.id}>{slot.name}</option>
                {/each}
              </select>
            </div>
            <div class="col-6 col-md-2">
              <label class="form-label mb-1 small" for="new-ws-min">min</label>
              <input
                id="new-ws-min"
                class="form-control"
                type="number"
                min="0"
                bind:value={newWorkshop.min}
              />
            </div>
            <div class="col-6 col-md-2">
              <label class="form-label mb-1 small" for="new-ws-max">max</label>
              <input
                id="new-ws-max"
                class="form-control"
                type="number"
                min="0"
                bind:value={newWorkshop.max}
              />
            </div>
            <div class="col-md-1 d-grid">
              <button class="btn btn-primary" type="submit" title="Workshop anlegen">
                <i class="bi bi-plus-lg"></i>
              </button>
            </div>
          </form>

          {#if app.project.workshops.length === 0}
            <p class="text-secondary mb-0">Noch keine Workshops angelegt.</p>
          {:else}
            <div class="table-responsive">
              <table class="table table-sm align-middle">
                <thead>
                  <tr>
                    <th style="min-width: 12rem;">Workshop</th>
                    <th style="min-width: 10rem;">Slot</th>
                    <th style="width: 6rem;">min</th>
                    <th style="width: 6rem;">max</th>
                    <th style="width: 4rem;"></th>
                  </tr>
                </thead>
                <tbody>
                  {#each app.project.workshops as w (w.id)}
                    <tr class={w.min > w.max ? "table-danger" : ""}>
                      <td
                        ><input
                          class="form-control form-control-sm"
                          bind:value={w.name}
                          aria-label="Workshop-Name"
                        /></td
                      >
                      <td>
                        <select
                          class="form-select form-select-sm"
                          bind:value={w.slotId}
                          aria-label="Slot"
                        >
                          {#each app.project.slots as slot (slot.id)}
                            <option value={slot.id}>{slot.name}</option>
                          {/each}
                        </select>
                      </td>
                      <td
                        ><input
                          class="form-control form-control-sm"
                          type="number"
                          min="0"
                          bind:value={w.min}
                          aria-label="Mindestbelegung"
                        /></td
                      >
                      <td
                        ><input
                          class="form-control form-control-sm"
                          type="number"
                          min="0"
                          bind:value={w.max}
                          aria-label="Höchstbelegung"
                        /></td
                      >
                      <td>
                        <button
                          class="btn btn-sm btn-outline-danger"
                          title="Workshop löschen"
                          onclick={() => removeWorkshopConfirm(w.id, w.name)}
                        >
                          <i class="bi bi-trash"></i>
                        </button>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
            <p class="small text-secondary mb-0">
              Zeilen rot markiert: min &gt; max. Workshops, die dieselbe Zeit (Slot) haben, können
              von einer Person nicht beide besucht werden.
            </p>
          {/if}
        {/if}
      </div>
    </div>
  </div>
</div>
