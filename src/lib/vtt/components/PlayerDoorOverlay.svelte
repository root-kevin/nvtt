<script>
  import { onDestroy } from "svelte";
  import { createEventDispatcher } from "svelte";

  import { zoom } from "$lib/vtt/panzoom/store.js";
  import { currentMap } from "$lib/vtt/map/store.js";
  import { tokens as tokensStore } from "$lib/vtt/tokens/store.js";
  import { DoorOpen, DoorClosed, DoorClosedLocked, Target } from "@lucide/svelte";
  import { activeDoorLanding } from "$lib/vtt/walls/store.js";
  import { getDoorMidpoint, getWallEndpoints, resolveDoorState, resolveWallType } from "$lib/vtt/walls/model.js";

  export let zIndex = 35;
  export let attemptedLockedDoors = new Set();

  const DOOR_ICON_SIZE = 60;
  const DOOR_GEOMETRY_WIDTH = 24;

  const dispatch = createEventDispatcher();

  let zoomVal = 1;
  let root;
  let doorFx = {};
  const shakeTimers = new Map();
  let tokens = [];
  let landing = null;

  const unsubZoom = zoom.subscribe((v) => (zoomVal = Number.isFinite(v) ? v : 1));
  const unsubTokens = tokensStore.subscribe((t) => (tokens = t || []));
  const unsubLanding = activeDoorLanding.subscribe((v) => (landing = v));

  onDestroy(() => {
    unsubZoom?.();
    unsubTokens?.();
    unsubLanding?.();
    shakeTimers.forEach((t) => clearTimeout(t));
    shakeTimers.clear();
  });

  $: doors =
    ($currentMap?.walls || [])
      .filter((w) => {
        const t = resolveWallType(w);
        return (t === "DOOR" || w?.kind === "door" || w?.door) && !(w?.door?.hidden);
      })
      .map((w) => {
        const endpoints = getWallEndpoints(w);
        if (!endpoints) return null;
        const withEndpoints = { ...w, a: endpoints.a, b: endpoints.b };
        const mid = getDoorMidpoint(withEndpoints);
        const screen = worldToScreen(mid);
        const state = resolveDoorState(withEndpoints?.door);
        const open = state === "OPEN" || (Number(withEndpoints?.door?.openPct) || 0) > 0;
        const lockedDoor = state === "LOCKED" && !open;
        const attempted = attemptedLockedDoors?.has?.(w.id);
        if (attempted && (!lockedDoor || open)) {
          attemptedLockedDoors.delete(w.id);
        }
        return {
          id: w.id,
          door: withEndpoints,
          screen,
          open,
          locked: lockedDoor,
          lockedDoor,
          iconSize: DOOR_ICON_SIZE
        };
      })
      .filter(Boolean);

  function worldToScreen(pt) {
    if (!pt || !zoomVal) return null;
    return { x: pt.x, y: pt.y };
  }

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
    const thickness = DOOR_GEOMETRY_WIDTH;
    const grid = $currentMap?.gridSizePx ?? 64;
    return Math.max(thickness * 1.5, grid * 0.25, 20);
  }

  function segmentIntersectsRect(a, b, rect) {
    const inside = (p) =>
      p.x >= rect.minX && p.x <= rect.maxX && p.y >= rect.minY && p.y <= rect.maxY;
    if (inside(a) || inside(b)) return true;

    const edges = [
      [{ x: rect.minX, y: rect.minY }, { x: rect.maxX, y: rect.minY }],
      [{ x: rect.maxX, y: rect.minY }, { x: rect.maxX, y: rect.maxY }],
      [{ x: rect.maxX, y: rect.maxY }, { x: rect.minX, y: rect.maxY }],
      [{ x: rect.minX, y: rect.maxY }, { x: rect.minX, y: rect.minY }]
    ];

    const intersects = (p1, p2, p3, p4) => {
      const d = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
      const d1 = d(p1, p2, p3);
      const d2 = d(p1, p2, p4);
      const d3 = d(p3, p4, p1);
      const d4 = d(p3, p4, p2);
      return d1 * d2 < 0 && d3 * d4 < 0;
    };

    for (const [p3, p4] of edges) {
      if (intersects(a, b, p3, p4)) return true;
    }

    // Finally, allow tangential touch by distance check to rectangle edges
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
    const closest = {
      x: clamp(a.x, rect.minX, rect.maxX),
      y: clamp(a.y, rect.minY, rect.maxY)
    };
    const dist = distToSegment(closest, a, b);
    return dist < 1;
  }

  function contactPoints(token) {
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

  function playerInRange(door) {
    if (!door || !$currentMap) return false;
    const endpoints = getWallEndpoints(door);
    if (!endpoints) return false;
    const mapId = $currentMap.id;
    const players =
      tokens?.filter(
        (t) =>
          t?.mapId === mapId &&
          (t?.vision?.isPlayer || t?.isPlayerToken || t?.characterId)
      ) || [];

    const threshold = doorInteractionThreshold(door);
    for (const t of players) {
      // Only allow interaction via the four mid-edge contact points (no diagonals).
      const pts = contactPoints(t);
      if (pts.some(p => distToSegment(p, endpoints.a, endpoints.b) <= threshold)) return true;
    }
    return false;
  }

  function resetDoorFx(id) {
    if (!doorFx[id]) return;
    doorFx = { ...doorFx, [id]: { ...doorFx[id], shake: false } };
  }

  function triggerLockedFeedback(id) {
    resetDoorFx(id);
    requestAnimationFrame(() => {
      doorFx = { ...doorFx, [id]: { ...(doorFx[id] || {}), shake: true } };
    });
    if (shakeTimers.has(id)) {
      clearTimeout(shakeTimers.get(id));
    }
    const timer = setTimeout(() => {
      resetDoorFx(id);
      shakeTimers.delete(id);
    }, 460);
    shakeTimers.set(id, timer);
  }

  function onClick(e, door) {
    e.preventDefault();
    e.stopPropagation();
    if (!door) return;
    if (!$currentMap) return;
    if (!playerInRange(door.door)) return;

    if (door.lockedDoor) {
      attemptedLockedDoors.add(door.id);
      triggerLockedFeedback(door.id);
      dispatch("lockedAttempt", { doorId: door.id });
      return;
    }

    attemptedLockedDoors.delete(door.id);
    dispatch("doorRequest", { doorId: door.id });
  }
</script>

<div
  class="door-overlay"
  bind:this={root}
  style={`pointer-events:none; position:absolute; inset:0; z-index:${zIndex};`}
>
  {#each doors as door (door.id)}
    {#if door.screen}
      {#if landing && landing.doorId === door.id && door.open}
        <div
          class="door-target"
          style={`left:${landing.x}px; top:${landing.y}px;`}
        >
          <Target size={80} stroke-width={2.2} />
        </div>
      {/if}
      <button
        class={`door-action ${doorFx[door.id]?.shake ? "shake" : ""} ${(door.locked && attemptedLockedDoors.has(door.id)) ? "locked" : ""}`}
        style={`left:${door.screen.x}px; top:${door.screen.y}px; width:${door.iconSize}px; height:${door.iconSize}px;`}
        title={door.open ? "Close Door" : "Open Door"}
        aria-label={door.open ? "Close Door" : "Open Door"}
        on:click|preventDefault|stopPropagation={(e) => onClick(e, door)}
        on:pointerdown|preventDefault|stopPropagation
      >
        {#if door.open}
          <DoorOpen size={door.iconSize} stroke-width={2.4} />
        {:else if (door.locked && attemptedLockedDoors.has(door.id))}
          <DoorClosedLocked size={door.iconSize} stroke-width={2.6} />
        {:else}
          <DoorClosed size={door.iconSize} stroke-width={2.4} />
        {/if}
      </button>
    {/if}
  {/each}
</div>

<style>
  .door-overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .door-action {
    position: absolute;
    transform: translate(-50%, -50%);
    transform-origin: center;
    border: 2px solid rgba(255,255,255,0.3);
    background: radial-gradient(120% 120% at 50% 20%, rgba(26,32,46,0.95), rgba(12,16,28,0.96));
    color: #ffffff;
    padding: 0;
    border-radius: 14px;
    filter: drop-shadow(0 10px 28px rgba(0, 0, 0, 0.85));
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    pointer-events: auto;
    transition: transform 140ms ease, color 160ms ease, filter 160ms ease, border-color 160ms ease, box-shadow 160ms ease;
  }

  .door-action:hover {
    transform: translate(-50%, -50%) scale(1.05);
    filter: drop-shadow(0 12px 32px rgba(0, 0, 0, 0.92));
    border-color: rgba(255,255,255,0.6);
  }

  .door-action.locked {
    color: #ff5c7a;
    border-color: rgba(255, 92, 122, 0.75);
    box-shadow: 0 0 0 2px rgba(255, 92, 122, 0.25), 0 14px 30px rgba(0,0,0,0.8);
  }

  .door-action.shake {
    animation: shake 0.32s ease;
  }

  .door-target {
    position: absolute;
    transform: translate(-50%, -50%);
    color: rgba(255, 215, 0, 0.9);
    filter: drop-shadow(0 6px 14px rgba(0,0,0,0.75));
    opacity: 1;
    transition: opacity 120ms ease;
    pointer-events: none;
  }

  @keyframes shake {
    0% {
      transform: translate(-50%, -50%) translateX(0);
    }
    20% {
      transform: translate(-50%, -50%) translateX(-6px);
    }
    40% {
      transform: translate(-50%, -50%) translateX(6px);
    }
    60% {
      transform: translate(-50%, -50%) translateX(-4px);
    }
    80% {
      transform: translate(-50%, -50%) translateX(4px);
    }
    100% {
      transform: translate(-50%, -50%) translateX(0);
    }
  }
</style>
