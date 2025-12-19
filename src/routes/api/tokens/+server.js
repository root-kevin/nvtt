// src/routes/api/tokens/+server.js
import { json, error } from "@sveltejs/kit";
import { migrateTokensFromMapsIfNeeded, readTokens, writeTokens } from "$lib/server/tokensStorage.js";
import { loadMaps } from "$lib/server/mapsStorage.js";

export async function GET({ url }) {
    await migrateTokensFromMapsIfNeeded();
    const mapId = url.searchParams.get("mapId");
    if (!mapId) throw error(400, "Missing mapId");
    const tokens = await readTokens(mapId);
    return json(tokens);
}

/**
 * Persist tokens for a specific map WITHOUT touching other map fields.
 * Body: { mapId, tokens }
 */
export async function PUT({ request }) {
    await migrateTokensFromMapsIfNeeded();
    const body = await request.json();
    const mapId = body?.mapId || body?.id;
    if (!mapId) throw error(400, "Missing mapId");
    if (!Array.isArray(body?.tokens)) throw error(400, "Missing tokens");

    // Verify map exists
    const maps = await loadMaps({ stripFogPng: true });
    const idx = maps.findIndex(m => m.id === mapId);
    if (idx === -1) throw error(404, "Map not found");

    const saved = await writeTokens(mapId, body.tokens);
    return json({ ok: true, tokens: saved });
}
