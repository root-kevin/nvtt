import { writable } from "svelte/store";

export const currentMap = writable({
    id: null,
    src: null,
    width: 0,
    height: 0,
    gridSizePx: 64
});

export function setMapFromImage(id, src, img) {
    currentMap.set({
        id,
        src,
        width: img.width,
        height: img.height,
        gridSizePx: 64
    });
}
