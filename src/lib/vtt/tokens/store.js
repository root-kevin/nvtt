// src/lib/vtt/tokens/store.js
import { writable, get } from "svelte/store";
import { currentMap } from "$lib/vtt/map/store.js";
import { sendWS } from "$lib/ws.js";
import { tokenLibrary } from "$lib/vtt/tokens/library.js";
import { applySharedHPOnCreate, syncSharedHPOnUpdate } from "$lib/vtt/tokens/health.js";
import { cloneTemplateAsIndividual } from "$lib/vtt/tokens/templateCloner.js";
import { normalizeSheet, applyOverrides } from "$lib/vtt/5e/normalizeSheet.js";
import {
    resolvePlayerAbilities,
    resolvePlayerAC,
    resolvePlayerSavingThrows
} from "$lib/vtt/data/playerStats.js";
import { defaultVision } from "$lib/vtt/tokens/defaultVision.js";

const DEBUG_TOKEN_SAVES = false;
import { deriveHpState } from "$lib/vtt/tokens/hpUtils.js";

export const tokens = writable([]);          // HYDRATED (template + overrides)
export const selectedTokens = writable([]);

// Default fallback image for ANY missing template data
const DEFAULT_IMAGE =
    "https://images.dndbeyond.com/avatars/4675/675/636747837794884984.jpeg?width=128&height=128";

/* ============================================================
   INTERNAL HELPERS
============================================================ */

const OVERRIDE_KEYS = [
    "id",
    "templateId",
    "mapId",
    "x",
    "y",
    "hidden",
    "name",
    "img",
    "currentHp",
    "maxHp",
    "tempHp",
    "ac",
    "size",
    "sizeFeet",
    "sizeLabel",
    "abilities",
    "skills",
    "saves",
    "passives",
    "conditions",
    "notes",
    "consistentHp",
    "speed",

    // ✅ NEW: elevation (feet, +/-)
    "elevation",
    "vision"
];

let lastHydratedMapId = null;
const LOCAL_MOVE_TTL_MS = 2000;
const LOCAL_UPDATE_TTL_MS = 2000;
const localMoveCache = new Map();
const localUpdateCache = new Map();
let loadingTokensFor = null;

export function registerLocalTokenMove(token) {
    if (!token?.id) return;
    localMoveCache.set(token.id, {
        mapId: token.mapId,
        x: token.x,
        y: token.y,
        ts: Date.now()
    });
}

export function registerLocalTokenUpdate(token) {
    if (!token?.id) return;
    localUpdateCache.set(token.id, {
        mapId: token.mapId,
        snapshot: JSON.stringify(sanitize(token)),
        ts: Date.now()
    });
}

function shouldPersistMoveFromWS(token, mapId) {
    if (!token?.id) return true;
    const cached = localMoveCache.get(token.id);
    if (!cached) return true;
    const sameMove =
        cached.mapId === mapId &&
        cached.x === token.x &&
        cached.y === token.y &&
        Date.now() - cached.ts < LOCAL_MOVE_TTL_MS;
    if (sameMove) {
        localMoveCache.delete(token.id);
        return false;
    }
    return true;
}

function shouldPersistUpdateFromWS(token, mapId) {
    if (!token?.id) return true;
    const cached = localUpdateCache.get(token.id);
    if (!cached) return true;
    const same =
        cached.mapId === mapId &&
        cached.snapshot === JSON.stringify(sanitize(token)) &&
        Date.now() - cached.ts < LOCAL_UPDATE_TTL_MS;
    if (same) {
        localUpdateCache.delete(token.id);
        return false;
    }
    return true;
}


function diffFields(baseObj = {}, currentObj = {}) {
    const diff = {};
    Object.entries(currentObj || {}).forEach(([key, val]) => {
        if (val !== (baseObj ?? {})[key]) {
            diff[key] = val;
        }
    });
    return Object.keys(diff).length ? diff : undefined;
}

function setTokens(list) {
    tokens.set(list || []);
}

function sanitize(token) {
    if (!token) return token;
    const {
        el,
        __svelte_meta,
        __style,
        __className,
        __attributes,
        ...rest
    } = token;
    return rest;
}

