// src/lib/server/mapsStorage.js
import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";

const MAPS_PATH = path.join(process.cwd(), "data", "maps.json");

/* ======================================================
   Utilities
====================================================== */

function deepClone(obj) {
    return obj ? JSON.parse(JSON.stringify(obj)) : obj;
}

function dropUndefined(obj = {}) {
    const out = {};
    for (const k in obj) {
        if (obj[k] !== undefined) out[k] = obj[k];
    }
    return out;
}

function normalizeObstruction(val, fallback = "NORMAL") {
    const upper = typeof val === "string" ? val.toUpperCase() : null;
    if (upper === "NONE" || upper === "NORMAL" || upper === "LIMITED") {
        return upper;
    }
    return fallback;
}

function toCoords(raw = {}) {
    if (Array.isArray(raw.c) && raw.c.length >= 4) {
        const [x0, y0, x1, y1] = raw.c;
        if ([x0, y0, x1, y1].every(Number.isFinite)) {
            return [x0, y0, x1, y1];
        }
    }
    const ax = raw?.a?.x;
    const ay = raw?.a?.y;
    const bx = raw?.b?.x;
    const by = raw?.b?.y;
    if ([ax, ay, bx, by].every(Number.isFinite)) {
        return [ax, ay, bx, by];
    }
    return [0, 0, 0, 0];
}

function resolveDoorState(door = {}) {
    const raw = (door.state || "").toString().toUpperCase();
    if (raw === "OPEN" || raw === "CLOSED" || raw === "LOCKED") return raw;
    if (door.locked) return "LOCKED";
    if (door.open) return "OPEN";
    return "CLOSED";
}

function normalizeDoor(rawDoor = {}, { state } = {}) {
    const finalState = resolveDoorState(rawDoor);
    const pctRaw = Number.isFinite(rawDoor.openPct)
        ? rawDoor.openPct
        : finalState === "OPEN"
            ? 100
            : 0;
    const openPct = Math.max(0, Math.min(100, pctRaw));

    return {
        state: finalState,
        openPct,
        open: finalState === "OPEN",
        locked: finalState === "LOCKED",
        hinge: rawDoor.hinge ?? "a",
        swing: rawDoor.swing ?? rawDoor.dir ?? rawDoor.swingDir ?? 1,
        thicknessPx: Number.isFinite(rawDoor.thicknessPx) ? rawDoor.thicknessPx : 14,
        noSwing: rawDoor.noSwing ?? false,
        hp: rawDoor.hp,
        ac: rawDoor.ac,
        hidden: rawDoor.hidden ?? false
    };
}

function legacyKindToType(kind) {
    const k = (kind || "").toString().toLowerCase();
    if (k === "door") return "DOOR";
    if (k === "window") return "WINDOW";
    return "WALL";
}

function normalizeWall(raw = {}) {
    const coords = toCoords(raw);
    const [x0, y0, x1, y1] = coords;

    const type = (raw.type || legacyKindToType(raw.kind)).toString().toUpperCase();
    const dirRaw = Number.isFinite(raw.dir) ? raw.dir : 0;
    const dir = dirRaw === 1 || dirRaw === 2 ? dirRaw : 0;

    let move = normalizeObstruction(raw.move, null);
    let sight = normalizeObstruction(raw.sight, null);
    let light = normalizeObstruction(raw.light, null);
    let sound = normalizeObstruction(raw.sound, null);

    if (type === "DOOR") {
        const state = resolveDoorState(raw.door);
        move = state === "OPEN" ? "NONE" : "NORMAL";
        sight = state === "OPEN" ? "NONE" : "NORMAL";
    }

    if (type === "WINDOW") {
        move = move ?? "NORMAL";
        sight = sight ?? "NONE";
        light = light ?? "NONE";
    }

    // Legacy flags: blocksMovement / blocksVision
    if (type !== "DOOR") {
        if (!raw.move && raw.blocksMovement !== undefined) {
            move = raw.blocksMovement ? "NORMAL" : "NONE";
        }
        if (!raw.sight && raw.blocksVision !== undefined) {
            sight = raw.blocksVision ? "NORMAL" : "NONE";
        }
    }

    move = normalizeObstruction(move, "NORMAL");
    sight = normalizeObstruction(sight, "NORMAL");
    light = normalizeObstruction(light, "NORMAL");
    sound = normalizeObstruction(sound, "NORMAL");

    const door = type === "DOOR" ? normalizeDoor(raw.door || {}) : undefined;

    const id = raw.id || (typeof randomUUID === "function" ? randomUUID() : Math.random().toString(36).slice(2));

    const normalized = {
        id,
        c: coords,
        a: { x: x0, y: y0 },
        b: { x: x1, y: y1 },
        type,
        kind: type.toLowerCase(), // compatibility for legacy code paths
        move: normalizeObstruction(move, "NORMAL"),
        sight: normalizeObstruction(sight, "NORMAL"),
        light: normalizeObstruction(light, "NORMAL"),
        sound: normalizeObstruction(sound, "NORMAL"),
        blocksMovement: move !== "NONE",
        blocksVision: sight !== "NONE",
        dir,
        door,
        flags: raw.flags && typeof raw.flags === "object" ? raw.flags : undefined
    };

    return dropUndefined(normalized);
}

