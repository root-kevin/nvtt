<!-- Fog canvas with soft brush painting/erasing and PNG sync -->
<script>
    import { onMount, onDestroy, createEventDispatcher } from "svelte";
    import { currentMap } from "$lib/vtt/map/store.js";
    import {
        paint,
        coverAll as coverAllFog,
        revealAll as revealAllFog,
        getCanvas
    } from "$lib/vtt/fog/engine.js";

    import { panMode } from "$lib/vtt/panzoom/store.js";
    import { sendWS, setFogUpdateHandler } from "$lib/ws.js";

    export let isGM = false;
    export let mode = null; // add | erase | null
    export let brushSize = 120;
    export let opacity = 0.75;
    export let zIndex = 20;
    export let onSync = () => {};

    const dispatch = createEventDispatcher();

    let canvasEl;
    let previewCanvasEl;
    let previewCtx;
    let displayCtx;

    let fogEntry = null;
    let fogReady = false;

    let painting = false;
    let last = null;
    let strokeQueue = [];
    let paintFrame = null;

    let previewPos = null;
    let pendingPreview = null;
    let previewFrame = null;

    let spaceDown = false;
    let lastSizeKey = null;
    let activePointerId = null;
    let hasPointerCapture = false;

    // -------------------------
    // Load fog from PNG file
    // -------------------------
    function loadFogFromFile() {
        if (!$currentMap?.fogSrc || !fogEntry?.canvas) return;

        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = `${$currentMap.fogSrc}?v=${Date.now()}`;

        img.onload = () => {
            const ctx2 = fogEntry.canvas.getContext("2d");
            ctx2.clearRect(0, 0, fogEntry.canvas.width, fogEntry.canvas.height);
            ctx2.drawImage(img, 0, 0, fogEntry.canvas.width, fogEntry.canvas.height);
            renderFog();
            clearPreviewOverlay();
        };
    }

    // -------------------------
    // Canvas sizing
    // -------------------------
    function sizeCanvas() {
        if (!canvasEl || !$currentMap?.width || !$currentMap?.height) return;

        canvasEl.width = $currentMap.width;
        canvasEl.height = $currentMap.height;
        canvasEl.style.width = `${$currentMap.width}px`;
        canvasEl.style.height = `${$currentMap.height}px`;

        if (previewCanvasEl) {
            previewCanvasEl.width = $currentMap.width;
            previewCanvasEl.height = $currentMap.height;
            previewCtx = previewCanvasEl.getContext("2d");
            clearPreviewOverlay();
        }

        fogEntry = getCanvas($currentMap.id, $currentMap.width, $currentMap.height);
        displayCtx = canvasEl.getContext("2d");

        fogReady = true;
        renderFog();

        if ($currentMap.fogSrc) loadFogFromFile();
    }

    function pointerToMap(evt) {
        const rect = canvasEl.getBoundingClientRect();
        const scaleX = canvasEl.width / rect.width;
        const scaleY = canvasEl.height / rect.height;

        return {
            x: (evt.clientX - rect.left) * scaleX,
            y: (evt.clientY - rect.top) * scaleY
        };
    }

    // -------------------------
    // Fog Saving
    // -------------------------
    async function finalizeFog() {
        if (!$currentMap?.id || !fogEntry?.canvas) return;

        fogEntry.canvas.toBlob(async (blob) => {
            if (!blob) return;

            console.log("[Fog] Uploading fog PNG", $currentMap.id);

            await fetch(`/api/fog/${$currentMap.id}.png`, {
                method: "PUT",
                headers: { "Content-Type": "image/png" },
                body: blob
            });

            sendWS({
                type: "fogUpdated",
                mapId: $currentMap.id
            });

            clearPreviewOverlay();
        }, "image/png");
    }

    // -------------------------
    // Fog Rendering
    // -------------------------
    function redraw(sourceCanvas) {
        if (!displayCtx || !sourceCanvas) return;

        displayCtx.save();
        displayCtx.clearRect(0, 0, canvasEl.width, canvasEl.height);

        // Fog tint overlay
        const tint = isGM ? "rgba(128,128,128,1)" : "#111";
        displayCtx.globalAlpha = isGM ? 0.7 : 1;
        displayCtx.fillStyle = tint;
        displayCtx.fillRect(0, 0, canvasEl.width, canvasEl.height);

        displayCtx.globalCompositeOperation = "destination-in";
        displayCtx.drawImage(sourceCanvas, 0, 0);
        displayCtx.globalCompositeOperation = "source-over";

        displayCtx.restore();
    }

    function renderFog() {
        if (!fogEntry || !fogReady) return;
        redraw(fogEntry.canvas);
    }

    // -------------------------
    // Painting
    // -------------------------
    function applyStroke(pt) {
        if (!mode || !$currentMap) return;

        const radius = Math.max(5, Math.min(300, brushSize)) / 2;

        const persistent = paint(
            $currentMap.id,
            $currentMap.width,
            $currentMap.height,
            {
                x: pt.x,
                y: pt.y,
                radius,
                opacity: 1,
                mode: mode === "erase" ? "erase" : "add"
            }
        );

        fogEntry = { canvas: persistent.canvas ?? persistent, mapId: $currentMap.id };
    }

    function processQueue() {
        paintFrame = null;
        if (!strokeQueue.length) return;

        while (strokeQueue.length) {
            const { from, to } = strokeQueue.shift();

            const dx = to.x - from.x;
            const dy = to.y - from.y;
            const dist = Math.hypot(dx, dy);
            const step = Math.max(4, brushSize * 0.35);
            const steps = Math.ceil(dist / step);

            for (let i = 0; i <= steps; i++) {
                applyStroke({
                    x: from.x + dx * (i / steps),
                    y: from.y + dy * (i / steps)
                });
            }
        }

        renderFog();
    }

    function enqueueStroke(seg) {
        strokeQueue.push(seg);
        if (!paintFrame) {
            paintFrame = requestAnimationFrame(processQueue);
        }
    }

    // -------------------------
    // Brush Preview Cursor
    // -------------------------
    function onMouseMovePreview(e) {
        if (!isGM || !mode || spaceDown) {
            previewPos = null;
            return;
        }
        previewPos = pointerToMap(e);
    }

    function clearPreviewOverlay() {
        if (!previewCtx || !previewCanvasEl) return;
        previewCtx.clearRect(0, 0, previewCanvasEl.width, previewCanvasEl.height);
    }

    // -------------------------
    // Pointer Events
    // -------------------------
    function onPointerDown(e) {
        if (!isGM || !mode || spaceDown) return;

        painting = true;
        if (canvasEl && Number.isFinite(e.pointerId)) {
            try {
                canvasEl.setPointerCapture(e.pointerId);
                activePointerId = e.pointerId;
                hasPointerCapture = true;
            } catch (err) {}
        }
        const pt = pointerToMap(e);
        last = pt;

        enqueueStroke({ from: pt, to: pt });

        // FORCE immediate stroke (fixes single-click fog)
        if (!paintFrame) {
            paintFrame = requestAnimationFrame(processQueue);
        }

        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp);
        window.addEventListener("pointercancel", onPointerCancel);
    }

    function onPointerMove(e) {
        if (!painting || !mode || spaceDown) return;

        const pt = pointerToMap(e);
        enqueueStroke({ from: last, to: pt });
        last = pt;
    }

