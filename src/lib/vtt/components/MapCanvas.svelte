<script>
  import { onMount, onDestroy } from "svelte";
  import { browser } from "$app/environment";

  import { pan, zoom, setupPanZoom } from "$lib/vtt/panzoom/store.js";
  import { currentMap, setCurrentMap, upsertMap } from "$lib/vtt/map/store.js";
  import { sendWS } from "$lib/ws.js";
    import VisionDebugOverlay from "$lib/vtt/components/VisionDebugOverlay.svelte";


  export let isGM = false;
  export let showGrid = false;
  export let measureMode = false;
  export let activeTool = "select";

  let container;
  let img;

  let unsubPan;
  let unsubZoom;

  let panVal = { x: 0, y: 0 };
  let zoomVal = 1;

  let lastPan = { x: 0, y: 0 };
  let lastZoom = 1;

  let suppressSave = true;
  let suppressTimer = null;
  let saveTimer = null;

  let viewRestoredFor = null;
  let userInteracted = false;

  const SAVE_DEBOUNCE = 350;

  /* ----------------------------------
     Helpers
  ---------------------------------- */

  function suppressSaves() {
    suppressSave = true;
    clearTimeout(suppressTimer);
    suppressTimer = setTimeout(() => {
      suppressSave = false;
    }, SAVE_DEBOUNCE);
  }

  function scheduleViewSave(p, z) {
    if (!browser || suppressSave || !$currentMap?.id) return;

    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const payload = {
        ...$currentMap,
        view: {
          pan: { x: p.x || 0, y: p.y || 0 },
          zoom: z || 1
        }
      };
      delete payload.fogPng;
      delete payload.tokens;

      fetch("/api/maps", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).catch(() => {});
    }, SAVE_DEBOUNCE);
  }

  function preventSpaceScroll(e) {
    if (e.code !== "Space") return;

    const tag = e.target?.tagName?.toLowerCase();
    if (
      tag !== "input" &&
      tag !== "textarea" &&
      tag !== "select" &&
      !e.target?.isContentEditable
    ) {
      e.preventDefault();
    }
  }

  function markInteraction() {
    userInteracted = true;
  }

  function applyToolInteractionState() {
    if (!browser || !container) return;

    const disableForWalls = isGM && activeTool === "wall";
    container.style.pointerEvents = disableForWalls ? "none" : "";
    container.style.touchAction = disableForWalls ? "none" : "";
  }

  /* ----------------------------------
     Lifecycle
  ---------------------------------- */

  onMount(() => {
    if (!browser) return;

    suppressSaves();

    setupPanZoom(container);

    unsubPan = pan.subscribe(v => {
      lastPan = v || { x: 0, y: 0 };
      scheduleViewSave(lastPan, lastZoom);
    });

    unsubZoom = zoom.subscribe(v => {
      lastZoom = Number.isFinite(v) ? v : 1;
      scheduleViewSave(lastPan, lastZoom);
    });

    window.addEventListener("keydown", preventSpaceScroll, { passive: false });
    container?.addEventListener("pointerdown", markInteraction, { passive: true });

    applyToolInteractionState();
  });

  onDestroy(() => {
    if (!browser) return;

    window.removeEventListener("keydown", preventSpaceScroll);
    container?.removeEventListener("pointerdown", markInteraction);

    unsubPan?.();
    unsubZoom?.();
    clearTimeout(suppressTimer);
    clearTimeout(saveTimer);
  });

  /* ----------------------------------
     Reactivity (Browser-Safe)
  ---------------------------------- */

  $: if (browser && container) {
    applyToolInteractionState();
  }

  // Sync image → map dimensions
  $: if (browser && img?.naturalWidth && img?.naturalHeight && $currentMap) {
    if (
      $currentMap.width !== img.naturalWidth ||
      $currentMap.height !== img.naturalHeight
    ) {
      const updated = {
        ...$currentMap,
        width: img.naturalWidth,
        height: img.naturalHeight,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight
      };

      const payload = { ...updated };
      delete payload.tokens;
      upsertMap(payload);
      setCurrentMap(payload);

      fetch("/api/maps", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).catch(() => {});

      sendWS({ type: "map-set", map: payload });
    }
  }

  // Restore saved view once per map
  $: if (
    browser &&
    $currentMap?.id &&
    container &&
    $currentMap?.view &&
    viewRestoredFor !== $currentMap.id
  ) {
    const rect = container.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      suppressSaves();

      pan.set({
        x: Number($currentMap.view.pan?.x) || 0,
        y: Number($currentMap.view.pan?.y) || 0
      });
      zoom.set(Number($currentMap.view.zoom) || 1);

      viewRestoredFor = $currentMap.id;
    }
  }

  // Fit fallback (first load only)
  $: if (
    browser &&
    $currentMap?.id &&
    container &&
    !viewRestoredFor &&
    !userInteracted
  ) {
    const rect = container.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      const fit = Math.min(
        rect.width / $currentMap.width,
        rect.height / $currentMap.height
      );
      const z = Math.max(0.1, Math.min(1, fit));

      suppressSaves();
      pan.set({
        x: (rect.width - $currentMap.width * z) / 2,
        y: (rect.height - $currentMap.height * z) / 2
      });
      zoom.set(z);
    }
  }

  $: panVal = $pan || { x: 0, y: 0 };
  $: zoomVal = Number.isFinite($zoom) ? $zoom : 1;
</script>

<div class={`map-container ${measureMode ? "measure-mode" : ""}`} bind:this={container}>
  {#if $currentMap}
    <div
      class="map-inner"
      style={`transform: translate(${panVal.x}px, ${panVal.y}px) scale(${zoomVal});
              width:${$currentMap.width}px;
              height:${$currentMap.height}px;`}
    >
      <img
        bind:this={img}
        class="map-image"
        src={$currentMap.src}
        alt={$currentMap.name}
      />

      {#if showGrid}
        <div
          class="grid-overlay"
          style={`background-size:${$currentMap.gridSizePx ?? 64}px ${$currentMap.gridSizePx ?? 64}px;`}
        />
      {/if}

      <slot />
      <slot name="vision-debug" />

    </div>

    <div class="hud-layer">
      <slot name="overlay" />
    </div>
  {/if}
</div>

<style>
  .map-container {
    position: absolute;
    inset: 0;
    overflow: hidden;
    background: #111;
  }

  .map-container.measure-mode {
    cursor: crosshair !important;
  }

  .map-inner {
    position: absolute;
    transform-origin: top left;
  }

  .map-image {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  .grid-overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background-image:
      linear-gradient(to right, rgba(255,255,255,0.12) 2px, transparent 2px),
      linear-gradient(to bottom, rgba(255,255,255,0.12) 2px, transparent 2px);
  }

  .hud-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 250;
  }
</style>
