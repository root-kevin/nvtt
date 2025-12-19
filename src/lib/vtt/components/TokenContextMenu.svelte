<script>
    import { applyHpPatch } from "$lib/vtt/tokens/hpUtils.js";

    export let x = 0;
    export let y = 0;
    export let token = null;
    export let currentHp = 0;
    export let maxHp = 1;
    export let tempHp = 0;
    export let pushUpdate = () => {};

    export let onRename = () => {};
    export let onDelete = () => {};
    export let onToggleHidden = () => {};

    let delta = "";

    function setCurrentHp(val) {
        const derived = applyHpPatch({ currentHp, maxHp, tempHp }, { setCurrent: Number.isFinite(val) ? val : 0 });
        pushUpdate(derived);
    }

    function setTempHp(val) {
        const derived = applyHpPatch({ currentHp, maxHp, tempHp }, { setTemp: +val || 0 });
        pushUpdate(derived);
    }

    function damage() {
        const derived = applyHpPatch({ currentHp, maxHp, tempHp }, { damage: Math.abs(+delta || 0) });
        pushUpdate(derived);
        delta = "";
    }

    function heal() {
        const derived = applyHpPatch({ currentHp, maxHp, tempHp }, { heal: Math.abs(+delta || 0) });
        pushUpdate(derived);
        delta = "";
    }
</script>

<div class="context-menu" style={`top:${y}px; left:${x}px;`}>
    <div class="block">
        <div class="label">HP</div>
        <div class="hp-row">
            <label>Current</label>
            <input type="number" value={currentHp} on:input={(e) => setCurrentHp(+e.target.value || 0)} />
        </div>
        <div class="hp-row">
            <label>Max</label>
            <div class="readonly">{maxHp ?? "—"}</div>
        </div>
        <div class="hp-row">
            <label>Temp</label>
            <input type="number" value={tempHp} on:input={(e) => setTempHp(+e.target.value || 0)} />
        </div>
        <div class="hp-row delta">
            <input type="number" placeholder="Amount" bind:value={delta} />
            <button on:click={damage}>Damage</button>
            <button on:click={heal}>Heal</button>
        </div>
        <label class="toggle">
            <input type="checkbox" checked={!!token?.consistentHp} on:change={(e) => pushUpdate({ consistentHp: e.target.checked })} />
            <span>Persistent HP</span>
        </label>
    </div>

    <button on:click={onRename}>Rename</button>
    <button on:click={onDelete}>Delete</button>
    <button on:click={onToggleHidden}>
        {token?.hidden ? "Show to Players" : "Hide from Players"}
    </button>
</div>

<style>
.context-menu {
    position: absolute;
    background: #222;
    color: white;
    padding: 6px;
    border: 1px solid #444;
    border-radius: 4px;
    z-index: 5000;
    display: flex;
    flex-direction: column;
    min-width: 220px;
}

.context-menu button {
    background: #333;
    color: white;
    border: none;
    padding: 5px;
    text-align: left;
    cursor: pointer;
}

.context-menu button:hover {
    background: #555;
}

.block {
    display: grid;
    gap: 6px;
    margin-bottom: 8px;
}
.label {
    font-weight: 700;
}
.hp-row {
    display: grid;
    grid-template-columns: 60px 1fr;
    gap: 6px;
    align-items: center;
}
.hp-row.delta {
    grid-template-columns: 1fr 1fr 1fr;
}
.hp-row input {
    background: #111;
    color: #eee;
    border: 1px solid #444;
    border-radius: 4px;
    padding: 4px;
}
.readonly {
    padding: 4px;
    background: #111;
    border: 1px solid #444;
    border-radius: 4px;
}
.toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.9rem;
}
</style>
