// Shared helpers for elevation, terrain sampling, visibility, and cover.
import { intersectRaySegment } from "./intersections.js";
import { extractVisionSegments } from "./extractWalls.js";
import { wallBlocksSight, resolveWallType, isDoorOpen } from "../walls/model.js";

const HEIGHT_EPS = 1e-3;

function pointInPolygon(point, polygon = []) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x ?? polygon[i][0];
    const yi = polygon[i].y ?? polygon[i][1];
    const xj = polygon[j].x ?? polygon[j][0];
    const yj = polygon[j].y ?? polygon[j][1];
    const intersect =
      yi > point.y !== yj > point.y &&
      point.x <
        ((xj - xi) * (point.y - yi)) / ((yj - yi) || 1e-9) +
          xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function resolveRegionBase(region, fallback = 0) {
  const candidates = [
    region?.base,
    region?.elevation,
    region?.z,
    region?.height,
    region?.altitude
  ];
  const pick = candidates.find(Number.isFinite);
  return Number.isFinite(pick) ? pick : fallback;
}

function resolveRegionSlope(region, point) {
  const slope = region?.slope || region?.gradient;
  if (!slope) return 0;
  const rate =
    Number(slope.rate) ??
    Number(slope.rise) ??
    Number(slope.gradient) ??
    Number(slope.perPx);
  if (!Number.isFinite(rate) || Math.abs(rate) < 1e-6) return 0;

  const dirDeg = Number(slope.directionDeg ?? slope.direction ?? slope.angle);
  const dirRad = Number.isFinite(dirDeg)
    ? (dirDeg * Math.PI) / 180
    : Number(slope.radians);
  const axis =
    Number.isFinite(dirRad) && !Number.isNaN(dirRad)
      ? { x: Math.cos(dirRad), y: Math.sin(dirRad) }
      : { x: 0, y: 1 }; // default: slope increases to +Y

  const origin = slope.origin || slope.anchor || region?.origin || { x: 0, y: 0 };
  const dx = (point.x ?? 0) - (origin.x ?? 0);
  const dy = (point.y ?? 0) - (origin.y ?? 0);
  const projection = dx * axis.x + dy * axis.y;
  return projection * rate;
}

function sampleRaster(terrain, x, y) {
  const raster = terrain?.raster;
  if (!raster?.data || !Number.isFinite(raster.width) || !Number.isFinite(raster.height)) {
    return null;
  }
  const scale = Number.isFinite(raster.scale) ? raster.scale : 1;
  const px = Math.floor(x / scale);
  const py = Math.floor(y / scale);
  if (px < 0 || py < 0 || px >= raster.width || py >= raster.height) return null;
  const idx = py * raster.width + px;
  const val = raster.data[idx];
  return Number.isFinite(val) ? val : null;
}

export function resolveWallHeightSpan(wall) {
  const flags = wall?.flags || {};
  const wh = flags["wall-height"] || flags.wallHeight || {};
  const elev = flags.elevation || flags.elevations || {};
  const candidatesBottom = [
    wall?.heightBottom,
    wall?.bottom,
    wall?.zBottom,
    wh.bottom,
    elev.bottom,
    elev.min,
    elev.low
  ];
  const candidatesTop = [
    wall?.heightTop,
    wall?.top,
    wall?.zTop,
    wh.top,
    elev.top,
    elev.max,
    elev.high
  ];

  const bottom = candidatesBottom.find(Number.isFinite);
  const top = candidatesTop.find(Number.isFinite);
  return {
    bottom: Number.isFinite(bottom) ? bottom : -Infinity,
    top: Number.isFinite(top) ? top : Infinity
  };
}

export function getTerrainHeightAt(x, y, map, { withMeta = false } = {}) {
  const terrain = map?.terrain || {};
  const base =
    Number.isFinite(terrain.baseElevation) ||
    Number.isFinite(terrain.base)
      ? Number(terrain.baseElevation ?? terrain.base)
      : 0;

  let regionMatch = null;
  for (const region of terrain.regions || []) {
    const poly = region?.polygon || region?.points || region?.shape;
    if (!Array.isArray(poly) || poly.length < 3) continue;
    if (!pointInPolygon({ x, y }, poly)) continue;
    const regionBase = resolveRegionBase(region, base);
    const regionSlope = resolveRegionSlope(region, { x, y });
    const regionHeight = regionBase + regionSlope;
    const priority = Number(region?.priority ?? 0);
    if (!regionMatch || priority >= regionMatch.priority) {
      regionMatch = {
        height: regionHeight,
        priority,
        regionId: region?.id || region?.name || null
      };
    }
  }

  const rasterHeight = sampleRaster(terrain, x, y);
  const value = Number.isFinite(rasterHeight)
    ? rasterHeight
    : regionMatch?.height ?? base;

  return withMeta
    ? {
        height: value,
        source: Number.isFinite(rasterHeight)
          ? "raster"
          : regionMatch
          ? "region"
          : "base",
        region: regionMatch?.regionId ?? null,
        base
      }
    : value;
}

