<!-- src/lib/vtt/components/TokenLayer.svelte -->
<script>
    import { get } from "svelte/store";
    import { onMount, onDestroy, tick } from "svelte";
    import { currentMap } from "$lib/vtt/map/store.js";
    import {
        tokens,
        upsertToken,
        deleteToken,
        persistCurrentTokens,
        registerLocalTokenMove,
        registerLocalTokenUpdate
    } from "$lib/vtt/tokens/store.js";
    import { sendWS } from "$lib/ws.js";
    import { createEventDispatcher } from "svelte";
    import { snapToGrid } from "$lib/vtt/utils/placement.js";
    import { clampTokenMovement } from "$lib/vtt/walls/collision.js";
    import { isDoorOpen, resolveWallType, wallBlocksMovement } from "$lib/vtt/walls/model.js";
    import {
        Edit,
        Eye,
        EyeOff,
        FileText,
        Lock,
        Unlock,
        Maximize,
        Trash2,
        Copy,
        PlusCircle,
        MinusCircle,
        ArrowUp,
        ArrowDown
    } from "@lucide/svelte";
    import { pan, zoom, panMode } from "$lib/vtt/panzoom/store.js";
    import { sendMessage } from "$lib/vtt/messages/controller.ts";
    import { applyHpPatch, deriveHpState, computeTemplateHp } from "$lib/vtt/tokens/hpUtils.js";
    import TokenDetails from "$lib/vtt/components/TokenDetails.svelte";
    import { tokenLibrary, addTemplate, replaceTemplate } from "$lib/vtt/tokens/library.js";
    import { customLibraryStore, saveCustomCreature, updateCustomCreature } from "$lib/vtt/tokens/customLibrary.js";
    import { applyOverrides, normalizeSheet } from "$lib/vtt/5e/normalizeSheet.js";
    import { setActiveVisionToken } from "$lib/vtt/player/visionStore.js";
    import { activeVisionTokenId } from "$lib/vtt/player/visionStore.js";
    import { recomputeVision } from "$lib/vtt/vision/controller.js";
    import { activeDoorLanding } from "$lib/vtt/walls/store.js";
    




    function clone(val) {
        try {
            return structuredClone(val);
        } catch (err) {
            return JSON.parse(JSON.stringify(val));
        }
    }

    function copyTokenToCustom(token) {
        if (!token) return;
        if (!isGM) return;
        const name = typeof prompt !== "undefined"
            ? prompt("Name for copied creature", token.name || "Custom Creature")
            : null;
        if (name == null) return;

        const customMap = get(customLibraryStore) || {};
        const sourceCustom = token.templateId?.startsWith("custom-")
            ? customMap[token.templateId]
            : null;

        const baseId = sourceCustom?.baseTemplateId || token.baseTemplateId || token.templateId;
        const overrides = sourceCustom?.overrides ? clone(sourceCustom.overrides) : {};

        const newId = saveCustomCreature({
            baseTemplateId: baseId,
            templateId: null,
            name,
            overrides,
            customized: true
        });
        if (!newId) return;

        const updated = { ...token, name, templateId: newId, baseTemplateId: baseId };
        upsertToken(updated, { persist: isGM });
        if (isGM) registerLocalTokenUpdate(updated);
        sendWS({ type: "token-update", token: updated });
    }

    export let isGM = false;
    export let selectedIds = [];
    export let activeTool = "select";
    export let incomingMeasure = null;
    export let zIndex = 10;
    export let movementMeasure = false;
    export let cameraFollow = true;

    const isPlayerOwnedToken = (token) =>
        !!(token?.vision?.isPlayer || token?.isPlayerToken || token?.characterId);
    const canDragToken = (token) => !!token && !token.locked && (isGM || isPlayerOwnedToken(token));
    const isDoorWall = (wall) => resolveWallType(wall) === "DOOR";

    let menu = { open: false, tokenId: null };
    let dragGroup = null;
    let dragLastValid = null; // authoritative last valid positions for current drag
    let detailsToken = null;
    let detailsReadOnly = false;
    let detailsPos = { x: 240, y: 120 };
    // placeholder to satisfy old selection logic (box removed)
    let selectionRect = null;
    const dispatch = createEventDispatcher();
    let clickStart = null;      // { x, y, token }
    let didMove = false;
    const DRAG_THRESHOLD = 5;
    let draggingTokenIds = new Set();
    const lastPositions = new Map();
    const releaseOffsets = new Map();
    let animationQueue = [];
    let animationTickPending = false;
    let dragLatestDelta = { dx: 0, dy: 0 };
    let visionFrame = null;
    let lastMapId = null;
    let collisionDebugEnabled = false;
    let interactionDebugEnabled = false;
    let interactionDebugTokens = [];
    let collisionHits = [];

    const SIZE_PRESETS = [
        { label: "Tiny",        feet: 2.5, factor: 0.5 },
        { label: "Small",       feet: 5,   factor: 1   },
        { label: "Medium",      feet: 5,   factor: 1   },
        { label: "Large",       feet: 10,  factor: 2   },
        { label: "Huge",        feet: 15,  factor: 3   },
        { label: "Gargantuan",  feet: 20,  factor: 4   }
    ];

    let sizeSelection = "Medium";
    let customFeet = 20;

    // Elevation input state (in feet, can be + or -; snapped to 5s)
    let elevationValue = 0;

    let hpMenu = { open: false, tokenId: null, x: 0, y: 0 };
    let hpAmount = "";
    let hpMenuToken = null;
    let menuToken = null;
    let canEditMenuToken = false;
    let menuReadOnly = false;

    let currentZoom = 1;
    let currentPan = { x: 0, y: 0 };
    let currentPanMode = "none";
    zoom.subscribe((z) => currentZoom = z || 1);
    pan.subscribe((p) => currentPan = p || { x: 0, y: 0 });
    panMode.subscribe((m) => currentPanMode = m || "none");

    let mapRect = { left: 0, top: 0 };
    let menuPos = { left: 0, top: 0 };
    let menuEl;
    const isBrowser = typeof document !== "undefined";
    let tokenMoveMs = 280;
    let moveMeasureOverlay = null;
    let moveMeasureUndo = null;
    let moveMeasureTimer = null;
    let followFrame = null;
    let followTarget = null;
    let followLastTs = 0;

    let measureStart = null; // {x,y} map coords (cell center)
    let measureStartCell = null; // {col,row}
    let measureCurrent = null; // {x,y} map coords (cell center)
    let measureCurrentCell = null; // {col,row}
    let measureOverlay = null; // screen coords + feet
    let remoteOverlay = null;

    $: if ($currentMap?.id !== lastMapId) {
        lastMapId = $currentMap?.id ?? null;
        lastPositions.clear();
        releaseOffsets.clear();
    }
    $: collisionDebugEnabled = !isGM && ($currentMap?.collisionDebug ?? false);
    $: if (!collisionDebugEnabled && collisionHits.length) {
        collisionHits = [];
    }
    $: interactionDebugEnabled = !!($currentMap?.interactionDebug);
    $: interactionDebugTokens = interactionDebugEnabled && $currentMap
        ? ($tokens || []).filter(t => t?.mapId === $currentMap.id)
        : [];

    // NEW: elevation captured at start/end cells (in feet)
    let measureStartElev = 0;
    let measureCurrentElev = 0;



    function updateMapRect() {
        if (!isBrowser) return;
        const el = document.querySelector(".map-container");
        if (el) {
            const rect = el.getBoundingClientRect();
            mapRect = { left: rect.left, top: rect.top };
        }
    }

    $: if ($currentMap && isBrowser) {
        updateMapRect();
    }
    $: tokenMoveMs = remapAnimationDuration($currentMap?.tokenMoveAnimationMs ?? 280);
    $: if (isGM && !movementMeasure) {
        if (moveMeasureOverlay) clearMoveMeasureOverlay();
        moveMeasureUndo = null;
    }
    $: if (!cameraFollow) {
        stopFollow();
    }

    function portalToBody(node) {
        if (typeof document !== "undefined") {
            document.body.appendChild(node);
            return {
                destroy() {
                    node.remove();
                }
            };
        }
    }

    function updateMenuPosition() {
        if (!isBrowser || !menuEl || !menu.open || !menuToken) return;
        const tokenEl = document.querySelector(`.token[data-token-id="${menuToken.id}"]`);
        if (!tokenEl) return;

        const tokenRect = tokenEl.getBoundingClientRect();
        const menuRect = menuEl.getBoundingClientRect();
        if (
            menuRect.width < 5 ||
            menuRect.height < 5 ||
            menuRect.left < -5000 ||
            menuRect.top < -5000
        ) {
            return;
        }
        const margin = 8;

        menuPos = {
            left: tokenRect.left + tokenRect.width / 2 - menuRect.width / 2,
            top: tokenRect.top - menuRect.height - margin
        };
    }

    $: if (menu.open && menuToken && $currentMap && isBrowser) {
        tick().then(updateMenuPosition);
    }
    $: if (menu.open) {
        // react to camera changes
        currentPan;
        currentZoom;
        mapRect;
        tick().then(updateMenuPosition);
    }

    $: if (activeTool !== "measure" && (measureStart || measureCurrent)) {
        measureStart = null;
        measureStartCell = null;
        measureCurrent = null;
        measureCurrentCell = null;
        measureOverlay = null;

        // NEW: clear elevation state too
        measureStartElev = 0;
        measureCurrentElev = 0;

        if (isBrowser) {
            window.removeEventListener("mousemove", handleMeasureMouseMove);
        }
    }

    $: if (activeTool === "measure" && measureStart && measureCurrent) {
        currentPan;
        currentZoom;
        mapRect;
        updateMeasureOverlay();
    }

    $: if (incomingMeasure && incomingMeasure.start && incomingMeasure.end) {
    currentPan;
    currentZoom;
    mapRect;

    const { mapRect: innerRect, scaleX, scaleY } = getMapMetrics();
    if (innerRect) {
        const startScreen = {
            x: innerRect.left + incomingMeasure.start.x * scaleX,
            y: innerRect.top + incomingMeasure.start.y * scaleY
        };
        const endScreen = {
            x: innerRect.left + incomingMeasure.end.x * scaleX,
            y: innerRect.top + incomingMeasure.end.y * scaleY
        };

        const dx = endScreen.x - startScreen.x;
        const dy = endScreen.y - startScreen.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
        const midX = (startScreen.x + endScreen.x) / 2;
        const midY = (startScreen.y + endScreen.y) / 2;

        remoteOverlay = {
    x: startScreen.x,
    y: startScreen.y,
    length,
    angle,
    midX,
    midY,
    feet: incomingMeasure.feet,

    // NEW — match measureOverlay shape
    is3d: incomingMeasure.is3d ?? false,
    horizontalFeet: incomingMeasure.horizontalFeet ?? incomingMeasure.feet,
    verticalFeet: incomingMeasure.verticalFeet ?? 0
};

    }
} else {
    remoteOverlay = null;
}


    onMount(() => {
        updateMapRect();

        tick().then(updateMenuPosition);

        const handleResize = () => {
            updateMapRect();
            updateMenuPosition();
        };

        const handleUndo = (e) => {
            if (!moveMeasureUndo) return;
            if (isGM && !movementMeasure) return;
            if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
            if (!$currentMap?.id || moveMeasureUndo.mapId !== $currentMap.id) return;
            e.preventDefault();

            const list = get(tokens) || [];
            moveMeasureUndo.tokens.forEach((orig) => {
                const current = list.find(t => t.id === orig.id);
                if (!current) return;
                const updated = { ...current, x: orig.x, y: orig.y };
                upsertToken(updated, { persist: false });
                if (isGM) {
                    registerLocalTokenMove({
                        ...updated,
                        mapId: updated.mapId ?? $currentMap?.id
                    });
                }
                sendWS({ type: "token-move", token: updated });
            });

            if (isGM) {
                persistCurrentTokens();
            }

            moveMeasureUndo = null;
            clearMoveMeasureOverlay();
        };

        window.addEventListener("resize", handleResize);
        window.addEventListener("keydown", handleUndo);
        return () => {
            window.removeEventListener("resize", handleResize);
            window.removeEventListener("keydown", handleUndo);
        };
    });


    onDestroy(() => {
        if (isBrowser) {
            window.removeEventListener("mousemove", handleMeasureMouseMove);
        }
    });

    let dragFrame = null;
    let dragPending = null;
    let dragLatest = null;

    function snapToFiveMin5(n) {
        return Math.max(5, Math.round(n / 5) * 5);
    }

    function snapToFiveSigned(n) {
        const v = Number(n);
        if (!Number.isFinite(v)) return 0;
        return Math.round(v / 5) * 5;
    }

    function remapAnimationDuration(value) {
        const input = Number(value);
        if (!Number.isFinite(input)) return 220;
        const points = [
            { in: 100, out: 80 },
            { in: 200, out: 140 },
            { in: 280, out: 220 },
            { in: 400, out: 360 },
            { in: 600, out: 650 }
        ];
        if (input <= points[0].in) return points[0].out;
        if (input >= points[points.length - 1].in) return points[points.length - 1].out;
        for (let i = 0; i < points.length - 1; i++) {
            const a = points[i];
            const b = points[i + 1];
            if (input >= a.in && input <= b.in) {
                const t = (input - a.in) / (b.in - a.in);
                return a.out + (b.out - a.out) * t;
            }
        }
        return points[2].out;
    }

    // Measurement elevation helpers

