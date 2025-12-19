<script>
    export let token;
    export let sheet;

    function cleanSpellName(raw) {
        return raw.replace(/\{@spell\s+([^}]+)\}/g, "$1").trim();
    }

    $: blocks = sheet?.spellcastingBlocks || [];
</script>

<div class="spells" data-token={token?.id || ""}>
    {#if !blocks.length}
        <div class="card">
            <div class="card-title">Spellcasting</div>
            <div class="entry">This creature does not have a spellcasting block.</div>
        </div>
    {:else}
        {#each blocks as block}
            <div class="card">
                <div class="card-title">{block.header || "Spellcasting"}</div>
                {#if block.headerEntries}
                    {#each block.headerEntries as line}
                        <div class="entry">{line}</div>
                    {/each}
                {/if}
                {#if block.spellsByLevel}
                    {#each Object.entries(block.spellsByLevel) as [level, spells]}
                        <div class="sub-title">
                            {#if level === "0"}
                                Cantrips (at will)
                            {:else}
                                Level {level} ({block.slots?.[level] ?? "—"} slots)
                            {/if}
                        </div>
                        <div class="spell-list">
                            {#each (spells || []) as raw}
                                <div class="entry">
                                    {cleanSpellName(raw)}
                                </div>
                            {/each}
                        </div>
                    {/each}
                {/if}
            </div>
        {/each}
    {/if}
</div>

<style>
    .spells {
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
    .spell-list {
        display: grid;
        gap: 4px;
    }
</style>
