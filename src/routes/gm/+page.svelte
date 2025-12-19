<!-- src/routes/gm/+page.svelte -->
<script>
    import { onMount, onDestroy } from "svelte";

    import MapCanvas from "$lib/vtt/components/MapCanvas.svelte";
    import TokenLayer from "$lib/vtt/components/TokenLayer.svelte";
    import MapUploadModal from "$lib/vtt/components/MapUploadModal.svelte";
    import TokenCreateModal from "$lib/vtt/components/TokenCreateModal.svelte";
    import TokenLibrary from "$lib/vtt/components/TokenLibrary.svelte";
    import MapSelectModal from "$lib/vtt/components/MapSelectModal.svelte";
    import MapSettingsModal from "$lib/vtt/components/MapSettingsModal.svelte";
    import FogCanvas from "$lib/vtt/components/FogCanvas.svelte";
  import WallCanvas from "$lib/vtt/components/WallCanvas.svelte";
  import DoorContextMenu from "$lib/vtt/components/DoorContextMenu.svelte";
  import { updateDoor, setDoorType } from "$lib/vtt/walls/doorMutations.js";
  import { recomputeVision } from "$lib/vtt/vision/controller.js";
  import VisionDebugOverlay from "$lib/vtt/components/VisionDebugOverlay.svelte";
  import PlayerVisionMask from "$lib/vtt/components/PlayerVisionMask.svelte";
  import { bumpDoorAnimVersion } from "$lib/vtt/walls/store.js";
  import { normalizeDoorData, obstructionForState, resolveDoorState } from "$lib/vtt/walls/model.js";




    import GMToolbar from "$lib/vtt/components/GMToolbar.svelte";
    import ToastStack from "$lib/vtt/messages/ToastStack.svelte";

    import { setPanTool } from "$lib/vtt/panzoom/store.js";
    import { get } from "svelte/store";

    import { assignTokenNameForSpawn } from "$lib/vtt/tokens/nameTools.js";
    import { computeTemplateHp } from "$lib/vtt/tokens/hpUtils.js";

    import {
        applyTokenWS,
        tokens,
        upsertToken,
        deleteToken
    } from "$lib/vtt/tokens/store.js";
    import { connectWS, sendWS } from "$lib/ws.js";

    import { maps, currentMap, loadMaps } from "$lib/vtt/map/store.js";
    import { snapToGrid } from "$lib/vtt/utils/placement.js";

    import { inferLabelFromFeet } from "$lib/vtt/tokens/size.js";
    import {
        tokenLibrary,
        addTemplate,
        loadLibraryFromServer
    } from "$lib/vtt/tokens/library.js";

    import "$lib/vtt/styles/gm.css";

    // ----------------------------------------------------
    // SMALL HELPERS
    // ----------------------------------------------------
    function safeImgUrl(u) {
        if (!u) return "";
        // 5eTools / homebrew images sometimes come in with spaces → encode them
        return u.replace(/ /g, "%20");
    }

    let showUpload = false;
    let showTokenCreate = false;
    let showTokenLibrary = false;
    let showMapSelect = false;
    let showMapSettings = false;

    let broadcastMapId = null;
    let showGrid = false;

    let selectedIds = [];
    let fogRef = null;
    let fogMode = null;
    let fogBrush = 160;
    let wallCanvasRef = null;

    let activeTool = "select";
    let incomingMeasure = null;
    let movementMeasure = false;
