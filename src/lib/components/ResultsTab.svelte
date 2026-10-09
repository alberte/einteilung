<script lang="ts">
  import { app } from "../state.svelte";
  import { downloadFile, resultCsv } from "../io/export";
  import { validateProject } from "../validation";
  import { groupByPersonSlot, groupByWorkshop } from "../resultView";

  const validation = $derived(validateProject(app.project));
  const result = $derived(app.result);

  const optimal = $derived(result?.status === "optimal" ? result : null);

  /** personId -> slotId -> Assignment */
  const byPersonSlot = $derived(groupByPersonSlot(app.project, optimal?.assignments ?? []));

  /** workshopId -> Assignment[] */
  const byWorkshop = $derived(groupByWorkshop(optimal?.assignments ?? []));

  const personName = (id: string) => app.project.persons.find((p) => p.id === id)?.name ?? id;
  const workshopName = (id: string) => app.project.workshops.find((w) => w.id === id)?.name ?? id;

  const maxRankCount = $derived(
    optimal ? Math.max(1, ...Object.values(optimal.stats.rankDistribution)) : 1,
  );

  function exportCsv() {
    if (!optimal) return;
    const date = new Date().toISOString().slice(0, 10);
    downloadFile(`workshop-belegung-${date}.csv`, resultCsv(app.project, optimal), "text/csv");
  }

  const countBadgeClass = (count: number, min: number, max: number) =>
    count < min ? "text-bg-warning" : count > max ? "text-bg-danger" : "text-bg-success";
</script>

