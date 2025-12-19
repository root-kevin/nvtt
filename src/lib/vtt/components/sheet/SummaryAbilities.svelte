<script>
    import { createEventDispatcher } from "svelte";
    import { computeAbilityMods } from "$lib/vtt/5e/computeModifiers.js";

    export let sheet = null;
    export let token = null;
    export let onBatch = () => {};
    export let readOnly = false;

    const abilityOrder = ["str", "dex", "con", "int", "wis", "cha"];
    const dispatch = createEventDispatcher();

    let draft = {};
    let originId = null;

    // Initialize ONLY when switching tokens
    $: if (sheet && token) {
        if (originId !== token.id) {
            originId = token.id;
            draft = { ...sheet.abilities };
        }
    }


    // Mods update normally
    $: draftMods = computeAbilityMods(draft);

    function updateAbility(key, value) {
        if (readOnly) return;
        const num = Number(value);
        draft[key] = Number.isFinite(num) ? num : draft[key];

        const cleaned = {};
        abilityOrder.forEach(k => cleaned[k] = draft[k]);

        dispatch("batch", cleaned);
        onBatch(cleaned);
    }

    function formatMod(v) {
        if (v == null || Number.isNaN(v)) return "—";
        return v >= 0 ? `+${v}` : `${v}`;
    }
</script>

<div class="card ability-card">
    <div class="card-title-row">
        <div class="card-title">Ability Scores</div>
    </div>

    <div class="ability-grid">
        {#each abilityOrder as key}
            <div class="ability-box">
                <div class="abl-label">{key.toUpperCase()}</div>

                <input
                    class="abl-input"
                    type="number"
                    bind:value={draft[key]}
                    on:blur={(e) => updateAbility(key, e.target.value)}
                    disabled={readOnly}
                />

                <div class="abl-mod">{formatMod(draftMods?.[key])}</div>
            </div>
        {/each}
    </div>
</div>


<style>
    .card-title-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 6px;
    }

    .ability-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
    }

    .ability-box {
        background: linear-gradient(180deg, rgba(255,255,255,0.03), rgba(0,0,0,0.35));
        border: 1px solid #2a3240;
        border-radius: 12px;
        padding: 8px;
        text-align: center;
    }

    .abl-label {
        font-size: 0.72rem;
        letter-spacing: 0.08em;
        color: #d1c184;
        margin-bottom: 4px;
    }

    .abl-input {
        width: 100%;
        text-align: center;
        background: #070a12;
        border: 1px solid #3b4253;
        border-radius: 8px;
        color: #f7f9fc;
        font-size: 0.9rem;
        margin-bottom: 4px;
        padding: 4px 2px;
    }

    .abl-mod {
        font-size: 0.9rem;
        color: #c4d0e6;
        margin-top: 2px;
    }
</style>
