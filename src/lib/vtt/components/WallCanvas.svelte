<!-- src/lib/vtt/components/WallCanvas.svelte -->
<script>
  import { onMount, onDestroy, createEventDispatcher } from "svelte";
  import { get } from "svelte/store";

  import { browser } from "$app/environment";
  import { currentMap, upsertMap } from "$lib/vtt/map/store.js";
  import {
    snapWallsToGrid,
    wallToolMode,
    doorAnimVersion,
    wallPreset
  } from "$lib/vtt/walls/store.js";
  import { tokens as tokensStore } from "$lib/vtt/tokens/store.js";
  import { LockKeyhole, LockKeyholeOpen, DoorOpen as IconDoorOpen, DoorClosed as IconDoorClosed } from "@lucide/svelte";
  import { DOOR_TYPES } from "$lib/vtt/walls/doorTypes.js";
  import { buildWallDoc, getDoorMidpoint, getWallEndpoints, resolveDoorState, resolveWallType, isDoor } from "$lib/vtt/walls/model.js";
  const DOOR_ANIM = {
    WOOD_SIMPLE: { style: "swing", durationMs: 250 },
    WOOD_GOOD: { style: "swing", durationMs: 250 },
    WOOD_HEAVY: { style: "swing", durationMs: 320 },
    WOOD_REINFORCED: { style: "swing", durationMs: 320 },
    STONE: { style: "slide", durationMs: 280 },
    IRON: { style: "slide", durationMs: 280 },
    PORTCULLIS_WOOD: { style: "ascend", durationMs: 320 },
    PORTCULLIS_IRON: { style: "ascend", durationMs: 320 }
  };

  const WALL_WIDTHS = {
    wall: 18,
    door: 24,
    terrain: 18,
    window: 12,
    invisible: 12
  };

  const WALL_COLORS = {
    wall: "#7b5cff",
    door: "#ffffff",
    terrain: "#4caf50",
    window: "#8fd0ff",
    invisible: "rgba(255,255,255,0.75)"
  };

  const WALL_NODE_RADIUS = 18;
  const WALL_HINGE_RADIUS = 12;

  function doorAnimConfig(door) {
    const type = door?.door?.type;
    const mapCfg = type ? DOOR_ANIM[type] : null;
    const explicit = door?.door?.animation || {};
    return {
      style: explicit.style || mapCfg?.style || "swing",
      durationMs: explicit.durationMs || mapCfg?.durationMs || 250
    };
  }
  export let isGM = false;
  export let mode = null; // "wall" | null
  export let zIndex = 30;
  export let attemptedLockedDoors = new Set();

  const dispatch = createEventDispatcher();

  let canvas;
  let ctx;

  let start = null;
  let preview = null;

  let hoveredId = null;
  let selectedDoor = null;
  let selectedWallId = null;
  let selectedDeletePos = null;
  let spaceDown = false;
  let displayWalls = true;
  let lastMapId = null;
  let nodeDrag = null; // { wallId, endpoint: "a"|"b", nextA, nextB, originalA, originalB }
  let nodeHover = null; // { wallId, endpoint }

  const doorOpenState = new Map();
  const doorAnimations = new Map();
  const doorShakes = new Map();
  const doorRenderPct = new Map();
  const doorLastPct = new Map();
  const wallTypeOf = (w) => resolveWallType(w);
  const isDoorWall = (w) => wallTypeOf(w) === "DOOR";
  let doorAnimSub;
  let doorControls = [];
  let doorDetailId = null;
  let schemaLogLast = 0;
  let selectedMidpoint = null;

  $: displayWalls = isGM ? ($currentMap?.showWalls ?? true) : true;
  $: if ($currentMap?.id !== lastMapId) {
    lastMapId = $currentMap?.id ?? null;
    doorOpenState.clear();
    doorRenderPct.clear();
    doorLastPct.clear();
    selectedWallId = null;
    nodeDrag = null;
    nodeHover = null;
    if (browser) {
      for (const raf of doorAnimations.values()) {
        cancelAnimationFrame(raf);
      }
    }
    doorAnimations.clear();
  }
  /* ======================================================
     Geometry helpers (TOP-LEVEL, SSR safe)
  ====================================================== */
  function distToSegment(p, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(
      0,
      Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))
    );
    return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
  }

function doorInteractionThreshold(w) {
  const thickness = WALL_WIDTHS.door;
  const grid = $currentMap?.gridSizePx ?? 64;
  return Math.max(thickness * 1.5, grid * 0.25, 20);
}

