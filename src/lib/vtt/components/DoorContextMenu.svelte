<script>
  import { createEventDispatcher, onMount, onDestroy } from "svelte";
  import { DOOR_TYPES } from "$lib/vtt/walls/doorTypes.js";

  export let door;
  export let x = 0;
  export let y = 0;
let localHidden = false;
let lastDoorId = null;
  $: d = door?.door;

$: if ((door?.id ?? null) !== lastDoorId) {
  lastDoorId = door?.id ?? null;
  localHidden = !!door?.door?.hidden;
}

  const dispatch = createEventDispatcher();

  $: isVertical =
  !!door &&
  Math.abs(door.a.x - door.b.x) < Math.abs(door.a.y - door.b.y);


  function close() {
    dispatch("close");
  }
function toggleHidden() {
  localHidden = !localHidden;

  dispatch("toggleHidden", { door });
}

  function setHinge(e) {
    dispatch("setHinge", { door, hinge: e.target.value });
  }

  function setSwing(e) {
    dispatch("setSwing", { door, swing: e.target.value });
  }

  function stop(e) {
    e.stopPropagation();
  }

  let outsideHandler;
  onMount(() => {
    outsideHandler = (e) => {
      if (e.target?.closest?.(".door-menu")) return;
      close();
    };
    setTimeout(() => {
      window.addEventListener("pointerdown", outsideHandler, true);
    });
  });

  onDestroy(() => {
    window.removeEventListener("pointerdown", outsideHandler, true);
  });
</script>

{#if door}
  <div
    class="door-menu"
    style={`left:${x}px; top:${y}px;`}
    on:pointerdown={stop}
>
  <!-- HEADER -->
  <div class="header">
    <div class="title">Door</div>
    <button class="close" on:click={close}>✕</button>
  </div>

  <!-- PRIMARY ACTIONS -->
  <!-- GEOMETRY -->
  <div class="section">
    <div class="section-title">Hinge & Swing</div>

    <div class="row">
      <label>Hinge</label>
      <select value={d.hinge ?? "a"} on:change={setHinge}>
        <option value="a">Endpoint A</option>
        <option value="b">Endpoint B</option>
        <option value="top">Top</option>
        <option value="bottom">Bottom</option>
        <option value="left">Left</option>
        <option value="right">Right</option>
      </select>
    </div>

    <div class="row">
      <label>Swing</label>
      <select value={d.swing ?? (isVertical ? "right" : "down")} on:change={setSwing}>
        {#if isVertical}
          <option value="left">Left</option>
          <option value="right">Right</option>
        {:else}
          <option value="up">Up</option>
          <option value="down">Down</option>
        {/if}
      </select>
    </div>
  </div>
  <div class="divider"></div>

  <!-- DOOR TYPE -->
  <div class="section">
    <div class="section-title">Door Type</div>

    <div class="row">
      <label>Material</label>
      <select
        value={d.type}
        on:change={(e) =>
          dispatch("changeType", {
            door,
            type: e.target.value
          })
        }
      >
        {#each Object.entries(DOOR_TYPES) as [key, def]}
          <option value={key}>
            {def.label}
          </option>
        {/each}
      </select>
    </div>
  </div>

  <div class="divider"></div>

<div class="section">
  <div class="row">
    <label>Hidden from Players</label>
    <input
      type="checkbox"
      checked={localHidden}
      on:change={toggleHidden}
    />
  </div>
</div>
<div class="divider"></div>

  <!-- META -->
  <div class="meta">
    <div>AC {d.ac}</div>
    <div>HP {d.hp}</div>
  </div>
</div>
{/if}

<style>
.door-menu {
  position: fixed;
  z-index: 1000;
  width: 260px;
  padding: 12px;
  background: radial-gradient(
    120% 120% at 50% 0%,
    #2a2f3a,
    #141820
  );
  border: 1px solid rgba(200,170,100,0.35);
  border-radius: 12px;
  box-shadow: 0 30px 80px rgba(0,0,0,0.8);
  color: #e8dcc2;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.title {
  font-weight: 700;
  letter-spacing: 0.06em;
}

.close {
  background: none;
  border: none;
  color: #c8aa6e;
  cursor: pointer;
}

.action {
  width: 100%;
  padding: 10px;
  margin-bottom: 10px;
  background: linear-gradient(180deg, #d6bb7c, #8b6d3a);
  border: none;
  border-radius: 8px;
  color: #1b1b1b;
  font-weight: 800;
  letter-spacing: 0.04em;
}

.section {
  margin-bottom: 8px;
}

.section-title {
  font-size: 11px;
  opacity: 0.7;
  margin-bottom: 4px;
  text-transform: uppercase;
}

.slider-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.slider-row input[type="range"] {
  flex: 1;
  appearance: none;
  height: 4px;
  background: linear-gradient(to right, #c8aa6e, #8b6d3a);
  border-radius: 4px;
}

.slider-row input[type="range"]::-webkit-slider-thumb {
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #f0e2b6;
  border: 1px solid #5a4625;
}

.pct {
  width: 36px;
  text-align: right;
  font-size: 11px;
}

.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.row label {
  font-size: 11px;
  opacity: 0.75;
}

select {
  flex: 1;
  background: #1d2430;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 6px;
  padding: 6px;
  color: #e8dcc2;
}

.divider {
  height: 1px;
  margin: 8px 0;
  background: linear-gradient(
    to right,
    transparent,
    rgba(200,170,100,0.25),
    transparent
  );
}

.meta {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  opacity: 0.8;
}
input[type="checkbox"] {
  width: 14px;
  height: 14px;
  accent-color: #c8aa6e;
  cursor: pointer;
}
.action-row {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}

.action {
  flex: 1;
  padding: 10px;
  background: linear-gradient(180deg, #d6bb7c, #8b6d3a);
  border: none;
  border-radius: 8px;
  color: #1b1b1b;
  font-weight: 800;
  letter-spacing: 0.04em;
  cursor: pointer;
}

.action.secondary {
  background: linear-gradient(180deg, #3a3f4b, #1d2028);
  color: #e8dcc2;
  border: 1px solid rgba(200,170,100,0.25);
}

.action:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
button.danger {
  width: 100%;
  padding: 8px;
  background: linear-gradient(180deg, #6e1f1f, #3a0f0f);
  border: 1px solid rgba(220, 80, 80, 0.6);
  border-radius: 8px;
  color: #f5d0d0;
  font-weight: 700;
  letter-spacing: 0.04em;
  cursor: pointer;
}

button.danger:hover {
  background: linear-gradient(180deg, #8a2a2a, #4a1414);
}

</style>