function roundUpTo5(n) {
    return Math.ceil((Number(n) || 0) / 5) * 5;
}


    function tokenOccupiesCell(token, col, row, gridSize) {
        if (!token || !gridSize) return false;
        const x = Number(token.x) || 0;
        const y = Number(token.y) || 0;
        const size = Number(token.size) || gridSize;

        const minCol = Math.floor(x / gridSize);
        const minRow = Math.floor(y / gridSize);
        const maxCol = Math.floor((x + size - 1) / gridSize);
        const maxRow = Math.floor((y + size - 1) / gridSize);

        return col >= minCol && col <= maxCol && row >= minRow && row <= maxRow;
    }

    function getTokenAtCell(col, row) {
        const mapId = $currentMap?.id;
        const gridSize = $currentMap?.gridSizePx ?? 64;
        if (!mapId) return null;

        const list = get(tokens) || [];
        for (let i = list.length - 1; i >= 0; i--) {
            const t = list[i];
            if (t?.mapId !== mapId) continue;
            if (tokenOccupiesCell(t, col, row, gridSize)) return t;
        }
        return null;
    }

    function getElevationAtCell(col, row) {
        const t = getTokenAtCell(col, row);
        return Number(t?.elevation) || 0;
    }

function compute3dFeet(horizontalFeet, startElev, endElev) {
    const a = (Number(endElev) || 0) - (Number(startElev) || 0);
    const b = Number(horizontalFeet) || 0;
    if (!a) return b; // already a multiple of 5
    const c = Math.sqrt(a * a + b * b);
    return roundUpTo5(c);
}


    // -------------------------------------------------------------------------

    function inferSizeSelectionForToken(token) {
        const grid = $currentMap?.gridSizePx ?? 64;
        const pxSize = token.size ?? grid;
        const factor = pxSize / grid;

        if (token.sizeLabel) {
            const known = SIZE_PRESETS.find(p => p.label === token.sizeLabel);
            if (known) return token.sizeLabel;
        }

        const match = SIZE_PRESETS.find(p => Math.abs(p.factor - factor) < 0.01);
        if (match) return match.label;

        return "Gargantuan";
    }

    function onContextMenu(event, token) {
        if (activeTool === "measure") return;
        event.preventDefault();
        event.stopPropagation();

        menu = { open: true, tokenId: token.id };
        closeHpMenu();

        if (!isGM) return;

        const grid = $currentMap?.gridSizePx ?? 64;
        const pxSize = token.size ?? grid;
        const factor = pxSize / grid;

        sizeSelection = inferSizeSelectionForToken(token);

        if (sizeSelection === "Gargantuan") {
            if (typeof token.sizeFeet === "number" && token.sizeFeet >= 20) {
                customFeet = snapToFiveMin5(token.sizeFeet);
            } else {
                const impliedFeet = factor * 5;
                customFeet = snapToFiveMin5(Math.max(20, impliedFeet || 20));
            }
        } else {
            customFeet = 20;
        }

        // Elevation init for the menu input
        elevationValue = snapToFiveSigned(token.elevation ?? 0);
    }

    function closeMenu() {
        if (menu.open) {
            menu = { ...menu, open: false };
            closeHpMenu();
        }
    }

    function renameToken(id) {
        const t = get(tokens).find(t => t.id === id);
        if (!t) return closeMenu();
        if (!isGM && (!isPlayerOwnedToken(t) || t.locked)) return closeMenu();
        const name = prompt("Rename token", t.name ?? "");
        if (!name || name === t.name) return closeMenu();
        const updated = { ...t, name };
        upsertToken(updated, { persist: isGM });
        if (isGM) registerLocalTokenUpdate(updated);
        sendWS({ type: "token-update", token: updated });
        closeMenu();
    }

    let copying = false;
    function copyTokenToNewTemplate(token) {
        if (!token) return;
        if (!isGM) return;
        if (copying) return;
        copying = true;

        const base = get(tokenLibrary).find((tpl) => tpl.id === token.templateId);
        if (!base) { copying = false; return; }

        const name = typeof prompt !== "undefined"
            ? prompt("Name for copied creature", base.name || token.name || "Custom Creature")
            : null;

        if (name == null) { copying = false; return; }

        const suffix = Math.random().toString(16).slice(2, 8);
        const newId = `custom-${base.id}-${suffix}`;
        if (get(tokenLibrary).some((tpl) => tpl.id === newId)) { copying = false; return; }

        const newTemplate = { ...base, id: newId, name };
        addTemplate(newTemplate);

        const updatedToken = { ...token, templateId: newId, name, baseTemplateId: base.id };
        upsertToken(updatedToken, { persist: isGM });
        if (isGM) registerLocalTokenUpdate(updatedToken);
        sendWS({ type: "token-update", token: updatedToken });
        closeMenu();
        copying = false;
    }

    function deleteTokenAction(id) {
        if (!isGM) return closeMenu();
        deleteToken(id);
        sendWS({ type: "token-delete", id });
        closeMenu();
    }

    function toggleHidden(id) {
        const t = get(tokens).find(t => t.id === id);
        if (!t) return closeMenu();
        if (!isGM) return closeMenu();
        const updated = { ...t, hidden: !t.hidden };
        upsertToken(updated, { persist: isGM });
        if (isGM) registerLocalTokenUpdate(updated);
        sendWS({ type: "token-update", token: updated });
        closeMenu();
    }

    function toggleLock(id) {
        const t = get(tokens).find(tok => tok.id === id);
        if (!t) return;
        if (!isGM) return;
        const updated = { ...t, locked: !t.locked };
        upsertToken(updated, { persist: isGM });
        if (isGM) registerLocalTokenUpdate(updated);
        sendWS({ type: "token-update", token: updated });
    }

    function updateSize(id) {
        const t = get(tokens).find(tok => tok.id === id);
        if (!t) return;
        if (!isGM) return;
        const grid = $currentMap?.gridSizePx ?? 64;

        let feet;
        const preset = SIZE_PRESETS.find(p => p.label === sizeSelection);
        if (sizeSelection === "Gargantuan") {
            feet = Math.max(20, snapToFiveMin5(+customFeet || 20));
        } else {
            feet = preset?.feet ?? 5;
        }

        const factor = feet / 5;
        const size = grid * factor;

        const updated = {
            ...t,
            size,
            sizeFeet: feet,
            sizeLabel: sizeSelection
        };

        upsertToken(updated, { persist: isGM });
        if (isGM) registerLocalTokenUpdate(updated);
        sendWS({ type: "token-update", token: updated });
    }

    function updateElevation(id, rawValue) {
        const t = get(tokens).find(tok => tok.id === id);
        if (!t) return;
        if (!isGM) return;

        const snapped = snapToFiveSigned(rawValue);
        elevationValue = snapped;

        // Persist 0 as 0 (explicit), but you can also choose to store null/undefined if you prefer.
        const updated = { ...t, elevation: snapped };

        upsertToken(updated, { persist: isGM });
        if (isGM) registerLocalTokenUpdate(updated);
        sendWS({ type: "token-update", token: updated });
    }

    const visible = (t) => t.mapId === $currentMap?.id && (isGM || !t.hidden);

    function getMapMetrics() {
        const mapRect = document.querySelector(".map-inner")?.getBoundingClientRect();
        const mapW = $currentMap?.width ?? mapRect?.width ?? 1;
        const mapH = $currentMap?.height ?? mapRect?.height ?? 1;
        const scaleX = mapRect ? mapRect.width / mapW : 1;
        const scaleY = mapRect ? mapRect.height / mapH : 1;
        return { mapRect, mapW, mapH, scaleX, scaleY };
    }

    function getMapContainerRect() {
        return document.querySelector(".map-container")?.getBoundingClientRect() ?? null;
    }

    function toScreen(x, y) {
        const { mapRect, scaleX, scaleY } = getMapMetrics();
        if (!mapRect) return null;
        return {
            x: mapRect.left + x * scaleX,
            y: mapRect.top + y * scaleY
        };
    }

    function getTokenCell(token, gridSize) {
        if (!token || !gridSize) return { col: 0, row: 0 };
        return {
            col: Math.round((Number(token.x) || 0) / gridSize),
            row: Math.round((Number(token.y) || 0) / gridSize)
        };
    }

    function clearMoveMeasureOverlay() {
        if (moveMeasureTimer) {
            clearTimeout(moveMeasureTimer);
            moveMeasureTimer = null;
        }
        moveMeasureOverlay = null;
    }

    function updateMoveMeasureOverlay(token, squares, final = false) {
        if (!token || !$currentMap) return;
        const size = token.size ?? $currentMap.gridSizePx ?? 64;
        const anchor = toScreen(token.x + size / 2, token.y);
        if (!anchor) return;
        moveMeasureOverlay = {
            x: anchor.x,
            y: anchor.y - 12,
            squares,
            feet: squares * 5,
            final
        };
    }

    function scheduleFollow(token) {
        if (isGM || !cameraFollow || !token || !isBrowser) return;
        followTarget = {
            id: token.id,
            x: token.x,
            y: token.y,
            size: token.size ?? $currentMap?.gridSizePx ?? 64,
            mapId: token.mapId ?? $currentMap?.id
        };
        followLastTs = 0;
        if (!followFrame) {
            followFrame = requestAnimationFrame(runFollowFrame);
        }
    }

    function stopFollow() {
        if (followFrame) {
            cancelAnimationFrame(followFrame);
            followFrame = null;
        }
        followTarget = null;
        followLastTs = 0;
    }

    function requestVisionRecompute() {
        if (visionFrame) return;
        visionFrame = requestAnimationFrame(() => {
            visionFrame = null;
            recomputeVision();
        });
    }

    function runFollowFrame() {
        followFrame = null;
        if (!followTarget || !cameraFollow || !isBrowser || currentPanMode !== "none") return;
        if ($currentMap?.id && followTarget.mapId && followTarget.mapId !== $currentMap.id) return;

        const rect = getMapContainerRect();
        if (!rect) return;

        const now = performance.now();
        const dt = followLastTs ? now - followLastTs : 16;
        followLastTs = now;

        const followDurationMs = Math.max(400, tokenMoveMs * 2.6);
        const alpha = 1 - Math.exp(-dt / followDurationMs);

        const z = currentZoom || 1;
        const targetX = rect.width / 2 - (followTarget.x + followTarget.size / 2) * z;
        const targetY = rect.height / 2 - (followTarget.y + followTarget.size / 2) * z;

        let shouldContinue = false;
        pan.update((p) => {
            const nextX = p.x + (targetX - p.x) * alpha;
            const nextY = p.y + (targetY - p.y) * alpha;
            shouldContinue = Math.abs(targetX - nextX) + Math.abs(targetY - nextY) > 0.5;
            return { x: nextX, y: nextY };
        });

        if (shouldContinue) {
            followFrame = requestAnimationFrame(runFollowFrame);
        }
    }

    function screenToMap(clientX, clientY) {
        const { mapRect, scaleX, scaleY } = getMapMetrics();
        if (!mapRect) return null;
        const rawX = (clientX - mapRect.left) / scaleX;
        const rawY = (clientY - mapRect.top) / scaleY;
        return { x: rawX, y: rawY };
    }

    function snapToCellCenter(worldX, worldY, gridSize) {
        const col = Math.floor(worldX / gridSize);
        const row = Math.floor(worldY / gridSize);
        return {
            x: (col + 0.5) * gridSize,
            y: (row + 0.5) * gridSize,
            col,
            row
        };
    }

    function doorSide(door, p) {
        if (!door || !p) return 0;
        const ax = door.a.x;
        const ay = door.a.y;
        const bx = door.b.x;
        const by = door.b.y;
        return (bx - ax) * (p.y - ay) - (by - ay) * (p.x - ax);
    }

    function projectPointOntoSegment(p, a, b) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
        return { x: a.x + dx * t, y: a.y + dy * t };
    }

    function landingZoneMatch({ tokenPos, startPos, map, radius }) {
        const grid = map?.gridSizePx ?? 64;
        const landingRadius = Math.max(radius, grid * 0.25);
        const doors = (map?.walls || []).filter((w) => isDoorWall(w) && w?.door?.open === true);
        let match = null;
        for (const door of doors) {
            if (!door?.a || !door?.b) continue;
            const mid = { x: (door.a.x + door.b.x) / 2, y: (door.a.y + door.b.y) / 2 };
            const dist = Math.hypot(tokenPos.x - mid.x, tokenPos.y - mid.y);
            if (dist > landingRadius) continue;
            match = { door, mid };
            break;
        }
        if (!match) return null;

        const thickness = Number(match.door?.door?.thicknessPx) || 0;
        const clearance = radius + thickness / 2 + 10;
        const dirVec = { x: match.door.b.x - match.door.a.x, y: match.door.b.y - match.door.a.y };
        const len = Math.hypot(dirVec.x, dirVec.y) || 1;
        const normal = { x: -dirVec.y / len, y: dirVec.x / len };
        const move = { x: tokenPos.x - startPos.x, y: tokenPos.y - startPos.y };
        const moveLen = Math.hypot(move.x, move.y);
        let n = normal;
        const dot = move.x * normal.x + move.y * normal.y;
        if (moveLen > 1e-4 && Math.abs(dot) > 1e-4) {
            n = dot >= 0 ? normal : { x: -normal.x, y: -normal.y };
        } else {
            const sideVal = doorSide(match.door, startPos);
            n = sideVal >= 0 ? { x: -normal.x, y: -normal.y } : normal;
        }
        const landing = {
            x: match.mid.x + n.x * clearance,
            y: match.mid.y + n.y * clearance
        };
        return { landing, door: match.door, mid: match.mid };
    }

    function segmentIntersectionParam(p1, p2, p3, p4) {
        const x1 = p1.x; const y1 = p1.y;
        const x2 = p2.x; const y2 = p2.y;
        const x3 = p3.x; const y3 = p3.y;
        const x4 = p4.x; const y4 = p4.y;
        const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
        if (Math.abs(den) < 1e-6) return null;
        const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
        const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / den;
        if (t < 0 || t > 1 || u < 0 || u > 1) return null;
        return {
            t,
            u,
            point: {
                x: x1 + t * (x2 - x1),
                y: y1 + t * (y2 - y1)
            }
        };
    }

    function computeDoorLanding({ start, end, door, hitPoint, radius }) {
        const a = door.a;
        const b = door.b;
        const dir = { x: b.x - a.x, y: b.y - a.y };
        const len = Math.hypot(dir.x, dir.y) || 1;
        const normal = { x: -dir.y / len, y: dir.x / len };
        const moveDir = { x: end.x - start.x, y: end.y - start.y };
        const dot = moveDir.x * normal.x + moveDir.y * normal.y;
        const n = dot >= 0 ? normal : { x: -normal.x, y: -normal.y };
        const thickness = Number(door?.door?.thicknessPx) || 0;
        const clearance = radius + thickness / 2 + 8;
        const projected = projectPointOntoSegment(hitPoint, a, b);
        return {
            x: projected.x + n.x * clearance,
            y: projected.y + n.y * clearance
        };
    }

    function clampMovementPath({ current, target, radius, walls, maxStep, relaxOnDrop = false }) {
        if (!current || !target) {
            return { pos: current ?? target, collided: false, hit: null };
        }
        const origin = current && Number.isFinite(radius)
            ? { x: current.x + radius, y: current.y + radius }
            : null;
        const blockingWalls = (walls || []).filter((w) => wallBlocksMovement(w, origin));
        let pos = { ...current };
        let hit = null;

        const openDoors = (walls || []).filter((w) => isDoorWall(w) && isDoorOpen(w));
        const tryDoorSnap = (startPt, endPt) => {
            let best = null;
            for (const door of openDoors) {
                if (!door?.a || !door?.b) continue;
                const hitInfo = segmentIntersectionParam(startPt, endPt, door.a, door.b);
                if (!hitInfo) continue;
                if (!best || hitInfo.t < best.t) {
                    best = { ...hitInfo, door };
                }
            }
            if (!best) return null;
            // Ensure path to door is clear (respect closed walls)
            const reach = clampTokenMovement({
                start: startPt,
                end: best.point,
                radius,
                walls: blockingWalls,
                relaxOnDrop
            });
            if (reach.collided) return null;
            const landing = computeDoorLanding({
                start: startPt,
                end: endPt,
                door: best.door,
                hitPoint: best.point,
                radius
            });
            return { landing, door: best.door };
        };

        function tryDoorThresholdTeleport(startPt, endPt) {
            let best = null;
            for (const door of openDoors) {
                if (!door?.a || !door?.b) continue;
                const sideStart = doorSide(door, startPt);
                const sideEnd = doorSide(door, endPt);
                const signFlip =
                    (sideStart === 0 && sideEnd !== 0) ||
                    (sideEnd === 0 && sideStart !== 0) ||
                    sideStart * sideEnd < 0;
                const hitInfo = segmentIntersectionParam(startPt, endPt, door.a, door.b);
                if (!signFlip && !hitInfo) continue;
                const denom = Math.abs(sideStart) + Math.abs(sideEnd) || 1;
                const tGuess = hitInfo?.t ?? Math.min(1, Math.max(0, Math.abs(sideStart) / denom));
                const crossPoint = hitInfo?.point ?? {
                    x: startPt.x + (endPt.x - startPt.x) * tGuess,
                    y: startPt.y + (endPt.y - startPt.y) * tGuess
                };
                if (!best || tGuess < best.t) {
                    best = { t: tGuess, door, point: crossPoint };
                }
            }
            if (!best) return null;
            const landing = computeDoorLanding({
                start: startPt,
                end: endPt,
                door: best.door,
                hitPoint: best.point,
                radius
            });
            return { landing, door: best.door };
        }

        // Snap through up to 3 doors on a single move
        for (let i = 0; i < 3; i += 1) {
            const snap =
                tryDoorSnap(pos, { x: target.x, y: target.y }) ||
                tryDoorThresholdTeleport(pos, { x: target.x, y: target.y });
            if (!snap) break;
            pos = { ...snap.landing };
        }

        const startAfterSnap = { ...pos };
        const moveDx = target.x - startAfterSnap.x;
        const moveDy = target.y - startAfterSnap.y;
        const dist = Math.hypot(moveDx, moveDy);
        const step = Math.max(maxStep || dist || 0, 1e-3);
        const steps = Math.max(1, Math.ceil(dist / step));

        for (let i = 0; i < steps; i += 1) {
            const t = (i + 1) / steps;
            const segTarget = {
                x: startAfterSnap.x + moveDx * t,
                y: startAfterSnap.y + moveDy * t
            };
            const clamped = clampTokenMovement({
                start: pos,
                end: segTarget,
                radius,
                walls: blockingWalls,
                relaxOnDrop
            });
            if (clamped.collided) {
                if (!hit && clamped.hit) hit = clamped.hit;
                return { pos: { ...pos }, collided: true, hit };
            }
            pos = { x: clamped.x, y: clamped.y };
        }

        return { pos, collided: false, hit };
    }

    function updateMeasureOverlay() {
        if (!measureStart || !measureCurrent) {
            measureOverlay = null;
            return;
        }
        const { mapRect, scaleX, scaleY } = getMapMetrics();
        if (!mapRect) return;

        const startScreen = {
            x: mapRect.left + measureStart.x * scaleX,
            y: mapRect.top + measureStart.y * scaleY
        };
        const endScreen = {
            x: mapRect.left + measureCurrent.x * scaleX,
            y: mapRect.top + measureCurrent.y * scaleY
        };

        const dx = endScreen.x - startScreen.x;
        const dy = endScreen.y - startScreen.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
        const midX = (startScreen.x + endScreen.x) / 2;
        const midY = (startScreen.y + endScreen.y) / 2;

        const dxCells = Math.abs((measureCurrentCell?.col ?? 0) - (measureStartCell?.col ?? 0));
        const dyCells = Math.abs((measureCurrentCell?.row ?? 0) - (measureStartCell?.row ?? 0));
        const cells = Math.max(dxCells, dyCells);
        const horizontalFeet = cells * 5;

        // 3D math only if start OR end is on an elevated token
        const startElev = Number(measureStartElev) || 0;
        const endElev = Number(measureCurrentElev) || 0;
        const is3d = startElev !== 0 || endElev !== 0;
        const verticalFeet = Math.abs((endElev || 0) - (startElev || 0));
        const feet = is3d
            ? compute3dFeet(horizontalFeet, startElev, endElev)
            : horizontalFeet;

        measureOverlay = {
            x: startScreen.x,
            y: startScreen.y,
            length,
            angle,
            midX,
            midY,
            feet,
            is3d,
            horizontalFeet,
            verticalFeet
        };
    }

    function updateSelection(nextIds) {
        dispatch("selectionChange", { ids: nextIds });
    }

    function clearSelectionIfBackground(e) {
        if (e.target.closest(".token")) return;
        updateSelection([]);
        setActiveVisionToken(null);
        requestVisionRecompute();
    }

    function handleMeasureMouseDown(e) {
        if (!isGM) return;
        if (activeTool !== "measure") return;
        if (e.button !== 0) return;
        if (e.target.closest(".gm-toolbar, .gm-menu, .token-menu, .right-click-menu")) return;
        if (!$currentMap) return;
        if (currentPanMode !== "none") return;

        const pt = screenToMap(e.clientX, e.clientY);
        if (!pt) return;

        const size = $currentMap?.gridSizePx ?? 64;
        const snapped = snapToCellCenter(pt.x, pt.y, size);

        if (!measureStart) {
            measureStart = snapped;
            measureStartCell = { col: snapped.col, row: snapped.row };
            measureCurrent = snapped;
            measureCurrentCell = { col: snapped.col, row: snapped.row };

            // Capture elevation at start (and seed current)
            measureStartElev = getElevationAtCell(snapped.col, snapped.row);
            measureCurrentElev = measureStartElev;

            window.addEventListener("mousemove", handleMeasureMouseMove);
        } else {
            measureCurrent = snapped;
            measureCurrentCell = { col: snapped.col, row: snapped.row };

            // Capture elevation at end
            measureCurrentElev = getElevationAtCell(snapped.col, snapped.row);

            updateMeasureOverlay();

            const feet = measureOverlay?.feet ?? 0;
            if ($currentMap?.id) {
                sendWS({
                    type: "gmMessage",
                    messageType: "toast",
                    text: `${feet} ft`,
                    start: { x: measureStart.x, y: measureStart.y },
                    end: { x: measureCurrent.x, y: measureCurrent.y },
                    feet,
                    timestamp: Date.now(),
                    mapId: $currentMap.id
                });
            }
            sendMessage(`${feet} ft`);

            if (isGM && $currentMap?.id) {
                sendWS({
                    type: "measure-clear",
                    mapId: $currentMap.id
                });
            }

            measureStart = null;
            measureStartCell = null;
            measureCurrent = null;
            measureCurrentCell = null;
            measureOverlay = null;
            measureStartElev = 0;
            measureCurrentElev = 0;

            window.removeEventListener("mousemove", handleMeasureMouseMove);
        }

        updateMeasureOverlay();
    }

    function handleMeasureMouseMove(e) {
        if (activeTool !== "measure") return;
        if (!measureStart) return;

        const pt = screenToMap(e.clientX, e.clientY);
        if (!pt) return;

        const size = $currentMap?.gridSizePx ?? 64;
        const snapped = snapToCellCenter(pt.x, pt.y, size);

        measureCurrent = snapped;
        measureCurrentCell = { col: snapped.col, row: snapped.row };

        // Update current elevation while moving
        measureCurrentElev = getElevationAtCell(snapped.col, snapped.row);

        updateMeasureOverlay();
        if (isGM && measureOverlay && $currentMap?.id) {
            sendWS({
                type: "measure-live",
                mapId: $currentMap.id,
                start: { x: measureStart.x, y: measureStart.y },
                end: { x: measureCurrent.x, y: measureCurrent.y },
                feet: measureOverlay.feet,
                timestamp: Date.now()
            });
        }

    }

    function handleTokenMouseDown(e, token) {
        if (activeTool !== "select") return;

        // Right-click = selection only
        if (e.button === 2) {
            clickStart = null;
            didMove = false;
            return;
        }

        if (e.button !== 0) return;
        if (isGM && token.locked) return;

        e.stopPropagation();

        // Selection logic
        const multi = e.metaKey || e.ctrlKey;
        let ids = [...(selectedIds ?? [])];
        const alreadySelected = ids.includes(token.id);

        if (multi) {
            ids = alreadySelected
                ? ids.filter(id => id !== token.id)
                : [...ids, token.id];
            updateSelection(ids);
        } else if (!alreadySelected) {
            updateSelection([token.id]);
            ids = [token.id];
        }

        const groupIds = ids;

        clickStart = { x: e.clientX, y: e.clientY, token };
        didMove = false;

        window.addEventListener("mouseup", onTokenMouseUp);
        if (!canDragToken(token)) {
            return;
        }

        // Drag initialization
        const { mapRect, scaleX, scaleY } = getMapMetrics();
        if (!mapRect) return;

        const startX = e.clientX;
        const startY = e.clientY;

        const targets = groupIds
            .map(id => get(tokens).find(t => t.id === id))
            .filter(t => t && canDragToken(t));

        const domTargets = targets
            .map(t => {
                const el = document.querySelector(`.token[data-token-id="${t.id}"]`);
                return el ? { ...t, el } : null;
            })
            .filter(Boolean);

        const measureActive = activeTool === "select" && (isGM ? movementMeasure : true);
        const snapActive = activeTool === "select" && movementMeasure;
        const followEnabled = !isGM && cameraFollow && isPlayerOwnedToken(token);
        const followStartMap = followEnabled ? screenToMap(e.clientX, e.clientY) : null;
        const followOffset = followStartMap
            ? { x: token.x - followStartMap.x, y: token.y - followStartMap.y }
            : null;
        if (measureActive) {
            clearMoveMeasureOverlay();
            moveMeasureUndo = {
                mapId: $currentMap?.id ?? null,
                tokens: targets.map(t => ({ id: t.id, x: t.x, y: t.y }))
            };
        }

        dragGroup = {
            startX,
            startY,
            scaleX,
            scaleY,
            map: $currentMap,
            targets: domTargets,
            measureActive,
            snapActive,
            measureAnchorId: token.id,
            measureGrid: $currentMap?.gridSizePx ?? 64,
            measureSquares: 0,
            measureLastCell: measureActive ? getTokenCell(token, $currentMap?.gridSizePx ?? 64) : null,
            followEnabled,
            anchorStart: { x: token.x, y: token.y },
            followOffset,
            startPositions: domTargets.map(t => ({ id: t.id, x: t.x, y: t.y }))
        };

        dragLatest = null;
        dragLastValid = domTargets.map(t => ({ id: t.id, x: t.x, y: t.y }));
        dragLatestDelta = { dx: 0, dy: 0 };

        window.addEventListener("mousemove", onDragMove);
    }


    function onTokenMouseUp() {
        window.removeEventListener("mousemove", onDragMove);
        window.removeEventListener("mouseup", onTokenMouseUp);

        if (didMove) {
            onDragEnd({ relaxOnDrop: true });
            requestVisionRecompute();
            clickStart = null;
            didMove = false;
            return;
        }

        if (clickStart?.token?.vision?.hasVision) {
            setActiveVisionToken(clickStart.token.id);
            requestVisionRecompute();
        }

        dragGroup = null;
        dragPending = null;
        dragLatest = null;
        dragLastValid = null;
        draggingTokenIds = new Set();
        dragLatestDelta = { dx: 0, dy: 0 };
        clearMoveMeasureOverlay();
        stopFollow();
        if (collisionDebugEnabled) {
            collisionHits = [];
        }
        if (!isGM) {
            activeDoorLanding.set(null);
        }

        clickStart = null;
        didMove = false;
    }


    function openDetails(token) {
        const mapRect = document.querySelector(".map-inner")?.getBoundingClientRect();
        if (mapRect) {
            const centerX =
                mapRect.left +
                (token.x + (token.size ?? $currentMap?.gridSizePx ?? 64) / 2) *
                    (mapRect.width / ($currentMap?.width ?? mapRect.width));
            const centerY =
                mapRect.top +
                (token.y + (token.size ?? $currentMap?.gridSizePx ?? 64) / 2) *
                    (mapRect.height / ($currentMap?.height ?? mapRect.height));
            detailsPos = { x: centerX + 20, y: centerY - 40 };
        }
        detailsToken = token;
        detailsReadOnly = !isGM && !isPlayerOwnedToken(token);
    }

    function openHpMenu(token) {
        const isSame = hpMenu.open && hpMenu.tokenId === token.id;
        if (isSame) {
            closeHpMenu();
            return;
        }
        hpMenu = {
            open: true,
            tokenId: token.id,
            x: 0,
            y: 0
        };
        hpAmount = "";
    }

    function toggleHpMenu(id) {
        const t = get(tokens).find(tok => tok.id === id);
        if (!t) return;
        if (!isGM && (!isPlayerOwnedToken(t) || t.locked)) return;
        openHpMenu(t);
    }

    $: hpMenuToken = hpMenu.open ? ($tokens?.find(tok => tok.id === hpMenu.tokenId) ?? null) : null;
    $: menuToken = menu.open ? ($tokens?.find(tok => tok.id === menu.tokenId) ?? null) : null;
    $: canEditMenuToken = !!menuToken && (isGM || (isPlayerOwnedToken(menuToken) && !menuToken.locked));
    $: menuReadOnly = !!menuToken && !canEditMenuToken;

    function closeHpMenu() {
        hpMenu = { open: false, tokenId: null, x: 0, y: 0 };
        hpAmount = "";
    }

    function hpDisplay(token) {
        const { currentHp, maxHp } = deriveHpState(token);
        return { hp: currentHp, max: maxHp };
    }

    function applyHpDelta(token, delta) {
        if (!token) return;
        const patch = applyHpPatch(token, delta >= 0 ? { heal: delta } : { damage: Math.abs(delta) });
        const adjusted = { ...token, ...patch };
        upsertToken(adjusted, { persist: isGM });
        if (isGM) registerLocalTokenUpdate(adjusted);
        sendWS({ type: "token-update", token: adjusted });
        hpAmount = "";
    }

    function updateTempHp(token, value) {
        if (!token) return;
        const patch = applyHpPatch(token, { setTemp: +value || 0 });
        const updated = { ...token, ...patch };
        upsertToken(updated, { persist: isGM });
        if (isGM) registerLocalTokenUpdate(updated);
        sendWS({ type: "token-update", token: updated });
    }

    function onDragMove(e) {
        if (!dragGroup) return;

        const totalDx = e.clientX - dragGroup.startX;
        const totalDy = e.clientY - dragGroup.startY;

        if (clickStart && !didMove) {
            const absDx = Math.abs(totalDx);
            const absDy = Math.abs(totalDy);
            if (absDx > DRAG_THRESHOLD || absDy > DRAG_THRESHOLD) {
                didMove = true;
                draggingTokenIds = new Set(dragGroup?.targets?.map(t => t.id) ?? []);
            } else {
                return;
            }
        }

        let dx;
        let dy;

        if (dragGroup.followEnabled) {
            const pt = screenToMap(e.clientX, e.clientY);
            if (!pt || !dragGroup.followOffset) return;
            const anchorX = pt.x + dragGroup.followOffset.x;
            const anchorY = pt.y + dragGroup.followOffset.y;
            dx = anchorX - dragGroup.anchorStart.x;
            dy = anchorY - dragGroup.anchorStart.y;
        } else {
            dx = totalDx / dragGroup.scaleX;
            dy = totalDy / dragGroup.scaleY;
        }

        dragLatestDelta = { dx, dy };
        dragPending = { dx, dy };

        if (!dragFrame) {
            dragFrame = requestAnimationFrame(flushDragFrame);
        }
    }

    function onDragEnd({ relaxOnDrop = false } = {}) {
        const session = dragGroup;
        dragGroup = null;
        dragPending = null;

        if (dragFrame) {
            cancelAnimationFrame(dragFrame);
            dragFrame = null;
        }

        window.removeEventListener("mousemove", onDragMove);
        window.removeEventListener("mouseup", onDragEnd);

        if (!session) return;

        const map = session.map ?? $currentMap;
        const startSnapshot = session.targets.map(t => ({ ...t }));
        const lastValid = dragLastValid ?? startSnapshot;
        const latest = dragLatest ?? startSnapshot;
        const startPositions = session.startPositions ?? startSnapshot;

        const lastValidById = new Map(lastValid.map(t => [t.id, t]));
        const latestById = new Map(latest.map(t => [t.id, t]));
        const startById = new Map(startPositions.map(t => [t.id, t]));
        const finalUpdates = latest.map(orig => {
            if (!map) return { ...orig };
            const size = orig.size ?? map?.gridSizePx ?? 64;
            const prevValid = lastValidById.get(orig.id) ?? orig;
            const start = startById.get(orig.id) ?? orig;
            const intended = {
                x: start.x + (dragLatestDelta?.dx ?? 0),
                y: start.y + (dragLatestDelta?.dy ?? 0)
            };
            const target = snapToGrid(map, intended.x, intended.y, size);
            let resolved = { ...orig };
            if (!isGM) {
        const radius = size / 2;
                const gridSize = session.measureGrid ?? map?.gridSizePx ?? 64;
                const maxStep = Math.max(gridSize * 0.25, radius * 0.5, 1);
                const clamped = clampMovementPath({
                    current: { x: prevValid.x, y: prevValid.y },
                    target: { x: target.x, y: target.y },
                    radius,
                    walls: map?.walls,
                    maxStep
                });
                resolved = {
                    ...orig,
                    x: clamped.collided ? prevValid.x : clamped.pos.x,
                    y: clamped.collided ? prevValid.y : clamped.pos.y
                };
            } else {
                resolved = { ...orig, x: target.x, y: target.y };
            }

            const radius = size / 2;
            const match = landingZoneMatch({
                tokenPos: { x: resolved.x, y: resolved.y },
                startPos: { x: start.x, y: start.y },
                map,
                radius
            });
            const landingState = get(activeDoorLanding);
            const allowLanding = isGM || (landingState && landingState.doorId === match?.door?.id);
            if (match && allowLanding) {
                const originLanding = { x: start.x + radius, y: start.y + radius };
                const filteredWalls = (map?.walls || []).filter((w) => wallBlocksMovement(w, originLanding));
                const clamped = clampTokenMovement({
                    start: { x: start.x, y: start.y },
                    end: match.landing,
                    radius,
                    walls: filteredWalls
                });
                resolved = { ...resolved, x: clamped.x, y: clamped.y };
            }

            return resolved;
        });

        finalUpdates.forEach((updated) => {
            const current = latestById.get(updated.id);
            if (!current) return;
            releaseOffsets.set(updated.id, {
                dx: (current.x ?? updated.x) - updated.x,
                dy: (current.y ?? updated.y) - updated.y
            });
        });

        draggingTokenIds = new Set();
        dragLatest = null;
        if (collisionDebugEnabled) {
            collisionHits = [];
        }

        if (session.measureActive) {
            const anchor = finalUpdates.find(u => u.id === session.measureAnchorId);
            if (anchor) {
                updateMoveMeasureOverlay(anchor, session.measureSquares, true);
                clearTimeout(moveMeasureTimer);
                moveMeasureTimer = setTimeout(() => {
                    clearMoveMeasureOverlay();
                }, 1200);
            }
        }

        const mapId = $currentMap?.id ?? null;

        finalUpdates.forEach(updated => {
            upsertToken(updated, { persist: false });
            if (isGM) {
                registerLocalTokenMove({
                    ...updated,
                    mapId: updated.mapId ?? mapId
                });
            }
            sendWS({ type: "token-move", token: updated });
        });

        if (mapId) {
            persistCurrentTokens();
        }

        stopFollow();
        dragLastValid = null;
        dragLatestDelta = { dx: 0, dy: 0 };
        if (!isGM) {
            activeDoorLanding.set(null);
        }
    }

    function flushDragFrame() {
        dragFrame = null;
        if (!dragGroup || !dragPending) return;

        const { dx, dy } = dragPending;
        dragPending = null;

        const map = dragGroup.map ?? $currentMap;
        const debugHits = collisionDebugEnabled ? [] : null;
        const base = dragLastValid ?? dragGroup.targets;
        const baseById = new Map(base.map(t => [t.id, t]));
        const startPositions = dragGroup.startPositions ?? dragGroup.targets;
        const startById = new Map(startPositions.map(t => [t.id, t]));

        const updates = dragGroup.targets.map(orig => {
            const lastValid = baseById.get(orig.id) ?? orig;
            const start = startById.get(orig.id) ?? orig;
            let intendedX = start.x + dx;
            let intendedY = start.y + dy;
            if (dragGroup.snapActive && map) {
                const size = orig.size ?? map?.gridSizePx ?? 64;
                const snapped = snapToGrid(map, intendedX, intendedY, size);
                intendedX = snapped.x;
                intendedY = snapped.y;
            }

            if (!isGM && map) {
                const size = orig.size ?? map?.gridSizePx ?? 64;
                const radius = size / 2;
                const gridSize = dragGroup.measureGrid ?? map?.gridSizePx ?? 64;
                const maxStep = Math.max(gridSize * 0.25, radius * 0.5, 1);
        const clamped = clampMovementPath({
                    current: { x: lastValid.x, y: lastValid.y },
                    target: { x: intendedX, y: intendedY },
                    radius,
                    walls: map?.walls,
                    maxStep
                });
                if (clamped.collided) {
                    if (collisionDebugEnabled && clamped.hit) {
                        debugHits.push({ id: orig.id, ...clamped.hit });
                    }
                    return { ...orig, x: lastValid.x, y: lastValid.y };
                }
                return { ...orig, x: clamped.pos.x, y: clamped.pos.y };
            }

            return { ...orig, x: intendedX, y: intendedY };
        });

        dragLastValid = updates;
        dragLatest = updates;
        if (collisionDebugEnabled) {
            collisionHits = debugHits;
        }

        if (dragGroup.measureActive) {
            const anchor = updates.find(u => u.id === dragGroup.measureAnchorId);
            if (anchor) {
                const gridSize = dragGroup.measureGrid ?? $currentMap?.gridSizePx ?? 64;
                const nextCell = getTokenCell(anchor, gridSize);
                const lastCell = dragGroup.measureLastCell;
                if (lastCell) {
                    const delta =
                        Math.abs(nextCell.col - lastCell.col) +
                        Math.abs(nextCell.row - lastCell.row);
                    if (delta > 0) {
                        dragGroup.measureSquares += delta;
                        dragGroup.measureLastCell = nextCell;
                    }
                } else {
                    dragGroup.measureLastCell = nextCell;
                }
                updateMoveMeasureOverlay(anchor, dragGroup.measureSquares, false);
            }
        }

        if (!isGM) {
            const anchor = updates.find(u => u.id === dragGroup.measureAnchorId);
            if (anchor && isPlayerOwnedToken(anchor)) {
                scheduleFollow(anchor);
            }
        }

        if (!isGM) {
            const anchor = updates.find(u => u.id === dragGroup.measureAnchorId) || updates[0];
            const startAnchor = anchor ? startById.get(anchor.id) : null;
            if (anchor && startAnchor && $currentMap) {
                const radius = (anchor.size ?? $currentMap.gridSizePx ?? 64) / 2;
                const match = landingZoneMatch({
                    tokenPos: { x: anchor.x, y: anchor.y },
                    startPos: { x: startAnchor.x, y: startAnchor.y },
                    map: $currentMap,
                    radius
                });
                if (match) {
                    activeDoorLanding.set({
                        doorId: match.door.id,
                        x: match.mid.x,
                        y: match.mid.y
                    });
                } else {
                    activeDoorLanding.set(null);
                }
            } else {
                activeDoorLanding.set(null);
            }
        }

        updates.forEach(u => {
            if (!u.el) return;
            const offsetX = u.x - (dragGroup.targets.find(t => t.id === u.id)?.x ?? u.x);
            const offsetY = u.y - (dragGroup.targets.find(t => t.id === u.id)?.y ?? u.y);
            u.el.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
        });
    }

    function mergeOverrides(base = {}, patch = {}) {
        return applyOverrides(base || {}, patch || {});
    }

    function queueTokenAnimations(animations) {
        if (!isBrowser || animations.length === 0) return;
        animationQueue.push(...animations);
        if (animationTickPending) return;
        animationTickPending = true;

        tick().then(() => {
            animationTickPending = false;
            const queued = animationQueue;
            animationQueue = [];
            if (!queued.length) return;

            queued.forEach(({ id, dx, dy }) => {
                if (draggingTokenIds.has(id)) return;
                const el = document.querySelector(`.token[data-token-id="${id}"]`);
                if (!el) return;
                el.style.transition = "none";
                el.style.transform = `translate(${dx}px, ${dy}px)`;
                void el.offsetWidth;
            });

            requestAnimationFrame(() => {
                queued.forEach(({ id }) => {
                    if (draggingTokenIds.has(id)) return;
                    const el = document.querySelector(`.token[data-token-id="${id}"]`);
                    if (!el) return;
                    el.style.transition = "";
                    el.style.transform = "";
                });
            });
        });
    }

    function spawnTokenFromTemplate(template) {
    if (!template) return null;

    const baseTemplateId = template.baseTemplateId || template.id;
    const grid = $currentMap?.gridSizePx ?? 64;

    const sizeFeet = template.sizeFeet ?? 5;
    const sizeLabel = template.sizeLabel ?? "Medium";
    const size = grid * Math.max(0.5, sizeFeet / 5);

    const bestiary = template.bestiary ? structuredClone(template.bestiary) : null;
    const baseOverrides = template.overrides ? structuredClone(template.overrides) : {};

    const sheet = bestiary
        ? normalizeSheet(bestiary, baseOverrides, {
              name: template.name,
              templateId: template.id,
              baseTemplateId
          })
        : null;

    const { maxHp, currentHp, tempHp } = computeTemplateHp({
        ...template,
        overrides: baseOverrides,
        bestiary
    });

    const vision = defaultVision(template.vision);

    const token = {
        id: null,
        templateId: template.id,
        baseTemplateId,
        name: template.name,
        img: template.img,

        overrides: baseOverrides,
        size,
        sizeFeet,
        sizeLabel,

        abilities: sheet?.abilities,
        skills: sheet?.skills,
        saves: sheet?.saves,
        passives: sheet?.passives,

        bestiary,
        sheet,
        ac: template.ac ?? sheet?.meta?.ac ?? sheet?.ac,
        consistentHp: !!template.consistentHp,

        elevation: 0,

        vision
    };

    token.currentHp = currentHp;
    token.maxHp = maxHp;
    token.tempHp = tempHp;

    return token;
}
    tokens.subscribe(list => {

    if (!isBrowser) return;

    const animations = [];
    const nextPositions = new Map();
    let followCandidate = null;
    const activeVisionId = get(activeVisionTokenId);

    list.forEach((t) => {
        const x = Number(t.x) || 0;
        const y = Number(t.y) || 0;
        const isVisibleToken = visible(t);
        nextPositions.set(t.id, { x, y });

        const release = releaseOffsets.get(t.id);
        if (release) {
            animations.push({ id: t.id, dx: release.dx, dy: release.dy });
            releaseOffsets.delete(t.id);
            return;
        }

        const prev = lastPositions.get(t.id);
        if (!prev) return;

        const dx = prev.x - x;
        const dy = prev.y - y;
        if (dx === 0 && dy === 0) return;
        animations.push({ id: t.id, dx, dy });
        if (!isGM && isVisibleToken && activeVisionId && t.id === activeVisionId && isPlayerOwnedToken(t)) {
            followCandidate = t;
        }
        if (!isGM && isVisibleToken && activeTool === "select" && !draggingTokenIds.has(t.id) && !dragGroup) {
            const gridSize = $currentMap?.gridSizePx ?? 64;
            const squares =
                Math.round(Math.abs(prev.x - x) / gridSize) +
                Math.round(Math.abs(prev.y - y) / gridSize);
            if (squares > 0) {
                updateMoveMeasureOverlay(t, squares, true);
                clearTimeout(moveMeasureTimer);
                moveMeasureTimer = setTimeout(() => {
                    clearMoveMeasureOverlay();
                }, 1200);
            }
        }
    });

    lastPositions.clear();
    nextPositions.forEach((pos, id) => lastPositions.set(id, pos));
    queueTokenAnimations(animations);
    if (followCandidate && !draggingTokenIds.has(followCandidate.id)) {
        scheduleFollow(followCandidate);
    }
    });


    function handleDetailsUpdate(event) {
        const t = event.detail?.token;
        if (!t) return;
        detailsToken = t;
        detailsReadOnly = !isGM && !isPlayerOwnedToken(t);
    }

    async function handleTemplateSave(event) {
        const tplId = event.detail?.templateId;
        const changes = event.detail?.changes || {};
        if (!tplId) return;

        const lib = get(tokenLibrary) || [];
        const baseTemplate = lib.find((tpl) => tpl.id === tplId) || { id: tplId };
        const overridePatch = changes?.overrides || {};
        const hasTemplateChange =
            ("name" in changes && changes.name !== baseTemplate.name) ||
            Object.keys(overridePatch).length > 0 ||
            !!changes?.bestiary;

        const mergedTemplate = {
            ...baseTemplate,
            ...("name" in changes ? { name: changes.name } : {}),
            overrides: mergeOverrides(baseTemplate.overrides || {}, overridePatch),
            bestiary: baseTemplate.bestiary || changes?.bestiary || null,
            customized: baseTemplate.customized || hasTemplateChange || false
        };

        if (tplId.startsWith("custom-")) {
            const custom = (get(customLibraryStore) || {})[tplId] || {};
            updateCustomCreature(tplId, {
                overrides: mergedTemplate.overrides,
                name: mergedTemplate.name ?? custom.name,
                customized: mergedTemplate.customized
            });

            tokenLibrary.update((list) =>
                list.map((tpl) => (tpl.id === tplId ? mergedTemplate : tpl))
            );
        } else {
            await replaceTemplate(mergedTemplate);
            tokenLibrary.update((list) =>
                list.map((tpl) => (tpl.id === tplId ? mergedTemplate : tpl))
            );
        }
    }

    // Clamp into map bounds on load/change (GM only)

    
