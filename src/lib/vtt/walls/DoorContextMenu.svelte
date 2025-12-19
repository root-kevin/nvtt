<script>
  import { createEventDispatcher, onMount, onDestroy } from "svelte";
  import { DOOR_TYPES } from "$lib/vtt/walls/doorTypes.js";
  import { resolveDoorState } from "$lib/vtt/walls/model.js";

  export let door;
  export let x = 0;
  export let y = 0;

  const dispatch = createEventDispatcher();

  const isVertical =
    Math.abs(door.a.x - door.b.x) < Math.abs(door.a.y - door.b.y);

    // Local reactive snapshot so UI updates immediately
$: openPct =
  door?.door?.openPct ??
  (resolveDoorState(door?.door) === "OPEN" ? 100 : 0);

  function close() {
    dispatch("close");
  }

function toggleOpen() {
  dispatch("setOpenPct", {
    door,
    openPct: openPct > 0 ? 0 : 100
  });
}


  function setOpenPct(e) {
    const v = Number(e.target.value);
    dispatch("setOpenPct", {
      door,
      openPct: Math.max(0, Math.min(100, v))
    });
  }

  function setHinge(e) {
    dispatch("setHinge", { door, hinge: e.target.value });
  }

  function setSwing(e) {
    dispatch("setSwing", { door, swing: e.target.value });
  }

  function toggleLocked() {
    dispatch("toggleLocked", { door });
  }

  function toggleHidden() {
    dispatch("toggleHidden", { door });
  }

  function changeType(e) {
    dispatch("changeType", { door, type: e.target.value });
  }

  function toggleNoSwing() {
    dispatch("toggleNoSwing", { door });
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

  <!-- PRIMARY ACTION -->
  <button class="primary" on:click={toggleOpen}>
    {openPct > 0 ? "Close Door" : "Open Door"}
  </button>

  <!-- OPEN SLIDER -->
  <div class="section">
    <label class="lbl">Open</label>
    <div class="range-wrap">
      <input
  type="range"
  min="0"
  max="100"
  step="5"
  value={openPct}
  on:input={setOpenPct}
/>
<div class="range-val">{openPct}%</div>

    </div>
  </div>

  <div class="divider"></div>

  <!-- GEOMETRY -->
  <div class="section">
    <label class="lbl">Hinge</label>
    <select value={door.door.hinge ?? "a"} on:change={setHinge}>
      <option value="a">Endpoint A</option>
      <option value="b">Endpoint B</option>
      <option value="top">Top</option>
      <option value="bottom">Bottom</option>
      <option value="left">Left</option>
      <option value="right">Right</option>
    </select>

    <label class="lbl">Swing</label>
    <select value={door.door.swing ?? (isVertical ? "right" : "down")} on:change={setSwing}>
      {#if isVertical}
        <option value="left">Left</option>
        <option value="right">Right</option>
      {:else}
        <option value="up">Up</option>
        <option value="down">Down</option>
      {/if}
    </select>

    <label class="checkbox">
      <input type="checkbox" checked={!!door.door.noSwing} on:change={toggleNoSwing} />
      No Swing (disappears)
    </label>
  </div>

  <div class="divider"></div>

  <!-- SECURITY -->
  <div class="section">
    <button
      disabled={(openPct ?? 0) > 0}
      on:click={toggleLocked}
    >
      {door.door.locked ? "Unlock Door" : "Lock Door"}
    </button>

    <label class="checkbox">
      <input type="checkbox" checked={door.door.hidden} on:change={toggleHidden} />
      Hidden from Players
    </label>
  </div>

  <div class="divider"></div>

  <!-- TYPE -->
  <div class="section">
    <label class="lbl">Door Type</label>
    <select value={door.door.type} on:change={changeType}>
      {#each Object.keys(DOOR_TYPES) as k}
        <option value={k}>{DOOR_TYPES[k].label ?? k}</option>
      {/each}
    </select>
  </div>

  <!-- STATS -->
  <div class="stats">
    <div><strong>AC</strong> {door.door.ac}</div>
    <div><strong>HP</strong> {door.door.hp}</div>
  </div>
</div>

<style>
.door-menu {
  position: fixed;
  z-index: 1000;
  width: 240px;
  padding: 10px;
  background: linear-gradient(180deg, #1c2433, #121823);
  border: 1px solid rgba(200,170,100,0.35);
  border-radius: 10px;
  box-shadow: 0 20px 50px rgba(0,0,0,0.7);
  color: #e8dcc2;
  font-family: system-ui, serif;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.title {
  font-weight: 700;
  letter-spacing: 0.04em;
}

.close {
  background: none;
  border: none;
  color: #c8aa6e;
  cursor: pointer;
}

.primary {
  width: 100%;
  padding: 8px;
  margin-bottom: 8px;
  background: linear-gradient(180deg, #c8aa6e, #8b6d3a);
  border: none;
  border-radius: 6px;
  color: #1a1a1a;
  font-weight: 700;
  cursor: pointer;
}

.section {
  margin-bottom: 6px;
}

.lbl {
  font-size: 11px;
  opacity: 0.75;
  margin-bottom: 2px;
}

.range-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.range-wrap input[type="range"] {
  flex: 1;
  appearance: none;
  height: 4px;
  background: linear-gradient(to right, #c8aa6e, #8b6d3a);
  border-radius: 4px;
}

.range-wrap input[type="range"]::-webkit-slider-thumb {
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #e6d2a2;
  border: 1px solid #5a4625;
}

.range-val {
  width: 36px;
  text-align: right;
  font-size: 11px;
}

select, button:not(.primary) {
  width: 100%;
  padding: 6px;
  border-radius: 6px;
  background: #202a3d;
  border: 1px solid rgba(255,255,255,0.1);
  color: #e8dcc2;
}

.checkbox {
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 11px;
}

.divider {
  height: 1px;
  margin: 6px 0;
  background: linear-gradient(
    to right,
    transparent,
    rgba(200,170,100,0.25),
    transparent
  );
}

.stats {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  opacity: 0.85;
}
</style>
