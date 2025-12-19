<!-- src/lib/vtt/components/PlayerVisionMask.svelte -->
<script>
  import { onDestroy } from "svelte";
  import { currentMap } from "$lib/vtt/map/store.js";
  import { visionPolygon } from "$lib/vtt/vision/resultsStore.js";

  export let enabled = true;
  export let zIndex = 32;

  let canvas;
  let polygon = null;

  const unsubPoly = visionPolygon.subscribe((poly) => {
    polygon = Array.isArray(poly) ? poly : null;
    draw();
  });

  onDestroy(() => {
    unsubPoly?.();
  });

  function clear() {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function draw() {
    if (!canvas || !$currentMap || !enabled) {
      clear();
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!polygon || polygon.length < 3) return;

    ctx.save();
    ctx.beginPath();
    polygon.forEach((p, idx) => {
      if (!p) return;
      if (idx === 0) {
        ctx.moveTo(p.x, p.y);
      } else {
        ctx.lineTo(p.x, p.y);
      }
    });
    ctx.closePath();

    ctx.fillStyle = "rgba(76, 193, 255, 0.18)";
    ctx.strokeStyle = "rgba(76, 193, 255, 0.45)";
    ctx.lineWidth = 2;
    ctx.shadowColor = "rgba(76, 193, 255, 0.35)";
    ctx.shadowBlur = 8;

    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  $: if (canvas && $currentMap) {
    canvas.width = $currentMap.width || 0;
    canvas.height = $currentMap.height || 0;
    draw();
  }

  $: if (!enabled) {
    clear();
  }
</script>

<div
  class="vision-mask"
  style={`z-index:${zIndex};`}
>
  <canvas bind:this={canvas} class="vision-mask-canvas"></canvas>
</div>

<style>
  .vision-mask {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .vision-mask-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }
</style>
