<script>
    import { formatEntryNode } from "$lib/vtt/5e/normalizeSheet.js";

    export let sheet = null;

    function format(val) {
        if (!val && val !== 0) return "—";
        if (Array.isArray(val)) return val.map(formatEntryNode).filter(Boolean).join(", ");
        const out = formatEntryNode(val);
        return out || "—";
    }
</script>

<div class="card senses-card">
    <div class="card-title">Senses</div>
    <div class="senses">
        <div class="sense-row">
            <span>Passive Perception</span>
            <span>{sheet?.passives?.perception ?? "—"}</span>
        </div>
        <div class="sense-row">
            <span>Passive Investigation</span>
            <span>{sheet?.passives?.investigation ?? "—"}</span>
        </div>
        <div class="sense-row">
            <span>Passive Insight</span>
            <span>{sheet?.passives?.insight ?? "—"}</span>
        </div>
        <div class="sense-row">
            <span>Other Senses</span>
            <span>{format(sheet?.senses)}</span>
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
    .senses {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 6px;
    }
    .sense-row {
        background: rgba(5,7,12,0.6);
        border-radius: 8px;
        padding: 6px 8px;
        border: 1px solid #1f2533;
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 0.9rem;
        color: #d7deed;
    }
    .sense-row span:last-child {
        color: #f1e6c4;
    }
</style>