function releaseCapture() {
    if (!canvasEl || !hasPointerCapture || activePointerId == null) return;
    try {
        canvasEl.releasePointerCapture(activePointerId);
    } catch (err) {}
    hasPointerCapture = false;
    activePointerId = null;
}

function onPointerUp() {
    // --- FORCE APPLY SINGLE CLICK ---
    if (last) {
        applyStroke(last);
        renderFog();
    }

    painting = false;
    last = null;

    // DO NOT clear strokeQueue before finalizeFog runs
    strokeQueue.length = 0;

    finalizeFog();

    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerCancel);
    releaseCapture();
}

function onPointerCancel() {
    onPointerUp();
}

    // -------------------------
    // GM Buttons
    // -------------------------
    export function coverAll() {
        if (!$currentMap) return;
        fogEntry = { canvas: coverAllFog($currentMap.id, $currentMap.width, $currentMap.height), mapId: $currentMap.id };
        renderFog();
        finalizeFog();
    }

    export function revealAll() {
        if (!$currentMap) return;
        fogEntry = { canvas: revealAllFog($currentMap.id, $currentMap.width, $currentMap.height), mapId: $currentMap.id };
        renderFog();
        finalizeFog();
    }

    // -------------------------
    // Lifecycle
    // -------------------------
    onMount(() => {
        window.wsSend = sendWS;

        setFogUpdateHandler((id) => {
            if (id === $currentMap?.id) {
                loadFogFromFile();
            }
        });

        window.addEventListener("mousemove", onMouseMovePreview);

        sizeCanvas();

        const onKey = (e) => {
            if (e.code === "Space") {
                spaceDown = e.type === "keydown";
                if (spaceDown) {
                    painting = false;
                    last = null;
                    strokeQueue.length = 0;
                }
            }
        };

        window.addEventListener("keydown", onKey);
        window.addEventListener("keyup", onKey);

        const unsubPan = panMode.subscribe((m) => {
            if (m === "tool") {
                spaceDown = true;
                painting = false;
                strokeQueue.length = 0;
            } else if (m === "none") {
                spaceDown = false;
            }
        });

        return () => {
            unsubPan?.();
        };
    });

    onDestroy(() => {
        window.removeEventListener("mousemove", onMouseMovePreview);
        onPointerUp();
    });

    $: if ($currentMap) {
        const key = `${$currentMap.id}:${$currentMap.width}x${$currentMap.height}`;
        if (key !== lastSizeKey) {
            lastSizeKey = key;
            sizeCanvas();
        }
    }
</script>

<div class="fog-wrapper" style={`z-index:${zIndex};`}>
    <canvas
  bind:this={canvasEl}
  class={`fog-canvas ${mode && isGM ? "painting" : ""}`}
        on:pointerdown={onPointerDown}
        on:pointerleave={() => { if (painting && !hasPointerCapture) onPointerUp(); }}
    ></canvas>

    {#if !isGM}
        <canvas bind:this={previewCanvasEl} class="fog-preview"></canvas>
    {/if}

    {#if isGM && mode && previewPos}
        <div
            class="brush-preview"
            style={`left:${previewPos.x - brushSize/2}px;
                    top:${previewPos.y - brushSize/2}px;
                    width:${brushSize}px;
                    height:${brushSize}px;`}
        ></div>
    {/if}
</div>

<style>
.fog-wrapper {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 20;
}

.fog-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
}

.fog-canvas.painting {
    pointer-events: auto;
    cursor: crosshair;
}

.fog-preview {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 1;
}

.brush-preview {
    position: absolute;
    border: 2px solid rgba(255,255,255,0.4);
    border-radius: 50%;
    pointer-events: none;
    z-index: 2;
    box-shadow: 0 0 8px rgba(255,255,255,0.25);
}
</style>
