// src/lib/vtt/map/store.js
import { writable, get } from "svelte/store";

function normalizeLighting(map) {
    return {
        global: map?.lighting?.global ?? true
    };
}


export const maps = writable([]);
export const currentMap = writable(null);

function dropUndefined(obj = {}) {
    return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

function normalizeTokens(list) {
    if (!Array.isArray(list)) return [];
    return list.map((t) => {
        const {
            el,
            __svelte_meta,
            __style,
            __className,
            __attributes,
            ...rest
        } = t || {};
        return rest;
    });
}

/**
 * Set the active map
 */
export function setCurrentMap(map, { source = null } = {}) {
    if (!map) {
        currentMap.set(null);
        return;
    }

    const id = map.id;

    // Mark active map locally
    maps.update(list =>
        list.map(m =>
            m.id === id
                ? { ...m, active: true }
                : { ...m, active: false }
        )
    );

    // Pull the normalized stored version if available
    const match = get(maps).find((m) => m.id === id);
    const use = {
    ...(match ?? map),
    lighting: normalizeLighting(match ?? map)
};
    use.segmentedWalls = !!use.segmentedWalls;
    const segMode = (use.segmentLengthMode || "GRID").toUpperCase();
    use.segmentLengthMode = segMode === "FIXED_PX" ? "FIXED_PX" : "GRID";
    if (!Number.isFinite(use.segmentLengthPx)) {
        use.segmentLengthPx = use.gridSizePx;
    }
    delete use.tokens;


    currentMap.set(use);

    // Persist selected map state (no base64 fog!)
    if (typeof fetch !== "undefined") {
        if (source === "token" || source === "vision") {
            return;
        }
        const body = dropUndefined({
            ...use,
            active: true
        });

        // DO NOT include fogPng ever again
        delete body.fogPng;
        delete body.tokens;

        fetch("/api/maps", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        }).catch(() => {});
    }
}

/**
 * Replace all maps at once
 */
export function setMaps(list) {
    maps.set(list);
    if (list?.length) {
        currentMap.update((cm) => {
            const active = list.find(m => m.active);
            if (!cm) return active ?? list[0];
            const match = list.find(m => m.id === cm.id);
            return match ?? active ?? list[0];
        });
    } else {
        currentMap.set(null);
    }
}

/**
 * Insert/update a map entry
 */
export function upsertMap(map) {
    const cleanedTokens = undefined;
    const mapSafe = { ...(map || {}) };
    delete mapSafe.tokens;

    maps.update(list => {
        const idx = list.findIndex(m => m.id === mapSafe.id);
        let updated;

        if (idx === -1) {
            updated = mapSafe;
            return [...list, updated];
        }

        updated = {
    ...list[idx],
    ...mapSafe,
    lighting: normalizeLighting(mapSafe)
};
        if (cleanedTokens) updated.tokens = cleanedTokens;

        const copy = [...list];
        copy[idx] = updated;
        return copy;
    });

    currentMap.update(cm => {
        if (cm?.id !== mapSafe.id) return cm;
        const next = {
    ...cm,
    ...mapSafe,
    lighting: normalizeLighting(mapSafe)
};
        if (cleanedTokens) next.tokens = cleanedTokens;
        return next;
    });
}

/**
 * Load maps from maps.json (but DO NOT load fogPng)
 */
export async function loadMaps() {
    if (typeof fetch === "undefined") return;

    try {
        const res = await fetch("/api/maps");
        if (!res.ok) throw new Error("Failed to load maps");

        const data = await res.json();
        const list = Array.isArray(data) ? data : Array.isArray(data?.maps) ? data.maps : [];

        const fixed = list.map(m => ({
    ...m,
    lighting: normalizeLighting(m),

            width: m.width ?? 0,
            height: m.height ?? 0,
            naturalWidth: m.naturalWidth ?? m.width ?? 0,
            naturalHeight: m.naturalHeight ?? m.height ?? 0,
            showPlayerVisionToGM: m.showPlayerVisionToGM ?? true,
            view: {
                pan: {
                    x: m.view?.pan?.x ?? 0,
                    y: m.view?.pan?.y ?? 0
                },
                zoom: Number.isFinite(m.view?.zoom) ? m.view.zoom : 1
            },
            segmentedWalls: !!m.segmentedWalls,
            segmentLengthMode: (m.segmentLengthMode || "GRID").toUpperCase() === "FIXED_PX" ? "FIXED_PX" : "GRID",
            segmentLengthPx: Number.isFinite(m.segmentLengthPx) ? m.segmentLengthPx : m.gridSizePx,

            // REMOVE fogPng forever — replaced by fogSrc
            fogSrc: m.fogSrc ?? `/fog/${m.id}.png`
        }));

        maps.set(fixed);

        if (fixed.length && !get(currentMap)) {
            currentMap.set(fixed[0]);
        }
    } catch (e) {
        console.error("loadMaps failed", e);
    }
}
