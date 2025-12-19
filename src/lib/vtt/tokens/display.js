// src/lib/vtt/tokens/display.js
import { writable, get } from "svelte/store";
import { tokens, persistCurrentTokens } from "./store.js";
import { currentMap } from "$lib/vtt/map/store.js";

// Toggle showing token size labels beneath names
export const showTokenSizes = writable(false);

// Hide or reveal all tokens on the current map, and persist
export function toggleAllTokensHidden() {
    const map = get(currentMap);
    if (!map?.id) return;

    const current = get(tokens) || [];
    if (!current.length) return;

    // In your current architecture, `tokens` already contains only the current map's tokens
    // but we'll keep the filter in case that ever changes.
    const tokenList = current.filter(t => t.mapId === map.id || !t.mapId);

    if (!tokenList.length) return;

    const anyVisible = tokenList.some(t => !t.hidden);
    const newHidden = anyVisible; // if any visible -> hide all, else reveal all

    const updated = current.map(t =>
        (t.mapId === map.id || !t.mapId)
            ? { ...t, hidden: newHidden }
            : t
    );

    tokens.set(updated);

    // 🔥 This is the missing piece:
    // persists overrides to maps.json and broadcasts via WS
    persistCurrentTokens();
}
