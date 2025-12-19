<script>
    export let token;
    export let sheet;
    export let sectionEntries = () => [];

    function hasEntries(key) {
        return (sectionEntries(key) || []).length > 0;
    }
</script>

<div class="features" data-token={token?.id || ""}>
    {#if sheet}
        {#if hasEntries("trait")}
            <div class="card">
                <div class="card-title">Traits</div>
                {#each sectionEntries("trait") as entry}
                    <div class="entry">{entry}</div>
                {/each}
            </div>
        {/if}

        {#if hasEntries("legendary")}
            <div class="card">
                <div class="card-title">Legendary Traits</div>
                {#each sectionEntries("legendary") as entry}
                    <div class="entry">{entry}</div>
                {/each}
            </div>
        {/if}

        {#if hasEntries("lair")}
            <div class="card">
                <div class="card-title">Lair Actions / Effects</div>
                {#each sectionEntries("lair") as entry}
                    <div class="entry">{entry}</div>
                {/each}
            </div>
        {/if}

        {#if hasEntries("regional")}
            <div class="card">
                <div class="card-title">Regional Effects</div>
                {#each sectionEntries("regional") as entry}
                    <div class="entry">{entry}</div>
                {/each}
            </div>
        {/if}
    {:else}
        <div class="card">
            <div class="entry">No features available.</div>
        </div>
    {/if}
</div>

<style>
    .features {
        padding: 12px;
        display: grid;
        gap: 10px;
    }
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
        margin-bottom: 6px;
    }
    .entry {
        background: #050915;
        border-radius: 8px;
        border: 1px solid #252c3c;
        padding: 6px 8px;
        color: #e8ecf5;
        font-size: 0.9rem;
        margin-bottom: 4px;
    }
</style>
