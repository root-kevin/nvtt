<script>
    import { formatDamageArray, formatEntryNode } from "$lib/vtt/5e/normalizeSheet.js";

    export let sheet = null;

    function formatDamage(val) {
        const out = formatDamageArray(val);
        return out || "—";
    }

    function formatCond(val) {
        const out = formatEntryNode(val);
        return out || "—";
    }
</script>

<div class="card defenses-card">
    <div class="card-title">Defenses</div>
    <div class="def-list">
        <div class="def-row">
            <span class="def-label">Resistances</span>
            <span class="def-value">{formatDamage(sheet?.defenses?.resist)}</span>
        </div>
        <div class="def-row">
            <span class="def-label">Immunities</span>
            <span class="def-value">{formatDamage(sheet?.defenses?.immune)}</span>
        </div>
        <div class="def-row">
            <span class="def-label">Vulnerabilities</span>
            <span class="def-value">{formatDamage(sheet?.defenses?.vulnerable)}</span>
        </div>
        <div class="def-row">
            <span class="def-label">Condition Immunities</span>
            <span class="def-value">{formatCond(sheet?.defenses?.conditionImmune)}</span>
        </div>
    </div>
</div>

<style>
    .card {
        background: #0d121e;
        border-radius: 12px;
        border: 1px solid #202839;
        padding: 10px;
        box-shadow: 0 6px 18px rgba(0,0,0,0.25);
    }
    .card-title {
        font-size: 0.78rem;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: #d1c184;
        margin-bottom: 8px;
    }
    .def-list {
        display: grid;
        gap: 6px;
    }
    .def-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 6px 8px;
        border-radius: 8px;
        border: 1px solid #1f2533;
        background: rgba(6,8,14,0.7);
        font-size: 0.9rem;
        color: #d7deed;
    }
    .def-label {
        color: #cfd5e3;
    }
    .def-value {
        color: #f1e6c4;
        text-align: right;
        max-width: 70%;
    }
</style>
