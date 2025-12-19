const ANGLE_EPS = 1e-7;
const ENDPOINT_ANGLE_EPS = 1e-4;
const POINT_MERGE_EPS = 0.25;
const POINT_MERGE_EPS_SQ = POINT_MERGE_EPS * POINT_MERGE_EPS;
const TWO_PI = Math.PI * 2;

function normalizeAngle(angle) {
  let a = angle % TWO_PI;
  if (a < 0) a += TWO_PI;
  return a;
}

export function castRays(origin, segments, maxDistance) {
  const rays = [];
  const seenAngles = new Set();

  function addRay(angle) {
    const a = normalizeAngle(angle);
    const key = Math.round(a / ANGLE_EPS);
    if (seenAngles.has(key)) return;
    seenAngles.add(key);
    rays.push({
      angle: a,
      dx: Math.cos(a),
      dy: Math.sin(a),
      maxDistance
    });
  }

  // 1️⃣ Uniform radial sweep (core vision)
  const STEPS = 720; // 0.5 degree
  for (let i = 0; i < STEPS; i++) {
    addRay((i / STEPS) * TWO_PI);
  }

  // 2️⃣ Endpoint refinement (unique endpoints only)
  const uniqueEndpoints = [];
  for (const seg of segments) {
    for (const p of [seg.a, seg.b]) {
      const existing = uniqueEndpoints.find(q => {
        const dx = p.x - q.x;
        const dy = p.y - q.y;
        return dx * dx + dy * dy <= POINT_MERGE_EPS_SQ;
      });
      if (!existing) uniqueEndpoints.push(p);
    }
  }

  for (const p of uniqueEndpoints) {
    const dx = p.x - origin.x;
    const dy = p.y - origin.y;
    if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) continue;
    const angle = Math.atan2(dy, dx);
    addRay(angle - ENDPOINT_ANGLE_EPS);
    addRay(angle);
    addRay(angle + ENDPOINT_ANGLE_EPS);
  }

  return rays.sort((a, b) => a.angle - b.angle);
}
