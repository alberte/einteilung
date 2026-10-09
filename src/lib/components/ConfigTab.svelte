<script lang="ts">
  import { app } from "../state.svelte";
  import { validateProject } from "../validation";

  const validation = $derived(validateProject(app.project));
  const slotCount = $derived(app.project.slots.length);

  const profileHint = $derived(
    app.project.config.penaltyProfile === "linear"
      ? "Linear („Effizient“): Rang r kostet r — minimiert die Summe aller Ränge."
      : "Quadratisch („Fair“): Rang r kostet r² — hohe Ränge werden überproportional bestraft, Erstwünsche verteilen sich gleichmäßiger.",
  );
</script>

<div class="row g-4">
  <div class="col-lg-6">
    <div class="card h-100">
      <div class="card-header"><i class="bi bi-sliders me-2"></i>Konfiguration</div>
      <div class="card-body">
        <div class="mb-3">
          <label class="form-label" for="cfg-n">Workshops pro Person (n)</label>
          <input
            id="cfg-n"
            class="form-control"
            type="number"
            min="1"
            max={Math.max(1, slotCount)}
            bind:value={app.project.config.n}
          />
          <div class="form-text">
            Jede Person erhält n Workshops — höchstens einen pro Slot (aktuell {slotCount} Slots).
          </div>
        </div>

        <fieldset class="mb-3">
          <legend class="form-label fs-6">Straf-Profil für Wunsch-Ränge</legend>
          <div class="form-check">
            <input
              class="form-check-input"
              type="radio"
              id="profile-linear"
              value="linear"
              bind:group={app.project.config.penaltyProfile}
            />
            <label class="form-check-label" for="profile-linear">Effizient (linear)</label>
          </div>
          <div class="form-check">
            <input
              class="form-check-input"
              type="radio"
              id="profile-fair"
              value="fair"
              bind:group={app.project.config.penaltyProfile}
            />
            <label class="form-check-label" for="profile-fair">Fair (quadratisch)</label>
          </div>
          <div class="form-text">{profileHint}</div>
        </fieldset>

        <div class="mb-3">
          <label class="form-label" for="cfg-limit">Solver-Zeitlimit (Sekunden)</label>
          <input
            id="cfg-limit"
            class="form-control"
            type="number"
            min="5"
            max="600"
            bind:value={app.project.config.timeLimitSec}
          />
          <div class="form-text">
            Bei Überschreitung bricht die Berechnung ab und meldet „Zeitlimit überschritten“ — die
            App friert nicht ein (Solver läuft in einem Web Worker).
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="col-lg-6">
    <div class="card h-100">
      <div class="card-header"><i class="bi bi-play-circle me-2"></i>Berechnung starten</div>
      <div class="card-body">
        {#if validation.errors.length}
          <div class="alert alert-danger">
            <strong>Vor dem Lösen bitte beheben:</strong>
            <ul class="mb-0">
              {#each validation.errors as err, i (i)}
                <li>{err}</li>
              {/each}
            </ul>
          </div>
        {/if}
        {#if validation.warnings.length}
          <div class="alert alert-warning">
            {#each validation.warnings as w, i (i)}
              <div>{w}</div>
            {/each}
          </div>
        {/if}

        <p class="text-secondary">
          {app.project.persons.length} Teilnehmer × {app.project.config.n} Workshops ({app.project
            .workshops.length} Workshops in {slotCount} Slots).
        </p>

        <button
          class="btn btn-primary btn-lg"
          disabled={validation.errors.length > 0 || app.solving}
          onclick={() => app.solve()}
        >
          <i class="bi bi-calculator me-2"></i>Belegung berechnen
        </button>
      </div>
    </div>
  </div>
</div>
