import { writable } from "svelte/store";

export const activeVisionTokenId = writable(null);

export function setActiveVisionToken(id) {
  activeVisionTokenId.set(id);
}