// -------------------------------
// Door context menu state
// -------------------------------
let doorMenu = {
  open: false,
  doorId: null,
  x: 0,
  y: 0
};
$: menuDoor =
  doorMenu.open
    ? $currentMap?.walls?.find(w => w.id === doorMenu.doorId)
    : null;


    $: if (typeof window !== "undefined") {
        document.body.classList.toggle("measure-mode", activeTool === "measure");
    }

    // ----------------------------------------------------
    // WEBSOCKET + INITIAL LOAD
    // ----------------------------------------------------
    onMount(() => {
        console.log("[GM] onMount");
        loadMaps();
        (async () => {
            await loadLibraryFromServer();
            console.log("[GM] tokenLibrary after loadLibraryFromServer:", get(tokenLibrary));
        })();

        connectWS(msg => {
            if (!msg) return;
if (msg.type === "door-request") {
  const map = get(currentMap);
  if (!map || map.id !== msg.mapId) return;
  const door = map.walls?.find(w => w.id === msg.doorId);
  if (!door || door.kind !== "door") return;

  const state = resolveDoorState(door.door || {});
  if (state === "LOCKED") return;

  const nextOpen = state !== "OPEN";
  const nextState = nextOpen ? "OPEN" : "CLOSED";
  const obstruction = obstructionForState(nextState);
  const wallPatch = {
    move: obstruction,
    sight: obstruction,
    blocksMovement: obstruction !== "NONE",
    blocksVision: obstruction !== "NONE"
  };
  updateDoor(
    door.id,
    {
      state: nextState,
      open: nextOpen,
      openPct: nextOpen ? 100 : 0,
      locked: door.door?.locked ?? false
    },
    wallPatch
  );
  wallCanvasRef?.refreshDoorAnimations?.();
  bumpDoorAnimVersion();
  recomputeVision();
}
if (msg.type === "door-update") {
  currentMap.update(m => {
    if (!m || m.id !== msg.mapId) return m;

    const doorPatch = msg.door || {};

    const next = {
      ...m,
      walls: m.walls.map(w => {
        if (w.id !== msg.doorId) return w;
        const nextDoor = normalizeDoorData(doorPatch, w.door || {});
        const obstruction = obstructionForState(nextDoor.state);
        const autoPatch = {
          move: obstruction,
          sight: obstruction,
          blocksMovement: obstruction !== "NONE",
          blocksVision: obstruction !== "NONE"
        };
        const updated = { ...w, door: nextDoor, ...autoPatch };
        if (msg.wallPatch) Object.assign(updated, msg.wallPatch);
        return updated;
      })
    };

    const persistWalls = next.walls;
    fetch("/api/maps", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...next,
        walls: persistWalls
      })
    }).catch(() => {});

    return next;
  });
  wallCanvasRef?.refreshDoorAnimations?.();
  bumpDoorAnimVersion();
}

if (msg.type === "door-delete") {
  currentMap.update(m => {
    if (!m || m.id !== msg.mapId) return m;

    return {
      ...m,
      walls: m.walls.filter(w => w.id !== msg.doorId)
    };
  });
}


            // Debug WS path
            console.log("[GM] WS message received:", msg?.type, msg);
if (msg.type === "map-set") {
        // 🔒 NEVER let map-set touch tokens
        delete msg.tokens;
    }
            applyTokenWS(msg, { isGM: true });

            if (msg.type === "measure-live" && msg.mapId === $currentMap?.id) {
                incomingMeasure = {
                    start: msg.start,
                    end: msg.end,
                    feet: msg.feet
                };
            }

            if (msg.type === "measure-clear" && msg.mapId === $currentMap?.id) {
                incomingMeasure = null;
            }
        });

        broadcastMapId = $currentMap?.id ?? null;
        console.log("[GM] initial broadcastMapId:", broadcastMapId);
    });

    $: locations = $maps.map(m => m.location).filter(Boolean);

    // ----------------------------------------------------
    // HYDRATE EXISTING TOKENS FROM TEMPLATES (ONE TIME)
    // ----------------------------------------------------
    let hydratedFromTemplates = false;

    function hydrateTokensFromTemplates() {
        const lib = get(tokenLibrary);
        if (!lib.length) {
            console.log("[GM] hydrateTokensFromTemplates: library empty, skipping.");
            return;
        }

        console.log("[GM] hydrateTokensFromTemplates: start. Current tokens:", get(tokens));

        tokens.update(list =>
            list.map(tok => {
                if (!tok.templateId) return tok;

                const tpl = lib.find(t => t.id === tok.templateId);
                if (!tpl) return tok;

                let changed = false;
                const updated = { ...tok };

                // Ensure img is present and safe (encode spaces)
                if (!updated.img && tpl.img) {
                    updated.img = safeImgUrl(tpl.img);
                    changed = true;
                } else if (updated.img && updated.img.includes(" ")) {
                    updated.img = safeImgUrl(updated.img);
                    changed = true;
                }

                // Ensure sizeFeet is present
                if (!updated.sizeFeet && tpl.sizeFeet) {
                    updated.sizeFeet = tpl.sizeFeet;
                    changed = true;
                }

                // Ensure sizeLabel is present (for show-size under label)
                if (!updated.sizeLabel) {
                    const feet = updated.sizeFeet ?? tpl.sizeFeet ?? 5;
                    updated.sizeLabel = inferLabelFromFeet(feet);
                    changed = true;
                }

                if (changed) {
                    console.log("[GM] hydrateTokensFromTemplates: updated token", updated.id, updated);
                }

                return changed ? updated : tok;
            })
        );
    }

    $: if (!hydratedFromTemplates && $tokenLibrary?.length && $tokens?.length) {
        console.log("[GM] running one-time hydrateTokensFromTemplates");
        hydrateTokensFromTemplates();
        hydratedFromTemplates = true;
    }

    // ----------------------------------------------------
    // FOG SYNC
    // ----------------------------------------------------
    function handleFogSync(e) {
        console.log("[GM] handleFogSync for mapId:", e.detail.mapId);
        sendWS({ type: "fogUpdated", mapId: e.detail.mapId });
    }

    $: if (fogRef && $currentMap?.id) {
        console.log("[GM] fogRef + currentMap available, calling fogRef.loadFog()");
        fogRef.loadFog?.();
    }

    // ----------------------------------------------------
    // SHOW MAP TO PLAYER
    // ----------------------------------------------------
    $: gmMapId = $currentMap?.id ?? null;
    $: canShowToPlayer = gmMapId && gmMapId !== broadcastMapId;

    function showToPlayer() {
        const all = get(tokens).filter(t => t.mapId === gmMapId);
        console.log("[GM] showToPlayer → mapId:", gmMapId, "tokens:", all);
        const { tokens: _t, ...mapNoTokens } = $currentMap;

sendWS({
  type: "map-set",
  map: mapNoTokens,
  tokens: all
});

        sendWS({ type: "fogUpdated", mapId: gmMapId });
        broadcastMapId = gmMapId;
    }

    // ----------------------------------------------------
    // BULK TOKEN ACTIONS
    // ----------------------------------------------------
    function renameSelection() {
        if (!selectedIds.length) return;
        const base = prompt("Base name", "Token");
        if (!base) return;

        console.log("[GM] renameSelection for ids:", selectedIds, "base:", base);

        get(tokens)
            .filter(t => selectedIds.includes(t.id))
            .forEach((t, i) => {
                const newName = `${base} ${i + 1}`;
                const updated = { id: t.id, name: newName };
                console.log("[GM] renameSelection → upsertToken:", updated);
                upsertToken(updated);
                sendWS({ type: "token-update", token: updated });
            });
    }

    function toggleSelectionVisibility() {
        const selected = get(tokens).filter(t => selectedIds.includes(t.id));
        if (!selected.length) return;

        const nextState = !selected.every(t => t.hidden);
        console.log("[GM] toggleSelectionVisibility → ids:", selectedIds, "nextState:", nextState);

        selected.forEach(t => {
            const updated = { id: t.id, hidden: nextState };
            upsertToken(updated);
            sendWS({ type: "token-update", token: updated });
        });
    }

    function deleteSelection() {
        if (!selectedIds.length) return;

        const ids = [...selectedIds];
        console.log("[GM] deleteSelection → ids:", ids);

        ids.forEach(id => {
            deleteToken(id);
            sendWS({ type: "token-delete", id });
        });
        selectedIds = [];
    }

    // ------------------------------------------------------------
    // DRAG & DROP — TEMPLATE → INSTANCE
    // ------------------------------------------------------------
    function onDragOverMap(e) {
        if (e.dataTransfer?.types?.includes("application/json")) {
            e.preventDefault();
        }
    }

    async function onDropMap(e) {
        const raw = e.dataTransfer?.getData("application/json");
        console.log("[GM] onDropMap: raw data:", raw);
        if (!raw) return;
        e.preventDefault();

        let payload;
        try {
            payload = JSON.parse(raw);
        } catch (err) {
            console.error("[GM] onDropMap: failed to parse payload:", err);
            return;
        }

        console.log("[GM] onDropMap: parsed payload:", payload);

        const templateId = payload.templateId;
        if (!templateId) {
            console.warn("[GM] onDropMap: missing templateId in payload.");
            return;
        }

        const libraryNow = get(tokenLibrary);
        console.log("[GM] onDropMap: current tokenLibrary:", libraryNow);

        const tpl = libraryNow.find(t => t.id === templateId);
        if (!tpl) {
            console.warn("[GM] Template not found in library:", templateId);
            return;
        }

        console.log("[GM] onDropMap: using template:", tpl);

        // ensure template persisted
        console.log("[GM] onDropMap: calling addTemplate for template:", tpl.id);
        await addTemplate(tpl);

        const map = get(currentMap);
        if (!map?.id) {
            console.warn("[GM] onDropMap: no current map id.");
            return;
        }

        const mapId = map.id;
        const gridPx = map.gridSizePx ?? 64;

        const sizeFeet = tpl.sizeFeet ?? 5;
        const sizePx = (sizeFeet / 5) * gridPx;

        const rect = document
            .querySelector(".map-inner")
            ?.getBoundingClientRect();

        if (!rect) {
            console.warn("[GM] onDropMap: .map-inner rect not found.");
            return;
        }

        const relX = (e.clientX - rect.left) / rect.width;
        const relY = (e.clientY - rect.top) / rect.height;

        const rawX = relX * map.width;
        const rawY = relY * map.height;

        const { x, y } = snapToGrid(map, rawX, rawY, sizePx);

        console.log("[GM] onDropMap: drop coords → raw:", { rawX, rawY }, "snapped:", { x, y });

        // ------------------------------------------------
        // NAMING + SHORTHAND + RE-NUMBERING (SPECIES ONLY)
        // ------------------------------------------------
        const allTokens = get(tokens) || [];
        console.log("[GM] onDropMap: tokens BEFORE drop:", allTokens);

        const libLive = get(tokenLibrary);
        console.log("[GM] onDropMap: tokenLibrary for sibling calc:", libLive);

        const siblings = allTokens.filter(t => {
            if (t.mapId !== mapId) return false;
            if (t.templateId !== tpl.id) return false;

            const tplEntry = libLive.find(x => x.id === t.templateId);

            // EXCLUDE individual templates from sibling numbering
            if (tplEntry?.templateSource === "individual") return false;

            return true;
        });

        console.log("[GM] onDropMap: species siblings for numbering:", siblings);

        const base = tpl.name?.trim() || "Token";
        const { updatedTokens, newName } = assignTokenNameForSpawn(base, siblings);
        const renamed = updatedTokens.filter(u => {
            const original = siblings.find(t => t.id === u.id);
            return original && original.name !== u.name;
        });

        for (const tok of renamed) {
            const updated = { ...tok, name: tok.name };
            await upsertToken(updated);
            sendWS({ type: "token-update", token: updated });
        }

        const hpState = computeTemplateHp({
            ...tpl,
            overrides: tpl.overrides,
            bestiary: tpl.bestiary || tpl.sheet
        });

        const instance = {
            id: crypto.randomUUID(),
            templateId: tpl.id,
            mapId,
            name: newName,
            hidden: true,

            // IMAGE (safe: encode spaces)
            img: safeImgUrl(tpl.img),

            // SIZE FIELDS — **ALL THREE REQUIRED**
            size: sizePx,                  // pixel size
            sizeFeet: sizeFeet,            // 5 / 10 / 15 / etc
            sizeLabel: inferLabelFromFeet(sizeFeet),
            sizeOriginal:
                tpl.sizeLabel ||
                tpl.sizeOriginal ||
                inferLabelFromFeet(sizeFeet),

            // POSITION
            x,
            y,

            currentHp: hpState.currentHp ?? null,
            maxHp: hpState.maxHp ?? null,
            tempHp: hpState.tempHp ?? 0,
            consistentHp: tpl.consistentHp ?? false
        };

        console.log("[GM] onDropMap: creating instance token:", instance);

        upsertToken(instance);
        sendWS({ type: "token-add", token: instance });

        console.log("[GM] onDropMap: tokens AFTER drop:", get(tokens));
    }
