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

  // --- Verbindungen zwischen Workshops -------------------------------
  let linkWorkshopId = $state<string | null>(null);

  const linkWorkshop = $derived(app.project.workshops.find((w) => w.id === linkWorkshopId) ?? null);

  function slotNameOf(slotId: string): string {
    return app.project.slots.find((s) => s.id === slotId)?.name ?? "?";
  }

  function groupCount(w: { groupId?: string | null }): number {
    if (!w.groupId) return 0;
    return app.project.workshops.filter((x) => x.groupId === w.groupId).length;
  }

  function partnerName(w: { pairedWith?: string | null }): string | null {
    if (!w.pairedWith) return null;
    return app.project.workshops.find((x) => x.id === w.pairedWith)?.name ?? null;
  }

  /** Aktuelle Gruppen-Instanz des Workshops in einem Slot ("" = keine). */
  function groupInstanceInSlot(w: { id: string; groupId?: string | null }, slotId: string): string {
    if (!w.groupId) return "";
    const instance = app.project.workshops.find(
      (x) => x.groupId === w.groupId && x.slotId === slotId && x.id !== w.id,
    );
    return instance?.id ?? "";
  }

  const otherSlots = $derived(
    linkWorkshop ? app.project.slots.filter((s) => s.id !== linkWorkshop!.slotId) : [],
  );

  // --- Sortierung der Workshopliste ----------------------------------
  type SortKey = "default" | "name" | "slot" | "min" | "max";
  let sortKey = $state<SortKey>("default");
  let sortAsc = $state(true);

  function toggleSort(key: Exclude<SortKey, "default">) {
    if (sortKey === key) {
      sortAsc = !sortAsc;
    } else {
      sortKey = key;
      sortAsc = true;
    }
  }

  function sortIcon(key: Exclude<SortKey, "default">): string {
    if (sortKey !== key) return "bi-arrow-down-up text-secondary";
    return sortAsc ? "bi-caret-up-fill" : "bi-caret-down-fill";
  }

  const sortedWorkshops = $derived.by(() => {
    const list = [...app.project.workshops];
    const key = sortKey;
    if (key === "default") return list;
    const dir = sortAsc ? 1 : -1;
    const slotOrder = new Map(app.project.slots.map((s, i) => [s.id, i]));
    return list.sort((a, b) => {
      let cmp: number;
      if (key === "name") cmp = a.name.localeCompare(b.name, "de");
      else if (key === "slot")
        cmp = (slotOrder.get(a.slotId) ?? 0) - (slotOrder.get(b.slotId) ?? 0);
      else cmp = a[key] - b[key];
      return cmp * dir || a.name.localeCompare(b.name, "de");
    });
  });

  // --- Workshop in anderen Slot klonen -------------------------------
  let cloneId = $state<string | null>(null);
  const cloneSource = $derived(app.project.workshops.find((w) => w.id === cloneId) ?? null);
  let cloneTarget = $state("");
  let cloneName = $state("");
  let cloneAsGroup = $state(true);

  function openClone(id: string) {
    const w = app.project.workshops.find((x) => x.id === id);
    if (!w) return;
    cloneId = id;
    cloneName = w.name;
    cloneAsGroup = true;
    cloneTarget = app.project.slots.find((s) => s.id !== w.slotId)?.id ?? "";
  }

  function applyClone() {
    if (!cloneSource || !cloneTarget.trim()) return;
    app.cloneWorkshop(cloneSource.id, cloneTarget, cloneName, cloneAsGroup);
    cloneId = null;
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
                    <th style="min-width: 12rem;">
                      <button
                        class="btn btn-sm btn-link p-0 text-decoration-none text-body fw-semibold"
                        onclick={() => toggleSort("name")}
                        aria-label="Nach Name sortieren"
                      >
                        Workshop <i class="bi {sortIcon('name')}"></i>
                      </button>
                    </th>
                    <th style="min-width: 10rem;">
                      <button
                        class="btn btn-sm btn-link p-0 text-decoration-none text-body fw-semibold"
                        onclick={() => toggleSort("slot")}
                        aria-label="Nach Slot sortieren"
                      >
                        Slot <i class="bi {sortIcon('slot')}"></i>
                      </button>
                    </th>
                    <th style="width: 6rem;">
                      <button
                        class="btn btn-sm btn-link p-0 text-decoration-none text-body fw-semibold"
                        onclick={() => toggleSort("min")}
                        aria-label="Nach Mindestbelegung sortieren"
                      >
                        min <i class="bi {sortIcon('min')}"></i>
                      </button>
                    </th>
                    <th style="width: 6rem;">
                      <button
                        class="btn btn-sm btn-link p-0 text-decoration-none text-body fw-semibold"
                        onclick={() => toggleSort("max")}
                        aria-label="Nach Höchstbelegung sortieren"
                      >
                        max <i class="bi {sortIcon('max')}"></i>
                      </button>
                    </th>
                    <th style="min-width: 9rem;">Verbindung</th>
                    <th style="width: 7rem;"></th>
                  </tr>
                </thead>
                <tbody>
                  {#each sortedWorkshops as w (w.id)}
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
                        <div class="d-flex gap-1 flex-wrap align-items-center">
                          {#if w.groupId && groupCount(w) > 1}
                            <span
                              class="badge text-bg-info"
                              title="Gleicher Workshop in mehreren Slots — jede Person erhält höchstens eine Instanz"
                            >
                              <i class="bi bi-layers me-1"></i>{groupCount(w)}× Instanz
                            </span>
                          {/if}
                          {#if w.pairedWith}
                            <span
                              class="badge text-bg-warning text-dark"
                              title="Gekoppelt — wird von jeder Person nur zusammen mit dem Partner besucht"
                            >
                              <i class="bi bi-link-45deg me-1"></i>{partnerName(w)}
                            </span>
                          {/if}
                          <button
                            class="btn btn-sm btn-outline-secondary"
                            title="Workshop verbinden / koppeln"
                            aria-label="Workshop {w.name} verbinden"
                            onclick={() => (linkWorkshopId = w.id)}
                          >
                            <i class="bi bi-link-45deg"></i>
                          </button>
                        </div>
                      </td>
                      <td>
                        <div class="d-flex gap-1">
                          <button
                            class="btn btn-sm btn-outline-secondary"
                            title="In anderen Slot klonen"
                            aria-label="Workshop {w.name} in anderen Slot klonen"
                            onclick={() => openClone(w.id)}
                          >
                            <i class="bi bi-copy"></i>
                          </button>
                          <button
                            class="btn btn-sm btn-outline-danger"
                            title="Workshop löschen"
                            onclick={() => removeWorkshopConfirm(w.id, w.name)}
                          >
                            <i class="bi bi-trash"></i>
                          </button>
                        </div>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
            <p class="small text-secondary mb-0">
              Zeilen rot markiert: min &gt; max. Badge „× Instanz“: derselbe Workshop in mehreren
              Slots (jede Person erhält ihn höchstens einmal). Ketten-Badge: gekoppelte Workshops,
              die nur zusammen besucht werden.
            </p>
          {/if}
        {/if}
      </div>
    </div>
  </div>
</div>

{#if linkWorkshop}
  {@const targets = app.project.workshops.filter(
    (t) => t.slotId !== linkWorkshop!.slotId && t.id !== linkWorkshop!.id,
  )}
  <div
    class="modal d-block"
    tabindex="-1"
    role="dialog"
    aria-modal="true"
    aria-label="Workshop verbinden"
  >
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">
            <i class="bi bi-link-45deg me-2"></i>Workshop „{linkWorkshop.name}“ verbinden
          </h5>
          <button
            type="button"
            class="btn-close"
            aria-label="Schließen"
            onclick={() => (linkWorkshopId = null)}
          ></button>
        </div>
        <div class="modal-body">
          <div class="mb-4">
            <div class="form-label fw-semibold">Gleicher Workshop — weitere Durchführungen</div>
            {#each otherSlots as slot (slot.id)}
              <label class="form-label small mb-1" for="link-group-{slot.id}">
                Instanz in „{slot.name}“
              </label>
              <select
                id="link-group-{slot.id}"
                class="form-select mb-2"
                value={groupInstanceInSlot(linkWorkshop, slot.id)}
                onchange={(e) =>
                  app.setGroupInstance(
                    linkWorkshop!.id,
                    slot.id,
                    (e.target as HTMLSelectElement).value || null,
                  )}
              >
                <option value="">— keine —</option>
                {#each workshopsInSlot(app.project, slot.id) as t (t.id)}
                  <option value={t.id}>{t.name}</option>
                {/each}
              </select>
            {/each}
            <div class="form-text">
              Verbindet Durchführungen desselben Workshops über Slots hinweg: Der Workshop „läuft
              mehrfach“, aber jede Person erhält ihn höchstens einmal. Pro Slot ist eine Instanz
              möglich — Wünsche auf eine Durchführung zählen für alle.
            </div>
          </div>
          <div>
            <label class="form-label fw-semibold" for="link-pair"
              >Gekoppelter Partner — immer zusammen</label
            >
            <select
              id="link-pair"
              class="form-select"
              value={linkWorkshop.pairedWith ?? ""}
              onchange={(e) =>
                app.pairWorkshops(linkWorkshop!.id, (e.target as HTMLSelectElement).value || null)}
            >
              <option value="">— kein Partner —</option>
              {#each targets as t (t.id)}
                <option value={t.id}>{t.name} ({slotNameOf(t.slotId)})</option>
              {/each}
            </select>
            <div class="form-text">
              Beide Workshops werden von jeder Person nur zusammen oder gar nicht besucht — für
              zweiteilige Workshops über zwei Slots (z. B. Teil 1 + Teil 2).
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" onclick={() => (linkWorkshopId = null)}>
            Fertig
          </button>
        </div>
      </div>
    </div>
  </div>
  <div class="modal-backdrop show"></div>
{/if}

{#if cloneSource}
  <div
    class="modal d-block"
    tabindex="-1"
    role="dialog"
    aria-modal="true"
    aria-label="Workshop klonen"
  >
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">
            <i class="bi bi-copy me-2"></i>Workshop „{cloneSource.name}“ klonen
          </h5>
          <button
            type="button"
            class="btn-close"
            aria-label="Schließen"
            onclick={() => (cloneId = null)}
          ></button>
        </div>
        <div class="modal-body">
          <div class="mb-3">
            <label class="form-label" for="clone-name">Name der neuen Durchführung</label>
            <input id="clone-name" class="form-control" bind:value={cloneName} />
          </div>
          <div class="mb-3">
            <label class="form-label" for="clone-slot">Ziel-Slot</label>
            <select id="clone-slot" class="form-select" bind:value={cloneTarget}>
              {#each app.project.slots as slot (slot.id)}
                {#if slot.id !== cloneSource!.slotId}
                  <option value={slot.id}>{slot.name}</option>
                {/if}
              {/each}
            </select>
          </div>
          <div class="form-check">
            <input
              class="form-check-input"
              type="checkbox"
              id="clone-as-group"
              bind:checked={cloneAsGroup}
            />
            <label class="form-check-label" for="clone-as-group">
              Als <strong>gleichen Workshop</strong> verbinden (eine Durchführung je Slot, jede Person
              erhält ihn höchstens einmal)
            </label>
          </div>
          <div class="form-text">
            Die Kopie übernimmt min/max ({cloneSource.min}/{cloneSource.max}) und kann anschließend
            im Verbinden-Dialog angepasst werden. Ohne Verbindung sollte der Name angepasst werden,
            damit der Import eindeutig bleibt.
          </div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" onclick={() => (cloneId = null)}>
            Abbrechen
          </button>
          <button
            type="button"
            class="btn btn-primary"
            disabled={!cloneName.trim() || !cloneTarget}
            onclick={applyClone}
          >
            <i class="bi bi-copy me-1"></i>Klonen
          </button>
        </div>
      </div>
    </div>
  </div>
  <div class="modal-backdrop show"></div>
{/if}
