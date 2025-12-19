<script>
    export let sheet = null;

    const abilities = ["str", "dex", "con", "int", "wis", "cha"];

    function label(key) {
        return key.toUpperCase();
    }

    function format(val) {
        if (val == null) return "—";
        return val >= 0 ? `+${val}` : `${val}`;
    }
</script>

<div class="card saves-card">
    <div class="card-title">Saving Throws</div>
    <div class="saves">
        {#each abilities as key}
            <div class="save-row">
                <span class="save-label">{label(key)}</span>
                <span class="save-value">{format(sheet?.saves?.[key])}</span>
            </div>
        {/each}
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
    .saves {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 6px;
    }
    .save-row {
        background: rgba(5,7,12,0.6);
        border-radius: 8px;
        padding: 6px 8px;
        border: 1px solid #1f2533;
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 0.9rem;
    }
    .save-label {
        color: #cfd5e3;
        letter-spacing: 0.04em;
    }
    .save-value {
        color: #f1e6c4;
        font-weight: 700;
    }
</style>
