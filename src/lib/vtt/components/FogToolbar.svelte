<script>
    import { createEventDispatcher } from "svelte";
    import { Brush, Eraser, Circle, Eye, EyeOff, Cloud } from "@lucide/svelte";

    export let fogMode = null; // "add" | "erase" | null
    export let brushSize = 160;

    const dispatch = createEventDispatcher();
    const iconSize = 20;

    const sizes = [
        { label: "S", value: 60 },
        { label: "M", value: 140 },
        { label: "L", value: 240 }
    ];

    function selectMode(mode) {
        dispatch("modeChange", mode === fogMode ? null : mode);
    }

    function selectSize(val) {
        dispatch("brushChange", val);
    }
</script>

<div class="fog-toolbar">
        <div class="tool-group vertical">
        <div class="tool-header" data-tooltip="Fog Tools">
            <Cloud size={iconSize} stroke-width="2" />
            <span>Fog</span>
        </div>
        <div class="brush-row">
            <button class={`tool-btn ${fogMode === "add" ? "active" : ""}`} data-tooltip="Cover" on:click={() => selectMode("add")}>
                <Brush size={iconSize} stroke-width="2" />
            </button>
            <button class={`tool-btn ${fogMode === "erase" ? "active" : ""}`} data-tooltip="Reveal" on:click={() => selectMode("erase")}>
                <Eraser size={iconSize} stroke-width="2" />
            </button>
        </div>
        <div class="divider"></div>
        <div class="size-row">
            {#each sizes as s}
                <button class={`size-btn ${brushSize === s.value ? "active" : ""}`} data-tooltip={`Brush Size ${s.label}`} on:click={() => selectSize(s.value)}>
                    <Circle size={16} stroke-width="2" />
                    <span class="size-label">{s.label}</span>
                </button>
            {/each}
        </div>
        <div class="divider"></div>
        <button class="tool-btn wide" data-tooltip="Cover All" on:click={() => dispatch("coverAll")}>
            <EyeOff size={iconSize} stroke-width="2" />
            <span class="label">Cover All</span>
        </button>
        <button class="tool-btn wide" data-tooltip="Reveal All" on:click={() => dispatch("revealAll")}>
            <Eye size={iconSize} stroke-width="2" />
            <span class="label">Reveal All</span>
        </button>
        </div>
    </div>

<style>
.fog-toolbar {
    pointer-events: none;
}
.tool-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: rgba(8, 20, 34, 0.9);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 12px;
    padding: 10px;
    box-shadow: 0 8px 20px rgba(0,0,0,0.35);
    pointer-events: auto;
}
.tool-group.vertical {
    width: 170px;
}
.brush-row {
    display: flex;
    gap: 8px;
}
.tool-header {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #e7f0ff;
    font-size: 13px;
    opacity: 0.8;
    position: relative;
}
.tool-btn {
    width: 44px;
    height: 44px;
    border-radius: 10px;
    border: 1px solid rgba(255,255,255,0.1);
    background: rgba(30,42,58,0.9);
    color: #e7f0ff;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: transform 0.1s ease, background 0.1s ease, border 0.1s ease;
    position: relative;
}
.tool-btn:hover {
    background: rgba(255,255,255,0.08);
    transform: translateY(-1px);
}
.tool-btn.active {
    background: #e85537;
    border-color: #ff9a7f;
    color: #fff;
}
.tool-btn.wide {
    width: 100%;
    height: 44px;
    justify-content: flex-start;
    gap: 10px;
}
.tool-btn.wide .label {
    font-size: 13px;
    letter-spacing: 0.4px;
}
.tool-btn[data-tooltip]:hover::after,
.tool-header[data-tooltip]:hover::after,
.size-btn[data-tooltip]:hover::after {
    content: attr(data-tooltip);
    position: absolute;
    left: 100%;
    top: 50%;
    transform: translate(8px, -50%);
    background: rgba(10,10,10,0.85);
    color: #f5f7fb;
    padding: 6px 8px;
    border-radius: 6px;
    font-size: 12px;
    white-space: nowrap;
    box-shadow: 0 4px 12px rgba(0,0,0,0.35);
    pointer-events: none;
    z-index: 300;
}
.divider {
    height: 1px;
    background: rgba(255,255,255,0.08);
}
.size-row {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
}
.size-btn {
    height: 32px;
    border-radius: 8px;
    border: 1px solid rgba(255,255,255,0.12);
    background: rgba(30,42,58,0.9);
    color: #e7f0ff;
    font-size: 13px;
    cursor: pointer;
    display: grid;
    grid-template-columns: 18px 1fr;
    gap: 6px;
    align-items: center;
}
.size-btn.active {
    background: #e85537;
    border-color: #ff9a7f;
    color: #fff;
}
.size-label {
    font-size: 12px;
}
</style>