function toggleDoorOpen(e) {
  const door = e.detail.door;
  if (!door) return;
  const state = resolveDoorState(door.door || {});
  if (state === "LOCKED") return;

const nextOpen = state !== "OPEN";

updateDoor(
  door.id,
  {
    state: nextOpen ? "OPEN" : "CLOSED",
    open: nextOpen,
    openPct: nextOpen ? 100 : 0,
    locked: false
  }
);
wallCanvasRef?.refreshDoorAnimations?.();
bumpDoorAnimVersion();
recomputeVision();
}


function toggleDoorLocked(e) {
  const door = e.detail.door;
  if (!door) return;
  const state = resolveDoorState(door.door || {});
  if (state === "OPEN") return;

  const nextLocked = !door.door?.locked;

  updateDoor(door.id, {
    locked: nextLocked,
    state: nextLocked ? "LOCKED" : "CLOSED",
    open: false,
    openPct: 0
  });

  rebindDoorMenu(door.id);
  recomputeVision();
}


function toggleDoorHidden(e) {
  const door = e.detail.door;
  if (!door) return;

  updateDoor(door.id, {
    hidden: !door.door.hidden
  });

  rebindDoorMenu(door.id);
  recomputeVision();
}


function changeDoorType(e) {
  const door = e.detail.door;
  const type = e.detail.type;
  if (!door || !type) return;

  setDoorType(door.id, type);

  rebindDoorMenu(door.id);
  recomputeVision();
}