function normalizeWalls(list) {
    if (!Array.isArray(list)) return undefined;
    return list.map((w) => normalizeWall(w));
}

/**
 * IMPORTANT:
 * Tokens are RUNTIME-OWNED.
 * This function exists ONLY to strip transient DOM garbage
 * IF AND ONLY IF tokens are explicitly provided.
 */
export function sanitizeTokens(tokens) {
    if (!Array.isArray(tokens)) return tokens;

    return tokens.map(t => {
        if (!t || typeof t !== "object") return t;

        const {
            el,
            __svelte_meta,
            __style,
            __className,
            __attributes,
            ...clean
        } = t;

        return clean;
    });
}

/* ======================================================
   normalizeMap (SAFE)
====================================================== */
/**
 * normalizeMap is now STRICTLY NON-DESTRUCTIVE.
 *
 * - It NEVER invents tokens
 * - It NEVER removes tokens unless explicitly present
 * - It NEVER fills defaults for tokens
 * - It NEVER mutates the input object
 */
export function normalizeMap(
    raw = {},
    {
        stripFogPng = false,
        fillDefaults = false
    } = {}
) {
    if (!raw || typeof raw !== "object") return {};

    const src = deepClone(raw);

    // Explicitly extract known volatile fields
    const {
        fogPng,
        tokens,
        type,
        mapId,
        ...rest
    } = src;

    const normalized = {
        ...rest
    };

    // ---- Tokens (ONLY if explicitly provided) ----
    if (tokens !== undefined) {
        normalized.tokens = sanitizeTokens(tokens);
    }

    // ---- Fog source ----
    if (rest.fogSrc !== undefined) {
        normalized.fogSrc = rest.fogSrc;
    } else if (fillDefaults && rest.id) {
        normalized.fogSrc = `/fog/${rest.id}.png`;
    }

    // ---- Fog PNG ----
    if (!stripFogPng && fogPng !== undefined) {
        normalized.fogPng = fogPng;
    }

    // ---- Lighting defaults ----
    const lighting = src.lighting || {};
    normalized.lighting = {
        global: typeof lighting.global === "boolean" ? lighting.global : true
    };

    // ---- Walls (migrated to new schema) ----
    const walls = normalizeWalls(src.walls);
    if (walls !== undefined) {
        normalized.walls = walls;
    }

    // ---- Wall drawing options ----
    normalized.segmentedWalls = !!src.segmentedWalls;
    const mode = (src.segmentLengthMode || "").toUpperCase();
    normalized.segmentLengthMode = mode === "FIXED_PX" ? "FIXED_PX" : "GRID";
    if (Number.isFinite(src.segmentLengthPx)) {
        normalized.segmentLengthPx = src.segmentLengthPx;
    }

    // ---- Player vision visibility (default: true) ----
    if (normalized.showPlayerVisionToGM === undefined) {
        normalized.showPlayerVisionToGM = true;
    }

    return dropUndefined(normalized);
}

/* ======================================================
   File helpers
====================================================== */

async function ensureMapsFile() {
    await fs.mkdir(path.dirname(MAPS_PATH), { recursive: true });

    try {
        await fs.access(MAPS_PATH);
    } catch (err) {
        if (err?.code === "ENOENT") {
            await fs.writeFile(
                MAPS_PATH,
                JSON.stringify({ maps: [] }, null, 2),
                "utf-8"
            );
        } else {
            throw err;
        }
    }
}

/* ======================================================
   Public API
====================================================== */

export async function loadMaps(options = {}) {
    await ensureMapsFile();

    try {
        const raw = await fs.readFile(MAPS_PATH, "utf-8");
        const parsed = JSON.parse(raw);

        const list = Array.isArray(parsed)
            ? parsed
            : Array.isArray(parsed?.maps)
                ? parsed.maps
                : [];

        // IMPORTANT:
        // loadMaps NEVER injects tokens or defaults
        return list.map(m => normalizeMap(m, options));
    } catch (err) {
        console.warn(
            "[mapsStorage] loadMaps failed; returning []",
            err?.message ?? err
        );
        return [];
    }
}

export async function saveMaps(list = [], options = {}) {
    await ensureMapsFile();

    if (!Array.isArray(list)) {
        throw new Error("saveMaps expects an array");
    }

    // IMPORTANT:
    // saveMaps does NOT invent fields
    const cleaned = list.map(m => {
        const normalized = normalizeMap(m, options);
        if (normalized?.tokens !== undefined) {
            const { tokens, ...rest } = normalized;
            return rest;
        }
        return normalized;
    });

    await fs.writeFile(
        MAPS_PATH,
        JSON.stringify({ maps: cleaned }, null, 2),
        "utf-8"
    );

    return cleaned;
}
