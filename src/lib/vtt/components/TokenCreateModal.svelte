<script>
    import { onMount } from "svelte";
    import { get } from "svelte/store";
    import { X } from "@lucide/svelte";

    import { tokens, upsertToken, registerLocalTokenUpdate } from "$lib/vtt/tokens/store.js";
    import { sendWS } from "$lib/ws.js";
    import {
        tokenLibrary,
        loadLibraryFromServer,
        addTemplate
    } from "$lib/vtt/tokens/library.js";
    import { centerOnView } from "$lib/vtt/utils/placement.js";
    import { pan, zoom } from "$lib/vtt/panzoom/store.js";
    import { resolveTokenSize } from "$lib/vtt/tokens/size.js";
    import { computeTemplateHp } from "$lib/vtt/tokens/hpUtils.js";
    import { assignTokenNameForSpawn } from "$lib/vtt/tokens/nameTools.js";

    const DEFAULT_IMAGE =
        "https://images.dndbeyond.com/avatars/4675/675/636747837794884984.jpeg?width=128&height=128";

    export let open = false;
    export let onClose = () => {};
    export let mapId = "default";
    export let gridSizePx = 64;
    export let mapWidth = 3000;
    export let mapHeight = 3000;

    const SIZE_PRESETS = [
        { label: "Tiny",       feet: 2.5 },
        { label: "Small",      feet: 5 },
        { label: "Medium",     feet: 5 },
        { label: "Large",      feet: 10 },
        { label: "Huge",       feet: 15 },
        { label: "Gargantuan", feet: 20 }
    ];

    const ATTITUDE_OPTIONS = [
        { value: "ally",    label: "Ally" },
        { value: "neutral", label: "Indifferent" },
        { value: "enemy",   label: "Enemy" }
    ];

    // ------------------------------
    // STATE
    // ------------------------------
    let activeTab = "basic"; // "basic" | "json"
    let showAdvanced = false;

    let name = "";
    let imageUrl = DEFAULT_IMAGE;
    let file = null;
    let previewSrc = "";

    let sizeSelection = "Medium";
    let customFeet = 20;

    let maxHp = "";
    let ac = "";
    let race = "";
    let primaryClass = "";

    let attitude = "neutral";     // ally | neutral | enemy
    let shareHP = false;          // share HP across maps

    // cosmetic / optional
    let frameColor = "";          // token border color (optional)

    // base template from library (player / bestiary / etc.)
    let baseTemplateId = "";
    let baseTemplate = null;

    // JSON import
    let rawJson = "";
    let jsonError = "";
    let importedSheet = null; // full 5eTools-style monster object

    // auto-subscribe to library
    $: library = $tokenLibrary;

    onMount(() => {
        loadLibraryFromServer();
    });

    // ------------------------------
    // Helpers: parsing JSON statblocks
    // ------------------------------
    const SIZE_FEET = {
        T: 2.5,
        S: 5,
        M: 5,
        L: 10,
        H: 15,
        G: 20
    };

    const SIZE_LABEL = {
        T: "Tiny",
        S: "Small",
        M: "Medium",
        L: "Large",
        H: "Huge",
        G: "Gargantuan"
    };

    function parseAC(acVal) {
        if (!acVal) return null;
        if (Array.isArray(acVal) && acVal.length) {
            const v = acVal[0];
            if (typeof v === "number") return v;
            if (typeof v?.ac === "number") return v.ac;
            if (typeof v?.value === "number") return v.value;
        }
        if (typeof acVal === "number") return acVal;
        return null;
    }

    function parseHP(hpVal) {
        if (!hpVal) return null;
        if (typeof hpVal.average === "number") return hpVal.average;
        if (typeof hpVal.hp === "number") return hpVal.hp;
        if (typeof hpVal === "number") return hpVal;
        return null;
    }

    function parseType(t) {
        if (!t) return "";
        if (typeof t === "string") return t;
        if (t.type) return t.type;
        return "";
    }

    function guessAttitudeFromSource(src) {
        if (!src) return "neutral";
        if (src === "dndbeyond" || src === "player") return "ally";
        if (src === "5etools" || src === "bestiary") return "enemy";
        return "neutral";
    }

    function guessShareHPFromSource(src) {
        if (!src) return false;
        if (src === "dndbeyond" || src === "player" || src === "individual") return true;
        return false; // bestiary etc. default false
    }

    function tokenUrlFromMon(mon) {
        if (mon?.tokenHref?.url) return mon.tokenHref.url;
        return imageUrl || DEFAULT_IMAGE;
    }

    // ------------------------------
    // File upload / preview
    // ------------------------------
    async function handleFiles(list) {
        const f = list?.[0];
        if (!f) return;
        file = f;
        if (previewSrc) URL.revokeObjectURL(previewSrc);
        previewSrc = URL.createObjectURL(f);
    }

    async function ensureUpload() {
        // If a file was uploaded, send it; otherwise use whatever URL is set
        if (!file) {
            return imageUrl || DEFAULT_IMAGE;
        }

        const form = new FormData();
        form.append("file", file);

        const res = await fetch("/api/upload-token", { method: "POST", body: form });
        if (!res.ok) throw new Error("Upload failed");

        const data = await res.json();
        imageUrl = data.src;
        return imageUrl;
    }

    function centerCoords() {
        return centerOnView(
            { width: mapWidth, height: mapHeight },
            get(pan),
            get(zoom),
            gridSizePx
        );
    }

    function reset() {
        name = "";
        imageUrl = DEFAULT_IMAGE;
        previewSrc = "";
        file = null;
        sizeSelection = "Medium";
        customFeet = 20;
        maxHp = "";
        ac = "";
        race = "";
        primaryClass = "";
        attitude = "neutral";
        shareHP = false;
        frameColor = "";
        baseTemplateId = "";
        baseTemplate = null;
        rawJson = "";
        jsonError = "";
        importedSheet = null;
        activeTab = "basic";
        showAdvanced = false;
    }

    // ------------------------------
    // Base template selection
    // ------------------------------
    function onBaseTemplateChange(id) {
        baseTemplateId = id || "";
        baseTemplate = library.find(t => t.id === id) || null;

        if (!baseTemplate) {
            // reset defaults for “no base”
            attitude = "neutral";
            shareHP = false;
            return;
        }

        // Pre-fill basic fields
        name = baseTemplate.name || name;
        if (baseTemplate.img) {
            imageUrl = baseTemplate.img;
            previewSrc = ""; // use url instead of old preview
        }

        if (typeof baseTemplate.hp === "number") {
            maxHp = String(baseTemplate.hp);
        }
        if (typeof baseTemplate.ac === "number") {
            ac = String(baseTemplate.ac);
        }

        if (baseTemplate.sizeFeet) {
            // choose best matching preset
            const preset = SIZE_PRESETS.find(p => p.feet === baseTemplate.sizeFeet);
            if (preset) {
                sizeSelection = preset.label;
                if (preset.label === "Gargantuan") {
                    customFeet = baseTemplate.sizeFeet;
                }
            }
        }

        race = baseTemplate.race || race;
        primaryClass = baseTemplate.class || primaryClass;

        const src = baseTemplate.templateSource || baseTemplate.source || "";
        attitude = guessAttitudeFromSource(src);
        shareHP = guessShareHPFromSource(src);
    }

    // ------------------------------
    // JSON IMPORT
    // ------------------------------
    function applyJsonToForm(mon) {
        if (!mon || typeof mon !== "object") return;

        // name
        if (mon.name) name = mon.name;

        // size
        const letter = Array.isArray(mon.size) ? mon.size[0] : mon.size;
        if (letter) {
            const feet = SIZE_FEET[letter] ?? 5;
            const label = SIZE_LABEL[letter] ?? "Medium";

            const preset = SIZE_PRESETS.find(p => p.feet === feet);
            if (preset) {
                sizeSelection = preset.label;
            } else {
                sizeSelection = "Gargantuan";
                customFeet = feet;
            }
        }

        // AC / HP
        const parsedAc = parseAC(mon.ac);
        const parsedHp = parseHP(mon.hp);
        if (parsedAc !== null) ac = String(parsedAc);
        if (parsedHp !== null) maxHp = String(parsedHp);

        // Type / "race"
        const type = parseType(mon.type);
        if (type) race = type;

        // image
        const tokenUrl = tokenUrlFromMon(mon);
        if (tokenUrl) {
            imageUrl = tokenUrl;
            previewSrc = "";
        }

        // default attitude/shareHP from source
        const src = mon.source || "5etools";
        attitude = guessAttitudeFromSource("5etools");
        // bestiary defaults: enemies, no shared HP
        shareHP = false;
    }

    function importJson() {
        jsonError = "";
        importedSheet = null;

        if (!rawJson.trim()) return;

        try {
            const parsed = JSON.parse(rawJson);
            importedSheet = parsed;
            applyJsonToForm(parsed);
        } catch (err) {
            console.error(err);
            jsonError = "Invalid JSON. Check for trailing commas or syntax errors.";
        }
    }

    // ------------------------------
    // SUBMIT
    // ------------------------------
    async function submit(e) {
        e.preventDefault();
        if (!name) return;

        const { sizePx, sizeFeet, sizeLabel } = resolveTokenSize(
            sizeSelection,
            customFeet,
            gridSizePx
        );

        const src = await ensureUpload();
        const templateId = crypto.randomUUID();

        // Decide template source + source label
        let templateSource = "player";
        let source = "player";

        if (baseTemplate) {
            templateSource = "individual";
            source = baseTemplate.source || baseTemplate.templateSource || "player";
         } else if (importedSheet) {
    templateSource = "imported";
    source = importedSheet.source || "homebrew";
}


        // Build template
        const template = {
            id: templateId,
            name,
            img: src,
            hp: maxHp ? Number(maxHp) : null,
            ac: ac ? Number(ac) : null,
            sizeFeet,
            sizeLabel,
            race: race || null,
            class: primaryClass || null,
            source,
            templateSource,
            attitude,
            frameColor: frameColor || null
        };

        // Link to base template if one was chosen
        if (baseTemplate) {
            template.baseTemplateId = baseTemplate.id;
            template.originalName = baseTemplate.originalName || baseTemplate.name;
        }

        // If JSON statblock is present, stash it in `sheet`
        if (importedSheet) {
            template.sheet = importedSheet;
        }

        await addTemplate(template);

        // INSTANCE — map overrides, with numbering rule
        const { x, y } = centerCoords();
        const allTokens = get(tokens) || [];
        const siblings = allTokens.filter(
            t => t.mapId === mapId && t.templateId === templateId
        );

        const baseName = name?.trim() || "Token";
        const { updatedTokens, newName } = assignTokenNameForSpawn(baseName, siblings);
        const renames = updatedTokens.filter(u => {
            const original = siblings.find(t => t.id === u.id);
            return original && original.name !== u.name;
        });

        const sheet = normalizeSheet(template);
        const hpState = computeTemplateHp({
            ...template,
            overrides: template.overrides,
            bestiary: template.sheet ?? template.bestiary
        });
        const token = {
            id: crypto.randomUUID(),
            templateId,
            mapId,
            hidden: true,
            x,
            y,
            size: sizePx,
            sizeFeet,
            sizeLabel,
            name: newName,
            img: src,
            attitude,
            sheet,
            bestiary: sheet,
            currentHp: hpState.currentHp ?? null,
            maxHp: hpState.maxHp ?? null,
            tempHp: hpState.tempHp ?? 0,
            ...(shareHP ? { sharedHPGroupId: templateId } : {})
        };

        for (const tok of renames) {
            const updated = { ...tok, name: tok.name };
            await upsertToken(updated);
            registerLocalTokenUpdate(updated);
            sendWS({ type: "token-update", token: updated });
        }

        upsertToken(token);
        sendWS({ type: "token-add", token });

        reset();
        onClose();
    }