function tokenContactPoints(token) {
  if (!token) return [];
    const size = token.size ?? $currentMap?.gridSizePx ?? 64;
    const half = size / 2;
    const cx = token.x + half;
    const cy = token.y + half;
    return [
      { x: cx, y: token.y },          // top
      { x: cx, y: token.y + size },   // bottom
      { x: token.x, y: cy },          // left
      { x: token.x + size, y: cy }    // right
    ];
  }

  function distanceTokenToDoor(token, door) {
    if (!token || !door) return Infinity;
    const endpoints = getWallEndpoints(door);
    if (!endpoints) return Infinity;
    const pts = tokenContactPoints(token);
    return pts.reduce((best, p) => Math.min(best, distToSegment(p, endpoints.a, endpoints.b)), Infinity);
  }

  function isPlayerOwnedToken(token) {
    return !!(token?.vision?.isPlayer || token?.isPlayerToken || token?.characterId);
  }

  function isPlayerAdjacentToDoor(door) {
    if (!door || !$currentMap) return false;
    const mapId = $currentMap.id;
    const list = get(tokensStore) || [];
    const threshold = doorInteractionThreshold(door);
    const grid = $currentMap?.gridSizePx ?? 64;

    return list.some(t => {
      if (!t || t.mapId !== mapId) return false;
      if (!isPlayerOwnedToken(t)) return false;
      const size = t.size ?? grid;
      const half = size / 2;

      // Only allow interaction via the four mid-edge contact points (no diagonals)
      const pts = tokenContactPoints(t);
      const endpoints = getWallEndpoints(door);
      if (!endpoints) return false;
      return pts.some(p => distToSegment(p, endpoints.a, endpoints.b) <= threshold);
    });
  }

  function snapPoint(pt) {
    if (!$snapWallsToGrid || !$currentMap?.gridSizePx) return pt;
    const g = $currentMap.gridSizePx;
    return {
      x: Math.round(pt.x / g) * g,
      y: Math.round(pt.y / g) * g
    };
  }

  function snapToNodes(pt) {
    const nodes = getAllWallNodes();
    let best = null;
    for (const n of nodes) {
      const dist = Math.hypot(pt.x - n.x, pt.y - n.y);
      if (dist <= SNAP_RADIUS && (!best || dist < best.dist)) {
        best = { ...n, dist, pt: { x: n.x, y: n.y } };
      }
    }
    return best;
  }

  function snapDiagonal(a, b) {
    if (!$snapWallsToGrid) return snapPoint(b);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const angle = Math.atan2(dy, dx);
    const step = Math.PI / 4;
    const snapped = Math.round(angle / step) * step;
    const len = Math.hypot(dx, dy);
    return snapPoint({
      x: a.x + Math.cos(snapped) * len,
      y: a.y + Math.sin(snapped) * len
    });
  }

  function toMap(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (canvas.width / r.width),
      y: (e.clientY - r.top) * (canvas.height / r.height)
    };
  }

  function doorHitThreshold(w, override = null) {
    if (override != null) return override;
    const thickness = WALL_WIDTHS.door;
    const grid = $currentMap?.gridSizePx ?? 64;
    return Math.max(thickness * 1.5, grid * 0.15, 12);
  }

  function nearestEndpoint(pt, { exclude = null, threshold = SNAP_RADIUS } = {}) {
    const nodes = getAllWallNodes();
    let best = null;
    for (const n of nodes) {
      if (exclude && exclude.wallId === n.wallId && exclude.endpoint === n.end) continue;
      const dist = Math.hypot(pt.x - n.x, pt.y - n.y);
      if (dist <= threshold && (!best || dist < best.dist)) {
        const wall = ($currentMap?.walls || []).find(w => w.id === n.wallId);
        if (!wall) continue;
        best = { wall, endpoint: n.end, dist, pt: { x: n.x, y: n.y } };
      }
    }
    return best;
  }

  function doorStateInfo(doorWall) {
    const d = doorWall?.door || {};
    const state = resolveDoorState(d);
    const open = state === "OPEN";
    const locked = state === "LOCKED";
    const openPct = Number.isFinite(d.openPct) ? d.openPct : open ? 100 : 0;
    return { state, open, locked, openPct };
  }

  function nearestDoor(pt, thresholdOverride = null) {
    let best = null;
    for (const w of $currentMap?.walls || []) {
      if (!isDoorWall(w)) continue;
      const leaf = getDoorLeaf(w);
      const threshold = doorHitThreshold(w, thresholdOverride);
      const hingeDist = Math.hypot(pt.x - leaf.hinge.x, pt.y - leaf.hinge.y);
      const segDist = distToSegment(pt, leaf.hinge, leaf.tip);
      const dist = Math.min(hingeDist, segDist);
      if (!best || dist < best.dist) {
        best = { door: w, dist, threshold };
      }
    }
    return best;
  }

  function hitTestDoor(pt, thresholdOverride = null) {
    const info = nearestDoor(pt, thresholdOverride);
    if (info && info.dist <= info.threshold) {
      return info.door;
    }
    return null;
  }



  /* ======================================================
     Keyboard handling
  ====================================================== */
  function onKey(e) {
    if (e.code === "Space") {
      spaceDown = e.type === "keydown";
      if (spaceDown) {
        start = preview = null;
        draw();
      }
      return;
    }

    if (mode === "wall" && (e.metaKey || e.ctrlKey) && e.code === "KeyZ") {
      e.preventDefault();
      const walls = $currentMap?.walls || [];
      if (!walls.length) return;
      const updated = { ...$currentMap, walls: walls.slice(0, -1) };
      upsertMap(updated);

// 🔥 PERSIST WALLS TO DISK
fetch("/api/maps", {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    ...updated
  })
}).catch(err => {
  console.error("[WallCanvas] Failed to persist walls", err);
});



    }

    if (e.type === "keydown" && isGM && (e.code === "Delete" || e.code === "Backspace") && selectedWallId) {
      e.preventDefault();
      const walls = ($currentMap?.walls || []).filter(w => w.id !== selectedWallId);
      const updated = { ...$currentMap, walls };
      upsertMap(updated);
      fetch("/api/maps", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...updated })
      }).catch(() => {});
      selectedWallId = null;
      draw();
    }
  }

  onMount(() => {
    if (!browser) return;
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("pointerdown", onGlobalPointerDown, true);
    doorAnimSub = doorAnimVersion.subscribe(() => {
      refreshDoorAnimations();
    });
  });

  onDestroy(() => {
    if (!browser) return;
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("keyup", onKey);
    window.removeEventListener("pointerdown", onGlobalPointerDown, true);
    doorAnimSub?.();
  });

  /* ======================================================
     Canvas lifecycle
  ====================================================== */
  function resize() {
    if (!canvas || !$currentMap) return;
    canvas.width = $currentMap.width;
    canvas.height = $currentMap.height;
    ctx = canvas.getContext("2d");
    requestAnimationFrame(draw);
  }

  /* ======================================================
     Rendering
  ====================================================== */
  function wallRenderPoints(w) {
    const endpoints = getWallEndpoints(w);
    if (!endpoints) return null;
    let a = endpoints.a;
    let b = endpoints.b;
    if (nodeDrag && nodeDrag.wallId === w.id) {
      a = nodeDrag.nextA ?? endpoints.a;
      b = nodeDrag.nextB ?? endpoints.b;
    }
    return { a, b };
  }

  function rot90(v, dir = 1) {
  return dir === 1 ? { x: -v.y, y: v.x } : { x: v.y, y: -v.x };
}
function norm(v) {
  const len = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / len, y: v.y / len };
}

const SNAP_RADIUS = 18;

  function getAllWallNodes() {
    if (!$currentMap?.walls) return [];
    const nodes = [];
    for (const w of $currentMap.walls) {
      const endpoints = getWallEndpoints(w);
      if (!endpoints) continue;
      nodes.push({ x: endpoints.a.x, y: endpoints.a.y, wallId: w.id, end: "a" });
      nodes.push({ x: endpoints.b.x, y: endpoints.b.y, wallId: w.id, end: "b" });
    }
    return nodes;
  }

function getWallRenderStyle(wall) {
  const type = resolveWallType(wall);
  const isTerrain =
    wall?.type?.toString().toUpperCase() === "TERRAIN" ||
    (wall?.move === "LIMITED" && wall?.sight === "NONE");

  if (type === "DOOR") {
    return { color: WALL_COLORS.door, width: WALL_WIDTHS.door, dash: [] };
  }

  if (wall?.flags?.invisible || type === "INVISIBLE") {
    return { color: WALL_COLORS.invisible, width: WALL_WIDTHS.invisible, dash: [14, 12] };
  }

  if (type === "WINDOW") {
    return { color: WALL_COLORS.window, width: WALL_WIDTHS.window, dash: [] };
  }

  if (isTerrain) {
    return { color: WALL_COLORS.terrain, width: WALL_WIDTHS.terrain, dash: [] };
  }

  if (type === "WALL") {
    return { color: WALL_COLORS.wall, width: WALL_WIDTHS.wall, dash: [] };
  }

  return { color: WALL_COLORS.wall, width: WALL_WIDTHS.wall, dash: [] };
}

  function nodeVisualState(wallId, endpoint) {
    if (!isGM) return "idle";
    if (nodeDrag && nodeDrag.wallId === wallId && nodeDrag.endpoint === endpoint) return "drag";
    if (selectedWallId === wallId) return "selected";
    if (nodeHover && nodeHover.wallId === wallId && nodeHover.endpoint === endpoint) return "hover";
    if (hoveredId === wallId) return "hover";
    return "idle";
  }

