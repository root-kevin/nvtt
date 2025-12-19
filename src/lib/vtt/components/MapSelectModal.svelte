<script>
    import { onMount } from "svelte";
    import { maps, currentMap, setCurrentMap, loadMaps } from "$lib/vtt/map/store.js";
    import { tokens } from "$lib/vtt/tokens/store.js";
    import MapUploadModal from "$lib/vtt/components/MapUploadModal.svelte";
    import { X, Pencil } from "@lucide/svelte";

    export let open = false;
    export let onClose = () => {};
    let editingMap = null;

    let search = "";
    let locationFilter = "";
    let showUpload = false;

    onMount(() => {
        loadMaps();
    });

    $: filtered = $maps
        .filter(m => {
            const q = search.trim().toLowerCase();
            if (q && !(m.name?.toLowerCase().includes(q) || m.location?.toLowerCase().includes(q))) return false;
            if (locationFilter && m.location !== locationFilter) return false;
            return true;
        });

    function tokensOnMap(mapId) {
        return $tokens.filter(t => t.mapId === mapId).length;
    }

    function select(map) {
        setCurrentMap(map);
        onClose();
    }
</script>

{#if open}
<div class="modal-backdrop" on:click={onClose}>
    <div class="modal" on:click|stopPropagation>
        <header>
            <h3>Select Map</h3>
            <div class="actions">
                <button on:click={() => { editingMap = null; showUpload = true; }}>Upload Map</button>
                <button class="close" on:click={onClose} aria-label="Close">
                    <X size={16} stroke-width="2" />
                </button>
            </div>
        </header>

        <div class="filters">
            <input
                type="text"
                placeholder="Search name or location..."
                bind:value={search}
            />
            <select bind:value={locationFilter}>
                <option value="">All locations</option>
                {#each Array.from(new Set($maps.map(m => m.location).filter(Boolean))) as loc}
                    <option value={loc}>{loc}</option>
                {/each}
            </select>
        </div>

        <div class="map-list">
            {#if filtered.length === 0}
                <div class="empty">No maps found</div>
            {:else}
                {#each filtered as map (map.id)}
                    <div class={`map-row ${$currentMap?.id === map.id ? 'active' : ''}`}>
                        <button class="row-main" on:click={() => select(map)}>
                            <div class="thumb">
                                <img src={map.src} alt={map.name} />
                            </div>
                            <div class="details">
                                <div class="name">{map.name}</div>
                                <div class="meta">
                                    <span>{map.location || "Unspecified"}</span>
                                    <span>Tokens: {tokensOnMap(map.id)}</span>
                                </div>
                            </div>
                        </button>
                        <button class="edit" on:click={() => { editingMap = map; showUpload = true; }} aria-label="Edit map">
                            <Pencil size={16} stroke-width="2" />
                        </button>
                    </div>
                {/each}
            {/if}
        </div>
    </div>

    <MapUploadModal open={showUpload} onClose={() => { showUpload = false; editingMap = null; }} map={editingMap} existingLocations={$maps.map(m => m.location).filter(Boolean)} />
</div>
{/if}

<style>
.modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 60;
}
.modal {
    width: min(900px, 95vw);
    background: #1a1a1a;
    color: #f5f5f5;
    border: 1px solid #333;
    border-radius: 10px;
    padding: 14px;
    box-shadow: 0 10px 40px rgba(0,0,0,0.5);
    max-height: 90vh;
    display: flex;
    flex-direction: column;
}
header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 10px;
}
.actions {
    display: flex;
    gap: 8px;
}
.actions button,
.close {
    padding: 6px 10px;
    background: #2c2c2c;
    color: #fff;
    border: 1px solid #555;
    border-radius: 6px;
    cursor: pointer;
}
.close {
    width: 30px;
}
.filters {
    display: flex;
    gap: 8px;
    margin-bottom: 10px;
}
.filters input,
.filters select {
    flex: 1;
    padding: 8px;
    background: #111;
    border: 1px solid #444;
    color: #fff;
    border-radius: 6px;
}
.filters select {
    flex: 0 0 180px;
}
.map-list {
    overflow-y: auto;
    border: 1px solid #333;
    border-radius: 8px;
    background: #0f0f0f;
    flex: 1;
}
.map-row {
    display: flex;
    align-items: stretch;
    gap: 6px;
    padding: 6px 8px;
    border-bottom: 1px solid #222;
}
.map-row:hover {
    background: #1f1f1f;
}
.map-row.active {
    background: #2d4c7c;
}
.row-main {
    flex: 1;
    background: none;
    border: none;
    color: #fff;
    display: flex;
    gap: 10px;
    cursor: pointer;
    text-align: left;
}
.thumb {
    width: 100px;
    height: 70px;
    overflow: hidden;
    border: 1px solid #333;
    border-radius: 6px;
    flex-shrink: 0;
}
.thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}
.details {
    display: flex;
    flex-direction: column;
    gap: 4px;
}
.name {
    font-weight: 700;
}
.meta {
    display: flex;
    gap: 12px;
    font-size: 0.9rem;
    color: #cfd8e3;
}
.edit {
    width: 32px;
    background: #2c2c2c;
    color: #fff;
    border: 1px solid #555;
    border-radius: 6px;
    cursor: pointer;
}
.empty {
    padding: 12px;
    color: #aaa;
}
</style>
