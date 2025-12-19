// src/lib/vtt/vision/computeVision.js
import { intersectRaySegment } from "./intersections.js";
import { logVision } from "./debug.js";
import { wallBlocksSight } from "../walls/model.js";

const VERTEX_PROXIMITY = 1;
const VERTEX_PROXIMITY_SQ = VERTEX_PROXIMITY * VERTEX_PROXIMITY;
const ORIGIN_NUDGE = 0.75;
const ANGLE_EPS = 1e-9;
const TWO_PI = Math.PI * 2;
const RANGE_SAMPLE_STEPS = 96;

function dist2(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function normalizeAngle(a) {
  let angle = a % TWO_PI;
  if (angle < 0) angle += TWO_PI;
  return angle;
}

function adjustOriginAwayFromVertices(origin, segments, mapSize) {
  if (!segments?.length) return origin;

  const nearbySegments = [];
  for (const seg of segments) {
    const hitEndpoint = [seg.a, seg.b].find((p) => dist2(origin, p) <= VERTEX_PROXIMITY_SQ);
    if (hitEndpoint) nearbySegments.push(seg);
  }
  if (!nearbySegments.length) return origin;

  const target = {
    x: Number.isFinite(mapSize?.width) ? mapSize.width / 2 : origin.x + 1,
    y: Number.isFinite(mapSize?.height) ? mapSize.height / 2 : origin.y
  };
  const towardOpen = { x: target.x - origin.x, y: target.y - origin.y };
  const towardOpenLen = Math.hypot(towardOpen.x, towardOpen.y) || 1;
  towardOpen.x /= towardOpenLen;
  towardOpen.y /= towardOpenLen;

  let nx = 0;
  let ny = 0;
  for (const seg of nearbySegments) {
    const dx = seg.b.x - seg.a.x;
    const dy = seg.b.y - seg.a.y;
    const len = Math.hypot(dx, dy);
    if (!len) continue;
    let px = -dy / len;
    let py = dx / len;
    if (px * towardOpen.x + py * towardOpen.y < 0) {
      px *= -1;
      py *= -1;
    }
    nx += px;
    ny += py;
  }

  const nLen = Math.hypot(nx, ny);
  const dir = nLen > 1e-6 ? { x: nx / nLen, y: ny / nLen } : towardOpen;

  return {
    x: origin.x + dir.x * ORIGIN_NUDGE,
    y: origin.y + dir.y * ORIGIN_NUDGE
  };
}

function angleTo(origin, point) {
  return normalizeAngle(Math.atan2(point.y - origin.y, point.x - origin.x));
}

function dedupeSortedAngles(rawAngles = []) {
  const sorted = rawAngles.map(normalizeAngle).sort((a, b) => a - b);
  const unique = [];
  let prev = null;
  for (const angle of sorted) {
    if (prev === null || Math.abs(angle - prev) > ANGLE_EPS) {
      unique.push(angle);
      prev = angle;
    }
  }
  return unique;
}

function segmentBlocksAtElevation(seg, viewerElevation) {
  const span = seg?.meta?.elevation || {};
  const bottom = Number.isFinite(span.bottom) ? span.bottom : -Infinity;
  const top = Number.isFinite(span.top) ? span.top : Infinity;
  if (viewerElevation < bottom) return false; // viewer is below the blocking span
  if (viewerElevation > top) return false;    // viewer is above the blocker (elevated vision looks over)
  return true;
}

function shouldConsiderSegment(seg, origin, viewerElevation) {
  const wall = seg?.meta?.wall;
  if (wall && !wallBlocksSight(wall, origin)) return false;
  if (!segmentBlocksAtElevation(seg, viewerElevation)) return false;
  return true;
}

function castRay(origin, angle, segments, rayLimit, viewerElevation) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const ray = { angle, dx, dy, maxDistance: rayLimit };

  let closest = null;

  for (const seg of segments) {
    if (!shouldConsiderSegment(seg, origin, viewerElevation)) continue;
    const hit = intersectRaySegment(origin, ray, seg, { padding: 0 });
    if (!hit) continue;
    if (!closest || hit.dist < closest.dist) {
      closest = { ...hit, segment: seg };
    }
  }

  if (closest) {
    return {
      x: closest.x,
      y: closest.y,
      dist: closest.dist,
      angle,
      segment: closest.segment,
      hit: true,
      endpointSnap: !!closest.endpointSnap
    };
  }

  if (Number.isFinite(rayLimit)) {
    return {
      x: origin.x + dx * rayLimit,
      y: origin.y + dy * rayLimit,
      dist: rayLimit,
      angle,
      segment: null,
      hit: false,
      endpointSnap: false
    };
  }

  return null;
}

