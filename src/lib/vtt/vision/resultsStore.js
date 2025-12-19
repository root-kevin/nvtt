// src/lib/vtt/vision/resultsStore.js
import { writable } from "svelte/store";

/**
 * Array of points in MAP SPACE
 * [{ x, y }, ...]
 */
export const visionPolygon = writable(null);

/**
 * Metadata (optional, but useful)
 */
export const visionMeta = writable({
  tokenId: null,
  updatedAt: null
});

/**
 * Debug payload (GM-only, transient)
 */
export const visionDebug = writable(null);
