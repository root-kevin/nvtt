<script>
  import { createEventDispatcher } from "svelte";
  import { upsertMap } from "$lib/vtt/map/store.js";
  import { sendWS } from "$lib/ws.js";
  import AutoSaveModal from "$lib/vtt/components/AutoSaveModal.svelte";
  import "$lib/vtt/styles/sheet.css";

  export let open = false;
  export let map = null;
  export let locations = [];

  const dispatch = createEventDispatcher();

  $: locationOptions = Array.from(new Set((locations || []).filter(Boolean)));

  function persist(next) {
    if (!next?.id) return;
    upsertMap(next);
    if (typeof fetch !== "undefined") {
      const payload = {
        ...next
      };
      delete payload.fogPng;
      delete payload.tokens;

      fetch("/api/maps", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).catch(() => {});
    }
    const { tokens, ...mapNoTokens } = next || {};
    sendWS({ type: "map-set", map: mapNoTokens });
  }

  function handleSave(updated) {
    if (!updated) return;
    persist(updated);
  }
</script>

<AutoSaveModal
  {open}
  title="Map Settings"
  width={560}
  value={map}
  onSave={handleSave}
  on:close={() => dispatch("close")}
  let:local
  let:setLocal
  let:handleToggle
  let:handleTextBlur
>
  {#if local}
    <div class="settings-grid">
      <div class="card">
        <div class="card-title">Overview</div>
        <div class="field">
          <label>Map Name</label>
          <input
            type="text"
            value={local.name ?? ""}
            placeholder="Court of the Count"
            on:input={(e) => setLocal({ ...local, name: e.target.value })}
            on:blur={handleTextBlur}
          />
        </div>
        <div class="field">
          <label>Location</label>
          <input
            list="map-locations"
            value={local.location ?? ""}
            placeholder="Ravenloft"
            on:input={(e) => setLocal({ ...local, location: e.target.value })}
            on:blur={handleTextBlur}
          />
          <datalist id="map-locations">
            {#each locationOptions as loc}
              <option value={loc} />
            {/each}
          </datalist>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Lighting</div>
        <label class="toggle">
          <input
            type="checkbox"
            checked={local.lighting?.global ?? true}
            on:change={(e) => {
              setLocal({
                ...local,
                lighting: {
                  ...(local.lighting || {}),
                  global: e.target.checked
                }
              });
              handleToggle();
            }}
          />
          <span class="toggle-track"></span>
          <span class="toggle-label">Global Lighting</span>
        </label>
        <div class="future-row" aria-disabled="true">
          <span class="future-label">Ambient Light</span>
          <span class="future-value">Coming soon</span>
        </div>
        <div class="future-row" aria-disabled="true">
          <span class="future-label">Soundscape</span>
          <span class="future-value">Coming soon</span>
        </div>
      </div>

      <div class="card">
        <div class="card-title">View</div>
        <label class="toggle">
          <input
            type="checkbox"
            checked={local.showWalls ?? true}
            on:change={(e) => {
              setLocal({
                ...local,
                showWalls: e.target.checked
              });
              handleToggle();
            }}
          />
          <span class="toggle-track"></span>
          <span class="toggle-label">Show Walls (GM only)</span>
        </label>
        <label class="toggle">
          <input
            type="checkbox"
            checked={local.segmentedWalls ?? false}
            on:change={(e) => {
              setLocal({
                ...local,
                segmentedWalls: e.target.checked
              });
              handleToggle();
            }}
          />
          <span class="toggle-track"></span>
          <span class="toggle-label">Segmented Walls</span>
        </label>
        {#if local.segmentedWalls}
          <div class="field">
            <label>Segment Length Mode</label>
            <select
              value={local.segmentLengthMode ?? "GRID"}
              on:change={(e) => {
                setLocal({
                  ...local,
                  segmentLengthMode: e.target.value,
                  segmentLengthPx: local.segmentLengthPx ?? local.gridSizePx ?? 64
                });
                handleToggle();
              }}
            >
              <option value="GRID">Grid Size</option>
              <option value="FIXED_PX">Fixed Pixels</option>
            </select>
          </div>
          {#if (local.segmentLengthMode ?? "GRID") === "FIXED_PX"}
            <div class="field">
              <label>Segment Length (px)</label>
              <input
                type="number"
                min="4"
                step="1"
                value={local.segmentLengthPx ?? local.gridSizePx ?? 64}
                on:input={(e) =>
                  setLocal({
                    ...local,
                    segmentLengthPx: Number(e.target.value) || 0
                  })}
                on:blur={handleTextBlur}
              />
            </div>
          {/if}
        {/if}
        <label class="toggle">
          <input
            type="checkbox"
            checked={local.showPlayerVisionToGM ?? true}
            on:change={(e) => {
              setLocal({
                ...local,
                showPlayerVisionToGM: e.target.checked
              });
              handleToggle();
            }}
          />
          <span class="toggle-track"></span>
          <span class="toggle-label">Show Player Vision to GM</span>
        </label>
        <label class="toggle">
          <input
            type="checkbox"
            checked={local.collisionDebug ?? false}
            on:change={(e) => {
              setLocal({
                ...local,
                collisionDebug: e.target.checked
              });
              handleToggle();
            }}
          />
          <span class="toggle-track"></span>
          <span class="toggle-label">Collision Debug Overlay</span>
        </label>
        <label class="toggle">
          <input
            type="checkbox"
            checked={local.interactionDebug ?? false}
            on:change={(e) => {
              setLocal({
                ...local,
                interactionDebug: e.target.checked
              });
              handleToggle();
            }}
          />
          <span class="toggle-track"></span>
          <span class="toggle-label">Token Interaction Debug Layer</span>
        </label>

        <div class="field slider-field">
          <label>Token Move Animation</label>
          <input
            class="range"
            type="range"
            min="100"
            max="600"
            step="10"
            value={local.tokenMoveAnimationMs ?? 280}
            on:input={(e) =>
              setLocal({
                ...local,
                tokenMoveAnimationMs: Number(e.target.value) || 280
              })}
            on:change={handleToggle}
            on:pointerup={handleToggle}
          />
          <div class="range-value">{local.tokenMoveAnimationMs ?? 280} ms</div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Map Data</div>
        <div class="stat-row">
          <span class="label">Dimensions</span>
          <span class="value">{local.width ?? 0} × {local.height ?? 0}</span>
        </div>
        <div class="stat-row">
          <span class="label">Grid Size</span>
          <span class="value">{local.gridSizePx ?? 64} px</span>
        </div>
      </div>
    </div>
  {:else}
    <div class="empty">No active map selected.</div>
  {/if}
</AutoSaveModal>

<style>
  .settings-grid {
    display: grid;
    gap: 28px;
    padding: 28px;
    background: linear-gradient(
      to bottom,
      rgba(8, 11, 18, 0.95),
      rgba(6, 9, 14, 0.95)
    );
  }

  .settings-grid .card {
    padding: 24px;
    border-radius: 16px;
    background: linear-gradient(
      to bottom,
      rgba(18, 22, 34, 0.95),
      rgba(12, 16, 26, 0.95)
    );
    box-shadow:
      inset 0 1px 0 rgba(255,255,255,0.03),
      0 6px 18px rgba(0,0,0,0.45);
  }

  .settings-grid .card-title {
    margin-bottom: 18px;
    font-size: 0.78rem;
    letter-spacing: 0.14em;
    color: #e7d9a8;
    border-bottom: 1px solid rgba(231,217,168,0.15);
    padding-bottom: 10px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-bottom: 18px;
  }

  .field label {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: #d1c184;
  }

  .field input {
    padding: 10px 12px;
    border-radius: 10px;
    border: 1px solid #2a3243;
    background: #0b0f18;
    color: #f7f9fc;
    font-size: 0.95rem;
  }

  .field:last-child {
    margin-bottom: 0;
  }

  .slider-field {
    margin-top: 4px;
    margin-bottom: 20px;
    padding-top: 8px;
  }

  .slider-field label {
    font-size: 0.75rem;
  }

  .field .range {
    padding: 0;
    margin-top: 6px;
  }

  .range-value {
    margin-top: 8px;
    font-size: 1rem;
    color: #f1e6c4;
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  .toggle {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 0.95rem;
    color: #e4e9f7;
    position: relative;
    cursor: pointer;
    margin-bottom: 16px;
  }

  .toggle input {
    position: absolute;
    width: 44px;
    height: 24px;
    opacity: 0;
    margin: 0;
    cursor: pointer;
    left: 0;
    top: 0;
  }

  .toggle-track {
    width: 44px;
    height: 24px;
    border-radius: 999px;
    background: #232a38;
    border: 1px solid #3a4252;
    position: relative;
    transition: 120ms ease;
    pointer-events: none;
  }

  .toggle-track::after {
    content: "";
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #cfd5e3;
    position: absolute;
    left: 3px;
    top: 2px;
    transition: 120ms ease;
  }

  .toggle input:checked + .toggle-track {
    background: linear-gradient(to bottom, #d8b874, #b98f4b);
    border-color: rgba(255,255,255,0.6);
  }

  .toggle input:checked + .toggle-track::after {
    left: 22px;
    background: #1c140a;
  }

  .toggle-label {
    font-weight: 600;
  }

  .stat-row {
    display: flex;
    justify-content: space-between;
    font-size: 0.9rem;
    padding: 6px 0;
    color: #c9d1e6;
  }

  .stat-row .value {
    color: #f1e6c4;
    font-weight: 600;
  }

  .future-row {
    display: flex;
    justify-content: space-between;
    margin-top: 10px;
    padding: 8px 10px;
    border-radius: 10px;
    border: 1px solid #232a38;
    background: rgba(6, 8, 14, 0.7);
    color: #9aa6bf;
    font-size: 0.9rem;
  }

  .future-label {
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 0.72rem;
    color: #8f98ad;
  }

  .future-value {
    color: #b1b9cc;
    font-weight: 600;
  }

  .empty {
    color: #aab4c8;
    font-size: 0.9rem;
  }
</style>
