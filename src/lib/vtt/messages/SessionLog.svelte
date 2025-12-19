<script>
    import { sessionLog } from "./controller.ts";
    import { derived } from "svelte/store";

    export let mode = "player"; // gm | player
    export let open = false;

    const messages = derived(sessionLog, ($log) => $log);

    function clearLog() {
        if (mode !== "gm") return;
        sessionLog.set([]);
    }

    const categoryClass = (cat) => cat || "toast";
</script>

<div class={`session-log ${open ? "open" : ""}`}>
    <div class="session-log__header">
        <span>Session Log</span>
        {#if mode === "gm"}
            <button class="clear-btn" on:click={clearLog}>Clear</button>
        {/if}
    </div>
    <div class="session-log__body">
        {#each $messages as m (m.id)}
            <div class={`log-entry ${categoryClass(m.category)}`} data-category={m.category}>
                <div class="log-top">
                    <span class="category">{m.category}</span>
                    <span class="time">{new Date(m.timestamp).toLocaleTimeString()}</span>
                </div>
                <div class="log-text">{m.text}</div>
            </div>
        {/each}
    </div>
</div>

<style>
:global(:root) {
    --bg-dark: #1e1e1f;
    --bg-panel: #2a2a2d;
    --bg-panel-high: #323236;
    --border-soft: rgba(255,255,255,0.08);
    --border-strong: rgba(255,255,255,0.18);
    --text-normal: #e0e0e0;
    --text-dim: #b0b0b0;
    --text-bright: #ffffff;
    --shadow-strong: 0 8px 18px rgba(0,0,0,0.4);
    --radius: 8px;
    --radius-lg: 12px;
    --accent-blue: #4ea1ff;
    --accent-green: #57d587;
    --accent-yellow: #f5d76e;
    --accent-orange: #ff9f43;
    --accent-purple: #b785ff;
}

.session-log {
    position: fixed;
    right: 0;
    top: 0;
    height: 100%;
    width: 320px;
    background: var(--bg-panel);
    border-left: 1px solid var(--border-strong);
    box-shadow: -6px 0 18px rgba(0,0,0,0.45);
    transform: translateX(100%);
    transition: transform 200ms ease-out;
    z-index: 1200;
    display: flex;
    flex-direction: column;
    color: var(--text-normal);
}
.session-log.open {
    transform: translateX(0);
}
.session-log__header {
    padding: 10px 12px;
    border-bottom: 1px solid var(--border-soft);
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--bg-panel-high);
}
.clear-btn {
    background: transparent;
    border: 1px solid var(--border-soft);
    color: var(--text-normal);
    padding: 4px 8px;
    border-radius: var(--radius);
    cursor: pointer;
    transition: 120ms ease background, 120ms ease border;
}
.clear-btn:hover {
    background: rgba(255,255,255,0.08);
    border-color: var(--border-strong);
}
.session-log__body {
    flex: 1;
    overflow: auto;
    padding: 8px;
}
.log-entry {
    background: var(--bg-panel-high);
    border: 1px solid var(--border-soft);
    border-left: 4px solid var(--border-strong);
    border-radius: var(--radius);
    padding: 8px 10px;
    box-shadow: var(--shadow-strong);
    margin-bottom: 8px;
}
.log-entry[data-category="roll"] { border-left-color: var(--accent-blue); }
.log-entry[data-category="warning"] { border-left-color: var(--accent-yellow); }
.log-entry[data-category="gm"] { border-left-color: var(--accent-purple); }
.log-entry[data-category="measure"] { border-left-color: var(--accent-green); }

.log-top {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    color: var(--text-dim);
    margin-bottom: 4px;
}
.log-text {
    color: var(--text-bright);
    font-size: 13px;
}
</style>
