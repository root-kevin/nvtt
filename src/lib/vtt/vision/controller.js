import { get } from "svelte/store";
import { currentMap } from "$lib/vtt/map/store.js";
import { tokens } from "$lib/vtt/tokens/store.js";
import { activeVisionTokenId } from "$lib/vtt/player/visionStore.js";
import { extractVisionSegments } from "./extractWalls.js";
import { computeVision } from "./computeVision.js";
import { visionPolygon, visionMeta, visionDebug } from "./resultsStore.js";
import { feetToPx } from "./units.js";

let pending = false;
let lastReason = "";

function resolveMaxDistancePx(token, map) {
    const gridSizePx = Number.isFinite(map?.gridSizePx) ? map.gridSizePx : 64;
    const explicitRangeFeet = Number.isFinite(token?.vision?.distance)
        ? token.vision.distance
        : token?.vision?.hasDarkvision && Number.isFinite(token?.vision?.darkvisionDistance)
            ? token.vision.darkvisionDistance
            : null;
    const originPaddingFeet = 2.5;

    if (Number.isFinite(explicitRangeFeet)) {
        return feetToPx(explicitRangeFeet + originPaddingFeet, gridSizePx);
    }

    if (map?.lighting?.global) {
        return null;
    }

    const fallbackFeet = token?.vision?.hasDarkvision
        ? (Number.isFinite(token?.vision?.darkvisionDistance) ? token.vision.darkvisionDistance : 60)
        : 60;
    return feetToPx(fallbackFeet + originPaddingFeet, gridSizePx);
}



function doRecompute(reason = "unknown") {
    if (get(currentMap)?.interactionDebug) {
        console.groupCollapsed("[Vision] recompute", reason);
    }

    const map = get(currentMap);
    if (!map) {
        console.warn("[Vision] No active map");
        visionDebug.set(null);
        if (get(currentMap)?.interactionDebug) console.groupEnd();
        return;
    }

    const tokenId = get(activeVisionTokenId);
    if (!tokenId) {
        console.warn("[Vision] No active vision token selected");
        visionPolygon.set(null);
        visionDebug.set(null);
        if (get(currentMap)?.interactionDebug) console.groupEnd();
        return;
    }

    const token = get(tokens).find(t => t.id === tokenId);
    if (!token) {
        console.warn("[Vision] Vision token not found:", tokenId);
        visionPolygon.set(null);
        visionDebug.set(null);
        if (get(currentMap)?.interactionDebug) console.groupEnd();
        return;
    }

    const debug = get(currentMap)?.interactionDebug;
    if (debug) {
        console.log("[Vision] Token:", {
            id: token.id,
            name: token.name,
            x: token.x,
            y: token.y,
            vision: token.vision
        });
    }

    const walls = map.walls ?? [];
    if (debug) console.log("[Vision] Raw walls:", walls.length);

    const segments = extractVisionSegments(walls, map);

    if (debug) console.log("[Vision] Vision segments:", segments.length);

    const maxDistancePx = resolveMaxDistancePx(token, map);
    const polygon = computeVision(
        token,
        segments,
        maxDistancePx,
        map?.gridSizePx,
        { width: map?.width, height: map?.height },
        {
            onDebug: debug
                ? (payload) => visionDebug.set(payload)
                : null
        }
    );

    if (!polygon || !polygon.length) {
        console.warn("[Vision] No polygon generated");
        visionPolygon.set(null);
        visionDebug.set(debug ? {
            origin: { x: token.x, y: token.y },
            polygon: null,
            segments
        } : null);
        if (debug) console.groupEnd();
        return;
    }

    if (debug) console.log("[Vision] Polygon points:", polygon.length);

    // ✅ THIS IS THE KEY LINE
    visionPolygon.set(polygon);
    visionMeta.set({ tokenId: token.id, updatedAt: Date.now() });
    if (!debug) visionDebug.set(null);

    if (debug) console.groupEnd();
}

export function recomputeVision(reason = "unknown") {
    lastReason = reason;
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
        pending = false;
        doRecompute(lastReason);
    });
}