export function getTokenElevation(token, map, { includeEyeHeight = true, withMeta = false } = {}) {
  if (!token) return withMeta ? { height: 0, components: {} } : 0;
  const grid = map?.gridSizePx || 0;
  const size = Number.isFinite(token.size) ? token.size : grid;
  const cx = (token.x ?? 0) + (size || 0) / 2;
  const cy = (token.y ?? 0) + (size || 0) / 2;
  const terrain = getTerrainHeightAt(cx, cy, map, { withMeta: true });

  const baseElevation = Number.isFinite(token.elevation) ? token.elevation : 0;
  const visionOffset = Number.isFinite(token?.vision?.elevation) ? token.vision.elevation : 0;
  const eye = includeEyeHeight
    ? Number.isFinite(token?.vision?.eyeHeight)
      ? token.vision.eyeHeight
      : 0
    : 0;

  const height = terrain.height + baseElevation + visionOffset + eye;
  if (!withMeta) return height;
  return {
    height,
    components: {
      terrain: terrain.height,
      baseElevation,
      visionOffset,
      eyeHeight: eye
    },
    terrain
  };
}

export function getWallHeightIntersection(
  { origin, target, distance, maxDistance },
  wallOrSpan,
  map,
  { originElevation, targetElevation, span } = {}
) {
  const wall = wallOrSpan?.meta?.wall || wallOrSpan;
  const wallSpan = span || wallOrSpan?.meta?.elevation || resolveWallHeightSpan(wall);
  const bottom = Number.isFinite(wallSpan?.bottom) ? wallSpan.bottom : -Infinity;
  const top = Number.isFinite(wallSpan?.top) ? wallSpan.top : Infinity;

  const totalDistance =
    Number.isFinite(maxDistance) && maxDistance > 0
      ? maxDistance
      : target
      ? Math.hypot(target.x - origin.x, target.y - origin.y)
      : distance;
  const t =
    Number.isFinite(distance) && totalDistance > 0 ? distance / totalDistance : 0;

  const originZ =
    originElevation ??
    getTerrainHeightAt(origin?.x ?? 0, origin?.y ?? 0, map);
  const targetZ =
    targetElevation ??
    (target ? getTerrainHeightAt(target.x, target.y, map) : originZ);
  const heightAtWall = originZ + (targetZ - originZ) * t;

  const blocks =
    heightAtWall >= bottom - HEIGHT_EPS && heightAtWall <= top + HEIGHT_EPS;

  return {
    blocks,
    heightAtWall,
    wallBottom: bottom,
    wallTop: top
  };
}

function shouldConsiderSegment(seg, origin) {
  const wall = seg?.meta?.wall;
  if (wall) {
    const type = resolveWallType(wall);
    if (type === "DOOR" && isDoorOpen(wall)) return false;
    if (!wallBlocksSight(wall, origin)) return false;
  }
  return true;
}

function ensureSegments(segmentsOrMap, map) {
  if (Array.isArray(segmentsOrMap)) return segmentsOrMap;
  if (segmentsOrMap?.walls || map?.walls) {
    const m = map ?? segmentsOrMap;
    return extractVisionSegments(m?.walls || [], m);
  }
  return [];
}

