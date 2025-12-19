<!-- src/lib/vtt/vision/VisionDebugOverlay.svelte -->
<script>
  import { onDestroy } from "svelte";
  import { visionPolygon, visionDebug } from "$lib/vtt/vision/resultsStore.js";
  import { currentMap } from "$lib/vtt/map/store.js";

  export let isGM = false;
  export let zIndex = 30;

  let polygon = null;
  let debugPayload = null;

  const unsubPoly = visionPolygon.subscribe(v => polygon = v);
  const unsubDebug = visionDebug.subscribe(v => debugPayload = v);

  onDestroy(() => {
    unsubPoly?.();
    unsubDebug?.();
  });

  $: showDebug = isGM && !!$currentMap?.interactionDebug;
  $: debugSegments = showDebug && debugPayload?.segments ? debugPayload.segments : [];
  $: debugRays = showDebug && debugPayload?.rays ? debugPayload.rays : [];
  $: debugOrigin = showDebug ? debugPayload?.origin : null;
  $: polygonSource = showDebug && debugPayload?.polygon ? debugPayload.polygon : polygon;
  $: debugEndpoints = showDebug && debugSegments
    ? Array.from(
        debugSegments.reduce((set, seg) => {
          const key = (p) => `${Math.round(p.x * 10) / 10}:${Math.round(p.y * 10) / 10}`;
          set.set(key(seg.a), seg.a);
          set.set(key(seg.b), seg.b);
          return set;
        }, new Map()).values()
      )
    : [];
  $: hitPoints = showDebug && debugRays
    ? debugRays.filter(r => r.hit).map(r => ({ x: r.x, y: r.y, snapped: !!r.endpointSnap }))
    : [];
  $: pointsAttr =
    polygonSource && polygonSource.length
      ? polygonSource.map(p => `${p.x},${p.y}`).join(" ")
      : "";
</script>

{#if showDebug && $currentMap}
  <svg
    class="vision-debug"
    style="
      position:absolute;
      left:0;
      top:0;
      width:{$currentMap.width}px;
      height:{$currentMap.height}px;
      pointer-events:none;
      z-index:{zIndex};
    "
  >
    {#if debugSegments?.length}
      {#each debugSegments as seg (seg?.meta?.wall?.id || `${seg.a.x},${seg.a.y}-${seg.b.x},${seg.b.y}`)}
        <line
          x1={seg.a.x}
          y1={seg.a.y}
          x2={seg.b.x}
          y2={seg.b.y}
          stroke="rgba(250,160,60,0.8)"
          stroke-width="2"
          stroke-linecap="round"
        />
      {/each}
    {/if}

    {#if debugOrigin && debugRays?.length}
      {#each debugRays as ray, idx (idx)}
        <line
          x1={debugOrigin.x}
          y1={debugOrigin.y}
          x2={ray.x}
          y2={ray.y}
          stroke={ray.hit ? "rgba(80,200,255,0.8)" : "rgba(80,200,255,0.35)"}
          stroke-width="1"
          stroke-linecap="round"
          stroke-dasharray={ray.hit ? "none" : "4 4"}
        />
      {/each}
    {/if}

    {#if debugOrigin}
      <circle cx={debugOrigin.x} cy={debugOrigin.y} r="4" fill="rgba(255,255,255,0.8)" />
    {/if}

    {#if debugEndpoints?.length}
      {#each debugEndpoints as p, idx (idx)}
        <circle cx={p.x} cy={p.y} r="3" fill="rgba(255,180,80,0.9)" />
      {/each}
    {/if}

    {#if hitPoints?.length}
      {#each hitPoints as p, idx (idx)}
        <circle
          cx={p.x}
          cy={p.y}
          r={p.snapped ? "4" : "3"}
          fill={p.snapped ? "rgba(120,255,120,0.95)" : "rgba(90,200,255,0.9)"}
          stroke="rgba(0,0,0,0.45)"
          stroke-width="1"
        />
      {/each}
    {/if}

    {#if pointsAttr}
      <polygon
        points={pointsAttr}
        fill="rgba(80,160,255,0.25)"
        stroke="rgba(120,200,255,0.9)"
        stroke-width="2"
      />
    {/if}
  </svg>
{/if}

<style>
  .vision-debug {
    overflow: visible;
  }
</style>