function deleteDoor(e) {
  const door = e.detail.door;
  if (!door) return;

  currentMap.update(m => {
    if (!m) return m;

    return {
      ...m,
      walls: m.walls.filter(w => w.id !== door.id)
    };
  });

  // 🔥 PERSIST TO DISK
  const map = get(currentMap);
  if (map) {
    fetch("/api/maps", {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    ...map,
    walls: map.walls
  })
}).catch(() => {});

  }

  closeDoorMenu();
  recomputeVision();
}




// ----------------------------------
// Door geometry mutations (NEW)
// ----------------------------------
function rebindDoorMenu(doorId) {
  if (!doorMenu.open) return;

  const updated = $currentMap?.walls?.find(w => w.id === doorId);
  if (!updated) return;

  doorMenu = {
    ...doorMenu,
    door: updated
  };
}

function setDoorOpenPct(e) {
  const { door, openPct } = e.detail;
  if (!door || isNaN(openPct)) return;

  const pct = Math.max(0, Math.min(100, openPct));

  updateDoor(
    door.id,
    {
      openPct: pct,
      state: pct > 0 ? "OPEN" : "CLOSED"
    }
  );

  rebindDoorMenu(door.id);
}


function setDoorHinge(e) {
    const { door, hinge } = e.detail;
    if (!door || !hinge) return;

    updateDoor(e.detail.door.id, { hinge: e.detail.hinge });
  rebindDoorMenu(e.detail.door.id);
}