function nodeStyle(state) {
  if (state === "drag") return { r: WALL_NODE_RADIUS + 2, fill: "rgba(255,215,160,0.95)", stroke: "rgba(0,0,0,0.9)" };
  if (state === "selected") return { r: WALL_NODE_RADIUS, fill: "rgba(255,255,255,0.95)", stroke: "rgba(0,0,0,0.9)" };
  if (state === "hover") return { r: WALL_NODE_RADIUS - 1, fill: "rgba(220,220,220,0.85)", stroke: "rgba(0,0,0,0.8)" };
  return { r: WALL_NODE_RADIUS - 2, fill: "rgba(180,180,180,0.7)", stroke: "rgba(0,0,0,0.65)" };
}



  function draw() {
  if (!ctx || !$currentMap) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const wallList = $currentMap?.walls || [];
  const doorsFound = wallList.filter(w => isDoor(w)).length;
  const wallsFound = wallList.length - doorsFound;
  const now = performance.now();
  if (now - schemaLogLast > 250) {
    schemaLogLast = now;
    console.log(`[Walls] schema=c[] doors=${doorsFound} walls=${wallsFound}`);
  }

  for (const w of $currentMap.walls || []) {
    const renderPts = wallRenderPoints(w);
    if (!renderPts) continue;
    const now = performance.now();
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;

    const hover = w.id === hoveredId;

    /* ───────────────────────── DOORS ───────────────────────── */
    if (isDoorWall(w)) {
      const d = w.door || {};
      const state = resolveDoorState(d);
      const open = state === "OPEN";
      const locked = state === "LOCKED";

      // 🚫 Hidden from players
      if (!isGM && d.hidden) continue;

      // Player view: only icons; skip geometry render
      if (!isGM) continue;

      const leaf = getDoorLeaf({ ...w, a: renderPts.a, b: renderPts.b });
      const shaking = doorShakes.has(w.id) && doorShakes.get(w.id) > now;
      if (doorShakes.has(w.id) && !shaking) {
        doorShakes.delete(w.id);
      }

      if (shaking) {
        const jx = Math.sin(now / 35) * 4;
        const jy = Math.cos(now / 45) * 3;
        ctx.save();
        ctx.translate(jx, jy);
      }

      /* COLOR */
      const attemptedLocked = !isGM && locked && !open && attemptedLockedDoors?.has?.(w.id);
      ctx.strokeStyle = WALL_COLORS.door;
      ctx.shadowBlur = attemptedLocked ? 14 : 0;
      ctx.shadowColor = attemptedLocked ? "rgba(255,80,80,0.9)" : "rgba(0,0,0,0.8)";

      /* DOOR LEAF */
      if (!d.noSwing) {
        ctx.lineWidth = WALL_WIDTHS.door;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(leaf.hinge.x, leaf.hinge.y);
        ctx.lineTo(leaf.tip.x, leaf.tip.y);
        ctx.stroke();
      }

      /* HINGE */
      ctx.fillStyle = "rgba(0,0,0,0.9)";
      ctx.beginPath();
      ctx.arc(leaf.hinge.x, leaf.hinge.y, WALL_HINGE_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = WALL_COLORS.door;
      ctx.lineWidth = 2;
      ctx.stroke();


      /* SWING ARC */
      if (leaf.style === "swing") {
        ctx.strokeStyle = isGM
          ? "rgba(255,255,255,0.25)"
          : "rgba(255,255,255,0.18)";
        ctx.lineWidth = 2;

        let start = leaf.fromRad;
        let end = leaf.angleRad;
        let delta = end - start;

        if (delta > Math.PI) delta -= Math.PI * 2;
        if (delta < -Math.PI) delta += Math.PI * 2;

        ctx.beginPath();
        ctx.arc(
          leaf.hinge.x,
          leaf.hinge.y,
          leaf.len,
          start,
          end,
          delta < 0
        );
        ctx.stroke();
      }

      if (shaking) {
        ctx.restore();
      }

      // Door endpoint nodes (GM only, always visible)
      if (isGM) {
        const stateA = nodeVisualState(w.id, "a");
        const stateB = nodeVisualState(w.id, "b");
        const styleA = nodeStyle(stateA);
        const styleB = nodeStyle(stateB);
        const drawNode = (pt, st) => {
          if (!pt) return;
          ctx.save();
          ctx.fillStyle = st.fill;
          ctx.strokeStyle = st.stroke;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, st.r, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        };
        drawNode(renderPts.a, styleA);
        drawNode(renderPts.b, styleB);
      }

      ctx.shadowBlur = 0;
      ctx.shadowColor = "transparent";
      continue;
    }

    /* ───────────────────────── WALLS ───────────────────────── */
    if (!isGM) continue;
    if (!displayWalls && mode !== "wall") continue;

    const style = getWallRenderStyle(w);
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width;
    ctx.lineCap = "round";
    ctx.setLineDash(style.dash || []);

    if (selectedWallId === w.id) {
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = (style.width || 2) + 3;
      ctx.beginPath();
      ctx.moveTo(renderPts.a.x, renderPts.a.y);
      ctx.lineTo(renderPts.b.x, renderPts.b.y);
      ctx.stroke();
      ctx.restore();
    }

    ctx.beginPath();
    ctx.moveTo(renderPts.a.x, renderPts.a.y);
    ctx.lineTo(renderPts.b.x, renderPts.b.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Endpoint nodes (always for GM)
    const stateA = nodeVisualState(w.id, "a");
    const stateB = nodeVisualState(w.id, "b");
    const styleA = nodeStyle(stateA);
    const styleB = nodeStyle(stateB);
    const drawNode = (pt, st) => {
      if (!pt) return;
      ctx.save();
      ctx.fillStyle = st.fill;
      ctx.strokeStyle = st.stroke;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, st.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    };
    drawNode(renderPts.a, styleA);
    drawNode(renderPts.b, styleB);

  }

  /* PREVIEW WALL */
  if (start && preview) {
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = "rgba(180,220,255,0.9)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(preview.x, preview.y);
    ctx.stroke();
  }

  ctx.setLineDash([]);
  ctx.shadowBlur = 0;
}

/* ======================================================
   Door mutation helpers
====================================================== */


function changeDoorType(e) {
  setDoorType(e.detail.door.id, e.detail.type);
}


  /* ======================================================
     Pointer events
  ====================================================== */
  function down(e) {
    const pt = toMap(e);
    // GM Select tool: capture door clicks even over tokens
    if (isGM && mode !== "wall" && pt) {
      const hit = nearestDoor(pt);
      if (hit && hit.dist <= hit.threshold) {
        e.stopPropagation();
        e.preventDefault();
        selectedDoor = hit.door;
        selectedWallId = hit.door.id;
        hoveredId = hit.door.id;
        doorDetailId = hit.door.id;
        draw();
        dispatch("doorSelect", { door: hit.door });
        return;
      }
    }

    if (isGM && mode === "wall" && !spaceDown) {
      const node = nearestEndpoint(pt);
      if (node && node.dist <= SNAP_RADIUS && selectedWallId === node.wall.id) {
        const endpoints = getWallEndpoints(node.wall);
        if (!endpoints) return;
        nodeDrag = {
          wallId: node.wall.id,
          endpoint: node.endpoint,
          originalA: { ...endpoints.a },
          originalB: { ...endpoints.b },
          nextA: endpoints.a,
          nextB: endpoints.b
        };
        hoveredId = node.wall.id;
        start = preview = null;
        draw();
        return;
      }
    }
    const nearest = nearestDoor(pt);
    const door = nearest && nearest.dist <= nearest.threshold ? nearest.door : null;
    const doorState = door ? doorStateInfo(door) : null;

    const playerAdjacent = !isGM && isPlayerAdjacentToDoor(door);
    if (!isGM && !playerAdjacent) return;

    // ----------------------------
    // DOOR INTERACTION
    // ----------------------------
    if (door && e.button === 0) {
      if (!isGM && door?.door?.hidden) return;
      selectedDoor = door;
      selectedWallId = door.id;
      hoveredId = door.id;
      doorDetailId = door.id;
      draw();

      if (!isGM) {
        if (doorState?.locked && !doorState.open) {
          triggerDoorShake(door.id);
          dispatch("lockedAttempt", { doorId: door.id });
          return;
        }
        dispatch("doorRequest", { doorId: door.id });
        return;
      }

      // GM Select tool: select only
      if (mode !== "wall") {
        dispatch("doorSelect", { door });
        return;
      }

      // 🚫 Prevent opening locked doors
      if (!(doorState?.locked && !doorState.open)) {
        dispatch("toggleDoorOpen", { door });
      }

      dispatch("doorSelect", { door });
      return;
    }

    // WALL SELECTION (GM)
    const nearNode = snapToNodes(pt);
    if (isGM && !(mode === "wall" && $wallToolMode === "draw" && nearNode)) {
      const walls = $currentMap?.walls || [];
      let best = null;
      for (const w of walls) {
        const endpoints = getWallEndpoints(w);
        if (!endpoints) continue;
        const d = distToSegment(pt, endpoints.a, endpoints.b);
        if (d <= 12 && (!best || d < best.dist)) best = { wall: w, dist: d };
      }
      if (best) {
        selectedWallId = best.wall.id;
        hoveredId = best.wall.id;
        doorDetailId = null;
        draw();
        return;
      }
    }

    // 👇 CLICKED EMPTY SPACE → DESELECT
    selectedDoor = null;
    selectedWallId = null;
    hoveredId = null;
    draw();

    // ----------------------------
    // WALL TOOL BELOW
    // ----------------------------
    if (mode !== "wall" || spaceDown) return;

    if ($wallToolMode === "delete") {
      const walls = $currentMap.walls || [];
      let idx = -1;
      let best = 10;

      walls.forEach((w, i) => {
        if (isDoorWall(w)) return; // 🚫 SAFE
        const endpoints = getWallEndpoints(w);
        if (!endpoints) return;
        const d = distToSegment(pt, endpoints.a, endpoints.b);
        if (d < best) {
          best = d;
          idx = i;
        }
      });

      if (idx !== -1) {
        const updated = {
          ...$currentMap,
          walls: walls.filter((_, i) => i !== idx)
        };
        selectedWallId = null;
        upsertMap(updated);

        // 🔥 PERSIST WALLS TO DISK
        fetch("/api/maps", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...updated
          })
        }).catch(err => {
          console.error("[WallCanvas] Failed to persist walls", err);
        });
      }
      return;
    }

    selectedWallId = null;
    const snappedStart = snapToNodes(pt)?.pt ?? snapPoint(pt);
    start = snapToNodes(snappedStart)?.pt ?? snappedStart;
    preview = null;
  }

  function onContext(e) {
  if (!isGM) return;
  if (nodeDrag) return;

  const pt = toMap(e);
  const door = hitTestDoor(pt, 16);
  if (!door) return;

  selectedDoor = door;
  hoveredId = door.id;
  doorDetailId = door.id;
  draw();

  dispatch("openDoorMenu", {
    door,
    x: e.clientX,
    y: e.clientY
  });
  }

  function onGlobalPointerDown(e) {
    if (!isGM || mode === "wall" || !canvas) return;
    const pt = toMap(e);
    if (!pt) return;
    const hit = nearestDoor(pt);
    if (hit && hit.dist <= hit.threshold) {
      e.stopPropagation();
      e.preventDefault();
      selectedDoor = hit.door;
      selectedWallId = hit.door.id;
      hoveredId = hit.door.id;
      doorDetailId = hit.door.id;
      draw();
      dispatch("doorSelect", { door: hit.door });
    }
  }




  function move(e) {
    if (!canvas || !$currentMap) return;
    const pt = toMap(e);

    if (nodeDrag) {
      const snapped = snapPoint(pt);
      if (nodeDrag.endpoint === "a") {
        nodeDrag = { ...nodeDrag, nextA: snapped };
      } else {
        nodeDrag = { ...nodeDrag, nextB: snapped };
      }
      hoveredId = nodeDrag.wallId;
      draw();
      return;
    }

    const door = hitTestDoor(pt);
    if (door) {
      hoveredId = door.id;
      draw();
    } else if ($wallToolMode === "delete" && mode === "wall") {
      let best = 10;
      let bestId = null;
      for (const w of $currentMap.walls || []) {
        const endpoints = getWallEndpoints(w);
        if (!endpoints) continue;
        const d = distToSegment(pt, endpoints.a, endpoints.b);
        if (d < best) {
          best = d;
          bestId = w.id;
        }
      }
      hoveredId = bestId;
      draw();
    } else if (isGM) {
      const node = nearestEndpoint(pt);
      if (node && node.dist <= SNAP_RADIUS) {
        nodeHover = { wallId: node.wall.id, endpoint: node.endpoint };
        hoveredId = node.wall.id;
      } else {
        nodeHover = null;
        let bestWall = null;
        let best = 12;
        for (const w of $currentMap.walls || []) {
          const endpoints = getWallEndpoints(w);
          if (!endpoints) continue;
          const d = distToSegment(pt, endpoints.a, endpoints.b);
          if (d < best) {
            best = d;
            bestWall = w;
          }
        }
        hoveredId = bestWall?.id ?? null;
      }
      draw();
    }

    if (!start || spaceDown || mode !== "wall") return;
    let snapped = snapDiagonal(start, pt);
    const nodeSnap = snapToNodes(snapped);
    if (nodeSnap) {
      snapped = { x: nodeSnap.x, y: nodeSnap.y };
    }
    preview = snapped;
    draw();
  }

  function up(e) {
    if (nodeDrag) {
      const pt = snapPoint(toMap(e));

      // Snap to nearby endpoints (other walls) on drop
      const snapTarget = nearestEndpoint(pt, { exclude: { wallId: nodeDrag.wallId, endpoint: nodeDrag.endpoint }, threshold: SNAP_RADIUS });
      const finalPt = snapTarget ? snapTarget.pt : pt;

      const walls = ($currentMap.walls || []).map(w => {
        if (w.id !== nodeDrag.wallId) return w;
        const endpoints = getWallEndpoints(w) || { a: finalPt, b: finalPt };
        const nextA = nodeDrag.endpoint === "a" ? finalPt : nodeDrag.nextA ?? endpoints.a;
        const nextB = nodeDrag.endpoint === "b" ? finalPt : nodeDrag.nextB ?? endpoints.b;
        return {
          ...w,
          a: nextA,
          b: nextB,
          c: [nextA.x, nextA.y, nextB.x, nextB.y]
        };
      });

      const updated = { ...$currentMap, walls };
      upsertMap(updated);

      fetch("/api/maps", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...updated
        })
      }).catch(err => {
        console.error("[WallCanvas] Failed to persist walls", err);
      });

      nodeDrag = null;
      nodeHover = null;
      draw();
      return;
    }

    if (!start || spaceDown || mode !== "wall") return;
    let end = snapDiagonal(start, toMap(e));
    const snapEndNode = snapToNodes(end);
    if (snapEndNode) {
      end = { x: snapEndNode.x, y: snapEndNode.y };
    }
    if (Math.hypot(end.x - start.x, end.y - start.y) < 4) {
      start = preview = null;
      draw();
      return;
    }

    let walls = [...($currentMap.walls || [])];

    if ($wallPreset === "DOOR") {
      const type = DOOR_TYPES.WOOD_SIMPLE;
      let placedDoor = false;

      // Try to split an existing wall first (optional)
      for (const w of walls) {
        if (resolveWallType(w) !== "WALL") continue;
        const endpoints = getWallEndpoints(w);
        if (!endpoints) continue;

        const hit =
          distToSegment(start, endpoints.a, endpoints.b) <= 8 ||
          distToSegment(end, endpoints.a, endpoints.b) <= 8;
        if (!hit) continue;

        const ax = endpoints.a.x;
        const ay = endpoints.a.y;
        const bx = endpoints.b.x;
        const by = endpoints.b.y;

        const dx = bx - ax;
        const dy = by - ay;
        const lenSq = dx * dx + dy * dy;
        if (!lenSq) continue;

        const projectT = (p) =>
          Math.max(
            0,
            Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / lenSq)
          );

        const t1 = projectT(start);
        const t2 = projectT(end);

        const tMin = Math.min(t1, t2);
        const tMax = Math.max(t1, t2);
        if (tMax - tMin < 0.02) continue;

        const at = (t) => ({
          x: ax + dx * t,
          y: ay + dy * t
        });

        const cloneWall = (from, to) => ({
          ...w,
          id: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2),
          c: [from.x, from.y, to.x, to.y],
          a: from,
          b: to
        });

        walls = walls.filter(x => x.id !== w.id);

        if (tMin > 0) {
          const left = cloneWall(endpoints.a, at(tMin));
          walls.push(left);
        }

        const segA = at(tMin);
        const segB = at(tMax);

        walls.push({
          id: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2),
          c: [segA.x, segA.y, segB.x, segB.y],
          a: segA,
          b: segB,
          type: "DOOR",
          kind: "door",
          move: "NORMAL",
          sight: "NORMAL",
          light: w.light ?? "NORMAL",
          sound: w.sound ?? "NORMAL",
          blocksVision: true,
          blocksMovement: true,
          dir: 0,
          door: {
            state: "CLOSED",
            open: false,
            openPct: 0,
            locked: false,
            hidden: false,
            hinge: "a",
            swing: 1,
            type: "WOOD_SIMPLE",
            hp: type.hp,
            ac: type.ac,
            thicknessPx: type.thickness * 4
          }
        });

        if (tMax < 1) {
          const right = cloneWall(at(tMax), endpoints.b);
          walls.push(right);
        }

        placedDoor = true;
        break;
      }

      // If no wall hit, place a free-standing door using start/end
      if (!placedDoor) {
        const segA = start;
        const segB = end;
        walls.push({
          id: crypto.randomUUID?.() ?? Math.random().toString(36).slice(2),
          c: [segA.x, segA.y, segB.x, segB.y],
          a: segA,
          b: segB,
          type: "DOOR",
          kind: "door",
          move: "NORMAL",
          sight: "NORMAL",
          light: "NORMAL",
          sound: "NORMAL",
          blocksVision: true,
          blocksMovement: true,
          dir: 0,
          door: {
            state: "CLOSED",
            open: false,
            openPct: 0,
            locked: false,
            hidden: false,
            hinge: "a",
            swing: 1,
            type: "WOOD_SIMPLE",
            hp: type.hp,
            ac: type.ac,
            thicknessPx: type.thickness * 4
          }
        });
      }

    } else {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const totalLen = Math.hypot(dx, dy) || 1;
  const segMode = ($currentMap?.segmentLengthMode || "").toUpperCase() === "FIXED_PX" ? "FIXED_PX" : "GRID";
  const baseSegLen = segMode === "GRID"
    ? ($currentMap?.gridSizePx || 64)
    : ($currentMap?.segmentLengthPx || $currentMap?.gridSizePx || 64);
  const segmentsCount = $currentMap?.segmentedWalls
    ? Math.max(1, Math.ceil(totalLen / Math.max(1, baseSegLen)))
    : 1;

  for (let i = 0; i < segmentsCount; i += 1) {
    const t0 = i / segmentsCount;
    const t1 = (i + 1) / segmentsCount;
    const a = { x: start.x + dx * t0, y: start.y + dy * t0 };
    const b = i === segmentsCount - 1
      ? end
      : { x: start.x + dx * t1, y: start.y + dy * t1 };
    walls.push(buildWallDoc({ start: a, end: b, presetKey: $wallPreset || "NORMAL" }));
  }
}


    const updated = { ...$currentMap, walls };
    upsertMap(updated);

