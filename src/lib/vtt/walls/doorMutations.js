import { get } from "svelte/store";
import { currentMap, upsertMap } from "$lib/vtt/map/store.js";
import { sendWS } from "$lib/ws.js";
import { DOOR_TYPES } from "./doorTypes.js";
import { normalizeDoorData, obstructionForState } from "./model.js";

export function updateDoor(doorId, doorPatch, wallPatch = null) {
  const map = get(currentMap);
  if (!map) return;

  const normalizedPatch = { ...(doorPatch || {}) };

  const walls = (map.walls || []).map(w => {
    if (w.id !== doorId) return w;

    const nextDoor = normalizeDoorData(normalizedPatch, w.door || {});
    const obstruction = obstructionForState(nextDoor.state);
    const autoWallPatch = {
      move: obstruction,
      sight: obstruction,
      blocksMovement: obstruction !== "NONE",
      blocksVision: obstruction !== "NONE"
    };
    const nextWall = { ...w, door: nextDoor, ...autoWallPatch };

    if (wallPatch) Object.assign(nextWall, wallPatch);

    return nextWall;
  });

  const updated = { ...map, walls };
  upsertMap(updated);
  const latest = walls.find((w) => w.id === doorId)?.door;
  sendWS({
    type: "door-update",
    mapId: updated.id,
    doorId,
    door: {
      ...normalizedPatch,
      state: latest?.state ?? normalizedPatch.state,
      open: latest?.open,
      openPct: latest?.openPct,
      locked: latest?.locked
    },
    wallPatch: wallPatch || null
  });
}


export function setDoorType(doorId, typeKey) {
  const type = DOOR_TYPES[typeKey];
  if (!type) return;

  updateDoor(doorId, {
    type: typeKey,
    hp: type.hp,
    ac: type.ac,
    thicknessPx: type.thickness * 4
  });
}