function setDoorSwing(e) {
    const { door, swing } = e.detail;
    if (!door || !swing) return;

     updateDoor(e.detail.door.id, { swing: e.detail.swing });
  rebindDoorMenu(e.detail.door.id);
}

function toggleDoorNoSwing(e) {
    const { door } = e.detail;
    if (!door) return;

    const next = !door.door.noSwing;
    const locked = !!door.door?.locked;
    const fallbackPct = Number.isFinite(door.door?.openPct)
        ? door.door.openPct
        : resolveDoorState(door.door || {}) === "OPEN"
            ? 100
            : 0;
    const nextPct = locked ? 0 : (next ? 100 : fallbackPct);
    const nextState = locked ? "LOCKED" : nextPct > 0 ? "OPEN" : "CLOSED";

    updateDoor(
        door.id,
        {
            noSwing: next,
            openPct: nextPct,
            state: nextState
        }
    );
}


function openDoorMenu(e) {
  doorMenu = {
    open: true,
    doorId: e.detail.door.id,
    x: e.detail.x,
    y: e.detail.y
  };
}



function closeDoorMenu() {
    doorMenu = { open: false, door: null, x: 0, y: 0 };
}


    // ----------------------------------
// Global key bindings (GM only)
// ----------------------------------
function onKey(e) {
    // Ignore typing in inputs
    const tag = e.target?.tagName?.toLowerCase();
    if (
        tag === "input" ||
        tag === "textarea" ||
        e.target?.isContentEditable
    ) {
        return;
    }

    // V = Select tool
    if (e.key === "v" || e.key === "V") {
        activeTool = "select";
        fogMode = null;
        setPanTool(false);
    }
}

onMount(() => {
    if (typeof window !== "undefined") {
        window.addEventListener("keydown", onKey);
    }
});

onDestroy(() => {
    if (typeof window !== "undefined") {
        window.removeEventListener("keydown", onKey);
    }
});
</script>