function markPlayerToken(t = {}) {
    return {
        ...t,
        isPlayerToken: t.isPlayerToken || t.templateSource === "player" || !!t.characterId
    };
}

function toOverrides(token, mapIdFallback) {
    if (!token) return token;
    const clean = markPlayerToken(sanitize(token));
    const out = {};
    const isPlayer = clean.isPlayerToken || clean.templateSource === "player" || !!clean.characterId;
    const lib = get(tokenLibrary) || [];
    const base = clean.templateId ? lib.find(t => t.id === clean.templateId) : null;
    const baseSheet = base?.bestiary
        ? normalizeSheet(
            base.bestiary,
            base.overrides || {},
            { name: base.name, templateId: base.id, baseTemplateId: base.baseTemplateId || base.id }
        )
        : null;
    const baseMeta = baseSheet?.meta || {};

    OVERRIDE_KEYS.forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(clean, key)) {
            if (isPlayer && key === "saves") return;
            out[key] = clean[key];
        }
    });

    if (!out.mapId && mapIdFallback) {
        out.mapId = mapIdFallback;
    }

    // For player characters, stats are the manual-edit source of truth.
    if (isPlayer && clean.stats) {
        out.stats = clean.stats;
    }
    // For player characters, AC edits are absolute and persist directly.
    if (isPlayer && clean.ac != null) {
        out.ac = clean.ac;
    }

    if (baseSheet) {
        if (clean.abilities && !isPlayer) {
            const diff = diffFields(baseSheet.abilities, clean.abilities);
            if (diff) out.abilities = diff;
        }
        if (clean.skills) {
            const diff = diffFields(baseSheet.skills, clean.skills);
            if (diff) out.skills = diff;
        }
        if (!isPlayer && clean.saves) {
            const diff = diffFields(baseSheet.saves, clean.saves);
            if (diff) out.saves = diff;
        }
        if (clean.passives) {
            const diff = diffFields(baseSheet.passives, clean.passives);
            if (diff) out.passives = diff;
        }
        if (!isPlayer && clean.ac != null && clean.ac !== (baseMeta.ac ?? baseSheet.ac)) {
            out.ac = clean.ac;
        }
        if (clean.speed) {
            const diff = diffFields(baseMeta.speed ?? baseSheet.speed, clean.speed);
            if (diff) out.speed = diff;
        }
    } else {
        if (clean.stats && !out.stats) out.stats = clean.stats;
        if (clean.abilities) out.abilities = clean.abilities;
        if (clean.skills) out.skills = clean.skills;
        if (!isPlayer && clean.saves) out.saves = clean.saves;
        if (clean.passives) out.passives = clean.passives;
        if (clean.ac != null && !out.ac) out.ac = clean.ac;
        if (clean.speed) out.speed = clean.speed;
    }

    return out;
}

