<script>
    import { derived, writable, get } from "svelte/store";
    import {
        tokenLibrary,
        addTemplate,
        removeTemplateById,
        loadLibraryFromServer,
        replaceTemplate
    } from "$lib/vtt/tokens/library.js";
    import { currentMap } from "$lib/vtt/map/store.js";
    import { tokens, upsertToken, registerLocalTokenUpdate } from "$lib/vtt/tokens/store.js";
    import { sendWS } from "$lib/ws.js";
    import { centerOnView } from "$lib/vtt/utils/placement.js";
    import { pan, zoom } from "$lib/vtt/panzoom/store.js";
    import { loadBestiary } from "$lib/vtt/data/bestiaryLoader.js";
    import { loadPlayers } from "$lib/vtt/data/playerLoader.js";
    import { saveCustomCreature } from "$lib/vtt/tokens/customLibrary.js";
    import TokenDetails from "$lib/vtt/components/TokenDetails.svelte";

    import { shorthandEnabled } from "$lib/vtt/settings/store.js";
    import { toShorthand, assignTokenNameForSpawn } from "$lib/vtt/tokens/nameTools.js";

    import { X, Plus, Trash2, Copy, Edit } from "@lucide/svelte";

    import { customLibraryStore, updateCustomCreature } from "$lib/vtt/tokens/customLibrary.js";
    import { applyOverrides, normalizeSheet } from "$lib/vtt/5e/normalizeSheet.js";
    import { computeTemplateHp } from "$lib/vtt/tokens/hpUtils.js";


    export let open = false;
    export let onClose = () => {};
    export let onAddCustom = () => {};

    const search = writable("");
    const bestiaryStore = writable([]);
    const playerStore = writable([]);

    let tab = "library";
    let bestiaryLoading = false;
    let playersLoading = false;
    let bestiaryError = "";
    let playersError = "";

    const placeholderImg = "/tokens/player.png";
    let inspectTemplate = null;
    let detailsPos = { x: 180, y: 80 };

    function norm(v) {
        if (!v) return "";
        if (typeof v === "string") return v.toLowerCase();
        if (Array.isArray(v)) return v.join(" ").toLowerCase();
        if (typeof v === "object") return Object.values(v).join(" ").toLowerCase();
        return String(v).toLowerCase();
    }

    // -------------------------------------------------------
    // SEARCH (debounced)
    // -------------------------------------------------------
    const debouncedSearch = derived(search, ($s, set) => {
        const id = setTimeout(() => set($s), 200);
        return () => clearTimeout(id);
    });

    const filteredLibrary = derived(
        [tokenLibrary, debouncedSearch],
        ([$lib, $search]) => {
            const q = ($search || "").toLowerCase().trim();
            if (!q) return $lib;

            return $lib.filter(t => {
                const name = norm(t.name);
                const race = norm(t.race);
                const cls  = norm(t.class);
                const src  = norm(t.source || t.templateSource);

                return (
                    name.includes(q) ||
                    race.includes(q) ||
                    cls.includes(q) ||
                    src.includes(q)
                );
            });
        }
    );

    const filteredBestiary = derived(
        [bestiaryStore, debouncedSearch],
        ([$list, $search]) => {
            const q = ($search || "").toLowerCase().trim();
            if (!q) return $list;

            return $list.filter(b => {
                const name = norm(b.name);
                const race = norm(b.race);
                const cls  = norm(b.class);
                const src  = norm(b.source);

                return (
                    name.includes(q) ||
                    race.includes(q) ||
                    cls.includes(q) ||
                    src.includes(q)
                );
            });
        }
    );

    const BESTIARY_LIMIT = 200;
    const bestiaryLimited = derived(filteredBestiary, ($list) => ({
        total: $list.length,
        results: $list.slice(0, BESTIARY_LIMIT)
    }));

    const filteredPlayers = derived(
        [playerStore, debouncedSearch],
        ([$list, $search]) => {
            const q = ($search || "").toLowerCase().trim();
            if (!q) return $list;

            return $list.filter(p => {
                const name = norm(p.name);
                const race = norm(p.race);
                const cls  = norm(p.class);
                const src  = norm(p.source);

                return (
                    name.includes(q) ||
                    race.includes(q) ||
                    cls.includes(q) ||
                    src.includes(q)
                );
            });
        }
    );

    // -------------------------------------------------------
    // SIZE HELPERS
    // -------------------------------------------------------
    function computeTokenSizePx(sizeFeet, gridSizePx) {
        const feet = sizeFeet ?? 5;
        const grid = gridSizePx || 64;
        return (feet / 5) * grid;
    }

    function clone(val) {
        try {
            return structuredClone(val);
        } catch (err) {
            return JSON.parse(JSON.stringify(val));
        }
    }

    function getBaseMaxHpFromTemplate(template = {}) {
        const hp = template.overrides?.hp || {};
        return hp.baseMaxHp ?? template.maxHp ?? template.hp ?? template.bestiary?.hp?.average ?? null;
    }

    function getPersistentHpFromTemplate(template = {}) {
        const baseMax = getBaseMaxHpFromTemplate(template) ?? 1;
        const hp = template.overrides?.hp || {};
        return {
            maxHp: hp.baseMaxHp ?? baseMax,
            currentHp: hp.currentHp ?? hp.baseMaxHp ?? baseMax,
            tempHp: hp.tempHp ?? 0
        };
    }

    function buildTokenFromTemplate(template, templateIdOverride = null, nameOverride = null) {
        if (!template) return null;
        const baseId = template.baseTemplateId || template.id;
        const bestiary = clone(template.bestiary || template.sheet || template);
        const sheet = bestiary
            ? normalizeSheet(
                  bestiary,
                  template.overrides || {},
                  { name: nameOverride || template.name, templateId: templateIdOverride || template.id, baseTemplateId: baseId }
              )
            : null;

        const hpState = computeTemplateHp({
            ...template,
            overrides: template.overrides,
            bestiary
        });

        return {
            templateId: templateIdOverride || template.id,
            baseTemplateId: baseId,
            name: nameOverride || template.name,
            img: template.img,
            bestiary,
            sheet,
            sizeFeet: template.sizeFeet,
            sizeLabel: template.sizeLabel,
            currentHp: hpState.currentHp ?? null,
            maxHp: hpState.maxHp ?? null,
            tempHp: hpState.tempHp ?? 0,
            ac: template.ac ?? sheet?.ac ?? null,
            consistentHp: template.consistentHp || false,
            skillsBase: template.overrides?.skillsBase || template.skillsBase || {},
            savesBase: template.overrides?.savesBase || template.savesBase || {}
        };
    }

    function templateToToken(template, templateIdOverride = null, nameOverride = null) {
        if (!template) return null;
        const baseId = template.baseTemplateId || template.id;
        const bestiary = clone(template.bestiary || template.sheet || template);
        const sheet = bestiary
            ? normalizeSheet(
                  bestiary,
                  template.overrides || {},
                  { name: nameOverride || template.name, templateId: templateIdOverride || template.id, baseTemplateId: baseId }
              )
            : null;

        const hpState = computeTemplateHp({
            ...template,
            overrides: template.overrides,
            bestiary
        });

        const tokenId = crypto.randomUUID();

        return {
            id: tokenId,
            templateId: templateIdOverride || template.id,
            baseTemplateId: baseId,
            name: nameOverride || template.name,
            img: template.img,
            bestiary,
            sheet,
            sizeFeet: template.sizeFeet,
            sizeLabel: template.sizeLabel,
            currentHp: hpState.currentHp ?? sheet?.hp?.currentHp ?? sheet?.hp?.maxHp ?? null,
            maxHp: hpState.maxHp ?? sheet?.hp?.maxHp ?? null,
            tempHp: hpState.tempHp ?? sheet?.hp?.tempHp ?? 0,
            ac: template.ac ?? sheet?.ac ?? null,
            consistentHp: template.consistentHp || false
        };
    }

    function mergeOverrides(base = {}, patch = {}) {
        return applyOverrides(base || {}, patch || {});
    }

    function recomputeTokenFromTemplate(token, template) {
        if (!template?.bestiary) return token;
        const hpState = template.consistentHp
            ? computeTemplateHp({ ...template, overrides: template.overrides, bestiary: template.bestiary })
            : {
                  maxHp: token?.maxHp ?? getBaseMaxHpFromTemplate(template),
                  currentHp: token?.currentHp ?? getBaseMaxHpFromTemplate(template),
                  tempHp: token?.tempHp ?? 0
              };

        const mergedOverrides = mergeOverrides(template.overrides || {}, {
            abilities: token?.abilities,
            skills: token?.skills,
            saves: token?.saves,
            passives: token?.passives
        });
        const sheet = normalizeSheet(template.bestiary, mergedOverrides, {
            name: token?.name || template.name,
            templateId: template.id,
            baseTemplateId: template.baseTemplateId || template.id
        });

        return {
            ...token,
            bestiary: template.bestiary,
            sheet,
            currentHp: hpState.currentHp,
            maxHp: hpState.maxHp,
            tempHp: hpState.tempHp,
            ac: template.ac ?? sheet?.ac ?? token?.ac,
            sizeFeet: template.sizeFeet ?? token?.sizeFeet,
            sizeLabel: template.sizeLabel ?? token?.sizeLabel,
            consistentHp: template.consistentHp || false
        };
    }

    async function handleTemplateSave(event) {
        const { templateId, changes } = event.detail || {};
        if (!templateId) return;

        const lib = get(tokenLibrary) || [];
        const baseTemplate = lib.find((t) => t.id === templateId) || { id: templateId };
        const overridePatch = changes?.overrides || {};
        const nextOverrides = mergeOverrides(baseTemplate.overrides || {}, overridePatch);
        const consistentHp = "consistentHp" in changes ? changes.consistentHp : baseTemplate.consistentHp;

        if (!consistentHp && nextOverrides.hp) {
            const baseMax = nextOverrides.hp.baseMaxHp;
            nextOverrides.hp = baseMax != null ? { baseMaxHp: baseMax } : {};
        } else if (consistentHp && nextOverrides.hp) {
            nextOverrides.hp.baseMaxHp = nextOverrides.hp.baseMaxHp ?? baseTemplate.maxHp;
            nextOverrides.hp.currentHp = nextOverrides.hp.currentHp ?? nextOverrides.hp.baseMaxHp;
            nextOverrides.hp.tempHp = nextOverrides.hp.tempHp ?? 0;
        }

        const mergedTemplate = {
  ...baseTemplate,
  ...("name" in changes ? { name: changes.name } : {}),
  overrides: nextOverrides,
  consistentHp,

  // DO NOT persist derived stats
  // HP / AC / skills are resolved by TokenDetails at runtime
};


        if (templateId.startsWith("custom-")) {
            const current = (get(customLibraryStore) || {})[templateId] || {};
            updateCustomCreature(templateId, {
                overrides: mergedTemplate.overrides,
                name: mergedTemplate.name ?? current.name
            });

            tokenLibrary.update((list) =>
                list.map((t) => (t.id === templateId ? mergedTemplate : t))
            );
        } else {
            await replaceTemplate(mergedTemplate);
            tokenLibrary.update((list) =>
                list.map((t) => (t.id === templateId ? mergedTemplate : t))
            );
        }

        const updatedTokens = [];
        tokens.update((list) =>
            list.map((tok) => {
                if (tok.templateId !== templateId) return tok;
                const next = recomputeTokenFromTemplate(tok, mergedTemplate);
                updatedTokens.push(next);
                return next;
            })
        );
        updatedTokens.forEach((tok) => {
            registerLocalTokenUpdate(tok);
            sendWS({ type: "token-update", token: tok });
        });
    }


    // -------------------------------------------------------
    // LOAD BESTIARY
    // -------------------------------------------------------
    async function ensureBestiary() {
        if (bestiaryLoading || get(bestiaryStore).length) return;
        bestiaryLoading = true;

        try {
            const list = await loadBestiary();
            bestiaryStore.set(list || []);
            bestiaryError = "";
        } catch (err) {
            console.error(err);
            bestiaryError = "Failed to load bestiary.";
        } finally {
            bestiaryLoading = false;
        }
    }

    // -------------------------------------------------------
    // LOAD PLAYERS
    // -------------------------------------------------------
    async function ensurePlayers() {
        if (playersLoading || get(playerStore).length) return;
        playersLoading = true;

        try {
            const list = await loadPlayers();
            playerStore.set(list || []);
            playersError = list && list.length ? "" : "No player tokens found.";
        } catch (err) {
            console.error(err);
            playersError = "Failed to load player files.";
        } finally {
            playersLoading = false;
        }
    }

    // -------------------------------------------------------
    // PLACE TOKEN ON MAP (from template)
    // -------------------------------------------------------
    async function addToMapFromTemplate(template, { ensureInLibrary = false } = {}) {
        const map = get(currentMap);
        if (!map?.id) return;

        const grid = map.gridSizePx ?? 64;
        const sizeFeet = template.sizeFeet ?? 5;
        const sizePx = computeTokenSizePx(sizeFeet, grid);

        if (ensureInLibrary) {
            await addTemplate(template);
        }

        const currentTokens = get(tokens) || [];
        const siblings = currentTokens.filter(
            (t) => t.mapId === map.id && t.templateId === template.id
        );

        const baseName = template.name?.trim() || "Token";
        const { updatedTokens, newName } = assignTokenNameForSpawn(baseName, siblings);
        const renames = updatedTokens.filter(u => {
            const original = siblings.find(t => t.id === u.id);
            return original && original.name !== u.name;
        });

        const { x, y } = centerOnView(map, get(pan), get(zoom), sizePx);

        // Normalize: always hand tokens a usable sheet/bestiary reference.
        const baseSheet =
            template.sheet ||
            template.bestiary ||
            (template.trait || template.action || template.legendary || template.lair || template.regional || template.spellcasting || template.bonus || template.reaction
                ? { ...template }
                : null);

        const hpState = computeTemplateHp({
            ...template,
            overrides: template.overrides,
            bestiary: baseSheet
        });

        const token = {
            id: crypto.randomUUID(),
            templateId: template.id,
            baseTemplateId: template.baseTemplateId || template.id,
            img: template.img ?? null,
            mapId: map.id,
            templateSource: template.templateSource || "player",
            characterId: template.characterId ?? null,

            sheet: baseSheet,
            bestiary: baseSheet,

            x,
            y,
            hidden: true,

            size: sizePx,
            sizeFeet,
            sizeLabel: sizeFeet ? template.sizeLabel || `Size ${sizeFeet} ft` : template.sizeLabel,

            name: newName,
            currentHp: hpState.currentHp ?? null,
            maxHp: hpState.maxHp ?? null,
            tempHp: hpState.tempHp ?? 0,
            consistentHp: template.consistentHp || false,
            skillsBase: template.overrides?.skillsBase || template.skillsBase || {},
            savesBase: template.overrides?.savesBase || template.savesBase || {}
        };

        for (const tok of renames) {
            const updated = { ...tok, name: tok.name };
            await upsertToken(updated);
            registerLocalTokenUpdate(updated);
            sendWS({ type: "token-update", token: updated });
        }

        upsertToken(token);
        sendWS({ type: "token-add", token });
    }

    // -------------------------------------------------------
    // DELETE TEMPLATE (LIBRARY ONLY)
    // -------------------------------------------------------
    function deleteTemplateAndTokens(id) {
        if (!id) return;
        
        const template = get(tokenLibrary).find(t => t.id === id);
        const label = template?.name || "this template";

        const ok = confirm(`Are you sure you want to delete ${label} and all its tokens?`);
        if (!ok) return;

        removeTemplateById(id);
        tokens.update(list => list.filter(t => t.templateId !== id));
    }

    function openTemplateDetails(template) {
        const base = buildTokenFromTemplate(template, template.id, template.name);
        inspectTemplate = base ? { id: crypto.randomUUID(), ...base } : null;
    }

    function createCustomFromTemplate(template) {
        if (!template) return;
        const name = typeof prompt !== "undefined"
            ? prompt("Name for this creature", template.name || "Custom Creature")
            : null;
        if (name == null) return;
        const suffix = Math.random().toString(16).slice(2, 8);
        const newId = `${template.id}-${suffix}`;
        const cloned = { ...template, id: newId, name };
        addTemplate(cloned);
        const base = buildTokenFromTemplate(cloned, newId, name);
        inspectTemplate = base ? { id: crypto.randomUUID(), ...base } : null;
    }

    function handleDetailsUpdateFromLibrary(event) {
        const t = event.detail?.token;
        if (!t) return;
        inspectTemplate = t;
    }

    function displayRace(entry = {}) {
        const typeField = entry.type ?? entry.bestiary?.type;
        if (!typeField) return "";
        if (typeof typeField === "string") return typeField;
        if (typeof typeField === "object") {
            return typeof typeField.type === "string" ? typeField.type : "";
        }
        return "";
    }

    function displayClass(entry = {}) {
        const typeField = entry.type ?? entry.bestiary?.type;
        if (typeField && typeof typeField === "object" && Array.isArray(typeField.tags) && typeField.tags.length) {
            return typeField.tags.join(" / ");
        }
        return "";
    }

    // -------------------------------------------------------
    // LOAD USER LIBRARY WHEN OPENED
    // -------------------------------------------------------
    $: if (open) loadLibraryFromServer();
