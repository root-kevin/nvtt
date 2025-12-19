// src/lib/vtt/walls/collision.js
// Swept-circle (capsule) vs segment collision helpers for token movement.

const EPS_PX = 0.5;
const SKIN_PX = 6;
const CORNER_EPS_PX = 2;
const MAX_ITERS = 6;
const BISECT_STEPS = 20;
const SLIDE_BACKOFF = 0.9;

function normalize(v) {
  const len = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / len, y: v.y / len };
}

function dist2(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function pointSegmentDistanceSquared(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist2(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  const proj = { x: a.x + dx * t, y: a.y + dy * t };
  return dist2(p, proj);
}

function closestPointOnSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { x: a.x, y: a.y };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return { x: a.x + dx * t, y: a.y + dy * t };
}

function orient(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(a, b, c) {
  return (
    Math.min(a.x, b.x) <= c.x &&
    c.x <= Math.max(a.x, b.x) &&
    Math.min(a.y, b.y) <= c.y &&
    c.y <= Math.max(a.y, b.y)
  );
}

function segmentsIntersect(a, b, c, d) {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);

  if (o1 === 0 && onSegment(a, b, c)) return true;
  if (o2 === 0 && onSegment(a, b, d)) return true;
  if (o3 === 0 && onSegment(c, d, a)) return true;
  if (o4 === 0 && onSegment(c, d, b)) return true;

  return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
}

function segmentSegmentDistanceSquared(a, b, c, d) {
  if (segmentsIntersect(a, b, c, d)) return 0;
  const d1 = pointSegmentDistanceSquared(a, c, d);
  const d2 = pointSegmentDistanceSquared(b, c, d);
  const d3 = pointSegmentDistanceSquared(c, a, b);
  const d4 = pointSegmentDistanceSquared(d, a, b);
  return Math.min(d1, d2, d3, d4);
}

function penetrationVectors(center, segments, radius) {
  const pushes = [];
  for (const seg of segments) {
    const closest = closestPointOnSegment(center, seg.a, seg.b);
    const distSq = dist2(center, closest);
    const dist = Math.sqrt(distSq);
    const penetration = radius + EPS_PX - dist;
    if (penetration > 0) {
      let dir = {
        x: center.x - closest.x,
        y: center.y - closest.y
      };
      if (Math.abs(dir.x) < 1e-6 && Math.abs(dir.y) < 1e-6) {
        dir = {
          x: seg.b.y - seg.a.y,
          y: -(seg.b.x - seg.a.x)
        };
      }
      dir = normalize(dir);
      pushes.push({
        vec: { x: dir.x * penetration, y: dir.y * penetration },
        len: penetration,
        seg
      });
    }
  }
  return pushes;
}

function resolveMTV(center, segments, radius) {
  const overlaps = penetrationVectors(center, segments, radius);
  if (!overlaps.length) return { center, resolved: true };

  const candidates = [...overlaps.map(o => o.vec)];
  const sum = overlaps.reduce(
    (acc, o) => ({ x: acc.x + o.vec.x, y: acc.y + o.vec.y }),
    { x: 0, y: 0 }
  );
  if (Math.hypot(sum.x, sum.y) > 1e-6) {
    candidates.push(sum);
  }

  const resolvesAll = (cVec) => {
    const next = { x: center.x + cVec.x, y: center.y + cVec.y };
    for (const seg of segments) {
      const closest = closestPointOnSegment(next, seg.a, seg.b);
      const distSq = dist2(next, closest);
      if (distSq < (radius + EPS_PX) * (radius + EPS_PX) - 1e-6) return false;
    }
    return true;
  };

  let best = null;
  for (const vec of candidates) {
    if (!vec) continue;
    if (!resolvesAll(vec)) continue;
    const len = Math.hypot(vec.x, vec.y);
    if (!best || len < best.len) {
      best = { vec, len };
    }
  }

  const applied = best ? best.vec : sum;
  const nextCenter = {
    x: center.x + (applied?.x || 0),
    y: center.y + (applied?.y || 0)
  };

  // Final epsilon nudge outward if still barely overlapping
  const remaining = penetrationVectors(nextCenter, segments, radius);
  if (remaining.length) {
    const push = remaining.reduce(
      (acc, o) => ({ x: acc.x + o.vec.x, y: acc.y + o.vec.y }),
      { x: 0, y: 0 }
    );
    nextCenter.x += push.x * 0.1;
    nextCenter.y += push.y * 0.1;
  }

  return { center: nextCenter, resolved: !remaining.length };
}

function depenetratePoint(center, segments, radius) {
  let best = null;
  for (const seg of segments) {
    const closest = closestPointOnSegment(center, seg.a, seg.b);
    const distSq = dist2(center, closest);
    const dist = Math.sqrt(distSq);
    const push = radius + EPS_PX - dist;
    if (push > 0 && (!best || push > best.push)) {
      let dir = {
        x: center.x - closest.x,
        y: center.y - closest.y
      };
      if (Math.abs(dir.x) < 1e-6 && Math.abs(dir.y) < 1e-6) {
        dir = {
          x: seg.b.y - seg.a.y,
          y: -(seg.b.x - seg.a.x)
        };
      }
      dir = normalize(dir);
      best = { push, dir, seg, closest };
    }
  }

  if (!best) return { center, pushed: false };

  return {
    center: {
      x: center.x + best.dir.x * best.push,
      y: center.y + best.dir.y * best.push
    },
    pushed: true,
    seg: best.seg,
    closest: best.closest
  };
}

function findCollisionT(start, end, segA, segB, radius) {
  const r2 = radius * radius;
  if (pointSegmentDistanceSquared(start, segA, segB) <= r2) return 0;

  const minDist2 = segmentSegmentDistanceSquared(start, end, segA, segB);
  if (minDist2 > r2) return null;

  let lo = 0;
  let hi = 1;
  for (let i = 0; i < BISECT_STEPS; i += 1) {
    const mid = (lo + hi) / 2;
    const p = {
      x: start.x + (end.x - start.x) * mid,
      y: start.y + (end.y - start.y) * mid
    };
    if (pointSegmentDistanceSquared(p, segA, segB) <= r2) {
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return hi;
}

export function clampTokenMovement({ start, end, radius, walls, relaxOnDrop = false }) {
  if (!start || !end || !Number.isFinite(radius)) {
    return { x: end?.x ?? 0, y: end?.y ?? 0, collided: false };
  }
  const originalStart = { x: start.x, y: start.y };

  const fatRadius = radius + SKIN_PX + (relaxOnDrop ? 2 : 0);

  let startCenter = { x: start.x + fatRadius, y: start.y + fatRadius };
  let endCenter = { x: end.x + fatRadius, y: end.y + fatRadius };

  const segments = [];
  for (const w of walls || []) {
    if (!wallBlocksMovement(w, startCenter)) continue;
    const { a, b } = getWallPoints(w);
    if (!a || !b) continue;
    segments.push({ a, b, wall: w });
  }

  if (!segments.length) {
    return { x: end.x, y: end.y, collided: false };
  }

  // If starting inside penetration, push out along closest normal once.
  const startFix = depenetratePoint(startCenter, segments, fatRadius);
  if (startFix.pushed) {
    const shift = {
      x: startFix.center.x - startCenter.x,
      y: startFix.center.y - startCenter.y
    };
    startCenter = startFix.center;
    endCenter = { x: endCenter.x + shift.x, y: endCenter.y + shift.y };
  }

  const moveVec = { x: endCenter.x - startCenter.x, y: endCenter.y - startCenter.y };
  const moveLen = Math.hypot(moveVec.x, moveVec.y);

  function clampPath(pathStart, pathEnd) {
    let earliest = 1;
    let earliestSeg = null;
    for (const seg of segments) {
      const t = findCollisionT(pathStart, pathEnd, seg.a, seg.b, radius);
      if (t != null && t < earliest) {
        earliest = t;
        earliestSeg = seg;
      }
    }

    if (earliest >= 1) {
      return {
        collided: false,
        endPoint: { ...pathEnd },
        hitSeg: null,
        hitCenter: null
      };
    }

    const pathLen = Math.hypot(pathEnd.x - pathStart.x, pathEnd.y - pathStart.y);
    const backOff = pathLen > 0 ? EPS_PX / pathLen : 0;
    const tSafe = Math.max(0, earliest - backOff);
    const safeCenter = {
      x: pathStart.x + (pathEnd.x - pathStart.x) * tSafe,
      y: pathStart.y + (pathEnd.y - pathStart.y) * tSafe
    };
    const hitCenter = {
      x: pathStart.x + (pathEnd.x - pathStart.x) * earliest,
      y: pathStart.y + (pathEnd.y - pathStart.y) * earliest
    };

    return {
      collided: true,
      endPoint: safeCenter,
      hitSeg: earliestSeg,
      hitCenter,
      hitT: earliest
    };
  }

  let clamped = clampPath(startCenter, endCenter);
  if (!clamped.collided) {
    return { x: clamped.endPoint.x - fatRadius, y: clamped.endPoint.y - fatRadius, collided: false };
  }

  // Iterative MTV resolution with skin.
  let resolvedCenter = { x: startCenter.x, y: startCenter.y };
  let hitSeg = clamped.hitSeg;
  let hitCenter = clamped.hitCenter;
  for (let i = 0; i < MAX_ITERS; i += 1) {
    const overlaps = penetrationVectors(resolvedCenter, segments, fatRadius);
    if (!overlaps.length) break;
    const mtv = resolveMTV(resolvedCenter, segments, fatRadius);
    resolvedCenter = mtv.center;
  }

  // Final check; if still overlapping, nudge along summed normals
  const remaining = penetrationVectors(resolvedCenter, segments, fatRadius);
  if (remaining.length) {
    const sum = remaining.reduce(
      (acc, o) => ({ x: acc.x + o.vec.x, y: acc.y + o.vec.y }),
      { x: 0, y: 0 }
    );
    const len = Math.hypot(sum.x, sum.y) || 1;
    resolvedCenter = {
      x: resolvedCenter.x + (sum.x / len) * CORNER_EPS_PX,
      y: resolvedCenter.y + (sum.y / len) * CORNER_EPS_PX
    };
  }

  const finalHits = penetrationVectors(resolvedCenter, segments, fatRadius);
  const primarySeg = hitSeg || finalHits[0]?.seg || clamped.hitSeg || null;
  const hitPoint = primarySeg
    ? closestPointOnSegment(resolvedCenter, primarySeg.a, primarySeg.b)
    : null;

  return {
    x: resolvedCenter.x - fatRadius,
    y: resolvedCenter.y - fatRadius,
    collided: true,
    hit: hitPoint
      ? {
          x: hitPoint.x,
          y: hitPoint.y,
          center: resolvedCenter,
          a: primarySeg?.a,
          b: primarySeg?.b
        }
      : null
  };
}
import { getWallPoints, wallBlocksMovement } from "./model.js";
