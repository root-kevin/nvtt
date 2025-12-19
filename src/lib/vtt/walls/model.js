// Shared wall helpers (client-side)

const OBSTRUCTION = new Set(["NONE", "NORMAL", "LIMITED"]);

export const WALL_PRESETS = {
  NORMAL: {
    label: "Normal",
    type: "WALL",
    move: "NORMAL",
    sight: "NORMAL",
    light: "NORMAL",
    sound: "NORMAL"
  },
  TERRAIN: {
    label: "Terrain",
    type: "WALL",
    move: "LIMITED",
    sight: "NONE",
    light: "NORMAL",
    sound: "NORMAL"
  },
  INVISIBLE: {
    label: "Invisible",
    type: "WALL",
    move: "NORMAL",
    sight: "NONE",
    light: "NONE",
    sound: "NORMAL",
    flags: { invisible: true }
  },
  WINDOW: {
    label: "Window",
    type: "WINDOW",
    move: "NORMAL",
    sight: "NONE",
    light: "NONE",
    sound: "NORMAL"
  }
};

function clampObstruction(value, fallback = "NORMAL") {
  const upper = typeof value === "string" ? value.toUpperCase() : null;
  if (upper && OBSTRUCTION.has(upper)) return upper;
  return fallback;
}

export function resolveWallType(wall) {
  const t = (wall?.type || wall?.kind || "").toString().toUpperCase();
  if (t === "DOOR" || t === "WINDOW" || t === "WALL") return t;
  if (wall?.door) return "DOOR"; // legacy data that forgot to set type
  return "WALL";
}

export function isDoor(wall) {
  return resolveWallType(wall) === "DOOR";
}

export function getWallEndpoints(w) {
  if (Array.isArray(w?.c) && w.c.length >= 4) {
    return {
      a: { x: Number(w.c[0]) || 0, y: Number(w.c[1]) || 0 },
      b: { x: Number(w.c[2]) || 0, y: Number(w.c[3]) || 0 }
    };
  }
  if (w?.a && w?.b) return { a: w.a, b: w.b };
  return null;
}

export function getDoorMidpoint(door) {
  const { a, b } = getWallPoints(door);
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2
  };
}

export function getWallPoints(wall) {
  if (!wall) return { a: { x: 0, y: 0 }, b: { x: 0, y: 0 } };
  const endpoints = getWallEndpoints(wall);
  if (endpoints) return endpoints;
  return { a: { x: 0, y: 0 }, b: { x: 0, y: 0 } };
}

export function resolveDoorState(door = {}) {
  const raw = (door.state || "").toString().toUpperCase();
  if (raw === "OPEN" || raw === "CLOSED" || raw === "LOCKED") return raw;
  if (door.locked) return "LOCKED";
  if (door.open) return "OPEN";
  return "CLOSED";
}

export function isDoorOpen(wall) {
  if (!wall) return false;
  const type = resolveWallType(wall);
  if (type !== "DOOR") return false;
  const state = resolveDoorState(wall.door);
  if (state === "OPEN") return true;
  if (typeof wall?.door?.openPct === "number") return wall.door.openPct >= 99;
  return false;
}

export function obstructionForState(state) {
  return state === "OPEN" ? "NONE" : "NORMAL";
}

export function normalizeDoorData(patch = {}, existing = {}) {
  const merged = { ...existing, ...patch };
  let state = resolveDoorState(merged);

  if (state !== "LOCKED" && Number.isFinite(merged.openPct)) {
    if (merged.openPct >= 99) state = "OPEN";
    else if (merged.openPct <= 1) state = "CLOSED";
  }

  merged.state = state;
  if (patch.locked !== undefined) {
    merged.locked = !!patch.locked;
  } else {
    merged.locked = state === "LOCKED";
  }
  merged.open = state === "OPEN";
  if (!Number.isFinite(merged.openPct)) {
    merged.openPct = merged.open ? 100 : 0;
  }
  if (state === "LOCKED") {
    merged.openPct = 0;
    merged.open = false;
  }

  return merged;
}

function isDirectionalBlock(wall, origin) {
  const dir = Number(wall?.dir) || 0;
  if (!dir || !origin) return true;
  const { a, b } = getWallPoints(wall);
  const side = (b.x - a.x) * (origin.y - a.y) - (b.y - a.y) * (origin.x - a.x);
  if (dir === 1) return side >= 0; // block from left of A->B
  if (dir === 2) return side <= 0; // block from right of A->B
  return true;
}

export function wallBlocksMovement(wall, origin = null) {
  const type = resolveWallType(wall);
  if (type === "DOOR" && isDoorOpen(wall)) return false;

  let move = clampObstruction(wall?.move);
  if (!move && wall?.blocksMovement !== undefined) {
    move = wall.blocksMovement ? "NORMAL" : "NONE";
  }
  if (!move) move = "NORMAL";
  if (move === "NONE") return false;

  return isDirectionalBlock(wall, origin);
}

export function wallBlocksSight(wall, origin = null) {
  const type = resolveWallType(wall);
  if (type === "DOOR" && isDoorOpen(wall)) return false;

  let sight = clampObstruction(wall?.sight);
  if (!sight && wall?.blocksVision !== undefined) {
    sight = wall.blocksVision ? "NORMAL" : "NONE";
  }
  if (!sight) sight = "NORMAL";
  if (sight === "NONE") return false;

  return isDirectionalBlock(wall, origin);
}

function maybeRandomId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

export function buildWallDoc({ start, end, presetKey = "NORMAL", base = {} }) {
  const preset = WALL_PRESETS[presetKey] || WALL_PRESETS.NORMAL;
  const c = [
    Number(start?.x) || 0,
    Number(start?.y) || 0,
    Number(end?.x) || 0,
    Number(end?.y) || 0
  ];

  return {
    id: base.id || maybeRandomId(),
    c,
    a: { x: c[0], y: c[1] },
    b: { x: c[2], y: c[3] },
    type: preset.type,
    kind: preset.type.toLowerCase(),
    move: preset.move,
    sight: preset.sight,
    light: preset.light,
    sound: preset.sound,
    blocksMovement: preset.move !== "NONE",
    blocksVision: preset.sight !== "NONE",
    dir: base.dir ?? 0,
    flags: preset.flags || base.flags
  };
}