</script>

{#if open}
<div class="bg3-lib-panel" on:click|stopPropagation>
    <header class="bg3-lib-header">
        <div class="title-group">
            <h2>Token Library</h2>
            <p>Summon creatures, allies, and villains onto the battlefield.</p>
        </div>
        <button class="close-btn" on:click={onClose}>
            <X size="18" />
        </button>
    </header>

    <!-- Shorthand toggle (above tabs) -->
    <div class="bg3-lib-shorthand">
        <label>
            <input type="checkbox" bind:checked={$shorthandEnabled} />
            Use shorthand names
        </label>
    </div>

    <!-- Tabs -->
    <div class="bg3-lib-tabs">
        <button
            class:bg3-active={tab === "library"}
            on:click={() => (tab = "library")}
        >
            My Tokens
        </button>
        <button
            class:bg3-active={tab === "bestiary"}
            on:click={() => {
                tab = "bestiary";
                ensureBestiary();
            }}
        >
            Bestiary
        </button>
        <button
            class:bg3-active={tab === "players"}
            on:click={() => {
                tab = "players";
                ensurePlayers();
            }}
        >
            Players
        </button>
    </div>

    <!-- Search -->
    <div class="bg3-lib-search">
        <input
            type="text"
            placeholder="Search by name, race, class, or source…"
            bind:value={$search}
        />
    </div>

    <!-- CONTENT -->
    <div class="bg3-lib-content">
        {#if tab === "library"}
            {#if $filteredLibrary.length === 0}
                <div class="bg3-empty">
                    <p>No templates in your library yet.</p>
                    <button class="bg3-ghost" on:click={onAddCustom}>
                        <Plus size="16" /> Create Custom Token
                    </button>
                </div>
            {:else}
                <ul class="bg3-list">
                    {#each $filteredLibrary as t (t.id)}
                        <li
                            class="bg3-row"
                            draggable="true"
                            on:dragstart={e => {
                                e.dataTransfer.setData(
                                    "application/json",
                                    JSON.stringify({ templateId: t.id })
                                );
                            }}
                        >
                            <div class="row-left">
                                <div class="avatar">
                                    <img src={t.img || placeholderImg} alt={t.name} />
                                </div>
                                <div class="meta">
                                    <div class="name-line">
                                        <span class="name">
                                            {$shorthandEnabled ? toShorthand(t.name) : t.name}
                                        </span>
                                        {#if t.source || t.templateSource}
                                            <span class="source-pill">
                                                {(t.source || t.templateSource).toUpperCase()}
                                            </span>
                                        {/if}
                                    </div>

                                    <div class="sub">
                                        <span>
                                            {#if displayRace(t)}{displayRace(t)}{/if}
                                            {#if displayRace(t) && displayClass(t)} · {/if}
                                            {#if displayClass(t)}{displayClass(t)}{/if}
                                        </span>
                                        {#if t.cr !== undefined}
                                            <span class="sep">·</span>
                                            <span>CR {t.cr}</span>
                                        {/if}
                                    </div>

                                    <div class="stats">
                                        <span>HP {t.overrides?.hp?.baseMaxHp ?? t.bestiary?.hp?.average ?? "—"}</span>
                                        <span>AC {t.ac ?? t.overrides?.ac ?? t.bestiary?.ac?.[0]?.ac ?? "—"}</span>
                                    </div>
                                </div>
                            </div>

                            <div class="row-actions">
                                <button
                                    class="icon-btn"
                                    title="Create from template"
                                    on:click={() => createCustomFromTemplate(t)}
                                >
                                    <Copy size="16" />
                                </button>
                                <button
                                    class="icon-btn"
                                    title="Edit sheet"
                                    on:click={() => openTemplateDetails(t)}
                                >
                                    <Edit size="16" />
                                </button>
                                <button
                                    class="icon-btn danger"
                                    title="Delete from library"
                                    on:click={() => deleteTemplateAndTokens(t.id)}
                                >
                                    <Trash2 size="16" />
                                </button>
                            </div>
                        </li>
                    {/each}
                </ul>
            {/if}
        {:else if tab === "bestiary"}
            {#if bestiaryLoading}
                <div class="bg3-empty">
                    <p>Consulting dusty tomes… loading bestiary.</p>
                </div>
            {:else if bestiaryError}
                <div class="bg3-empty"><p>{bestiaryError}</p></div>
            {:else}
                <div class="bg3-notice">
                    Showing {$bestiaryLimited.results.length} of {$bestiaryLimited.total} creatures.
                </div>
                <ul class="bg3-list">
                    {#each $bestiaryLimited.results as b (b.id)}
                        <li
                            class="bg3-row"
                            draggable="true"
                            on:dragstart={async e => {
                                e.dataTransfer.setData(
                                    "application/json",
                                    JSON.stringify({ templateId: b.id })
                                );
                                await addTemplate(b);
                            }}
                        >
                            <div class="row-left">
                                <div class="avatar">
                                    <img src={b.img || placeholderImg} alt={b.name} />
                                </div>
                                <div class="meta">
                                    <div class="name-line">
                                        <span class="name">
                                            {$shorthandEnabled ? toShorthand(b.name) : b.name}
                                        </span>
                                        {#if b.source}
                                            <span class="source-pill">
                                                {b.source.toUpperCase()}
                                            </span>
                                        {/if}
                                    </div>

                                    <div class="sub">
                                        <span>
                                            {#if displayRace(b)}{displayRace(b)}{/if}
                                            {#if displayRace(b) && displayClass(b)} · {/if}
                                            {#if displayClass(b)}{displayClass(b)}{/if}
                                        </span>
                                        {#if b.cr !== undefined}
                                            <span class="sep">·</span>
                                            <span>CR {b.cr}</span>
                                        {/if}
                                    </div>

                                    <div class="stats">
                                        <span>HP {b.hp?.average ?? b.overrides?.hp?.baseMaxHp ?? b.bestiary?.hp?.average ?? "—"}</span>
                                        <span>AC {b.ac ?? b.overrides?.ac ?? b.bestiary?.ac?.[0]?.ac ?? "—"}</span>
                                    </div>
                                </div>
                            </div>

                            <div class="row-actions">
                                <button
                                    class="icon-btn"
                                    title="Place on map"
                                    on:click={() =>
                                        addToMapFromTemplate(b, { ensureInLibrary: true })
                                    }
                                >
                                    <Plus size="16" />
                                </button>
                            </div>
                        </li>
                    {/each}
                </ul>
            {/if}
        {:else}
            {#if playersLoading}
                <div class="bg3-empty">
                    <p>Gathering the party… loading player files.</p>
                </div>
            {:else if playersError}
                <div class="bg3-empty"><p>{playersError}</p></div>
            {:else if $filteredPlayers.length === 0}
                <div class="bg3-empty"><p>No player tokens detected.</p></div>
            {:else}
                <ul class="bg3-list">
                    {#each $filteredPlayers as p (p.id)}
                        <li
                            class="bg3-row"
                            draggable="true"
                            on:dragstart={async e => {
                                e.dataTransfer.setData(
                                    "application/json",
                                    JSON.stringify({ templateId: p.id })
                                );
                                await addTemplate(p);
                            }}
                        >
                            <div class="row-left">
                                <div class="avatar">
                                    <img src={p.img || placeholderImg} alt={p.name} />
                                </div>
                                <div class="meta">
                                    <div class="name-line">
                                        <span class="name">
                                            {$shorthandEnabled ? toShorthand(p.name) : p.name}
                                        </span>
                                        {#if p.source}
                                            <span class="source-pill">
                                                {p.source.toUpperCase()}
                                            </span>
                                        {/if}
                                    </div>

                                    <div class="sub">
                                        <span>
                                            {#if p.race}{p.race}{/if}
                                            {#if p.race && p.class} · {/if}
                                            {#if p.class}{p.class}{/if}
                                        </span>

                                        {#if p.level}
                                            <span class="sep">·</span>
                                            <span>Level {p.level}</span>
                                        {/if}
                                    </div>

                                    <div class="stats">
                                        <span>HP {p.maxHp ?? p.hp ?? "—"}</span>
                                        <span>AC {p.ac ?? "—"}</span>
                                    </div>
                                </div>
                            </div>

                            <div class="row-actions">
                                <button
                                    class="icon-btn"
                                    title="Place on map"
                                    on:click={() =>
                                        addToMapFromTemplate(p, { ensureInLibrary: true })
                                    }
                                >
                                    <Plus size="16" />
                                </button>
                            </div>
                        </li>
                    {/each}
                </ul>
            {/if}
        {/if}
    </div>

    <footer class="bg3-lib-footer">
        <button class="bg3-ghost" on:click={onAddCustom}>
            <Plus size="16" /> Create Custom Token
        </button>
    </footer>

{#if inspectTemplate}
    <TokenDetails
        token={inspectTemplate}
        mode="template"
        initialPos={detailsPos}
        onClose={() => (inspectTemplate = null)}
        on:saveTemplate={handleTemplateSave}
    />
{/if}

    
</div>
{/if}

<style>
/* Panel container */
.bg3-lib-panel {
    position: fixed;
    top: 10px;
    right: 10px;
    width: 420px;
    max-height: calc(100vh - 20px);
    display: flex;
    flex-direction: column;
    background: radial-gradient(
        circle at top left,
        #26222f 0%,
        #141018 40%,
        #08070a 100%
    );
    border-radius: 14px;
    border: 1px solid rgba(191, 160, 96, 0.45);
    box-shadow: 0 0 35px rgba(0, 0, 0, 0.7);
    color: #eee;
    font-family: "Inter", system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
    overflow: hidden;
    z-index: 1500;
}

/* Header */
.bg3-lib-header {
    padding: 14px 16px 10px 16px;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    background: linear-gradient(to bottom, rgba(0, 0, 0, 0.45), transparent);
}
.bg3-lib-header h2 {
    font-size: 1.25rem;
    margin: 0;
    font-weight: 600;
}
.bg3-lib-header p {
    margin: 4px 0 0 0;
    font-size: 0.85rem;
    color: #c7bda0;
}
.title-group {
    max-width: 320px;
}

.close-btn {
    border: none;
    background: none;
    color: #aaa;
    cursor: pointer;
    padding: 2px;
    border-radius: 999px;
}
.close-btn:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.05);
}

/* Shorthand toggle */
.bg3-lib-shorthand {
    padding: 4px 12px 0 12px;
    font-size: 0.8rem;
    color: #d7d2c6;
}
.bg3-lib-shorthand label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
}
.bg3-lib-shorthand input[type="checkbox"] {
    accent-color: #d8b874;
}

/* Tabs */
.bg3-lib-tabs {
    display: flex;
    padding: 8px 10px 0 10px;
    gap: 6px;
}
.bg3-lib-tabs button {
    flex: 1;
    padding: 6px 10px;
    font-size: 0.9rem;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: radial-gradient(
        circle at top,
        rgba(255, 255, 255, 0.05),
        rgba(0, 0, 0, 0.3)
    );
    color: #d7d2c6;
    cursor: pointer;
}
.bg3-lib-tabs button:hover {
    border-color: rgba(255, 255, 255, 0.18);
}
.bg3-lib-tabs button.bg3-active {
    background: linear-gradient(to bottom, #d8b874, #b98f4b);
    color: #151108;
    border-color: rgba(255, 255, 255, 0.65);
    font-weight: 600;
}

/* Search */
.bg3-lib-search {
    padding: 8px 12px 4px 12px;
}
.bg3-lib-search input {
    width: 100%;
    padding: 8px 10px;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(0, 0, 0, 0.45);
    color: #eee;
    font-size: 0.9rem;
    outline: none;
}
.bg3-lib-search input::placeholder {
    color: rgba(230, 230, 230, 0.55);
}
.bg3-lib-search input:focus {
    border-color: rgba(223, 190, 110, 0.85);
}

/* Content */
.bg3-lib-content {
    padding: 4px 10px 8px 10px;
    flex: 1;
    overflow-y: auto;
}

/* List + rows */
.bg3-list {
    list-style: none;
    margin: 0;
    padding: 0;
}
.bg3-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 8px;
    border-radius: 10px;
    border: 1px solid transparent;
    background: radial-gradient(
        circle at top left,
        rgba(255, 255, 255, 0.02),
        rgba(0, 0, 0, 0.55)
    );
    transition: background 0.15s ease, border-color 0.15s ease,
        transform 0.08s ease;
    margin-bottom: 4px;
}
.bg3-row:hover {
    border-color: rgba(223, 190, 110, 0.6);
    background: radial-gradient(
        circle at top left,
        rgba(255, 255, 255, 0.06),
        rgba(0, 0, 0, 0.75)
    );
    transform: translateY(-1px);
}

.row-left {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
}

.avatar {
    width: 48px;
    height: 48px;
    border-radius: 999px;
    overflow: hidden;
    border: 1px solid rgba(223, 190, 110, 0.55);
    box-shadow: 0 0 12px rgba(0, 0, 0, 0.5);
    background: radial-gradient(
        circle at 30% 0%,
        rgba(255, 255, 255, 0.25),
        rgba(0, 0, 0, 0.85)
    );
}
.avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.meta {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
}
.name-line {
    display: flex;
    align-items: center;
    gap: 6px;
}
.name {
    font-size: 0.98rem;
    font-weight: 600;
    white-space: nowrap;
    text-overflow: ellipsis;
    overflow: hidden;
}
.source-pill {
    padding: 1px 6px;
    border-radius: 999px;
    font-size: 0.7rem;
    border: 1px solid rgba(255, 255, 255, 0.28);
    background: rgba(0, 0, 0, 0.7);
    color: #e7d6b3;
}

.sub {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 0.78rem;
    color: #c7bca3;
}
.sub .sep {
    opacity: 0.6;
}

.stats {
    display: flex;
    gap: 10px;
    font-size: 0.8rem;
    color: #dfd9c7;
}

/* Row actions */
.row-actions {
    display: flex;
    gap: 6px;
}
.icon-btn {
    width: 30px;
    height: 30px;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    background: radial-gradient(
        circle at top,
        rgba(255, 255, 255, 0.12),
        rgba(0, 0, 0, 0.8)
    );
    color: #f2e7c4;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 0;
}
.icon-btn:hover {
    border-color: rgba(255, 255, 255, 0.4);
}
.icon-btn.danger {
    border-color: rgba(214, 106, 106, 0.65);
    color: #f5c4c4;
}
.icon-btn.danger:hover {
    background: radial-gradient(
        circle at top,
        rgba(255, 120, 120, 0.2),
        rgba(0, 0, 0, 0.9)
    );
}

/* Empty / notice */
.bg3-empty {
    padding: 18px 10px;
    text-align: center;
    font-size: 0.9rem;
    color: #d8d1c2;
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: center;
}
.bg3-notice {
    font-size: 0.8rem;
    color: #ccbfa2;
    padding: 4px 8px 8px 8px;
}

/* Footer */
.bg3-lib-footer {
    padding: 8px 12px 10px 12px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    display: flex;
    justify-content: flex-end;
    background: linear-gradient(to top, rgba(0, 0, 0, 0.65), transparent);
}

/* Buttons */
.bg3-ghost {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 12px;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.16);
    background: rgba(0, 0, 0, 0.35);
    color: #efe3c6;
    cursor: pointer;
    font-size: 0.9rem;
}
.bg3-ghost:hover {
    border-color: rgba(255, 255, 255, 0.3);
    background: rgba(255, 255, 255, 0.06);
}
</style>