</script>

<svelte:window on:click={() => { closeMenu(); closeHpMenu(); }} />

{#if menu.open && menuToken}
    <div class="menu-root" use:portalToBody>
        <div class="menu-overlay" style="position: fixed; inset: 0; pointer-events:none; z-index:9999; transform:none !important;">
            <div
                class="menu-stack"
                bind:this={menuEl}
                style={`position:absolute; left:${menuPos.left}px; top:${menuPos.top}px; pointer-events:none; transform:none !important;`}
            >
                <div class="token-menu" style="pointer-events:auto;" on:click|stopPropagation={() => {}}>
                    <div class="menu-row icons-row">
                        {#if canEditMenuToken}
                            <button data-tooltip="Rename" on:click={() => renameToken(menu.tokenId)} aria-label="Rename token">
                                <Edit size={16} stroke-width="2" />
                            </button>
                        {/if}

                        <button
                            data-tooltip="Details"
                            on:click={() => { const t = get(tokens).find(tok => tok.id === menu.tokenId); if (t) openDetails(t); closeMenu(); }}
                            aria-label="Details"
                        >
                            <FileText size={16} stroke-width="2" />
                        </button>

                        {#if isGM}
                            <button class="icon-btn" on:click={() => copyTokenToCustom(menuToken)} aria-label="Duplicate">
                                <Copy size={16} stroke-width="2" />
                            </button>

                            <button data-tooltip="Lock" on:click={() => toggleLock(menu.tokenId)} aria-label="Lock token">
                                {#if get(tokens).find(tok => tok.id === menuToken.id)?.locked}
                                    <Lock size={16} stroke-width="2" />
                                {:else}
                                    <Unlock size={16} stroke-width="2" />
                                {/if}
                            </button>

                            <button data-tooltip="Toggle Visibility" on:click={() => toggleHidden(menuToken.id)} aria-label="Toggle visibility">
                                {#if get(tokens).find(tok => tok.id === menuToken.id)?.hidden}
                                    <EyeOff size={16} stroke-width="2" />
                                {:else}
                                    <Eye size={16} stroke-width="2" />
                                {/if}
                            </button>

                            <button class="danger" data-tooltip="Delete" on:click={() => deleteTokenAction(menu.tokenId)} aria-label="Delete token">
                                <Trash2 size={16} stroke-width="2" />
                            </button>
                        {/if}
                    </div>

                    <div class="menu-row hp-row">
                        {#if menuToken}
                            <button
                                class="hp-btn"
                                disabled={menuReadOnly}
                                on:click|stopPropagation={() => toggleHpMenu(menu.tokenId)}
                                aria-label="Adjust HP"
                                data-tooltip="Adjust HP"
                            >
                                <span class="hp-num">{hpDisplay(menuToken).hp ?? "—"}</span>
                                <span class="hp-sep">/</span>
                                <span class="hp-max">{hpDisplay(menuToken).max ?? "—"}</span>
                            </button>
                        {/if}

                        {#if isGM}
                            <div class="size-picker" aria-label="Set size">
                                <Maximize size={16} stroke-width="2" />
                                <select bind:value={sizeSelection} on:change={() => updateSize(menu.tokenId)}>
                                    {#each SIZE_PRESETS as opt}
                                        <option value={opt.label}>{opt.label}</option>
                                    {/each}
                                </select>
                                {#if sizeSelection === "Gargantuan"}
                                    <input
                                        type="number"
                                        min="20"
                                        step="5"
                                        bind:value={customFeet}
                                        on:change={() => { customFeet = Math.max(20, snapToFiveMin5(+customFeet || 20)); updateSize(menu.tokenId); }}
                                        aria-label="Custom feet"
                                    />
                                {/if}
                            </div>
                        {/if}
                    </div>

                    {#if isGM}
                        <!-- Elevation control (right-click menu) -->
                        <div class="menu-row elev-row" aria-label="Set elevation">
                            <div class="elev-label">
                                <span class="elev-title">Elevation</span>
                                <span class="elev-hint">(ft)</span>
                            </div>

                            <input
                                class="elev-input"
                                type="number"
                                step="5"
                                inputmode="numeric"
                                bind:value={elevationValue}
                                on:change={() => updateElevation(menu.tokenId, elevationValue)}
                                aria-label="Elevation in feet"
                            />
                        </div>
                    {/if}
                </div>

                {#if hpMenu.open && hpMenuToken && hpMenu.tokenId === menu.tokenId}
                    <div class="hp-accordion" on:click|stopPropagation>
                        <div class="hp-row">
                            <button
                                class="icon-btn hp-btn heal"
                                on:click={() => applyHpDelta(hpMenuToken, Math.abs(+hpAmount || 0))}
                                aria-label="Heal"
                            >
                                <PlusCircle size={14} stroke-width="2" />
                                <span class="icon-text">Heal</span>
                            </button>

                            <input
                                class="hp-amount-input"
                                type="number"
                                min="0"
                                bind:value={hpAmount}
                                placeholder="0"
                            />

                            <button
                                class="icon-btn hp-btn danger"
                                on:click={() => applyHpDelta(hpMenuToken, -Math.abs(+hpAmount || 0))}
                                aria-label="Damage"
                            >
                                <MinusCircle size={14} stroke-width="2" />
                                <span class="icon-text">Damage</span>
                            </button>
                        </div>

                        <div class="hp-row secondary">
                            <label>
                                Temp HP
                                <input
                                    class="hp-input"
                                    type="number"
                                    min="0"
                                    value={hpMenuToken.tempHp ?? 0}
                                    on:input={(e) => updateTempHp(hpMenuToken, e.target.value)}
                                />
                            </label>
                        </div>
                    </div>
                {/if}
            </div>
        </div>
    </div>
{/if}

{#if measureOverlay && activeTool === "measure"}
    <div class="measure-root" use:portalToBody>
        <div class="measure-overlay">
            <div
                class="measure-line"
                style={`left:${measureOverlay.x}px; top:${measureOverlay.y}px; width:${measureOverlay.length}px; transform: rotate(${measureOverlay.angle}deg);`}
            />
            <div
    class="measure-label"
    style={`left:${measureOverlay.midX}px; top:${measureOverlay.midY}px; transform: translate(-50%, -50%);`}
>
    {#if measureOverlay.is3d}
        <span class="measure-3d">↕ 3D</span>
    {/if}
    <span>{measureOverlay.feet} ft</span>

    {#if measureOverlay.is3d}
        <div class="measure-tooltip">
            <div>Horizontal: {measureOverlay.horizontalFeet} ft</div>
            <div>Vertical: {measureOverlay.verticalFeet} ft</div>
        </div>
    {/if}
</div>

        </div>
    </div>
{/if}

{#if remoteOverlay && !isGM}
    <div class="measure-root" use:portalToBody>
        <div class="measure-overlay">
            <div
                class="measure-line"
                style={`left:${remoteOverlay.x}px; top:${remoteOverlay.y}px; width:${remoteOverlay.length}px; transform: rotate(${remoteOverlay.angle}deg);`}
            />
            <div
                class="measure-label"
                style={`left:${remoteOverlay.midX}px; top:${remoteOverlay.midY}px; transform: translate(-50%, -50%);`}
            >
                {#if remoteOverlay.is3d}
                    <span class="measure-3d">↕ 3D</span>
                {/if}
                <span>{remoteOverlay.feet} ft</span>

                {#if remoteOverlay.is3d}
                    <div class="measure-tooltip">
                        <div>Horizontal: {remoteOverlay.horizontalFeet} ft</div>
                        <div>Vertical: {remoteOverlay.verticalFeet} ft</div>
                    </div>
                {/if}
            </div>
        </div>
    </div>
{/if}

{#if moveMeasureOverlay}
    <div class="move-measure-root" use:portalToBody>
        <div
            class={`move-measure ${moveMeasureOverlay.final ? "final" : ""}`}
            style={`left:${moveMeasureOverlay.x}px; top:${moveMeasureOverlay.y}px;`}
        >
            Movement: {moveMeasureOverlay.feet} ft
        </div>
    </div>
{/if}

<div
    class={`token-layer ${activeTool === "measure" ? "cursor-crosshair" : ""}`}
    style={`z-index:${zIndex}; --token-move-duration:${tokenMoveMs}ms;`}
    on:click|capture={clearSelectionIfBackground}
    on:mousedown={handleMeasureMouseDown}
>
    {#if collisionDebugEnabled && collisionHits.length && $currentMap}
        <svg
            class="collision-debug"
            viewBox={`0 0 ${$currentMap.width} ${$currentMap.height}`}
            preserveAspectRatio="none"
        >
            {#each collisionHits as hit (hit.id)}
                <line
                    x1={hit.center.x}
                    y1={hit.center.y}
                    x2={hit.x}
                    y2={hit.y}
                />
                <circle cx={hit.x} cy={hit.y} r="6" />
            {/each}
        </svg>
    {/if}
    {#if interactionDebugEnabled && interactionDebugTokens.length && $currentMap}
        <svg
            class="interaction-debug"
            viewBox={`0 0 ${$currentMap.width} ${$currentMap.height}`}
            preserveAspectRatio="none"
        >
            {#each interactionDebugTokens as t (t.id)}
                {@const size = t.size ?? $currentMap.gridSizePx ?? 64}
                {@const half = size / 2}
                {@const cx = t.x + half}
                {@const cy = t.y + half}
                <rect
                    x={t.x}
                    y={t.y}
                    width={size}
                    height={size}
                    class="interaction-box"
                />
                <circle class="interaction-handle" cx={cx} cy={t.y} r="4" />
                <circle class="interaction-handle" cx={cx} cy={t.y + size} r="4" />
                <circle class="interaction-handle" cx={t.x} cy={cy} r="4" />
                <circle class="interaction-handle" cx={t.x + size} cy={cy} r="4" />
                <circle class="interaction-center" cx={cx} cy={cy} r="5" />
            {/each}
        </svg>
    {/if}
    {#each $tokens as t (t.id)}
        {#if visible(t) && $currentMap}
            {#key `${$currentMap.id}-${t.id}`}
                <div
                    class={`token ${isGM ? "gm-token" : "player-token"} ${canDragToken(t) ? "is-draggable" : "is-locked"} ${draggingTokenIds.has(t.id) ? "is-dragging" : ""} ${(t.characterId || t.isPlayerToken || t.templateSource === "player") ? "pc-token" : ""} ${t.outline ? "outline" : ""} ${t.hidden ? "hidden" : ""} ${selectedIds?.includes(t.id) ? "selected" : ""}`}
                    data-token-id={t.id}
                    draggable="false"
                    style={`left:${t.x}px; top:${t.y}px; width:${t.size ?? $currentMap.gridSizePx ?? 64}px; height:${t.size ?? $currentMap.gridSizePx ?? 64}px;`}
                    role="button"
                    tabindex="0"
                    on:mousedown={(e) => handleTokenMouseDown(e, t)}
                    on:contextmenu={(e) => onContextMenu(e, t)}
                    on:keydown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onContextMenu(e, t); } }}
                >
                    <img class="token-img" src={t.img} alt={t.name} draggable="false" />

                    {#if t.name}
                        <div class="token-label">
                            <div class="token-name">{t.name}</div>

                            {#if (t.elevation ?? 0) !== 0}
                                <div class="token-elevation">
                                    {#if (t.elevation ?? 0) > 0}
                                        <ArrowUp size={10} stroke-width="2" />
                                        <span>{t.elevation} ft</span>
                                    {:else}
                                        <ArrowDown size={10} stroke-width="2" />
                                        <span>{Math.abs(t.elevation)} ft</span>
                                    {/if}
                                </div>
                            {/if}
                        </div>
                    {/if}
                </div>
            {/key}
        {/if}
    {/each}

    {#if detailsToken}
        <TokenDetails
            token={detailsToken}
            gridSizePx={$currentMap?.gridSizePx ?? 64}
            initialPos={detailsPos}
            readOnly={detailsReadOnly}
            persistEdits={isGM}
            onClose={() => detailsToken = null}
            on:update={handleDetailsUpdate}
            on:saveTemplate={handleTemplateSave}
        />
    {/if}
</div>

<style>
    .token {
        position: absolute;
        transition: transform var(--token-move-duration, 280ms) ease-out;
        will-change: transform;
    }

.player-token {
    pointer-events: auto;
}

.gm-token {
    pointer-events: auto;
    cursor: grab;
}

.player-token.is-draggable {
    cursor: grab;
}

.player-token.is-locked {
    cursor: not-allowed;
}

.token.is-dragging {
    cursor: grabbing;
    transition: none;
}


    .token.outline .token-img {
        box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.4);
    }

    .token.hidden {
        opacity: 0.5;
    }

    .token.hidden .token-label {
        font-style: italic;
    }

    .token img {
        width: 100%;
        height: 100%;
        user-select: none;
        pointer-events: none;
        position: relative;
        z-index: 0;
    }

    .pc-token .token-img {
        border-radius: 50%;
        border: 3px solid #d6bf73;
        box-sizing: border-box;
        background: #111;
        object-fit: cover;
    }

    .token-label {
        position: absolute;
        bottom: -18px;
        left: 50%;
        transform: translateX(-50%);
        padding: 2px 6px;
        background: rgba(20, 20, 20, 0.85);
        color: #f0f0f0;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 8px;
        font-size: 1.4em;
        line-height: 1.2;
        white-space: nowrap;
        pointer-events: none;
        z-index: 2;
    }

    .token-name {
        font-size: 1.4em;
        line-height: 1.2;
    }

    .token-elevation {
        align-items: center;
        gap: 2px;
        font-size: 0.85em; /* SMALL text */
        opacity: 0.85;
        margin-top: 2px;
        text-align: center;
    }

    .token-elevation svg {
        opacity: 0.85;
    }

    .token-menu {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 10px;
        padding: 10px 12px;
        background: rgba(12, 18, 30, 0.92);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 12px;
        box-shadow: 0 12px 28px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255,255,255,0.05);
        z-index: 300;
        min-width: 320px;
    }

    .menu-overlay {
        position: fixed;
        inset: 0;
        pointer-events: none;
        transform: none !important;
    }

    .menu-stack {
        position: absolute;
        pointer-events: none;
        z-index: 300;
        min-width: 320px;
        transform: none !important;
    }

    .menu-stack > * {
        pointer-events: auto;
    }

    .menu-root,
    .hud-layer,
    .token-menu {
        transform: none !important;
    }

    .hp-accordion {
        transform: none !important;
    }

    .token-menu button {
        background: rgba(38,48,64,0.9);
        color: #eaf1ff;
        border: 1px solid rgba(255,255,255,0.08);
        padding: 8px;
        min-width: 36px;
        min-height: 36px;
        display: grid;
        place-items: center;
        cursor: pointer;
        border-radius: 10px;
        transition: background 0.12s ease, transform 0.12s ease, border 0.12s ease;
    }

    .menu-row {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
    }

    .hp-row {
        justify-content: space-between;
    }

    .token-menu button[data-tooltip]:hover::after {
        content: attr(data-tooltip);
        position: absolute;
        left: 50%;
        bottom: calc(100% + 6px);
        transform: translateX(-50%);
        background: rgba(10,10,10,0.85);
        color: #f5f7fb;
        padding: 6px 8px;
        border-radius: 6px;
        font-size: 12px;
        white-space: nowrap;
        box-shadow: 0 4px 12px rgba(0,0,0,0.35);
        pointer-events: none;
        z-index: 400;
    }

    .token-menu .hp-btn {
        width: auto;
        padding: 8px 12px;
        border-radius: 10px;
        gap: 6px;
        display: inline-flex;
        align-items: center;
        font-weight: 800;
    }

    .hp-num { color: #fff; }
    .hp-sep { color: #b3bdc9; }
    .hp-max { color: #d4dbe6; }

    .token-menu button:hover {
        background: rgba(255,255,255,0.08);
        transform: translateY(-1px);
    }

    .token-menu button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
        transform: none;
    }

    .token-menu .danger {
        color: #ff9a8a;
        border-color: #7a2e2e;
    }

    .hp-accordion {
        position: absolute;
        bottom: calc(100% + 8px);
        left: 0;
        width: 100%;
        background: #1b121f;
        border: 1px solid rgba(241, 195, 118, 0.35);
        border-radius: 12px;
        padding: 10px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        box-shadow: 0 10px 32px rgba(0, 0, 0, 0.55);
        animation: hp-slide 140ms ease-out;
    }

    .hp-row {
        display: flex;
        gap: 8px;
        align-items: center;
    }

    .hp-row.secondary {
        justify-content: flex-start;
    }

    .hp-btn {
        flex: 1;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 8px 12px;
        font-size: 0.9rem;
        border-radius: 10px;
        border: 1px solid rgba(241, 195, 118, 0.4);
        background: linear-gradient(180deg, rgba(241, 195, 118, 0.18), rgba(241, 195, 118, 0.08));
        color: #f5e9d8;
        cursor: pointer;
        min-height: 34px;
    }

    .hp-btn.heal {
        border-color: rgba(93, 199, 126, 0.5);
        background: linear-gradient(180deg, rgba(93, 199, 126, 0.25), rgba(93, 199, 126, 0.08));
    }

    .hp-btn.danger {
        border-color: rgba(214, 85, 85, 0.55);
        background: linear-gradient(180deg, rgba(214, 85, 85, 0.28), rgba(214, 85, 85, 0.08));
        color: #ffb0a4;
    }

    .hp-btn .icon-text {
        font-size: 0.9rem;
    }

    .hp-amount-input {
        width: 70px;
        padding: 6px 8px;
        border-radius: 8px;
        border: 1px solid rgba(241, 195, 118, 0.3);
        background: #0f0a12;
        color: #f5e9d8;
        text-align: center;
        font-size: 0.9rem;
    }

    .hp-row.secondary label {
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 12px;
        color: #c9d5e8;
    }

    .hp-input {
        padding: 6px 8px;
        border-radius: 8px;
        border: 1px solid rgba(241, 195, 118, 0.3);
        background: #0f0a12;
        color: #f5e9d8;
        font-size: 0.9rem;
        width: 120px;
    }

    /* Elevation row styling */
    .elev-row {
        justify-content: space-between;
        gap: 12px;
        padding-top: 2px;
    }

    .elev-label {
        display: inline-flex;
        align-items: baseline;
        gap: 6px;
        color: #cfe0ff;
        opacity: 0.95;
        font-size: 14px;
    }

    .elev-title {
        font-weight: 700;
        letter-spacing: 0.2px;
    }

    .elev-hint {
        opacity: 0.7;
        font-size: 14px;
    }

    .elev-input {
        width: 110px;
        padding: 6px 8px;
        border-radius: 10px;
        border: 1px solid rgba(255,255,255,0.10);
        background: rgba(38,48,64,0.65);
        color: #eaf1ff;
        font-size: 12px;
        text-align: center;
        outline: none;
    }

    .elev-input:focus {
        border-color: rgba(79, 130, 255, 0.65);
        box-shadow: 0 0 0 3px rgba(79, 130, 255, 0.18);
    }

    @keyframes hp-slide {
        from { opacity: 0; transform: translateY(-4px); }
        to   { opacity: 1; transform: translateY(0); }
    }

    .measure-root {
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 850;
        transform: none !important;
    }

    .measure-overlay {
        position: absolute;
        inset: 0;
        pointer-events: none;
    }

    .measure-line {
        position: absolute;
        height: 2px;
        background: rgba(255,255,255,0.9);
        box-shadow: 0 0 6px rgba(0,0,0,0.4);
        transform-origin: 0 50%;
        border-radius: 2px;
    }

    .measure-label {
        position: absolute;
        background: rgba(12, 18, 30, 0.92);
        color: #e7f0ff;
        padding: 4px 8px;
        border-radius: 8px;
        border: 1px solid rgba(255,255,255,0.12);
        font-size: 12px;
        white-space: nowrap;
        box-shadow: 0 8px 20px rgba(0,0,0,0.35);
    }

    .token.selected::after {
        content: "";
        position: absolute;
        inset: -5px;
        border-radius: 12px;
        border: 2px solid rgba(120, 170, 255, 0.9);
        box-shadow: 0 0 10px rgba(90, 150, 255, 0.65);
        pointer-events: none;
        z-index: 1;
    }

    .pc-token.selected::after {
        border-radius: 50%;
    }

    .size-picker {
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .size-picker select,
    .size-picker input {
        background: #2e2e2e;
        color: #fff;
        border: 1px solid #555;
        border-radius: 4px;
        padding: 4px 6px;
    }

    .size-picker input {
        width: 70px;
    }

    .token-layer {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        isolation: isolate;
    }

    .collision-debug {
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 2;
    }

    .collision-debug line {
        stroke: rgba(255, 90, 90, 0.9);
        stroke-width: 2;
    }

    .collision-debug circle {
        fill: rgba(255, 90, 90, 0.25);
        stroke: rgba(255, 90, 90, 0.95);
        stroke-width: 2;
    }

    .interaction-debug {
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 2;
    }

    .interaction-box {
        fill: rgba(80, 160, 255, 0.08);
        stroke: rgba(80, 200, 255, 0.85);
        stroke-width: 1.5;
    }

    .interaction-handle {
        fill: rgba(255, 235, 140, 0.9);
        stroke: rgba(30, 30, 30, 0.8);
        stroke-width: 1.5;
    }

    .interaction-center {
        fill: rgba(0, 0, 0, 0.65);
        stroke: rgba(255, 235, 140, 0.95);
        stroke-width: 1.5;
    }

    .cursor-crosshair {
        cursor: crosshair;
    }
    .measure-3d {
    margin-right: 6px;
    font-size: 11px;
    opacity: 0.7;
    letter-spacing: 0.3px;
}
.measure-tooltip {
    position: absolute;
    bottom: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
    background: rgba(10, 14, 24, 0.95);
    color: #e7f0ff;
    padding: 6px 8px;
    border-radius: 6px;
    font-size: 11px;
    line-height: 1.4;
    border: 1px solid rgba(255,255,255,0.12);
    box-shadow: 0 6px 18px rgba(0,0,0,0.45);
    white-space: nowrap;
    opacity: 0;
    pointer-events: none;
    transition: opacity 120ms ease;
    z-index: 900;
}

.measure-label:hover .measure-tooltip {
    opacity: 1;
}

.move-measure-root {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 860;
    transform: none !important;
}

.move-measure {
    position: absolute;
    transform: translate(-50%, -100%);
    padding: 6px 10px;
    border-radius: 9px;
    background: rgba(12, 18, 30, 0.92);
    color: #f2f5ff;
    border: 1px solid rgba(255, 255, 255, 0.16);
    font-size: 12px;
    font-weight: 600;
    box-shadow: 0 10px 22px rgba(0, 0, 0, 0.35);
    letter-spacing: 0.2px;
}

.move-measure.final {
    background: linear-gradient(180deg, rgba(241, 195, 118, 0.22), rgba(241, 195, 118, 0.08));
    border-color: rgba(241, 195, 118, 0.6);
    color: #f9e9c7;
}

</style>