function buildAngles(origin, segments, maxDistancePx) {
  const angles = [];
  for (const seg of segments) {
    angles.push(angleTo(origin, seg.a));
    angles.push(angleTo(origin, seg.b));
  }

  if (Number.isFinite(maxDistancePx)) {
    for (let i = 0; i < RANGE_SAMPLE_STEPS; i++) {
      angles.push((i / RANGE_SAMPLE_STEPS) * TWO_PI);
    }
  }

  return dedupeSortedAngles(angles);
}

function dedupePoints(points) {
  const MERGE_EPS = 0.25;
  const MERGE_EPS_SQ = MERGE_EPS * MERGE_EPS;
  const out = [];
  let last = null;
  for (const p of points) {
    if (!last || dist2(p, last) > MERGE_EPS_SQ) {
      out.push(p);
      last = p;
    }
  }
  // Close the loop if final point is redundant with first
  if (out.length >= 2 && dist2(out[0], out[out.length - 1]) <= MERGE_EPS_SQ) {
    out.pop();
  }
  return out;
}

function resolveViewerElevation(token) {
  const base = Number.isFinite(token?.elevation) ? token.elevation : 0;
  const eye = Number.isFinite(token?.vision?.elevation) ? token.vision.elevation : 0;
  const eyeOffset = Number.isFinite(token?.vision?.eyeHeight) ? token.vision.eyeHeight : 0;
  return base + eye + eyeOffset;
}

function resolveRayLimit(maxDistancePx, mapSize) {
  if (Number.isFinite(maxDistancePx)) return maxDistancePx;
  if (mapSize?.width && mapSize?.height) {
    const diag = Math.hypot(mapSize.width, mapSize.height);
    if (diag > 1) return diag;
  }
  return 8192; // finite fallback to keep math stable
}

export function computeVision(token, segments, maxDistancePx, gridSizePx, mapSize, options = {}) {
  if (!token || !segments) {
    console.warn("[Vision] computeVision missing inputs", { token, segments });
    return null;
  }

  const sizePx = Number.isFinite(token.size) && token.size > 0
    ? token.size
    : Number.isFinite(gridSizePx)
      ? gridSizePx
      : 0;
  const origin = {
    x: token.x + sizePx / 2,
    y: token.y + sizePx / 2
  };
  const adjustedOrigin = adjustOriginAwayFromVertices(origin, segments, mapSize);
  const onDebug = typeof options?.onDebug === "function" ? options.onDebug : null;
  const viewerElevation = resolveViewerElevation(token);
  const rayLimit = resolveRayLimit(maxDistancePx, mapSize);

  const angles = buildAngles(adjustedOrigin, segments, maxDistancePx);
  const hits = [];

  for (const angle of angles) {
    const hit = castRay(adjustedOrigin, angle, segments, rayLimit, viewerElevation);
    if (hit) hits.push(hit);
  }

  const polygon = dedupePoints(hits).map(({ x, y }) => ({ x, y }));

  logVision("result", {
    origin: adjustedOrigin,
    maxDistance: maxDistancePx,
    segments: segments.length,
    vertices: polygon.length,
    angles: angles.length
  });

  onDebug?.({
    origin: adjustedOrigin,
    rawOrigin: origin,
    maxDistance: maxDistancePx,
    segments,
    rays: hits,
    polygon
  });

  return polygon;
}
