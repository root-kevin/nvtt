// src/lib/vtt/utils/placement.js
// Compute map-space center based on current viewport, pan, and zoom.
export function centerOnView(map, pan, zoom, size = 64) {
    const tokenSize = size || 64;
    if (!map) return { x: 0, y: 0 };

    const fallback = tokenSize * 20;
    const w = map.width ?? map.naturalWidth ?? fallback;
    const h = map.height ?? map.naturalHeight ?? fallback;

    // Always place at the center of the map, regardless of pan/zoom
    return {
        x: Math.max(0, Math.min(w - tokenSize, w / 2 - tokenSize / 2)),
        y: Math.max(0, Math.min(h - tokenSize, h / 2 - tokenSize / 2))
    };
}

// Snap a token so its top-left aligns to the nearest grid line (so edges sit on grid).
export function snapToGrid(map, x, y, size) {
    const grid = map?.gridSizePx ?? 64;
    const w = map?.width ?? map?.naturalWidth ?? grid * 20;
    const h = map?.height ?? map?.naturalHeight ?? grid * 20;
    const snappedX = Math.round(x / grid) * grid;
    const snappedY = Math.round(y / grid) * grid;
    const sx = Math.max(0, Math.min(w - size, snappedX));
    const sy = Math.max(0, Math.min(h - size, snappedY));
    return { x: sx, y: sy };
}