<div class="gm-layout">
    <GMToolbar
        fogMode={fogMode}
        brushSize={fogBrush}
        gridOn={showGrid}
        canShowToPlayer={canShowToPlayer}
        activeTool={activeTool}
        movementMeasure={movementMeasure}
        on:selectTool={() => {
            activeTool = "select";
            fogMode = null;
            setPanTool(false);
        }}
        on:panTool={() => {
            activeTool = "pan";
            fogMode = null;
            setPanTool(true);
        }}
        on:measureTool={() => {
            activeTool = "measure";
            fogMode = null;
            setPanTool(false);
            incomingMeasure = null;
        }}
        on:toggleMoveMeasure={() => {
            movementMeasure = !movementMeasure;
        }}
        on:fogTool={() => {
            activeTool = activeTool === "fog" ? "select" : "fog";
            fogMode = activeTool === "fog" ? fogMode || "add" : null;
        }}
        on:wallTool={() => {
    activeTool = "wall";
    fogMode = null;
    setPanTool(false);
}}

        on:openTokens={() => (showTokenLibrary = !showTokenLibrary)}
        on:openMaps={() => (showMapSelect = true)}
        on:openMapSettings={() => (showMapSettings = true)}
        on:toggleGrid={() => (showGrid = !showGrid)}
        on:showPlayer={() => showToPlayer()}
        on:modeChange={e => (fogMode = e.detail)}
        on:brushChange={e => (fogBrush = e.detail)}
        on:coverAll={() => fogRef?.coverAll()}
        on:revealAll={() => fogRef?.revealAll()}
    />

    <div
        class="gm-map"
        on:dragover|preventDefault={onDragOverMap}
        on:drop={onDropMap}
    >
       <MapCanvas
  isGM={true}
  showGrid={showGrid}
  measureMode={activeTool === "measure"}
  activeTool={activeTool}
>
  <WallCanvas
    isGM={true}
    mode={activeTool === "wall" ? "wall" : null}
    zIndex={10}
    bind:this={wallCanvasRef}
    on:openDoorMenu={openDoorMenu}
    on:toggleDoorOpen={toggleDoorOpen}
    on:toggleDoorLocked={toggleDoorLocked}
  />

  {#if $currentMap}
    <FogCanvas
      bind:this={fogRef}
      isGM={true}
      mode={fogMode}
      brushSize={fogBrush}
      opacity={0.78}
      zIndex={20}
      on:fogSync={handleFogSync}
    />
    {#if $currentMap.showPlayerVisionToGM ?? true}
      <PlayerVisionMask zIndex={25} enabled={$currentMap.showPlayerVisionToGM ?? true} />
    {/if}
  {/if}

  <div style={`pointer-events: ${activeTool === "wall" || activeTool === "fog" ? "none" : "auto"};`}>
    <TokenLayer
      isGM={true}
      activeTool={activeTool}
      movementMeasure={movementMeasure}
      incomingMeasure={incomingMeasure}
      selectedIds={selectedIds}
      zIndex={40}
      on:selectionChange={e => (selectedIds = e.detail.ids)}
    />
  </div>

  <!-- 👁️ VISION DEBUG OVERLAY -->
  <VisionDebugOverlay slot="vision-debug" isGM={true} zIndex={30} />
</MapCanvas>


    </div>
{#if menuDoor}
  <DoorContextMenu
    door={menuDoor}
    x={doorMenu.x}
    y={doorMenu.y}
    on:close={closeDoorMenu}
    on:deleteDoor={deleteDoor}
    on:toggleHidden={toggleDoorHidden}
    on:changeType={changeDoorType}
    on:setOpenPct={setDoorOpenPct}
    on:setHinge={setDoorHinge}
    on:setSwing={setDoorSwing}
    on:toggleNoSwing={toggleDoorNoSwing}
  />
{/if}




    <ToastStack />

    <MapUploadModal
        open={showUpload}
        onClose={() => (showUpload = false)}
        existingLocations={locations}
    />

    <TokenCreateModal
        open={showTokenCreate}
        onClose={() => (showTokenCreate = false)}
        mapId={$currentMap?.id}
        gridSizePx={$currentMap?.gridSizePx ?? 64}
        mapWidth={$currentMap?.width}
        mapHeight={$currentMap?.height}
    />

    <MapSelectModal
        open={showMapSelect}
        onClose={() => (showMapSelect = false)}
    />

    <MapSettingsModal
        open={showMapSettings}
        map={$currentMap}
        locations={locations}
        on:close={() => (showMapSettings = false)}
    />

    <TokenLibrary
        open={showTokenLibrary}
        onClose={() => (showTokenLibrary = false)}
        onAddCustom={() => {
            showTokenCreate = true;
            showTokenLibrary = false;
        }}
    />
</div>
