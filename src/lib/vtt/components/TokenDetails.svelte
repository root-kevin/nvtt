<script>
    import { createEventDispatcher, tick } from "svelte";
    import {
        X,
        BookUser,
        CircleUserRound,
        HandFist,
        ScrollText,
        PackageOpen
    } from "@lucide/svelte";
    import "$lib/vtt/styles/sheet.css";

    import SummaryTab from "./TokenDetails/SummaryTab.svelte";
    import FeaturesTab from "./TokenDetails/FeaturesTab.svelte";
    import ActionsTab from "./TokenDetails/ActionsTab.svelte";
    import Spellcasting from "./sheet/Spellcasting.svelte";
    import InventoryTab from "./TokenDetails/InventoryTab.svelte";

    import { sendWS } from "$lib/ws.js";
    import { currentMap } from "$lib/vtt/map/store.js";
    import { normalizeSheet, applyOverrides } from "$lib/vtt/5e/normalizeSheet.js";
    import { SKILL_ABILITY } from "$lib/vtt/5e/computeSkills.js";
    import { upsertToken, registerLocalTokenUpdate } from "$lib/vtt/tokens/store.js";
    import { customLibraryStore } from "$lib/vtt/tokens/customLibrary.js";
    import { tokenLibrary } from "$lib/vtt/tokens/library.js";
    import { applyHpPatch, deriveHpState } from "$lib/vtt/tokens/hpUtils.js";
    const ABILITY_TO_STAT_ID = { str: 1, dex: 2, con: 3, int: 4, wis: 5, cha: 6 };

    const dispatch = createEventDispatcher();

    // UI panel constants
    const PANEL_W = 520;
    const PANEL_H = 720;

    // Props
    export let token = null;
    export let onClose = () => {};
    export let initialPos = { x: 220, y: 20 };
    export let gridSizePx = 64;
    export let mode = "token"; // "token" or "template"
    export let readOnly = false;
    export let persistEdits = true;

    // State
    let activeTab = "summary";
    let pos = { ...initialPos };
    let hasPosition = false;
    let panelEl;
    let mapLighting = true;

    let customLib = {};
    let libraryTemplates = [];
    let baseTemplateId = null;
    let customEntry = null;

    let baseSheet = null;
    let overrides = {};
    let sheet = null;

    let pendingTemplate = {};
    let lastTemplateKey = null;

    // Bind stores
    $: customLib = $customLibraryStore;
    $: libraryTemplates = $tokenLibrary || [];
    $: mapLighting = $currentMap?.lighting?.global ?? true;

    // -----------------------------
    // SHEET RESOLUTION PIPELINE
    // -----------------------------
    $: {
        const displayToken = token;
        if (!displayToken) {
            sheet = null;
        } else {
            customEntry = displayToken?.templateId?.startsWith("custom-")
                ? customLib[displayToken.templateId]
                : null;

            baseTemplateId =
                customEntry?.baseTemplateId ||
                displayToken?.baseTemplateId ||
                displayToken?.templateId ||
                null;

            const libEntry = baseTemplateId
                ? libraryTemplates.find(t => t.id === baseTemplateId)
                : null;

            const baseRaw =
                displayToken?.bestiary ||
                displayToken?.playerSheet ||
                displayToken?.sheet ||
                displayToken?.customSheet ||
                libEntry?.bestiary ||
                null;

            baseSheet = baseRaw;

            const baseOverrides = customEntry?.overrides || libEntry?.overrides || {};
            const mergedOverrides = applyOverrides(
                baseOverrides,
                pendingTemplate?.overrides || {}
            );

            const isPlayer = displayToken?.templateSource === "player" || displayToken?.isPlayerToken;

            if (isPlayer) {
                overrides = mergedOverrides;
                sheet = displayToken?.sheet || baseSheet || {};
                sheet = {
                    ...sheet,
                    abilities: displayToken?.abilities ?? sheet?.abilities ?? {},
                    ac: displayToken?.ac ?? sheet?.ac,
                    saves: displayToken?.saves ?? sheet?.saves
                };
            } else {
                const displayOverrides =
                    mode === "token"
                        ? applyOverrides(mergedOverrides, {
                              abilities: displayToken?.abilities,
                              skills: displayToken?.skills,
                              saves: displayToken?.saves,
                              passives: displayToken?.passives,
                              hp: {
                                  currentHp: displayToken?.currentHp,
                                  maxHp: displayToken?.maxHp,
                                  baseMaxHp: displayToken?.maxHp ?? mergedOverrides?.hp?.baseMaxHp,
                                  tempHp: displayToken?.tempHp
                              }
                          })
                        : mergedOverrides;

                overrides = mergedOverrides;

                const templateId = displayToken?.templateId || libEntry?.id;
                const name =
                    pendingTemplate?.name ||
                    customEntry?.name ||
                    displayToken?.name ||
                    libEntry?.name ||
                    baseRaw?.name;

                sheet = baseSheet
                    ? normalizeSheet(baseSheet, displayOverrides, {
                          templateId,
                          baseTemplateId:
                              baseTemplateId || libEntry?.baseTemplateId || libEntry?.id,
                          name
                      })
                    : null;
            }
        }
    }


    // Reset pending state when template ID changes
    $: {
        const key = token ? `${token.id || ""}::${token.templateId || ""}` : null;
        if (key !== lastTemplateKey) {
            lastTemplateKey = key;
            pendingTemplate = {};
        }
    }

    // -----------------------------
    // HP DERIVATION
    // -----------------------------
    function deriveLocalHp() {
        if (mode === "template") {
            const hpMode = getTemplateHpMode();
            const hpOvr = pendingTemplate.overrides?.hp || overrides?.hp || {};
            const baseMax =
                hpOvr.baseMaxHp ??
                sheet?.hp?.maxHp ??
                token?.maxHp ??
                1;

            if (hpMode) {
                return {
                    currentHp: hpOvr.currentHp ?? baseMax,
                    maxHp: baseMax,
                    tempHp: hpOvr.tempHp ?? 0
                };
            }

            return {
                currentHp: hpOvr.baseMaxHp ?? baseMax,
                maxHp: hpOvr.baseMaxHp ?? baseMax,
                tempHp: 0
            };
        }

        const sourceToken = token;
        const source = {
            currentHp: sourceToken?.currentHp ?? sheet?.hp?.currentHp,
            maxHp: sourceToken?.maxHp ?? sheet?.hp?.maxHp,
            tempHp: sourceToken?.tempHp ?? sheet?.hp?.tempHp
        };

        const d = deriveHpState(source);
        return {
            currentHp: d.current,
            maxHp: Math.max(1, d.max || 1),
            tempHp: d.temp
        };
    }

    $: ({ currentHp, maxHp, tempHp } = deriveLocalHp());

    // -----------------------------
    // TEMPLATE CHANGE STAGING
    // -----------------------------
    function dispatchTemplateSave(changes) {
        const targetTemplateId =
            token?.templateId ??
            token?.baseTemplateId ??
            baseTemplateId;
        if (!targetTemplateId) return;
        dispatch("saveTemplate", {
            templateId: targetTemplateId,
            changes
        });
    }

    function markTemplateChange(patch) {
        if (readOnly) return;
        const mergedOverrides = patch?.overrides
            ? applyOverrides(pendingTemplate.overrides || {}, patch.overrides)
            : pendingTemplate.overrides;

        const { overrides: _omit, ...rest } = patch || {};

        pendingTemplate = {
            ...pendingTemplate,
            ...rest,
            ...(mergedOverrides ? { overrides: mergedOverrides } : {})
        };

        if (mode === "template") {
            dispatchTemplateSave(patch);
        }
    }

    // -----------------------------
    // TOKEN-LEVEL INSTANT PATCH
    // -----------------------------
    function pushUpdate(patch) {
        if (!token) return;
        if (readOnly) return;

        const updated = {
            ...token,
            ...patch
        };

        upsertToken(updated, { persist: persistEdits });
        if (persistEdits) registerLocalTokenUpdate(updated);
        sendWS({ type: "token-update", token: updated });
        dispatch("update", { token: updated });
    }

    function markTokenChange(patch) {
        pushUpdate(patch);
    }

    // -----------------------------
    // PUBLIC EVENT HANDLERS
    // -----------------------------
    function getTemplateHpMode() {
        return (
            pendingTemplate.consistentHp ??
            token?.consistentHp ??
            sheet?.consistentHp ??
            false
        );
    }

    function handleTemplateHpChange(patch) {
        const hpMode = getTemplateHpMode();
        const existing = pendingTemplate.overrides?.hp || overrides?.hp || {};
        const nextHp = { ...existing };

        if (!hpMode) {
            if (patch.setMax != null) {
                nextHp.baseMaxHp = patch.setMax;
            }
            delete nextHp.currentHp;
            delete nextHp.tempHp;
        } else {
            const baseMax =
                (patch.setMax != null ? patch.setMax : nextHp.baseMaxHp) ??
                overrides?.hp?.baseMaxHp ??
                sheet?.hp?.maxHp ??
                token?.maxHp ??
                1;

            const seed = {
                currentHp: nextHp.currentHp ?? baseMax,
                maxHp: baseMax,
                tempHp: nextHp.tempHp ?? 0,
                overrides: { hp: { baseMaxHp: baseMax } }
            };

            const derived = applyHpPatch(seed, patch);
            nextHp.baseMaxHp = baseMax;
            nextHp.currentHp = derived.currentHp;
            nextHp.tempHp = derived.tempHp;
        }

        markTemplateChange({
            overrides: {
                ...(pendingTemplate.overrides || {}),
                hp: nextHp
            }
        });
    }

    function handleHpChange(patch) {
        if (readOnly) return;
        if (mode === "template") {
            handleTemplateHpChange(patch);
            return;
        }

        if (patch.setAc != null) {
            markTokenChange({ ac: Math.max(0, +patch.setAc || 0) });
            return;
        }

        if (patch.setSpeed) {
            const { type, value, condition } = patch.setSpeed;
            if (!type) return;
            const baseSpeed =
                token?.speed ||
                sheet?.meta?.speed ||
                {};
            const next = { ...baseSpeed };
            const current = next[type];
            const hasCondition = condition && condition.trim();
            const numeric = Number.isFinite(+value) ? +value : 0;
            if (hasCondition) {
                next[type] = {
                    number: typeof current === "object"
                        ? (current.number ?? numeric)
                        : numeric || current || 0,
                    condition: condition.trim()
                };
            } else {
                next[type] = typeof current === "object"
                    ? { ...(current || {}), number: numeric }
                    : numeric;
            }
            markTokenChange({ speed: next });
            return;
        }

        const base = token ? { ...token } : token;
        const updated = applyHpPatch(base, patch);

        // immediate apply for HP changes
        const merged = { ...base, ...updated };
        upsertToken(merged, { persist: persistEdits });
        if (persistEdits) registerLocalTokenUpdate(merged);
        sendWS({ type: "token-update", token: merged });
        dispatch("update", { token: merged });
    }

    function handleAbilityBatch(draft) {
        if (readOnly) return;
        if (!sheet) return;

        const abilities = {};
        for (const [k, v] of Object.entries(draft)) {
            const n = Number(v);
            abilities[k] = Number.isFinite(n) ? n : sheet.abilities[k] ?? 10;
        }

        // Manual ability edits persist as stat overrides (id-based).
        const baseStats = Array.isArray(token?.stats)
            ? token.stats
            : Array.isArray(sheet?.stats)
              ? sheet.stats
              : [];
        const nextStats = Object.entries(ABILITY_TO_STAT_ID).map(([abl, id]) => {
            const existing = baseStats.find((s) => s?.id === id) || {};
            return {
                ...existing,
                id,
                value: abilities[abl]
            };
        });

        const newMods = {};
        Object.entries(abilities).forEach(([key, score]) => {
            newMods[key] = Math.floor((score - 10) / 2);
        });

        const skillsBase =
            pendingTemplate.overrides?.skillsBase ??
            overrides?.skillsBase ??
            token?.skillsBase ??
            sheet?.skillsBase ??
            {};

        const savesBase =
            pendingTemplate.overrides?.savesBase ??
            overrides?.savesBase ??
            token?.savesBase ??
            sheet?.savesBase ??
            {};

        const updatedSkills = {};
        Object.entries(SKILL_ABILITY).forEach(([skill, abl]) => {
            const baseVal = skillsBase?.[skill];
            if (baseVal == null) return;
            const mod = newMods[abl];
            if (mod == null) return;
            updatedSkills[skill] = baseVal + mod;
        });

        const updatedSaves = {};
        Object.keys(abilities).forEach((abl) => {
            const baseVal = savesBase?.[abl];
            if (baseVal == null) return;
            const mod = newMods[abl];
            if (mod == null) return;
            updatedSaves[abl] = baseVal + mod;
        });

        const overridesPatch = {
            stats: nextStats,
            ...(Object.keys(updatedSkills).length && { skills: updatedSkills }),
            ...(Object.keys(updatedSaves).length && { saves: updatedSaves })
        };

        if (mode === "token") {
            markTokenChange({
                stats: nextStats,
                ...(Object.keys(updatedSkills).length && { skills: updatedSkills }),
                ...(Object.keys(updatedSaves).length && { saves: updatedSaves })
            });
            return;
        }

        markTemplateChange({
            overrides: overridesPatch
        });
    }

    function handleNameChange(name) {
        if (readOnly) return;
        if (mode === "template") {
            markTemplateChange({ name });
        } else {
            markTokenChange({ name });
        }
    }

    function togglePersistentHp(v) {
        if (readOnly) return;
        if (mode === "template") {
            if (v) {
                const baseMax =
                    pendingTemplate.overrides?.hp?.baseMaxHp ??
                    overrides?.hp?.baseMaxHp ??
                    sheet?.hp?.maxHp ??
                    token?.maxHp ??
                    1;
                markTemplateChange({
                    consistentHp: true,
                    overrides: {
                        ...(pendingTemplate.overrides || {}),
                        hp: {
                            baseMaxHp: baseMax,
                            currentHp: baseMax,
                            tempHp: 0
                        }
                    }
                });
            } else {
                const baseMax =
                    pendingTemplate.overrides?.hp?.baseMaxHp ??
                    overrides?.hp?.baseMaxHp ??
                    sheet?.hp?.maxHp ??
                    token?.maxHp ??
                    1;
                markTemplateChange({
                    consistentHp: false,
                    overrides: {
                        ...(pendingTemplate.overrides || {}),
                        hp: { baseMaxHp: baseMax }
                    }
                });
            }
        } else {
            markTokenChange({ consistentHp: v });
        }
    }

    function handleVisionUpdate(nextVision) {
        if (readOnly) return;
        if (mode !== "token" || !token) return;
        pushUpdate({ vision: nextVision });
    }

    // -----------------------------
    // UI Helpers
    // -----------------------------
    function sectionEntries(key) {
    return sheet?.[key] || [];
}

    function setTab(tab) {
        activeTab = tab;
    }

    function clampPosition(x, y) {
        if (typeof window === "undefined") return { x, y };
        return {
            x: Math.max(8, Math.min(window.innerWidth - PANEL_W - 8, x)),
            y: Math.max(8, Math.min(window.innerHeight - PANEL_H - 8, y))
        };
    }

    $: if (token && !hasPosition) {
        pos = clampPosition(initialPos.x, initialPos.y);
        hasPosition = true;
        tick().then(clampIntoScreen);
    }

    async function clampIntoScreen() {
        await tick();
        if (!panelEl) return;
        const r = panelEl.getBoundingClientRect();
        const pad = 16;
        pos = {
            x: Math.max(pad, Math.min(window.innerWidth - r.width - pad, pos.x)),
            y: Math.max(pad, Math.min(window.innerHeight - r.height - pad, pos.y))
        };
    }

    function portalToBody(node) {
        if (typeof document !== "undefined") {
            document.body.appendChild(node);
            return { destroy() { node.remove(); } };
        }
    }

    function startDrag(e) {
        const startX = e.clientX;
        const startY = e.clientY;
        const start = { ...pos };

        function move(ev) {
            pos = clampPosition(start.x + (ev.clientX - startX), start.y + (ev.clientY - startY));
        }

        function up() {
            window.removeEventListener("mousemove", move);
            window.removeEventListener("mouseup", up);
            clampIntoScreen();
        }

        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
    }
