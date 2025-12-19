<script>
    import { onMount } from "svelte";
    import { X } from "@lucide/svelte";
    import { upsertMap } from "$lib/vtt/map/store.js";

    export let open = false;
    export let onClose = () => {};
    export let existingLocations = [];
    export let map = null; // when provided, edit existing map

    let step = 1;
    let file = null;
    let previewSrc = "";
    let uploadedSrc = "";
    let name = "";
    let location = "";
    let container;
    let imageEl;
    let imageSize = { width: 0, height: 0 };

    let pan = { x: 0, y: 0 };
    let zoom = 1;
    let isPanning = false;
    let panStart = { x: 0, y: 0 };

    let box = { x: 100, y: 100, size: 100 };
    let draggingBox = false;
    let resizingBox = false;
    let dragStart = { x: 0, y: 0 };
    let boxStart = { x: 0, y: 0, size: 100 };

    const uniqueLocations = () => Array.from(new Set(existingLocations.filter(Boolean)));

    onMount(() => {
        return () => {
            if (previewSrc) URL.revokeObjectURL(previewSrc);
        };
    });

    function handleFiles(list) {
        const f = list?.[0];
        if (!f) return;
        file = f;
        if (previewSrc) URL.revokeObjectURL(previewSrc);
        previewSrc = URL.createObjectURL(f);
        step = 2;
    }

    function onDrop(e) {
        e.preventDefault();
        handleFiles(e.dataTransfer.files);
    }

    function onBrowse(e) {
        handleFiles(e.target.files);
    }

    async function ensureUpload() {
        if (uploadedSrc) return uploadedSrc;
        if (!file) return null;

        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/upload-map", { method: "POST", body: form });
        if (!res.ok) throw new Error("Upload failed");
        const data = await res.json();
        uploadedSrc = data.src;
        return uploadedSrc;
    }

    function onImageLoad() {
        if (!imageEl) return;
        imageSize = {
            width: imageEl.naturalWidth,
            height: imageEl.naturalHeight
        };
        const initialSize = map?.gridSizePx ? Math.max(5, Math.round(map.gridSizePx)) : 100;
        // Place at top-left by default
        box = {
            x: 0,
            y: 0,
            size: initialSize
        };
    }

    function beginPan(e) {
        if (e.button !== 0 || e.target?.dataset?.handle) return;
        isPanning = true;
        panStart = { x: e.clientX - pan.x, y: e.clientY - pan.y };
        e.preventDefault();
    }

    function endPan() {
        isPanning = false;
        draggingBox = false;
        resizingBox = false;
    }

    function onMouseMove(e) {
        if (isPanning) {
            pan = { x: e.clientX - panStart.x, y: e.clientY - panStart.y };
        } else if (draggingBox) {
            const dx = (e.clientX - dragStart.x) / zoom;
            const dy = (e.clientY - dragStart.y) / zoom;
            box = { ...box, x: boxStart.x + dx, y: boxStart.y + dy };
        } else if (resizingBox) {
            const dx = (e.clientX - dragStart.x) / zoom;
            const dy = (e.clientY - dragStart.y) / zoom;
            const delta = Math.max(dx, dy);
            const newSize = Math.max(16, boxStart.size + delta);
            box = { ...box, size: newSize };
        }
    }

    function onWheel(e) {
        if (!container) return;
        e.preventDefault();
        const rect = container.getBoundingClientRect();
        const offsetX = e.clientX - rect.left - pan.x;
        const offsetY = e.clientY - rect.top - pan.y;
        const zoomPointX = offsetX / zoom;
        const zoomPointY = offsetY / zoom;

        const factor = e.deltaY < 0 ? 1.08 : 0.92;
        const nextZoom = Math.min(5, Math.max(0.2, zoom * factor));
        pan = {
            x: e.clientX - rect.left - zoomPointX * nextZoom,
            y: e.clientY - rect.top - zoomPointY * nextZoom
        };
        zoom = nextZoom;
    }

    function startBoxDrag(e) {
        draggingBox = true;
        dragStart = { x: e.clientX, y: e.clientY };
        boxStart = { ...box };
        e.stopPropagation();
    }

    function startResize(e) {
        resizingBox = true;
        dragStart = { x: e.clientX, y: e.clientY };
        boxStart = { ...box };
        e.stopPropagation();
    }

    function snapBoxToGrid() {
        // Align box to an integer grid based on current size (grid size preview)
        const g = Math.max(5, Math.round(box.size));
        const snappedX = Math.round(box.x / g) * g;
        const snappedY = Math.round(box.y / g) * g;
        box = { ...box, x: snappedX, y: snappedY, size: g };
    }

    async function saveMap() {
        if (!name) return;
        const src = await ensureUpload() || uploadedSrc || previewSrc;
        if (!src) return;

        const payload = {
            id: map?.id ?? crypto.randomUUID(),
            name,
            src,
            location: location || "Unknown",
            gridSizePx: Math.round(box.size),
            width: map?.width,
            height: map?.height
        };

        const res = await fetch("/api/maps", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        if (!res.ok) {
            console.error("Failed to save map");
            return;
        }
        upsertMap(payload);
        reset();
        onClose();
    }

    function reset() {
        step = 1;
        file = null;
        if (previewSrc) URL.revokeObjectURL(previewSrc);
        previewSrc = "";
        uploadedSrc = "";
        name = "";
        location = "";
        box = { x: 100, y: 100, size: 100 };
        pan = { x: 0, y: 0 };
        zoom = 1;
    }

    $: if (open && map) {
        name = map.name ?? "";
        location = map.location ?? "";
        uploadedSrc = map.src ?? "";
        previewSrc = map.src ?? "";
        const initialSize = map.gridSizePx ? Math.max(5, Math.round(map.gridSizePx)) : 100;
        box = { x: 0, y: 0, size: initialSize };
        step = map.src ? 3 : 1;
    } else if (!open) {
        reset();
    }
</script>

{#if open}
<div class="modal-backdrop" on:click={onClose}>
    <div class="modal" on:click|stopPropagation>
        <header>
            <h3>Upload Map</h3>
            <button class="close" on:click={onClose} aria-label="Close">
                <X size={16} stroke-width="2" />
            </button>
        </header>

        <!-- Step 1: file -->
        {#if step === 1}
            <div
                class="dropzone"
                on:dragover|preventDefault
                on:drop={onDrop}
            >
                <p>Drag & drop a map image, or</p>
                <label class="browse">
                    Click to browse
                    <input type="file" accept="image/*" on:change={onBrowse} />
                </label>
            </div>
        {/if}

        <!-- Step 2: details -->
        {#if step === 2}
            <div class="details">
                <div class="field">
                    <label>Map name</label>
                    <input type="text" bind:value={name} placeholder="Dungeon Level 1" />
                </div>
                <div class="field">
                    <label>Location</label>
                    <div class="inline">
                        <select bind:value={location}>
                            <option value="">Select existing…</option>
                            {#each uniqueLocations() as loc}
                                <option value={loc}>{loc}</option>
                            {/each}
                        </select>
                        <input type="text" bind:value={location} placeholder="Or type new (e.g., Barovia)" />
                    </div>
                </div>
                <div class="actions">
                    <button on:click={() => (step = 1)}>Back</button>
                    <button class="primary" on:click={() => (step = 3)} disabled={!name || (!file && !map)}>Next</button>
                </div>
            </div>
        {/if}

        <!-- Step 3: calibrate -->
        {#if step === 3}
            <div class="calibrate">
                <div
                    class="viewer"
                    bind:this={container}
                    on:mousedown={beginPan}
                    on:mouseup={endPan}
                    on:mouseleave={endPan}
                    on:mousemove={onMouseMove}
                    on:wheel={onWheel}
                >
                    {#if previewSrc}
                        <div
                            class="image-wrap"
                            style={`transform: translate(${pan.x}px, ${pan.y}px) scale(${zoom}); transform-origin: 0 0;`}
                        >
                            <img
                                bind:this={imageEl}
                                src={previewSrc}
                                alt="Map preview"
                                on:load={onImageLoad}
                            />
                            <div
                                class="calibration-grid"
                                style={`background-size:${box.size}px ${box.size}px;`}
                            ></div>
                            <div
                                class="grid-box"
                                style={`left:${box.x}px; top:${box.y}px; width:${box.size}px; height:${box.size}px;`}
                                on:mousedown={startBoxDrag}
                            >
                                <div class="handle" data-handle="resize" on:mousedown={startResize}></div>
                                <span>5 ft</span>
                            </div>
                        </div>
                    {:else}
                        <p class="placeholder">No preview available</p>
                    {/if}
                </div>
                <div class="actions">
                    <button on:click={() => (step = 2)}>Back</button>
                    <div class="grid-actions">
                        <button type="button" on:click={snapBoxToGrid}>Snap box to grid</button>
                        <button class="primary" on:click={saveMap} disabled={!name || (!file && !map && !uploadedSrc)}>Save Map</button>
                    </div>
                </div>
            </div>
        {/if}
    </div>
</div>
{/if}

<style>
.modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 50;
}

.modal {
    width: min(900px, 95vw);
    background: #1a1a1a;
    color: #f5f5f5;
    border: 1px solid #333;
    border-radius: 10px;
    padding: 16px;
    box-shadow: 0 10px 40px rgba(0,0,0,0.5);
}

header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 12px;
}

.close {
    background: #333;
    color: #fff;
    border: 1px solid #555;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    cursor: pointer;
}

.dropzone {
    border: 2px dashed #555;
    padding: 40px;
    text-align: center;
    background: #0f0f0f;
    border-radius: 8px;
}

.browse {
    display: inline-block;
    margin-top: 10px;
    padding: 8px 12px;
    background: #333;
    border: 1px solid #555;
    cursor: pointer;
    border-radius: 6px;
}

.browse input {
    display: none;
}

.details .field {
    margin-bottom: 12px;
}

.details label {
    display: block;
    margin-bottom: 4px;
}

.details input,
.details select {
    width: 100%;
    padding: 8px;
    background: #111;
    border: 1px solid #444;
    color: #fff;
    border-radius: 6px;
}

.inline {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
}

.actions {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    margin-top: 12px;
}

.actions button {
    padding: 8px 12px;
    border: 1px solid #555;
    background: #2a2a2a;
    color: #fff;
    cursor: pointer;
    border-radius: 6px;
}

.actions .primary {
    background: #3a6ff7;
    border-color: #5585ff;
}

.grid-actions {
    display: flex;
    gap: 10px;
    align-items: center;
}

.calibrate {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.viewer {
    position: relative;
    background: #0c0c0c;
    border: 1px solid #333;
    border-radius: 6px;
    height: 500px;
    overflow: hidden;
    cursor: grab;
}

.viewer:active {
    cursor: grabbing;
}

.image-wrap {
    position: absolute;
    top: 0;
    left: 0;
}

.image-wrap img {
    display: block;
    max-width: none;
    user-select: none;
    pointer-events: none;
}

.calibration-grid {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background-image:
        linear-gradient(to right, rgba(255,255,255,0.2) 1px, transparent 1px),
        linear-gradient(to bottom, rgba(255,255,255,0.2) 1px, transparent 1px);
    background-position: 0 0;
}

.grid-box {
    position: absolute;
    border: 2px solid #58c4ff;
    box-shadow: 0 0 8px rgba(88, 196, 255, 0.6);
    background: rgba(88, 196, 255, 0.08);
    cursor: move;
}

.grid-box span {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    color: #e8f7ff;
    font-size: 12px;
    pointer-events: none;
}

.handle {
    position: absolute;
    width: 16px;
    height: 16px;
    right: -8px;
    bottom: -8px;
    background: #58c4ff;
    border-radius: 4px;
    border: 1px solid #9ae0ff;
    cursor: nwse-resize;
}

.placeholder {
    color: #888;
    text-align: center;
    margin-top: 200px;
}
</style>
