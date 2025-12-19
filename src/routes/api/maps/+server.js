// src/routes/api/maps/+server.js
import { json, error } from "@sveltejs/kit";
import { loadMaps, saveMaps, normalizeMap } from "$lib/server/mapsStorage.js";
import { migrateTokensFromMapsIfNeeded } from "$lib/server/tokensStorage.js";

const REQUIRED_KEYS = ["id", "name", "src", "gridSizePx", "width", "height", "view", "lighting"];

function hasRequiredMapFields(map) {
    if (!map) return false;
    for (const key of REQUIRED_KEYS) {
        if (map[key] === undefined || map[key] === null) return false;
    }
    const pan = map.view?.pan;
    const zoom = map.view?.zoom;
    const hasPan = pan && Number.isFinite(pan.x) && Number.isFinite(pan.y);
    const hasZoom = Number.isFinite(zoom);
    const hasLighting = map.lighting && typeof map.lighting.global === "boolean";
    return hasPan && hasZoom && hasLighting;
}

/* ===== GET ===== */
export async function GET() {
    await migrateTokensFromMapsIfNeeded();
    const maps = await loadMaps({ stripFogPng: true });
    const stripped = maps.map(({ tokens, ...rest }) => rest);
    return json(stripped);
}

/* ===== POST =====
   Create/update a map record WITHOUT allowing the request to overwrite tokens.
*/
export async function POST({ request }) {
    const raw = await request.json();
    const body = normalizeMap(raw, { stripFogPng: true, fillDefaults: true });
    if (!body?.id) throw error(400, "Map requires id");
    if (raw?.tokens !== undefined) throw error(400, "Tokens must be saved via /api/tokens");

    const maps = await loadMaps({ stripFogPng: true });
    const idx = maps.findIndex(m => m.id === body.id);

    if (idx === -1) {
        const next = { ...body };
        maps.push(next);
    } else {
        const prev = maps[idx] ?? {};
        maps[idx] = { ...prev, ...body };
    }

    await saveMaps(maps, { stripFogPng: true });

    // 🚫 Do not echo tokens back (prevents accidental token rehydrate/snap)
    const saved = maps.find(m => m.id === body.id) || body;
    const { tokens, ...mapNoTokens } = saved;

    return json({ ok: true, map: mapNoTokens });
}

/* ===== PUT =====
   Update map fields (walls/doors/grid/etc) WITHOUT overwriting tokens.
*/
export async function PUT({ request }) {
    const raw = await request.json();
    const body = normalizeMap(raw, { stripFogPng: true, fillDefaults: false });
    if (!body?.id) throw error(400, "Map requires id");
    if (raw?.tokens !== undefined || body.tokens !== undefined) {
        console.warn("Refused tokens in map payload", { id: body.id });
        throw error(400, "Tokens must be saved via /api/tokens");
    }
    if (!hasRequiredMapFields(body)) {
        console.warn("Refused partial map write", { keys: Object.keys(raw || {}) });
        throw error(400, "Refused partial map write");
    }

    const maps = await loadMaps({ stripFogPng: true });
    const idx = maps.findIndex(m => m.id === body.id);

    if (idx === -1) {
        const created = normalizeMap(raw, { stripFogPng: true, fillDefaults: true });
        const { tokens, ...rest } = created;
        maps.push(rest);
    } else {
        const prev = maps[idx] ?? {};

        // Build next map as: prev + body (tokens forbidden above)
        const next = { ...prev, ...body };
        delete next.tokens;
        maps[idx] = next;
    }

    await saveMaps(maps, { stripFogPng: true });

    // 🚫 Do not echo tokens back (prevents accidental token rehydrate/snap)
    const saved = maps.find(m => m.id === body.id);
    const { tokens, ...mapNoTokens } = saved || body;

    return json({ ok: true, map: mapNoTokens });
}

export async function DELETE({ request }) {
    const { id } = await request.json();
    if (!id) throw error(400, "Missing id");

    const maps = await loadMaps({ stripFogPng: true });
    const next = maps.filter(m => m.id !== id);

    await saveMaps(next, { stripFogPng: true });
    return json({ ok: true });
}