// 🔥 PERSIST WALLS TO DISK
fetch("/api/maps", {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    ...updated
  })
}).catch(err => {
  console.error("[WallCanvas] Failed to persist walls", err);
});

  


    start = preview = null;
    draw();
  }
  function isVerticalDoor(w) {
  const endpoints = (w?.a && w?.b) ? { a: w.a, b: w.b } : getWallEndpoints(w);
  if (!endpoints) return true;
  const dx = endpoints.b.x - endpoints.a.x;
  const dy = endpoints.b.y - endpoints.a.y;
  return Math.abs(dy) >= Math.abs(dx);
}

// Normalize hinge input:
// - supports new: "top" | "bottom" | "left" | "right"
// - supports legacy: "a" | "b" (or "A"/"B")
// Returns the actual hinge POINT (a or b) deterministically.
function resolveHingePoint(w) {
  const endpoints = w?.a && w?.b ? { a: w.a, b: w.b } : getWallEndpoints(w);
  if (!endpoints) return { x: 0, y: 0 };
  const { a, b } = endpoints;
  const door = w?.door;
  const d = door || {};
  const hRaw = (d.hinge ?? "a").toString().toLowerCase();

  const vertical = isVerticalDoor(w);

  // Helper endpoints
  const top    = a.y <= b.y ? a : b;
  const bottom = a.y >  b.y ? a : b;
  const left   = a.x <= b.x ? a : b;
  const right  = a.x >  b.x ? a : b;

  // New hinge positions
  if (hRaw === "top") return top;
  if (hRaw === "bottom") return bottom;
  if (hRaw === "left") return left;
  if (hRaw === "right") return right;

  // Legacy hinge = endpoint selection
  // (If user set hinge to "a"/"b", keep that exact endpoint)
  if (hRaw === "b") return b;
  return a; // default "a"
}

