import { writable } from "svelte/store";

export const viewport = writable({
    x: 0,
    y: 0,
    scale: 1
});

export function pan(dx, dy) {
    viewport.update(v => ({ ...v, x: v.x + dx, y: v.y + dy }));
}

export function zoomAt(point, delta) {
    viewport.update(v => {
        let newScale = Math.max(0.2, Math.min(4, v.scale * delta));
        return { ...v, scale: newScale };
    });
}

export function resetView() {
    viewport.set({ x: 0, y: 0, scale: 1 });
}
