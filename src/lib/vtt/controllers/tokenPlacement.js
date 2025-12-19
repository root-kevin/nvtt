// src/lib/vtt/controllers/tokenPlacement.js
// Click-to-place tokens on the map, honoring current pan/zoom.
import { get } from "svelte/store";
import { tokens, upsertToken, registerLocalTokenUpdate } from "$lib/vtt/tokens/store.js";
import { currentMap } from "$lib/vtt/map/store.js";
import { pan, zoom } from "$lib/vtt/panzoom/store.js";
import { sendWS } from "$lib/ws.js";
import { assignTokenNameForSpawn } from "$lib/vtt/tokens/nameTools.js";

export function enableTokenPlacement(container) {
    async function onClick(e) {
        const rect = container?.getBoundingClientRect?.();
        const map = get(currentMap);
        if (!rect || !map) return;

        const grid = map.gridSizePx ?? 64;
        const size = grid;
        const p = get(pan);
        const z = get(zoom) || 1;
        const w = map.width ?? map.naturalWidth ?? grid * 20;
        const h = map.height ?? map.naturalHeight ?? grid * 20;

        // Convert screen coords to map-space by inverting pan/zoom.
        const rawX = (e.clientX - rect.left - p.x) / z - size / 2;
        const rawY = (e.clientY - rect.top - p.y) / z - size / 2;
        const x = Math.max(0, Math.min(w - size, rawX));
        const y = Math.max(0, Math.min(h - size, rawY));

        const existing = get(tokens) || [];
        const siblings = existing.filter(
            (tok) => tok.mapId === map.id && !tok.templateId
        );

        const { updatedTokens, newName } = assignTokenNameForSpawn("Token", siblings);
        const renames = updatedTokens.filter(u => {
            const original = siblings.find(tk => tk.id === u.id);
            return original && original.name !== u.name;
        });

        for (const tok of renames) {
            const updated = { ...tok, name: tok.name };
            await upsertToken(updated);
            registerLocalTokenUpdate(updated);
            sendWS({ type: "token-update", token: updated });
        }

        const t = {
            id: crypto.randomUUID(),
            x,
            y,
            size,
            name: newName,
            img: "/tokens/goblin.png",
            mapId: map.id ?? "default",
            hidden: true,
            maxHp: 1,
            currentHp: 1,
            tempHp: 0
        };

        upsertToken(t);
        sendWS({ type: "token-add", token: t });
    }

    container?.addEventListener("click", onClick);

    return () => container?.removeEventListener("click", onClick);
}
