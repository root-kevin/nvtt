// src/lib/vtt/controllers/tokenDrag.js

import { get } from "svelte/store";
import { pan, zoom, panMode } from "$lib/vtt/panzoom/store.js";
import { tokens, upsertToken, registerLocalTokenMove } from "$lib/vtt/tokens/store.js";
import { currentMap } from "$lib/vtt/map/store.js";
import { sendWS } from "$lib/ws.js";
import { snapToGrid } from "$lib/vtt/utils/placement.js";

export function enableTokenDragging(container, isGM) {
    if (!isGM) return () => {};

    let dragging = null;
    let panActive = false;

    // Disable dragging while in pan mode
    panMode.subscribe((mode) => {
        panActive = mode !== "none";
    });

    function onMouseDown(e) {
        if (!isGM || panActive) return;

        // Correct attribute lookup
        const el = e.target.closest(".token");
        if (!el) return;

        const id = el.dataset.tokenId;    // <-- FIXED
        if (!id) return;

        const list = get(tokens);
        const t = list.find(t => t.id === id);
        if (!t) return;

        const z = get(zoom);

        dragging = {
            id,
            token: t,
            startMouseX: e.clientX,
            startMouseY: e.clientY,
            startX: t.x,
            startY: t.y,
            zoom: z
        };

        e.preventDefault();
    }

    function onMouseMove(e) {
        if (!dragging) return;

        const dx = e.clientX - dragging.startMouseX;
        const dy = e.clientY - dragging.startMouseY;

        const map = get(currentMap);
        const grid = map?.gridSizePx ?? 64;

        const rawX = dragging.startX + dx / dragging.zoom;
        const rawY = dragging.startY + dy / dragging.zoom;

        const snapped = snapToGrid(map, rawX, rawY, dragging.token.size ?? grid);

        const updated = {
            ...dragging.token,
            x: snapped.x,
            y: snapped.y
        };

        // Save locally
        upsertToken(updated);
        registerLocalTokenMove(updated);

        // Broadcast
        sendWS({
            type: "token-move",
            token: updated
        });
    }

    function onMouseUp() {
        dragging = null;
    }

    container.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
        container.removeEventListener("mousedown", onMouseDown);
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
    };
}