function traceSightRay(origin, target, segments, map, options = {}) {
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const maxDistance = Math.hypot(dx, dy);
  if (maxDistance < 1e-6) {
    return {
      blocked: false,
      distance: 0,
      originElevation: options.originElevation,
      targetElevation: options.targetElevation,
      tested: []
    };
  }

  const ray = { dx: dx / maxDistance, dy: dy / maxDistance, maxDistance };
  const hits = [];
  for (const seg of segments) {
    if (!shouldConsiderSegment(seg, origin)) continue;
    const hit = intersectRaySegment(origin, ray, seg, { padding: options.padding ?? 0 });
    if (hit) hits.push({ ...hit, segment: seg });
  }
  hits.sort((a, b) => a.dist - b.dist);

  const tested = [];
  const originElevation =
    options.originElevation ??
    getTerrainHeightAt(origin.x, origin.y, map);
  const targetElevation =
    options.targetElevation ??
    getTerrainHeightAt(target.x, target.y, map);

  for (const hit of hits) {
    const heightTest = getWallHeightIntersection(
      { origin, target, distance: hit.dist, maxDistance },
      hit.segment,
      map,
      { originElevation, targetElevation }
    );
    const detail = { ...hit, heightTest };
    tested.push(detail);
    if (heightTest.blocks) {
      return {
        blocked: true,
        blocker: detail,
        distance: hit.dist,
        originElevation,
        targetElevation,
        tested
      };
    }
  }

  return {
    blocked: false,
    distance: maxDistance,
    originElevation,
    targetElevation,
    tested
  };
}

function sampleTargetPoints(target, map) {
  const grid = map?.gridSizePx ?? 64;
  const size = Number.isFinite(target?.size) ? target.size : grid;
  const half = size / 2;
  const cx = (target?.x ?? 0) + half;
  const cy = (target?.y ?? 0) + half;
  return [
    { x: cx, y: cy },
    { x: target.x ?? 0, y: cy },
    { x: (target.x ?? 0) + size, y: cy },
    { x: cx, y: target.y ?? 0 },
    { x: cx, y: (target.y ?? 0) + size }
  ];
}

export function computeTokenVisibility(observer, target, segmentsOrMap, options = {}) {
  if (!observer || !target) {
    return { state: "none", reason: "missing-token" };
  }
  const map = options.map || (segmentsOrMap?.walls ? segmentsOrMap : null) || null;
  const segments = ensureSegments(segmentsOrMap, map);
  const samples = sampleTargetPoints(target, map);
  const origin = options.originPoint ?? (() => {
    const grid = map?.gridSizePx ?? 64;
    const size = Number.isFinite(observer.size) ? observer.size : grid;
    const half = size / 2;
    return { x: (observer.x ?? 0) + half, y: (observer.y ?? 0) + half };
  })();

  const originElevation =
    options.originElevation ??
    getTokenElevation(observer, map, { includeEyeHeight: true });
  const targetElevation =
    options.targetElevation ??
    getTokenElevation(target, map, { includeEyeHeight: false });

  const tests = samples.map((pt) =>
    traceSightRay(origin, pt, segments, map, {
      originElevation,
      targetElevation
    })
  );
  const blocked = tests.filter((t) => t.blocked).length;
  const visible = tests.length - blocked;
  const ratio = tests.length ? visible / tests.length : 0;

  let state = "none";
  if (ratio >= 0.75) state = "full";
  else if (ratio > 0) state = "partial";

  return {
    state,
    visible,
    blocked,
    total: tests.length,
    ratio,
    tests
  };
}

export function computeCover(attacker, target, segmentsOrMap, options = {}) {
  if (!attacker || !target) {
    return { type: "none", modifier: 0, total: 0, blocked: 0, tests: [] };
  }
  const map = options.map || (segmentsOrMap?.walls ? segmentsOrMap : null) || null;
  const segments = ensureSegments(segmentsOrMap, map);
  const samples = sampleTargetPoints(target, map);
  const origin = options.originPoint ?? (() => {
    const grid = map?.gridSizePx ?? 64;
    const size = Number.isFinite(attacker.size) ? attacker.size : grid;
    const half = size / 2;
    return { x: (attacker.x ?? 0) + half, y: (attacker.y ?? 0) + half };
  })();

  const originElevation =
    options.originElevation ??
    getTokenElevation(attacker, map, { includeEyeHeight: true });
  const targetElevation =
    options.targetElevation ??
    getTokenElevation(target, map, { includeEyeHeight: false });

  const tests = samples.map((pt) =>
    traceSightRay(origin, pt, segments, map, {
      originElevation,
      targetElevation,
      padding: options.padding ?? 0
    })
  );

  const blocked = tests.filter((t) => t.blocked).length;
  const total = tests.length;

  let type = "none";
  let modifier = 0;
  if (blocked >= total) {
    type = "full";
    modifier = Infinity;
  } else if (blocked >= 3) {
    type = "three-quarters";
    modifier = 5;
  } else if (blocked >= 1) {
    type = "half";
    modifier = 2;
  }

  return {
    type,
    modifier,
    blocked,
    total,
    tests
  };
}

