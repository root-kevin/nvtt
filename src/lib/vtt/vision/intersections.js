const EPS = 1e-6;
const ENDPOINT_EPS = 0.5;
const ENDPOINT_EPS_SQ = ENDPOINT_EPS * ENDPOINT_EPS;

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

function segmentSegmentDistanceSquared(a, b, c, d) {
  const o = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const onSeg = (p, q, r) =>
    Math.min(p.x, q.x) <= r.x && r.x <= Math.max(p.x, q.x) &&
    Math.min(p.y, q.y) <= r.y && r.y <= Math.max(p.y, q.y);

  const o1 = o(a, b, c);
  const o2 = o(a, b, d);
  const o3 = o(c, d, a);
  const o4 = o(c, d, b);

  const intersects =
    (o1 === 0 && onSeg(a, b, c)) ||
    (o2 === 0 && onSeg(a, b, d)) ||
    (o3 === 0 && onSeg(c, d, a)) ||
    (o4 === 0 && onSeg(c, d, b)) ||
    ((o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0));

  if (intersects) return 0;

  return Math.min(
    pointSegmentDistanceSquared(a, c, d),
    pointSegmentDistanceSquared(b, c, d),
    pointSegmentDistanceSquared(c, a, b),
    pointSegmentDistanceSquared(d, a, b)
  );
}

export function intersectRaySegment(origin, ray, seg, { padding = 0 } = {}) {
  const x1 = origin.x;
  const y1 = origin.y;
  const x2 = origin.x + ray.dx * ray.maxDistance;
  const y2 = origin.y + ray.dy * ray.maxDistance;

  const x3 = seg.a.x;
  const y3 = seg.a.y;
  const x4 = seg.b.x;
  const y4 = seg.b.y;

  const den = (x1-x2)*(y3-y4) - (y1-y2)*(x3-x4);
  if (Math.abs(den) < EPS) return null;

  const t = ((x1-x3)*(y3-y4) - (y1-y3)*(x3-x4)) / den;
  const u = -((x1-x2)*(y1-y3) - (y1-y2)*(x1-x3)) / den;

  const hits =
    t >= -EPS && t <= 1 + EPS &&
    u >= -EPS && u <= 1 + EPS;

  if (hits) {
    const clampedT = Math.max(0, Math.min(1, t));
    let ix = x1 + clampedT * (x2 - x1);
    let iy = y1 + clampedT * (y2 - y1);
    let endpointSnap = false;

    const da = dist2({ x: ix, y: iy }, seg.a);
    const db = dist2({ x: ix, y: iy }, seg.b);
    if (da <= ENDPOINT_EPS_SQ && da <= db) {
      ix = seg.a.x;
      iy = seg.a.y;
      endpointSnap = true;
    } else if (db <= ENDPOINT_EPS_SQ) {
      ix = seg.b.x;
      iy = seg.b.y;
      endpointSnap = true;
    }

    return {
      x: ix,
      y: iy,
      dist: clampedT * ray.maxDistance,
      endpointSnap
    };
  }

  // 🔒 Padding catch: if the ray segment passes within a small padding of the wall segment, treat as blocked.
  if (padding > 0) {
    const rayEnd = { x: x2, y: y2 };
    const distSq = segmentSegmentDistanceSquared({ x: x1, y: y1 }, rayEnd, seg.a, seg.b);
    if (distSq <= padding * padding) {
      // Project the seg midpoint onto the ray for an approximate hit distance
      const mid = { x: (seg.a.x + seg.b.x) / 2, y: (seg.a.y + seg.b.y) / 2 };
      const dir = { x: ray.dx, y: ray.dy };
      const tProj = Math.max(0, Math.min(ray.maxDistance, (mid.x - x1) * dir.x + (mid.y - y1) * dir.y));
      return {
        x: x1 + dir.x * tProj,
        y: y1 + dir.y * tProj,
        dist: tProj
      };
    }
  }

  return null;
}
