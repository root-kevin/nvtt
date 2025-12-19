// src/lib/server/tokensStorage.js
import fs from "fs/promises";
import path from "path";
import { loadMaps, saveMaps, sanitizeTokens } from "./mapsStorage.js";

const TOKENS_PATH = path.join(process.cwd(), "data", "tokens.json");

async function ensureTokensFile() {
    await fs.mkdir(path.dirname(TOKENS_PATH), { recursive: true });
    try {
        await fs.access(TOKENS_PATH);
    } catch (err) {
        if (err?.code === "ENOENT") {
            await fs.writeFile(TOKENS_PATH, JSON.stringify({}, null, 2), "utf-8");
        } else {
            throw err;
        }
    }
}

async function loadTokensMap() {
    await ensureTokensFile();
    try {
        const raw = await fs.readFile(TOKENS_PATH, "utf-8");
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch (err) {
        console.warn("[tokensStorage] loadTokensMap failed, using {}", err?.message ?? err);
        return {};
    }
}

async function saveTokensMap(obj = {}) {
    await ensureTokensFile();
    await fs.writeFile(TOKENS_PATH, JSON.stringify(obj, null, 2), "utf-8");
    return obj;
}

export async function readTokens(mapId) {
    if (!mapId) return [];
    const all = await loadTokensMap();
    return Array.isArray(all[mapId]) ? all[mapId] : [];
}

export async function writeTokens(mapId, tokens) {
    if (!mapId) return [];
    const cleaned = sanitizeTokens(tokens);
    const all = await loadTokensMap();
    all[mapId] = cleaned;
    await saveTokensMap(all);
    return cleaned;
}

export async function migrateTokensFromMapsIfNeeded() {
    await ensureTokensFile();
    const tokensMap = await loadTokensMap();
    const maps = await loadMaps({ stripFogPng: true });

    let changedMaps = false;
    let wroteTokens = false;

    for (let i = 0; i < maps.length; i += 1) {
        const map = maps[i] || {};
        const mapTokens = Array.isArray(map.tokens) ? sanitizeTokens(map.tokens) : [];
        if (!mapTokens.length) continue;
        if (!Array.isArray(tokensMap[map.id]) || tokensMap[map.id].length === 0) {
            tokensMap[map.id] = mapTokens;
            wroteTokens = true;
        }
        if (map.tokens) {
            const { tokens, ...rest } = map;
            maps[i] = rest;
            changedMaps = true;
        }
    }

    if (wroteTokens) {
        await saveTokensMap(tokensMap);
    }
    if (changedMaps) {
        await saveMaps(maps, { stripFogPng: true });
    }
}
