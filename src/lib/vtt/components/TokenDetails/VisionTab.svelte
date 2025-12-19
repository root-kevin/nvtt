<script>
  export let token;
  export let pushUpdate;

  const DEFAULT_VISION = {
    enabled: true,
    distance: null,
    hasDarkvision: false,
    darkvisionDistance: null
  };

  let local = normalizeVision(token?.vision);
  let lastTokenId = null;

  function normalizeVision(raw = {}) {
    return {
      ...DEFAULT_VISION,
      ...raw,
      enabled: raw.enabled ?? raw.hasVision ?? true,
      distance: Number.isFinite(raw.distance) ? raw.distance : raw.distance ?? null,
      hasDarkvision: !!raw.hasDarkvision,
      darkvisionDistance: Number.isFinite(raw.darkvisionDistance)
        ? raw.darkvisionDistance
        : raw.darkvisionDistance ?? null
    };
  }

  $: if (token?.id && token.id !== lastTokenId) {
    local = normalizeVision(token?.vision);
    lastTokenId = token.id;
  }

  function toFeet(value) {
    if (value === "" || value == null) return null;
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return null;
    return num;
  }

  function updateLocal(patch) {
    local = { ...local, ...patch };
  }

  function saveVision(nextLocal = local) {
    if (!token) return;
    const nextVision = {
      ...(token.vision || {}),
      ...nextLocal,
      hasVision: nextLocal.enabled
    };
    pushUpdate({ vision: nextVision });
  }

  function handleToggle(patch) {
    updateLocal(patch);
    saveVision({ ...local, ...patch });
  }

  function handleDistanceInput(value) {
    updateLocal({ distance: toFeet(value) });
  }

  function handleDistanceSave() {
    saveVision();
  }

  function handleDarkvisionInput(value) {
    updateLocal({ darkvisionDistance: toFeet(value) });
  }

  function handleDarkvisionSave() {
    saveVision();
  }
</script>

<div class="vision-tab">
  <div class="card">
    <div class="card-title">Vision</div>
    <label class="toggle">
      <input
        type="checkbox"
        checked={local.enabled}
        on:change={(e) => handleToggle({ enabled: e.target.checked })}
      />
      <span class="toggle-track"></span>
      <span class="toggle-label">Enabled</span>
    </label>
    <div class="hint">
      Leave distance empty for no explicit limit (global lighting only).
    </div>
    <div class="field-row">
      <span class="field-label">Distance (ft)</span>
      <div class="field-control">
        <input
          type="range"
          min="0"
          max="300"
          step="5"
          value={Number.isFinite(local.distance) ? local.distance : 0}
          disabled={!local.enabled}
          on:input={(e) => handleDistanceInput(e.target.value)}
          on:change={handleDistanceSave}
        />
        <input
          class="number-input"
          type="number"
          min="0"
          step="5"
          value={Number.isFinite(local.distance) ? local.distance : ""}
          placeholder="Unlimited"
          disabled={!local.enabled}
          on:input={(e) => handleDistanceInput(e.target.value)}
          on:blur={handleDistanceSave}
        />
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-title">Darkvision</div>
    <label class="toggle">
      <input
        type="checkbox"
        checked={local.hasDarkvision}
        on:change={(e) => handleToggle({
          hasDarkvision: e.target.checked,
          darkvisionDistance: e.target.checked ? local.darkvisionDistance : null
        })}
      />
      <span class="toggle-track"></span>
      <span class="toggle-label">Darkvision</span>
    </label>
    <div class="hint">
      Darkvision applies when global lighting is off and no explicit distance is set.
    </div>
    <div class="field-row">
      <span class="field-label">Distance (ft)</span>
      <div class="field-control">
        <input
          type="range"
          min="0"
          max="300"
          step="5"
          value={Number.isFinite(local.darkvisionDistance) ? local.darkvisionDistance : 0}
          disabled={!local.hasDarkvision}
          on:input={(e) => handleDarkvisionInput(e.target.value)}
          on:change={handleDarkvisionSave}
        />
        <input
          class="number-input"
          type="number"
          min="0"
          step="5"
          value={Number.isFinite(local.darkvisionDistance) ? local.darkvisionDistance : ""}
          placeholder="Default"
          disabled={!local.hasDarkvision}
          on:input={(e) => handleDarkvisionInput(e.target.value)}
          on:blur={handleDarkvisionSave}
        />
      </div>
    </div>
  </div>
</div>

<style>
  .vision-tab {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
  }

  .toggle {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 0.95rem;
    color: #e4e9f7;
    position: relative;
    cursor: pointer;
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

  .hint {
    font-size: 0.82rem;
    color: #aab4c8;
    margin: 6px 0 2px;
  }

  .field-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 8px;
  }

  .field-label {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #d1c184;
  }

  .field-control {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  input[type="range"] {
    width: 180px;
  }

  .number-input {
    width: 90px;
    padding: 6px;
    background: #202a3d;
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #e8dcc2;
    border-radius: 6px;
  }
</style>