/* ============================================================
   TEMPLATE → INSTANCE HYDRATION
============================================================ */
export function resolveToken(token) {
    const clean = markPlayerToken(sanitize(token));

    if (!clean?.templateId) {
        return clean;
    }

    const lib = get(tokenLibrary);
    const base = lib.find((t) => t.id === clean.templateId);
    const baseSheet = base?.bestiary || clean.bestiary || clean.sheet || null;

    const isPlayer =
        clean.isPlayerToken ||
        clean.templateSource === "player" ||
        base?.templateSource === "player";

        if (isPlayer) {
        const playerSheet =
            base?.bestiary ??
            base?.sheet ??
            base?.player?.bestiary ??
            base?.player ??
            clean?.bestiary ??
            clean?.sheet ??
            {};

        const manualAc = Number.isFinite(clean?.ac)
            ? clean.ac
            : Number.isFinite(clean?.overrides?.ac)
              ? clean.overrides.ac
              : null;

        const abilities = resolvePlayerAbilities(
            {
                ...playerSheet,
                stats: playerSheet.stats ?? [],
                bonusStats: playerSheet.bonusStats ?? [],
                overrideStats: playerSheet.overrideStats ?? [],
                inventory: playerSheet.inventory ?? playerSheet.items ?? [],
                items: playerSheet.items ?? playerSheet.inventory ?? []
            },
            {
                stats: clean.overrides?.stats ?? clean.stats ?? []
            }
        );

        const derivedAc = Number.isFinite(manualAc)
            ? manualAc
            : resolvePlayerAC(
                  {
                      ...playerSheet,
                      inventory: playerSheet.inventory ?? playerSheet.items ?? [],
                      items: playerSheet.items ?? playerSheet.inventory ?? []
                  },
                  abilities
              );

        const saves = resolvePlayerSavingThrows(playerSheet, abilities);

        const vision = defaultVision({
            ...clean.vision,
            ...base?.vision,
            isPlayer: true
        });

        const merged = {
            ...base,
            ...clean,
            sheet: {
                ...playerSheet,
                abilities,
                ac: derivedAc,
                saves
            },
            bestiary: playerSheet,
            abilities,
            saves,
            ac: derivedAc,
            vision
        };

        const hp = deriveHpState(merged);

        return {
            ...merged,
            currentHp: hp.current,
            maxHp: hp.max,
            tempHp: hp.temp
        };
    }

    // ============ NON-PLAYER BRANCH (Monsters, NPCs, etc.) ============

    // Avoid template HP overriding map-level HP edits
    const templateOverrides = base?.overrides ? structuredClone(base.overrides) : {};
    const tokenHasHp =
        clean.maxHp != null ||
        clean.currentHp != null ||
        clean.tempHp != null;

    if (tokenHasHp && templateOverrides.hp) {
        delete templateOverrides.hp;
    }

    const tokenBaseMax =
        clean.maxHp ??
        templateOverrides?.hp?.baseMaxHp ??
        base?.maxHp ??
        null;

    const tokenHpPatch = {
        baseMaxHp: tokenBaseMax,
        currentHp: clean.currentHp,
        maxHp: clean.maxHp,
        tempHp: clean.tempHp
    };

    const tokenOverridePatch = {
        abilities: clean.abilities,
        skills: clean.skills,
        saves: clean.saves,
        passives: clean.passives,
        ac: clean.ac,
        speed: clean.speed,
        hp: tokenHpPatch,
        stats: clean.overrides?.stats ?? clean.stats
    };

    const mergedOverrides = applyOverrides(templateOverrides, tokenOverridePatch);

    const sheet = baseSheet
        ? normalizeSheet(baseSheet, mergedOverrides, {
              name: clean.name || base?.name || baseSheet?.name,
              templateId: base?.id || clean.templateId,
              baseTemplateId: base?.baseTemplateId || base?.id || clean.baseTemplateId || clean.templateId
          })
        : null;

    const derivedCurrent = sheet?.hp?.currentHp ?? sheet?.hp?.maxHp ?? clean.currentHp;
    const derivedMax = sheet?.hp?.maxHp ?? clean.maxHp;
    const derivedTemp = sheet?.hp?.tempHp ?? clean.tempHp ?? 0;
    const derivedAc = clean.ac ?? sheet?.ac ?? sheet?.meta?.ac ?? null;

    const vision = defaultVision(
        clean.vision || clean.overrides?.vision || base?.vision || {}
    );

    const merged = {
        ...base,
        ...clean,
        sheet,
        bestiary: baseSheet || null,
        img: clean.img ?? base?.img ?? DEFAULT_IMAGE,
        sizeFeet: clean.sizeFeet ?? base?.sizeFeet ?? 5,
        sizeLabel: clean.sizeLabel ?? base?.sizeLabel ?? "Medium",
        currentHp: derivedCurrent,
        maxHp: derivedMax,
        tempHp: derivedTemp,
        ac: derivedAc,
        vision
    };

    const hp = deriveHpState(merged);

    return {
        ...merged,
        currentHp: hp.current,
        maxHp: hp.max,
        tempHp: hp.temp
    };

}