</script>


{#if token}
<div
    class="sheet"
    use:portalToBody
    bind:this={panelEl}
    style={`left:${pos.x}px; top:${pos.y}px;`}
>
    <!-- HEADER BAR -->
    <div class="drag-bar" on:mousedown={startDrag}>
        <div class="title-row">
            <span class="title">{token.name || sheet?.meta?.name || "Creature"}</span>
            <span class="subtitle">
                {#if sheet?.meta?.type}
                    {sheet.meta.type}
                    {#if sheet.meta.cr} · CR {sheet.meta.cr}{/if}
                {/if}

            </span>
        </div>

        <!-- RIGHT SIDE BUTTON AREA -->
        <div class="header-buttons">
            <button class="icon-btn close-btn" on:click={onClose} aria-label="Close">
                <X size={16} stroke-width="2" />
            </button>
        </div>
    </div>

    <!-- TABS -->
    <div class="tab-bar">
        <button
            class={`tab ${activeTab === "summary" ? "active" : ""}`}
            data-tooltip="Abilities, Saves, Skills, Senses"
            on:click={() => setTab("summary")}
            aria-label="Summary / Core Stats"
            type="button"
        >
            <BookUser size={18} stroke-width="2" />
        </button>
        <button
            class={`tab ${activeTab === "features" ? "active" : ""}`}
            data-tooltip="Features & Traits"
            on:click={() => setTab("features")}
            aria-label="Features & Traits"
            type="button"
        >
            <CircleUserRound size={18} stroke-width="2" />
        </button>
        <button
            class={`tab ${activeTab === "actions" ? "active" : ""}`}
            data-tooltip="Actions"
            on:click={() => setTab("actions")}
            aria-label="Actions"
            type="button"
        >
            <HandFist size={18} stroke-width="2" />
        </button>
        <button
            class={`tab ${activeTab === "spells" ? "active" : ""}`}
            data-tooltip="Spells"
            on:click={() => setTab("spells")}
            aria-label="Spells"
            type="button"
        >
            <ScrollText size={18} stroke-width="2" />
        </button>
        <button
            class={`tab ${activeTab === "inventory" ? "active" : ""}`}
            data-tooltip="Inventory"
            on:click={() => setTab("inventory")}
            aria-label="Inventory"
            type="button"
        >
            <PackageOpen size={18} stroke-width="2" />
        </button>
    </div>

    <!-- TAB CONTENT -->
    <div class="tab-content">
        <div class={`tab-panel ${activeTab === "summary" ? "active" : ""}`}>
            <SummaryTab
                token={token}
                {sheet}
                {overrides}
                {maxHp}
                {currentHp}
                {tempHp}
                {mode}
                {mapLighting}
                {readOnly}
                hasPersistentHp={!!token?.consistentHp}
                onHpChange={handleHpChange}
                onAbilityBatch={handleAbilityBatch}
                onNameChange={handleNameChange}
                togglePersistentHp={togglePersistentHp}
                onVisionUpdate={handleVisionUpdate}
            />
        </div>
        <div class={`tab-panel ${activeTab === "features" ? "active" : ""}`}>
            <FeaturesTab {token} {sheet} {sectionEntries} />
        </div>
        <div class={`tab-panel ${activeTab === "actions" ? "active" : ""}`}>
            <ActionsTab {token} {sheet} {sectionEntries} />
        </div>
        <div class={`tab-panel ${activeTab === "spells" ? "active" : ""}`}>
            <Spellcasting {sheet} />
        </div>
        <div class={`tab-panel ${activeTab === "inventory" ? "active" : ""}`}>
            <InventoryTab />
        </div>
    </div>
</div>
{/if}


<style>
/* ===========================
   TOKEN DETAILS PANEL
   =========================== */
.sheet {
    position: fixed;
    width: 520px;
    max-width: calc(100vw - 16px);
    max-height: calc(100vh - 16px);
    background: radial-gradient(circle at top, #181c25 0, #0b0f18 55%);
    color: #f7f9fc;
    border: 1px solid #3a4252;
    border-radius: 14px;
    box-shadow: 0 18px 48px rgba(0,0,0,0.7);
    z-index: 9999;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Inter", sans-serif;
}

/* ===========================
   HEADER / DRAG BAR
   =========================== */
.drag-bar {
    display: flex;
    align-items: center;
    justify-content: space-between; /* FIXED */
    padding: 8px 10px;
    background: linear-gradient(to right, #151924, #1e2330);
    border-bottom: 1px solid #2b3240;
    cursor: move;
    user-select: none;
    height: 48px;
}

.title-row {
    display: flex;
    flex-direction: column;
    line-height: 1.1;
}

.title {
    font-weight: 800;
    letter-spacing: 0.03em;
    font-size: 0.92rem;
    text-transform: uppercase;
}

.subtitle {
    font-size: 0.78rem;
    color: #aab4c8;
    margin-top: 1px;
}

/* ===========================
   HEADER BUTTONS
   =========================== */
.header-buttons {
    display: flex;
    align-items: center;
    gap: 6px;
    pointer-events: auto;
}

/* Base icon button */
.icon-btn {
    width: 26px;
    height: 26px;
    border-radius: 6px;
    border: 1px solid #444b57;
    background: #20252f;
    color: #f7f9fc;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 0;
    transition: 120ms ease;
}

.icon-btn:hover {
    background: #2d3441;
    border-color: #566074;
}

.icon-btn:active {
    transform: scale(0.92);
}

/* Close (same as regular, but add subtle danger highlight on hover) */
.close-btn:hover {
    background: #31262a;
    border-color: #b36b6b;
    color: #f5b1b1;
}

/* ===========================
   TAB BAR
   =========================== */
.tab-bar {
    display: flex;
    background: #11151f;
    border-bottom: 1px solid #1f2532;
    padding: 0 6px;
    height: 42px;
    align-items: center;
    gap: 6px;
}

.tab {
    width: 38px;
    height: 30px;
    cursor: pointer;
    color: #b8c2d8;
    border-radius: 8px;
    border: 1px solid transparent;
    background: transparent;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    user-select: none;
    position: relative;
    transition: 120ms ease;
}

.tab:hover {
    color: #e3e8f5;
    background: rgba(255,255,255,0.04);
}

.tab.active {
    color: #f0f4ff;
    border-color: rgba(209,193,132,0.55);
    background: rgba(209,193,132,0.08);
}

.tab[data-tooltip]:hover::after {
    content: attr(data-tooltip);
    position: absolute;
    bottom: -30px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(10,12,18,0.95);
    border: 1px solid #2b3240;
    color: #e8ecf5;
    padding: 4px 8px;
    border-radius: 6px;
    font-size: 0.72rem;
    letter-spacing: 0.02em;
    white-space: nowrap;
    pointer-events: none;
    z-index: 2;
}

.tab[data-tooltip]:hover::before {
    content: "";
    position: absolute;
    bottom: -10px;
    left: 50%;
    transform: translateX(-50%);
    border-width: 6px;
    border-style: solid;
    border-color: rgba(10,12,18,0.95) transparent transparent transparent;
    pointer-events: none;
}

/* ===========================
   TAB CONTENT AREA
   =========================== */
.tab-content {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    background: radial-gradient(
        circle at top left,
        rgba(255,255,255,0.02),
        rgba(0,0,0,0.65)
    );
    padding-bottom: 14px;
}

.tab-panel {
    display: none;
    width: 100%;
    box-sizing: border-box;
}

.tab-panel.active {
    display: block;
}

/* Smooth scrollbar for the sheet */
.tab-content::-webkit-scrollbar {
    width: 8px;
}
.tab-content::-webkit-scrollbar-track {
    background: rgba(255,255,255,0.04);
}
.tab-content::-webkit-scrollbar-thumb {
    background: rgba(255,255,255,0.18);
    border-radius: 4px;
}
</style>
