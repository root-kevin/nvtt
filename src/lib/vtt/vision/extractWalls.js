import { segment } from "./types.js";
import { getWallPoints, resolveWallType, wallBlocksSight } from "../walls/model.js";

const LENGTH_EPS = 0.5;
const SNAP_EPS = 0.5;
const SNAP_EPS_SQ = SNAP_EPS * SNAP_EPS;

function dist2(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function snapEndpoints(rawSegments) {
  const clusters = [];

  function snapPoint(p) {
    for (const existing of clusters) {
      if (dist2(existing, p) <= SNAP_EPS_SQ) return existing;
    }
    const fresh = { x: p.x, y: p.y };
    clusters.push(fresh);
    return fresh;
  }

  return rawSegments.map(seg => ({
    ...seg,
    a: snapPoint(seg.a),
    b: snapPoint(seg.b)
  }));
}

function normalizeSegment(seg) {
  const aFirst = seg.a.x < seg.b.x || (seg.a.x === seg.b.x && seg.a.y <= seg.b.y);
  const a = aFirst ? seg.a : seg.b;
  const b = aFirst ? seg.b : seg.a;
  return { ...seg, a, b };
}

function segKey(seg) {
  const round = (v) => Math.round(v * 1000); // thousandth-pixel stability
  return `${round(seg.a.x)}:${round(seg.a.y)}-${round(seg.b.x)}:${round(seg.b.y)}`;
}

function unitNormalForSegment(a, b, preferLeft = true) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = preferLeft ? -dy / len : dy / len;
  const ny = preferLeft ? dx / len : -dx / len;
  return { x: nx, y: ny };
}

function boundaryNormal(a, b, map) {
  if (!map?.width || !map?.height) return null;
  const center = { x: map.width / 2, y: map.height / 2 };
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const base = unitNormalForSegment(a, b, true);
  const toCenter = { x: center.x - mid.x, y: center.y - mid.y };
  const dot = base.x * toCenter.x + base.y * toCenter.y;
  // Point normal outward; if it faces center, flip it.
  return dot > 0 ? { x: -base.x, y: -base.y } : base;
}

function wallNormal(a, b, wall) {
  const dir = Number(wall?.dir) || 0;
  if (dir === 1) return unitNormalForSegment(a, b, true);  // block from left of A->B
  if (dir === 2) return unitNormalForSegment(a, b, false); // block from right of A->B
  return null;
}

function resolveElevationSpan(wall) {
  const flags = wall?.flags || {};
  const elev = flags.elevation || flags.elevations || {};
  const bottomCandidates = [
    wall?.bottom,
    wall?.zBottom,
    elev.bottom,
    elev.min,
    elev.low
  ];
  const topCandidates = [
    wall?.top,
    wall?.zTop,
    elev.top,
    elev.max,
    elev.high
  ];

  const bottom = bottomCandidates.find(Number.isFinite);
  const top = topCandidates.find(Number.isFinite);

  return {
    bottom: Number.isFinite(bottom) ? bottom : -Infinity,
    top: Number.isFinite(top) ? top : Infinity
  };
}

function preprocessSegments(rawSegments = []) {
  const snapped = snapEndpoints(rawSegments);
  const deduped = [];
  const seen = new Set();

  for (const seg of snapped) {
    const dx = seg.a.x - seg.b.x;
    const dy = seg.a.y - seg.b.y;
    if (dx * dx + dy * dy < LENGTH_EPS * LENGTH_EPS) continue; // drop tiny/zero walls

    const normalized = normalizeSegment(seg);
    const key = segKey(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(normalized);
  }

  return deduped;
}

export function extractVisionSegments(walls, map) {
  const segments = [];

  // ---------------------------
  // REAL WALLS / DOORS
  // ---------------------------
  for (const w of walls || []) {
    const type = resolveWallType(w);
    const { a, b } = getWallPoints(w);
    if (!a || !b) continue;

    if (type === "DOOR") {
      const doorData = w?.door || {};
      const openNow = !!doorData.open || (Number(doorData.openPct) || 0) > 0;
      if (openNow) continue;
      if (!wallBlocksSight(w, null)) continue;
      segments.push(segment(a, b, {
        type: "door",
        openPct: w?.door?.openPct ?? 0,
        wall: w,
        normal: wallNormal(a, b, w), // doors remain two-sided unless dir is set
        elevation: resolveElevationSpan(w),
        invisible: !!w?.flags?.invisible
      }));
      continue;
    }

    if (type === "WINDOW") {
      if (!wallBlocksSight(w, null)) continue;
      segments.push(segment(a, b, {
        type: "window",
        wall: w,
        normal: wallNormal(a, b, w),
        elevation: resolveElevationSpan(w),
        invisible: !!w?.flags?.invisible
      }));
      continue;
    }

    if (wallBlocksSight(w, null)) {
      segments.push(segment(a, b, {
        type: "wall",
        wall: w,
        normal: wallNormal(a, b, w),
        elevation: resolveElevationSpan(w),
        invisible: !!w?.flags?.invisible
      }));
    }
  }

  // ---------------------------
  // 🔥 MAP BOUNDARY WALLS
  // ---------------------------
  if (map?.width && map?.height) {
    const w = map.width;
    const h = map.height;

    const b1a = { x: 0, y: 0 };
    const b1b = { x: w, y: 0 };
    const b2a = { x: w, y: 0 };
    const b2b = { x: w, y: h };
    const b3a = { x: w, y: h };
    const b3b = { x: 0, y: h };
    const b4a = { x: 0, y: h };
    const b4b = { x: 0, y: 0 };

    const boundaryMeta = (a, b) => ({
      type: "boundary",
      normal: boundaryNormal(a, b, map),
      elevation: { bottom: -Infinity, top: Infinity }
    });

    segments.push(segment(b1a, b1b, boundaryMeta(b1a, b1b)));
    segments.push(segment(b2a, b2b, boundaryMeta(b2a, b2b)));
    segments.push(segment(b3a, b3b, boundaryMeta(b3a, b3b)));
    segments.push(segment(b4a, b4b, boundaryMeta(b4a, b4b)));
  }

  return preprocessSegments(segments);
}