/* ============================================================
   MAP SWITCH → hydrate tokens
============================================================ */
async function loadTokensForMap(mapId) {
    if (!mapId || typeof fetch === "undefined") {
        lastHydratedMapId = mapId ?? null;
        setTokens([]);
        return;
    }
    if (loadingTokensFor === mapId) return;
    loadingTokensFor = mapId;
    try {
        const res = await fetch(`/api/tokens?mapId=${encodeURIComponent(mapId)}`);
        if (!res.ok) throw new Error("Failed to load tokens");
        const data = await res.json();
        if (get(currentMap)?.id !== mapId) return;
        const list = Array.isArray(data) ? data : [];
        const hydrated = list.map((t) => resolveToken(t));
        lastHydratedMapId = mapId;
        setTokens(hydrated);
    } catch (err) {
        console.error("loadTokensForMap failed", err);
        if (get(currentMap)?.id === mapId) {
            setTokens([]);
        }
    } finally {
        loadingTokensFor = null;
    }
}

currentMap.subscribe((map) => {
    const mapId = map?.id ?? null;
    if (!mapId) {
        lastHydratedMapId = null;
        setTokens([]);
        return;
    }
    if (mapId === lastHydratedMapId) return;
    loadTokensForMap(mapId);
});


// Rehydrate once the library becomes available so player tokens resolve fully
let libraryReady = false;
tokenLibrary.subscribe((lib) => {
    const nowReady = Array.isArray(lib) && lib.length > 0;
    if (nowReady && !libraryReady) {
        const map = get(currentMap);
        const source = get(tokens);

        if (map?.id && Array.isArray(source) && source.length) {
            const rehydrated = source.map((t) => resolveToken(t));
            setTokens(rehydrated);
        }
    }
    libraryReady = nowReady;
});

/* ============================================================
   SELECTION
============================================================ */
export function setSelected(ids) {
    selectedTokens.set(Array.isArray(ids) ? ids : []);
}

/* ============================================================
   SAVE TOKEN OVERRIDES TO SERVER
============================================================ */
function persistTokensToServer(mapId, hydratedList) {
    if (!mapId) return;

    const list = (hydratedList || []).filter((t) => t.mapId === mapId);
    const overrides = list.map((t) => toOverrides(t, mapId));

    sendWS({
        type: "tokensUpdate",
        mapId,
        tokens: overrides
    });

    fetch("/api/tokens", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            mapId,
            tokens: overrides
        })
    }).catch(() => { });
}

/* ============================================================
   UPSERT TOKEN (CREATE or UPDATE)
============================================================ */
export async function upsertToken(raw, { persist = true } = {}) {
    const incoming = sanitize(raw);
    const cm = get(currentMap);
    const lib = get(tokenLibrary);
    const currentList = get(tokens) || [];

    if (incoming && incoming.sheet?.hp) {
        incoming.currentHp = incoming.currentHp ?? incoming.sheet.hp.currentHp ?? incoming.sheet.hp.maxHp;
        incoming.maxHp = incoming.maxHp ?? incoming.sheet.hp.maxHp;
        incoming.tempHp = incoming.tempHp ?? incoming.sheet.hp.tempHp ?? 0;
    }
    if (incoming) {
        const hp = deriveHpState(incoming);
        incoming.currentHp = hp.current;
        incoming.maxHp = hp.max;
        incoming.tempHp = hp.temp;
    }
    if (incoming && incoming.sheet?.ac != null) {
        incoming.ac = incoming.ac ?? incoming.sheet.ac ?? incoming.sheet.meta?.ac;
    }

    let nextList = currentList.slice();
    const idx = currentList.findIndex((t) => t.id === incoming.id);

    /* -------------------------------------------
       UPDATE EXISTING TOKEN
    ------------------------------------------- */
    if (idx !== -1) {
        const existingHydrated = currentList[idx];
        const existingOverrides = toOverrides(existingHydrated, existingHydrated.mapId);

        let mergedOverrides = {
            ...existingOverrides,
            ...incoming
        };

        // Auto-promotion logic (rename → individual)
        const baseTemplate = existingOverrides.templateId
            ? lib.find((t) => t.id === existingOverrides.templateId)
            : null;

        if (baseTemplate) {
            const isSpecies =
                baseTemplate.templateSource !== "individual" &&
                baseTemplate.templateSource !== "imported";

            const prevName = existingOverrides.name ?? baseTemplate.name;
            const newName = incoming.name ?? prevName;

            const nameChanged =
                incoming.name &&
                incoming.name !== prevName &&
                incoming.name !== baseTemplate.name;

            if (isSpecies && nameChanged) {
                try {
                    const individualName = incoming.name || prevName;
                    const newTemplate = await cloneTemplateAsIndividual(
                        individualName,
                        baseTemplate.id
                    );

                    if (newTemplate) {
                        mergedOverrides.templateId = newTemplate.id;
                        mergedOverrides.name = newTemplate.name;
                    }
                } catch (err) {
                    console.error("cloneTemplateAsIndividual failed", err);
                }
            }
        }

        const resolved = resolveToken(markPlayerToken(mergedOverrides));
        nextList[idx] = resolved;

        if (resolved.sharedHpGroupId) {
            nextList = syncSharedHPOnUpdate(resolved, nextList) || nextList;
        }
    }

    /* -------------------------------------------
       CREATE NEW TOKEN
    ------------------------------------------- */
    else {
        const grid = cm?.gridSizePx ?? 64;
        const px = incoming.size ?? grid;

        const storedOverrides = applySharedHPOnCreate({
            ...incoming,
            size: px
        });

        const hp = deriveHpState(storedOverrides);
        storedOverrides.currentHp = hp.current;
        storedOverrides.maxHp = hp.max;
        storedOverrides.tempHp = hp.temp;

        const resolved = resolveToken(markPlayerToken(storedOverrides));
        nextList.push(resolved);

        if (resolved.sharedHpGroupId) {
            nextList = syncSharedHPOnUpdate(resolved, nextList) || nextList;
        }
    }

    tokens.set(nextList);

    if (cm?.id && persist) {
        const tokensForMap = nextList.filter((t) => t.mapId === cm.id);
        persistTokensToServer(cm.id, tokensForMap);
    }
}