// Normalize swing input:
// - vertical: "left" | "right" (legacy numeric 1/-1 supported)
// - horizontal: "up" | "down"
function resolveSwingDir(w) {
  const d = w.door || {};
  const vertical = isVerticalDoor(w);

  const raw = d.swing;

  // Legacy numeric
  if (raw === 1) return vertical ? "right" : "down";
  if (raw === -1) return vertical ? "left" : "up";

  const s = (raw ?? "").toString().toLowerCase();

  if (vertical) {
    return s === "left" ? "left" : "right";
  } else {
    return s === "up" ? "up" : "down";
  }
}


// EXACT deterministic angle rules you specified (degrees):
// 0 = right, 90 = up, 180 = left, 270 = down
function resolveDoorAngles(w) {
  const { a, b } = w;
  const d = w.door || {};
  const vertical = isVerticalDoor(w);

  const hinge = resolveHingePoint(w);
  const swing = resolveSwingDir(w);

  let from;
  let dir;

  if (vertical) {
    const bottom = a.y > b.y ? a : b;
    const top = a.y <= b.y ? a : b;

    const hingeBottom = hinge === bottom;

    // CLOSED ANGLE
    from = hingeBottom ? 90 : 270;

    // DIRECTION
    dir = swing === "left" ? +1 : -1;
  } else {
    const left = a.x <= b.x ? a : b;
    const right = a.x > b.x ? a : b;

    const hingeLeft = hinge === left;

    // CLOSED ANGLE
    from = hingeLeft ? 0 : 180;

    // DIRECTION
    dir = swing === "up" ? +1 : -1;
  }

  return { from, dir };
}