</script>

{#if open}
<div class="bg3-backdrop" on:click={onClose}>
    <div class="bg3-modal" on:click|stopPropagation>
        <header class="bg3-header">
            <h2>Create Token</h2>
            <button class="bg3-close" on:click={onClose}><X size="18" /></button>
        </header>

        <!-- Tabs -->
        <div class="bg3-tabs">
            <button
                class:bg3-tab-active={activeTab === "basic"}
                on:click={() => activeTab = "basic"}
            >
                Basics
            </button>
            <button
                class:bg3-tab-active={activeTab === "json"}
                on:click={() => activeTab = "json"}
            >
                JSON Import
            </button>
        </div>

        {#if activeTab === "basic"}
            <form class="bg3-form" on:submit|preventDefault={submit}>
                <!-- BASE TEMPLATE SELECT -->
                <div class="bg3-field">
                    <label>Base Template (optional)</label>
                    <select bind:value={baseTemplateId} on:change={(e) => onBaseTemplateChange(e.target.value)}>
                        <option value="">None</option>
                        {#each library as tmpl}
                            <option value={tmpl.id}>
                                {tmpl.name} {tmpl.templateSource ? `(${tmpl.templateSource})` : ""}
                            </option>
                        {/each}
                    </select>
                </div>

                <!-- NAME -->
                <div class="bg3-field">
                    <label>Name</label>
                    <input type="text" bind:value={name} required />
                </div>

                <!-- IMAGE -->
                <div class="bg3-row">
                    <div class="bg3-upload">
                        <label>Image</label>

                        <div
                            class="bg3-dropzone"
                            on:dragover|preventDefault
                            on:drop={e => handleFiles(e.dataTransfer.files)}
                        >
                            <p>Drop Image</p>
                            <input
                                type="file"
                                accept="image/*"
                                on:change={e => handleFiles(e.target.files)}
                            />
                        </div>

                        <input
                            type="text"
                            bind:value={imageUrl}
                            placeholder="Or paste image URL…"
                        />
                    </div>

                    <div class="bg3-preview">
                        {#if previewSrc}
                            <img src={previewSrc} alt="preview" />
                        {:else}
                            <img src={imageUrl} alt="preview" />
                        {/if}
                    </div>
                </div>

                <!-- SIZE + AC + HP -->
                <div class="bg3-row-3">
                    <div class="bg3-field">
                        <label>Size</label>
                        <select bind:value={sizeSelection}>
                            {#each SIZE_PRESETS as opt}
                                <option value={opt.label}>{opt.label}</option>
                            {/each}
                        </select>
                    </div>

                    {#if sizeSelection === "Gargantuan"}
                        <div class="bg3-field">
                            <label>Custom Feet</label>
                            <input
                                type="number"
                                bind:value={customFeet}
                                min="20"
                                step="5"
                            />
                        </div>
                    {/if}

                    <div class="bg3-field">
                        <label>AC</label>
                        <input type="number" bind:value={ac} min="0" />
                    </div>

                    <div class="bg3-field">
                        <label>HP</label>
                        <input type="number" bind:value={maxHp} min="0" />
                    </div>
                </div>

                <!-- RACE + CLASS -->
                <div class="bg3-row-2">
                    <div class="bg3-field">
                        <label>Race / Type</label>
                        <input type="text" bind:value={race} />
                    </div>

                    <div class="bg3-field">
                        <label>Class / Role</label>
                        <input type="text" bind:value={primaryClass} />
                    </div>
                </div>

                <!-- ATTITUDE + HP SHARING -->
                <div class="bg3-row-2">
                    <div class="bg3-field">
                        <label>Attitude</label>
                        <select bind:value={attitude}>
                            {#each ATTITUDE_OPTIONS as opt}
                                <option value={opt.value}>{opt.label}</option>
                            {/each}
                        </select>
                    </div>

                    <div class="bg3-field checkbox-field">
                        <label>
                            <input
                                type="checkbox"
                                bind:checked={shareHP}
                            />
                            Persistent HP across maps
                        </label>
                        <small>
                            PCs: usually ON. Monsters: usually OFF.
                        </small>
                    </div>
                </div>

                <!-- ADVANCED TOGGLE -->
                <button
                    type="button"
                    class="bg3-advanced-toggle"
                    on:click={() => showAdvanced = !showAdvanced}
                >
                    {showAdvanced ? "Hide Advanced" : "Show Advanced"}
                </button>

                {#if showAdvanced}
                    <div class="bg3-advanced">
                        <div class="bg3-field">
                            <label>Token Border Color</label>
                            <input type="color" bind:value={frameColor} />
                        </div>
                        <!-- Placeholder for future: stats, speed, etc.
                             JSON import will still store full sheet → template.sheet -->
                        <p class="advanced-note">
                            Advanced stat editing will live here.
                            JSON import already stores the full statblock into the template.
                        </p>
                    </div>
                {/if}

                <div class="bg3-actions">
                    <button
                        type="button"
                        class="bg3-cancel"
                        on:click={onClose}
                    >
                        Cancel
                    </button>
                    <button type="submit" class="bg3-primary">Create</button>
                </div>
            </form>
        {:else}
            <!-- JSON IMPORT TAB -->
            <div class="bg3-form">
                <div class="bg3-field">
                    <label>Paste 5eTools-style JSON</label>
                    <textarea
                        rows="14"
                        bind:value={rawJson}
                        placeholder='Paste the full JSON for a single creature (e.g. "Spinosaurus Dinosaur")'
                    ></textarea>
                    {#if jsonError}
                        <div class="json-error">{jsonError}</div>
                    {/if}
                </div>

                <div class="bg3-actions">
                    <button
                        type="button"
                        class="bg3-cancel"
                        on:click={() => { rawJson = ""; jsonError = ""; importedSheet = null; }}
                    >
                        Clear
                    </button>
                    <button
                        type="button"
                        class="bg3-primary"
                        on:click={importJson}
                    >
                        Import JSON → Fill Form
                    </button>
                </div>

                <p class="json-help">
                    After import, switch back to <strong>Basics</strong> to review the auto-filled name, size, HP, AC,
                    and image. The full statblock is saved into the template for later use.
                </p>
            </div>
        {/if}
    </div>
</div>
{/if}

<style>
.bg3-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(5, 5, 5, 0.7);
    backdrop-filter: blur(4px);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 2000;
}

.bg3-modal {
    width: 580px;
    max-height: 90vh;
    overflow-y: auto;
    background: rgba(22, 22, 22, 0.92);
    border: 1px solid rgba(190, 160, 80, 0.4);
    border-radius: 14px;
    padding: 20px;
    box-shadow: 0 0 30px rgba(0, 0, 0, 0.6);
    color: #eee;
    font-family: "Inter", sans-serif;
}

.bg3-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-bottom: 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}
.bg3-header h2 {
    font-size: 1.4rem;
    font-weight: 600;
}
.bg3-close {
    background: none;
    border: none;
    color: #aaa;
    cursor: pointer;
    padding: 4px;
}
.bg3-close:hover {
    color: #fff;
}

.bg3-tabs {
    display: flex;
    gap: 8px;
    margin-top: 12px;
    margin-bottom: 12px;
}
.bg3-tabs button {
    flex: 0 0 auto;
    padding: 6px 12px;
    border-radius: 999px;
    border: 1px solid transparent;
    background: rgba(255, 255, 255, 0.04);
    color: #eee;
    font-size: 0.85rem;
    cursor: pointer;
}
.bg3-tabs button.bg3-tab-active {
    background: linear-gradient(to bottom, #d4b56a, #b89449);
    color: #111;
    border-color: rgba(255, 255, 255, 0.2);
}

.bg3-form {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.bg3-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.bg3-field label {
    font-size: 0.85rem;
    color: #d8c48c;
}
.bg3-field input,
.bg3-field select,
.bg3-field textarea {
    padding: 8px 10px;
    background: rgba(0, 0, 0, 0.35);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: #eee;
    border-radius: 6px;
    outline: none;
    font-family: inherit;
    font-size: 0.9rem;
}
.bg3-field input:focus,
.bg3-field select:focus,
.bg3-field textarea:focus {
    border-color: rgba(210, 180, 100, 0.7);
}

.bg3-row {
    display: grid;
    grid-template-columns: 1fr 120px;
    gap: 12px;
}
.bg3-row-2 {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
}
.bg3-row-3 {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 12px;
}

.bg3-upload input[type="file"] {
    display: none;
}
.bg3-dropzone {
    background: rgba(255, 255, 255, 0.05);
    border: 1px dashed rgba(255, 255, 255, 0.2);
    padding: 16px;
    text-align: center;
    font-size: 0.8rem;
    border-radius: 8px;
    cursor: pointer;
}
.bg3-dropzone:hover {
    border-color: rgba(210, 180, 100, 0.5);
}

.bg3-preview img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 8px;
}

.bg3-actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    padding-top: 8px;
}

.bg3-cancel {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.1);
    padding: 8px 16px;
    border-radius: 6px;
    cursor: pointer;
    color: #eee;
}
.bg3-cancel:hover {
    background: rgba(255, 255, 255, 0.15);
}

.bg3-primary {
    background: linear-gradient(to bottom, #d4b56a, #b89449);
    border: 1px solid rgba(255, 255, 255, 0.2);
    padding: 8px 16px;
    border-radius: 6px;
    cursor: pointer;
    color: #1a1a1a;
    font-weight: 600;
}
.bg3-primary:hover {
    background: linear-gradient(to bottom, #e1c279, #c6a356);
}

.bg3-advanced-toggle {
    margin-top: 4px;
    align-self: flex-start;
    background: none;
    border: none;
    color: #d8c48c;
    font-size: 0.85rem;
    cursor: pointer;
    padding: 0;
}
.bg3-advanced-toggle:hover {
    text-decoration: underline;
}

.bg3-advanced {
    padding: 10px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.advanced-note {
    font-size: 0.8rem;
    color: #aaa;
}

.checkbox-field label {
    display: flex;
    align-items: center;
    gap: 6px;
}
.checkbox-field small {
    font-size: 0.75rem;
    color: #aaa;
}

.json-error {
    color: #ff7a7a;
    font-size: 0.8rem;
}
.json-help {
    font-size: 0.8rem;
    color: #aaa;
}
</style>