/* ============================================================
   DELETE TOKEN
============================================================ */
export function deleteToken(id, { persist = true } = {}) {
    const cm = get(currentMap);
    const currentList = get(tokens) || [];
    const nextList = currentList.filter((t) => t.id !== id);

    tokens.set(nextList);

    if (cm?.id && persist) {
        persistTokensToServer(cm.id, nextList);
    }
}

/* ============================================================
   TOGGLE HIDDEN
============================================================ */
export function toggleHidden(id, { persist = true } = {}) {
    const cm = get(currentMap);
    const currentList = get(tokens) || [];

    const nextList = currentList.map((t) =>
        t.id === id ? { ...t, hidden: !t.hidden } : t
    );

    tokens.set(nextList);

    if (cm?.id && persist) {
        persistTokensToServer(cm.id, nextList);
    }
}

/* ============================================================
   MANUAL SAVE
============================================================ */
export function persistCurrentTokens() {
    const cm = get(currentMap);
    if (!cm?.id) return;

    const hydrated = get(tokens);
    persistTokensToServer(cm.id, hydrated);
}

/* ============================================================
   WEBSOCKET SYNC
============================================================ */
export function applyTokenWS(msg, { isGM = false } = {}) {
    if (msg.type === "tokensUpdate" && Array.isArray(msg.tokens)) {
        const cm = get(currentMap);
        if (cm?.id === msg.mapId) {
            lastHydratedMapId = msg.mapId;
            const hydrated = msg.tokens.map((t) => {
                const hp = deriveHpState(t);
                const normalized = {
                    ...t,
                    currentHp: hp.current,
                    maxHp: hp.max,
                    tempHp: hp.temp
                };
                return resolveToken(normalized);
            });
            setTokens(hydrated);
        }
        return;
    }

    if (msg.type === "token-add" || msg.type === "token-update") {
        if (msg.token) {
            upsertToken(msg.token, { persist: false });
        }
        return;
    }

    if (msg.type === "token-move") {
        if (msg.token) {
            upsertToken(msg.token, { persist: false });
        }
        return;
    }

    if (msg.type === "token-delete") {
        deleteToken(msg.id, { persist: false });
        return;
    }

    if (msg.type === "token-sync" && Array.isArray(msg.tokens)) {
        const hydrated = msg.tokens.map((t) => {
            const hp = deriveHpState(t);
            const normalized = {
                ...t,
                currentHp: hp.current,
                maxHp: hp.max,
                tempHp: hp.temp
            };
            return resolveToken(normalized);
        });
        setTokens(hydrated);
    }
}