function degToRadScreen(deg) {
  // Your existing convention: rad = (-deg) so that 90 points UP
  return (-deg * Math.PI) / 180;
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

function getDoorRenderPct(door) {
  if (!door) return 0;
  if (doorRenderPct.has(door.id)) return doorRenderPct.get(door.id);
  const d = door.door || {};
  const base = typeof d.openPct === "number"
    ? d.openPct
    : resolveDoorState(d) === "OPEN"
      ? 100
      : 0;
  const pct = Math.max(0, Math.min(100, base));
  doorRenderPct.set(door.id, pct);
  return pct;
}

function getDoorLeaf(w) {
  const endpoints = w?.a && w?.b ? { a: w.a, b: w.b } : getWallEndpoints(w);
  if (!endpoints) {
    return {
      hinge: { x: 0, y: 0 },
      tip: { x: 0, y: 0 },
      len: 0,
      openPct: 0,
      fromDeg: 0,
      angleDeg: 0,
      fromRad: 0,
      angleRad: 0,
      style: "swing"
    };
  }
  const { a, b } = endpoints;
  const d = w.door || {};
  const anim = doorAnimConfig(w);

  const hinge = resolveHingePoint(w);
  const other = hinge === a ? b : a;

  const len = Math.hypot(other.x - hinge.x, other.y - hinge.y) || 1;

  // Resolve open percentage
  let openPct = getDoorRenderPct(w);
  const t = openPct / 100;

  let tip;
  let fromDeg = null;
  let angleDeg = null;
  let fromRad = null;
  let angleRad = null;

  if (anim.style === "swing") {
    const { from, dir } = resolveDoorAngles(w);
    fromDeg = from;
    angleDeg = from + dir * 180 * t;
    fromRad = (-from * Math.PI) / 180;
    angleRad = (-angleDeg * Math.PI) / 180;
    tip = {
      x: hinge.x + Math.cos(angleRad) * len,
      y: hinge.y + Math.sin(angleRad) * len
    };
  } else if (anim.style === "slide") {
    const dirVec = norm({ x: b.x - a.x, y: b.y - a.y });
    const perp = rot90(dirVec);
    const offset = {
      x: perp.x * len * t,
      y: perp.y * len * t
    };
    tip = {
      x: other.x + offset.x,
      y: other.y + offset.y
    };
    return {
      hinge: { x: hinge.x + offset.x, y: hinge.y + offset.y },
      tip,
      len,
      openPct,
      fromDeg,
      angleDeg,
      fromRad,
      angleRad,
      style: anim.style
    };
  } else if (anim.style === "ascend") {
    const lift = len * 0.6 * t;
    tip = {
      x: other.x,
      y: other.y - lift
    };
    return {
      hinge: { x: hinge.x, y: hinge.y - lift },
      tip,
      len,
      openPct,
      fromDeg,
      angleDeg,
      fromRad,
      angleRad,
      style: anim.style
    };
  } else {
    const { from, dir } = resolveDoorAngles(w);
    fromDeg = from;
    angleDeg = from + dir * 180 * t;
    fromRad = (-from * Math.PI) / 180;
    angleRad = (-angleDeg * Math.PI) / 180;
    tip = {
      x: hinge.x + Math.cos(angleRad) * len,
      y: hinge.y + Math.sin(angleRad) * len
    };
  }

  return {
    hinge,
    tip,
    len,
    openPct,
    fromDeg,
    angleDeg,
    fromRad,
    angleRad,
    style: anim.style
  };
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function updateDoorOpenPctLocal(doorId, openPct) {
  const pct = Math.max(0, Math.min(100, Number.isFinite(openPct) ? openPct : 0));
  doorRenderPct.set(doorId, pct);
  draw();
}

function animateDoorOpenPct(doorId, targetPct, durationMs = 250, fromPct = null) {
  if (!browser) return;
  const map = $currentMap;
  if (!map) return;

  const door = (map.walls || []).find(w => w.id === doorId);
  const d = door?.door || {};
  const from =
    Number.isFinite(fromPct)
      ? fromPct
      : getDoorRenderPct(door);
  const to = Math.max(0, Math.min(100, targetPct));

  if (from === to) {
    updateDoorOpenPctLocal(doorId, to);
    return;
  }

  if (doorAnimations.has(doorId)) {
    cancelAnimationFrame(doorAnimations.get(doorId));
    doorAnimations.delete(doorId);
  }

  const start = performance.now();
  const step = (ts) => {
    const t = Math.min(1, (ts - start) / durationMs);
    const eased = easeOutCubic(t);
    const next = from + (to - from) * eased;
    updateDoorOpenPctLocal(doorId, next);
    if (t < 1) {
      const raf = requestAnimationFrame(step);
      doorAnimations.set(doorId, raf);
    } else {
      doorAnimations.delete(doorId);
    }
  };

  const raf = requestAnimationFrame(step);
  doorAnimations.set(doorId, raf);
}

function syncDoorAnimations() {
  const doors = ($currentMap?.walls || []).filter(w => isDoorWall(w));
  doorControls = doors.map((door) => {
    const endpoints = getWallEndpoints(door);
    if (!endpoints) return null;
    const withEndpoints = { ...door, a: endpoints.a, b: endpoints.b };
    const state = doorStateInfo(door);
    const mid = getDoorMidpoint(withEndpoints);
    const typeInfo = DOOR_TYPES?.[door?.door?.type] || null;
    const dx = endpoints.b.x - endpoints.a.x;
    const dy = endpoints.b.y - endpoints.a.y;
    const orient = Math.abs(dx) >= Math.abs(dy) ? "horizontal" : "vertical";
    const thickness = Number(door?.door?.thicknessPx) || WALL_WIDTHS.door;
    const offset = Math.max(43, thickness / 2 + 31);
    const ctrlPos = orient === "horizontal"
      ? { x: mid.x, y: mid.y + offset }
      : { x: mid.x - offset, y: mid.y };
    const delPos = orient === "horizontal"
      ? { x: mid.x, y: mid.y - offset }
      : { x: mid.x + offset, y: mid.y };
    return { id: door.id, mid, ctrlPos, delPos, orient, door: withEndpoints, state, typeInfo };
  }).filter(Boolean);
  for (const door of doors) {
    const d = door.door || {};
    const state = doorStateInfo(door);
    const targetPctRaw = typeof d.openPct === "number" ? d.openPct : (state.open ? 100 : 0);
    const targetPct = Math.max(0, Math.min(100, targetPctRaw));
    const currentPct = getDoorRenderPct(door);
    const prevOpen = doorOpenState.get(door.id);
    const prevPct =
      doorLastPct.has(door.id)
        ? doorLastPct.get(door.id)
        : prevOpen === undefined
          ? currentPct
          : prevOpen
            ? 100
            : 0;
    doorOpenState.set(door.id, !!state.open);
    const cfg = doorAnimConfig(door);
    const duration = cfg.durationMs ?? 250;
    animateDoorOpenPct(door.id, targetPct, duration, prevPct);
    doorLastPct.set(door.id, targetPct);
  }
}

  export function refreshDoorAnimations() {
    syncDoorAnimations();
    draw();
  }

function triggerDoorShake(id, duration = 300) {
  if (!browser) return;
  doorShakes.set(id, performance.now() + duration);
}

export function shakeDoor(id, duration = 300) {
  triggerDoorShake(id, duration);
  draw();
}



    /* ======================================================
         Reactive lifecycle*/

  $: if ($currentMap?.width && canvas) resize();
  $: if ($currentMap && canvas) draw();
  $: if ($currentMap && browser) syncDoorAnimations();
  $: if (isGM && mode === "wall" && selectedWallId && $currentMap) {
    const wall = ($currentMap.walls || []).find(w => w.id === selectedWallId);
    const endpoints = getWallEndpoints(wall);
    selectedMidpoint = endpoints ? { x: (endpoints.a.x + endpoints.b.x) / 2, y: (endpoints.a.y + endpoints.b.y) / 2 } : null;
    if (wall && endpoints) {
      const orient = Math.abs(endpoints.b.x - endpoints.a.x) >= Math.abs(endpoints.b.y - endpoints.a.y) ? "horizontal" : "vertical";
      const thickness = Number(wall?.door?.thicknessPx) || WALL_WIDTHS.door;
      const offset = Math.max(28, thickness / 2 + 18);
      selectedDeletePos = orient === "horizontal"
        ? { x: selectedMidpoint.x, y: selectedMidpoint.y - offset }
        : { x: selectedMidpoint.x + offset, y: selectedMidpoint.y };
    } else {
      selectedDeletePos = null;
    }
  } else {
    selectedMidpoint = null;
    selectedDeletePos = null;
  }
</script>

<canvas
  bind:this={canvas}
  class="wall-canvas"
  style={`pointer-events: ${(isGM && mode === "wall") ? "auto" : (isGM ? "auto" : "none")}; z-index: ${zIndex};`}
  on:pointerdown={down}
  on:pointermove={move}
  on:pointerup={up}
  on:contextmenu|preventDefault={onContext}
/>

{#if isGM && mode === "wall" && selectedDeletePos}
  <div class="delete-overlay" style={`z-index:${zIndex + 40};`}>
    <button
      class="delete-btn"
      style={`left:${selectedDeletePos.x}px; top:${selectedDeletePos.y}px;`}
      title="Delete Segment"
      on:click={() => {
        const walls = ($currentMap?.walls || []).filter(w => w.id !== selectedWallId);
        const updated = { ...$currentMap, walls };
        upsertMap(updated);
        fetch("/api/maps", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...updated })
        }).catch(() => {});
        selectedWallId = null;
        draw();
      }}
    >
      ✕
    </button>
  </div>
{/if}

