import { writable } from "svelte/store";

export const showWalls = writable(true);
export const wallOpacity = writable(0.6);
export const snapWallsToGrid = writable(true);

// draw | door | delete
export const wallToolMode = writable("draw");
export const wallPreset = writable("NORMAL");

export const doorAnimVersion = writable(0);
export function bumpDoorAnimVersion() {
    doorAnimVersion.update((n) => (Number.isFinite(n) ? n + 1 : 1));
}

// Landing zone indicator (player view)
export const activeDoorLanding = writable(null); // { doorId, x, y } | null
