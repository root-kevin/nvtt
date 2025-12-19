import { writable } from "svelte/store";

/**
 * ID of the token currently driving vision (PlayerView)
 */
export const activeVisionTokenId = writable(null);

/**
 * Last computed vision result (polygon, rays, metadata)
 * NOT rendered yet
 */
export const currentVisionResult = writable(null);

export function setActiveVisionToken(id) {
  activeVisionTokenId.set(id);
}

export function setVisionResult(result) {
  currentVisionResult.set(result);
}


/**
 * ID of the token whose vision drives PlayerView
 * (manual selection for now; per-player later)
 */
export const selectedVisionTokenId = writable(null);