{#if !result}
  <div class="alert alert-info d-flex align-items-center justify-content-between flex-wrap gap-2">
    <div>
      <i class="bi bi-info-circle me-2"></i>
      Noch kein Ergebnis. Berechnung starten, um die Belegung zu bestimmen.
    </div>
    <div>
      {#if validation.errors.length}
        <button class="btn btn-primary" disabled title="Bitte erst Konfigurationsfehler beheben">
          Belegung berechnen
        </button>
      {:else}
        <button class="btn btn-primary" onclick={() => app.solve()}>
          <i class="bi bi-calculator me-1"></i>Belegung berechnen
        </button>
      {/if}
    </div>
  </div>
  {#if validation.errors.length}
    <div class="alert alert-danger">
      <ul class="mb-0">
        {#each validation.errors as err, i (i)}
          <li>{err}</li>
        {/each}
      </ul>
    </div>
  {/if}
{:else if result.status === "infeasible"}
  <div class="alert alert-danger">
    <h5><i class="bi bi-x-octagon me-2"></i>Keine gültige Belegung möglich</h5>
    <p class="mb-1">Der Solver hat folgende Ursachen gefunden:</p>
    <ul class="mb-0">
      {#each result.reasons as reason, i (i)}
        <li>{reason}</li>
      {/each}
    </ul>
    <hr />
    <p class="mb-0 small">
      Tipp: Mindestbelegungen reduzieren, Höchstbelegungen erhöhen oder n (Workshops pro Person) im
      Tab „Konfiguration“ anpassen.
    </p>
  </div>
{:else if result.status === "timeout"}
  <div class="alert alert-warning">
    <h5><i class="bi bi-hourglass-split me-2"></i>Zeitlimit überschritten</h5>
    <p class="mb-0">
      Keine bestätigt optimale Lösung innerhalb von {app.project.config.timeLimitSec} s. Zeitlimit erhöhen
      oder die Instanz verkleinern (weniger Teilnehmer/Workshops).
    </p>
  </div>
{:else if result.status === "error"}
  <div class="alert alert-danger">
    <h5><i class="bi bi-bug me-2"></i>Interner Fehler</h5>
    <p class="mb-0">{result.message}</p>
  </div>
{:else}
  {@const stats = result.stats}
  <div class="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
    <div class="d-flex flex-wrap gap-3">
      <div class="card">
        <div class="card-body py-2 px-3">
          <div class="text-secondary small">Zuweisungen</div>
          <div class="fs-4">{stats.totalAssignments}</div>
        </div>
      </div>
      <div class="card">
        <div class="card-body py-2 px-3">
          <div class="text-secondary small">aus Wünschen</div>
          <div class="fs-4 text-success">{stats.fromWishes}</div>
        </div>
      </div>
      <div class="card">
        <div class="card-body py-2 px-3">
          <div class="text-secondary small">
            ohne Wunsch <i class="bi bi-info-circle" title="Rot markierte Zuweisungen"></i>
          </div>
          <div class="fs-4 {stats.nonWish ? 'text-danger' : ''}">{stats.nonWish}</div>
        </div>
      </div>
      <div class="card">
        <div class="card-body py-2 px-3">
          <div class="text-secondary small">Ø Wunsch-Rang</div>
          <div class="fs-4">
            {stats.avgWishRank === null ? "–" : stats.avgWishRank.toFixed(2)}
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-body py-2 px-3">
          <div class="text-secondary small">Rechenzeit</div>
          <div class="fs-4">{(stats.solveMs / 1000).toFixed(1)} s</div>
        </div>
      </div>
    </div>
    <div class="d-flex flex-column gap-2">
      <button class="btn btn-success" onclick={exportCsv}>
        <i class="bi bi-filetype-csv me-1"></i>Ergebnis als CSV exportieren
      </button>
      <button
        class="btn btn-outline-secondary btn-sm"
        onclick={() => app.solve()}
        disabled={app.solving}
      >
        <i class="bi bi-arrow-repeat me-1"></i>Neu berechnen
      </button>
    </div>
  </div>

  <div class="mb-3">
    <h6 class="text-secondary mb-2">Verteilung der erfüllten Wunsch-Ränge</h6>
    <div class="d-flex flex-wrap gap-3 align-items-end">
      {#each Object.entries(stats.rankDistribution).sort((a, b) => Number(a[0]) - Number(b[0])) as [rank, count] (rank)}
        <div class="text-center" style="min-width: 5rem;">
          <div class="small text-secondary">{count}×</div>
          <div class="progress" style="height: 1.25rem;">
            <div
              class="progress-bar {Number(rank) === 1
                ? 'bg-success'
                : Number(rank) <= 2
                  ? 'bg-primary'
                  : 'bg-secondary'}"
              style="width: {Math.round((count / maxRankCount) * 100)}%"
            ></div>
          </div>
          <div class="small">Rang {rank}</div>
        </div>
      {/each}
      {#if stats.nonWish > 0}
        <div class="text-center" style="min-width: 5rem;">
          <div class="small text-secondary">{stats.nonWish}×</div>
          <div class="progress" style="height: 1.25rem;">
            <div class="progress-bar bg-danger" style="width: 100%"></div>
          </div>
          <div class="small from-no-wish">kein Wunsch</div>
        </div>
      {/if}
    </div>
  </div>

  <h5 class="mt-4"><i class="bi bi-grid-3x3-gap me-2"></i>Workshops</h5>
  {#each app.project.slots as slot (slot.id)}
    <div class="mb-3">
      <h6 class="text-secondary">{slot.name}</h6>
      <div class="slot-row">
        {#each app.project.workshops.filter((w) => w.slotId === slot.id) as w (w.id)}
          {@const count = stats.workshopCounts[w.id] ?? 0}
          <div
            class="card workshop-card {count < w.min ? 'workshop-count-low' : 'workshop-count-ok'}"
          >
            <div class="card-header py-2 d-flex justify-content-between align-items-center">
              <strong>{w.name}</strong>
              <span class="badge {countBadgeClass(count, w.min, w.max)}"
                >{count} / min {w.min} / max {w.max}</span
              >
            </div>
            {#if count > 0}
              <ul class="list-group list-group-flush">
                {#each byWorkshop.get(w.id) ?? [] as a (a.personId)}
                  <li class="list-group-item py-1 small {a.fromWish ? '' : 'from-no-wish'}">
                    {personName(a.personId)}
                    {#if a.fromWish && a.rank !== null}
                      <span class="badge text-bg-light border ms-1">Rang {a.rank}</span>
                    {:else}
                      <span class="badge text-bg-danger-subtle text-danger border ms-1"
                        >kein Wunsch</span
                      >
                    {/if}
                  </li>
                {/each}
              </ul>
            {:else}
              <div class="card-body py-2 text-secondary small">Keine Zuweisungen.</div>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/each}

  <h5 class="mt-4"><i class="bi bi-people me-2"></i>Personen</h5>
  <div class="table-responsive border rounded">
    <table class="table table-sm table-striped mb-0 align-middle">
      <thead>
        <tr>
          <th>Person</th>
          {#each app.project.slots as slot (slot.id)}
            <th>{slot.name}</th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each app.project.persons as person (person.id)}
          <tr>
            <td>{person.name}</td>
            {#each app.project.slots as slot (slot.id)}
              {@const a = byPersonSlot.get(person.id)?.get(slot.id)}
              <td>
                {#if a}
                  <span class={a.fromWish ? "" : "from-no-wish"}>
                    {workshopName(a.workshopId)}
                    {#if a.fromWish && a.rank !== null}
                      <span class="badge text-bg-light border ms-1">Rang {a.rank}</span>
                    {:else}
                      <i class="bi bi-exclamation-circle ms-1" title="kein Wunsch"></i>
                    {/if}
                  </span>
                {:else}
                  <span class="text-secondary">–</span>
                {/if}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}
