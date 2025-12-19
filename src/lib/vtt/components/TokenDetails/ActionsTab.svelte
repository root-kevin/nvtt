<script>
    export let token;
    export let sheet;
    export let sectionEntries = () => [];

    function hasEntries(key) {
        return (sectionEntries(key) || []).length > 0;
    }
</script>

<div class="actions" data-token={token?.id || ""}>
    {#if sheet}
        {#if hasEntries("action")}
            <div class="card">
                <div class="card-title">Actions</div>
                {#each sectionEntries("action") as entry}
                    <div class="entry">{entry}</div>
                {/each}
            </div>
        {/if}

        {#if hasEntries("bonus")}
            <div class="card">
                <div class="card-title">Bonus Actions</div>
                {#each sectionEntries("bonus") as entry}
                    <div class="entry">{entry}</div>
                {/each}
            </div>
        {/if}

        {#if hasEntries("reaction")}
            <div class="card">
                <div class="card-title">Reactions</div>
                {#each sectionEntries("reaction") as entry}
                    <div class="entry">{entry}</div>
                {/each}
            </div>
        {/if}

        {#if hasEntries("legendary")}
            <div class="card">
                <div class="card-title">Legendary Actions</div>
                {#each sectionEntries("legendary") as entry}
                    <div class="entry">{entry}</div>
                {/each}
            </div>
        {/if}

        {#if hasEntries("lair")}
            <div class="card">
                <div class="card-title">Lair Actions</div>
                {#each sectionEntries("lair") as entry}
                    <div class="entry">{entry}</div>
                {/each}
            </div>
        {/if}
    {:else}
        <div class="card">
            <div class="entry">No actions available.</div>
        </div>
    {/if}
</div>

<style>
    .actions {
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