{#if isGM && selectedDoor && selectedWallId && mode !== "wall" && selectedMidpoint}
  <div
    class="door-details"
    style={`left:${selectedMidpoint.x + 12}px; top:${selectedMidpoint.y + 12}px; z-index:${zIndex + 50};`}
  >
    <div class="details-header">Door</div>
    <div class="details-row">
      <label>Door Type</label>
      <select
        value={selectedDoor?.door?.type ?? "WOOD_SIMPLE"}
        on:change={(e) => {
          setDoorType(selectedDoor.id, e.target.value);
          dispatch("doorSelect", { door: selectedDoor });
        }}
      >
        {#each Object.entries(DOOR_TYPES) as [key, def]}
          <option value={key}>{def.label}</option>
        {/each}
      </select>
    </div>
    <div class="details-row stats">
      <span>AC {DOOR_TYPES[selectedDoor?.door?.type || "WOOD_SIMPLE"]?.ac ?? selectedDoor?.door?.ac ?? "?"}</span>
      <span>HP {DOOR_TYPES[selectedDoor?.door?.type || "WOOD_SIMPLE"]?.hp ?? selectedDoor?.door?.hp ?? "?"}</span>
    </div>
  </div>
{/if}

{#if isGM}
  <div class="door-controls-layer" style={`z-index:${zIndex + 45};`}>
    {#each doorControls as ctrl (ctrl.id)}
      {#if ctrl?.door}
        <div
          class={`door-controls ${ctrl.orient}`}
          style={`left:${ctrl.ctrlPos.x}px; top:${ctrl.ctrlPos.y}px;`}
          title={ctrl.typeInfo ? `${ctrl.typeInfo.label ?? ctrl.door?.door?.type ?? "Door"} — AC ${ctrl.typeInfo.ac ?? "?"} HP ${ctrl.typeInfo.hp ?? "?"}` : ""}
          on:click={() => {
            selectedDoor = ctrl.door;
            doorDetailId = ctrl.id;
            selectedWallId = ctrl.id;
            dispatch("doorSelect", { door: ctrl.door });
          }}
        >
          <button
            class={`door-btn ${ctrl.state?.open ? "disabled" : ""}`}
            title={ctrl.state?.open ? "Close Door to Lock" : (ctrl.state?.locked ? "Unlock Door" : "Lock Door")}
            on:click={() => {
              if (ctrl.state?.open) return;
              dispatch("toggleDoorLocked", { door: ctrl.door });
            }}
          >
            {#if ctrl.state?.locked}
              <LockKeyhole size={56} />
            {:else}
              <LockKeyholeOpen size={56} />
            {/if}
          </button>
          <button
            class={`door-btn ${ctrl.state?.locked ? "disabled" : ""}`}
            title={ctrl.state?.open ? "Close Door" : (ctrl.state?.locked ? "Door is Locked" : "Open Door")}
            on:click={() => {
              if (ctrl.state?.locked) return;
              dispatch("toggleDoorOpen", { door: ctrl.door });
            }}
          >
            {#if ctrl.state?.open}
              <IconDoorOpen size={56} />
            {:else}
              <IconDoorClosed size={56} />
            {/if}
          </button>
        </div>
      {/if}
    {/each}
  </div>

{/if}


<style>
.wall-canvas {
  position: absolute;
  inset: 0;
}

.door-controls-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.delete-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.delete-btn {
  position: absolute;
  transform: translate(-50%, -50%);
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 2px solid rgba(255,255,255,0.7);
  background: rgba(24, 28, 38, 0.95);
  color: #fff;
  font-weight: 800;
  cursor: pointer;
  box-shadow: 0 12px 30px rgba(0,0,0,0.65);
  pointer-events: auto;
}

.door-details {
  position: absolute;
  transform: translate(-50%, -50%);
  background: rgba(16, 20, 32, 0.95);
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 10px;
  padding: 10px;
  color: #eaf1ff;
  box-shadow: 0 16px 40px rgba(0,0,0,0.65);
  pointer-events: auto;
  min-width: 180px;
}

.door-details .details-header {
  font-weight: 700;
  letter-spacing: 0.02em;
  margin-bottom: 6px;
  font-size: 13px;
}

.door-details .details-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.door-details .details-row label {
  font-size: 12px;
  opacity: 0.8;
}

.door-details .details-row select {
  flex: 1;
  background: #1e2535;
  color: #eaf1ff;
  border: 1px solid rgba(255,255,255,0.18);
  border-radius: 8px;
  padding: 6px 8px;
}

.door-details .stats {
  justify-content: space-between;
  font-size: 12px;
  opacity: 0.9;
}

.door-controls {
  position: absolute;
  transform: translate(-50%, -50%);
  display: flex;
  gap: 12px;
  align-items: center;
  pointer-events: none;
}
.door-controls.horizontal {
  flex-direction: row;
}
.door-controls.vertical {
  flex-direction: column;
}

.door-btn {
  width: 44px;
  height: 44px;
  border: 2px solid rgba(255,255,255,0.35);
  background: radial-gradient(120% 120% at 50% 18%, rgba(32,38,52,0.95), rgba(14,16,26,0.95));
  border-radius: 12px;
  color: #ffffff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 12px 32px rgba(0,0,0,0.7);
  pointer-events: auto;
  transition: transform 140ms ease, box-shadow 160ms ease, border-color 160ms ease;
}

.door-info {
  min-width: 160px;
  padding: 10px 12px;
  background: rgba(16, 20, 32, 0.95);
  border: 1px solid rgba(255,255,255,0.35);
  border-radius: 12px;
  color: #ffffff;
  box-shadow: 0 10px 28px rgba(0,0,0,0.75);
  pointer-events: auto;
  cursor: pointer;
  transition: transform 120ms ease, box-shadow 140ms ease, border-color 160ms ease;
}

.door-info:hover {
  transform: translateY(-1px);
  box-shadow: 0 14px 36px rgba(0,0,0,0.82);
  border-color: rgba(255,255,255,0.55);
}

.door-info.active {
  border-color: rgba(124, 92, 255, 0.8);
  box-shadow: 0 16px 40px rgba(0,0,0,0.88);
}

.door-info-title {
  font-weight: 700;
  letter-spacing: 0.03em;
}

.door-info-stats {
  font-size: 12px;
  opacity: 0.9;
  margin-top: 4px;
}

.door-btn.disabled {
  opacity: 0.35;
  filter: grayscale(0.5);
  cursor: not-allowed;
  pointer-events: none;
}

.door-btn:not(.disabled):hover {
  transform: translateY(-2px) scale(1.03);
  box-shadow: 0 16px 40px rgba(0,0,0,0.85);
  border-color: rgba(255,255,255,0.65);
}

</style>
