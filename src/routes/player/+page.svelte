<script>
    import { onMount } from "svelte";

    import MapCanvas from "$lib/vtt/components/MapCanvas.svelte";
    import TokenLayer from "$lib/vtt/components/TokenLayer.svelte";
    import FogCanvas from "$lib/vtt/components/FogCanvas.svelte";
    import ToastStack from "$lib/vtt/messages/ToastStack.svelte";

    import { applyTokenWS, tokens } from "$lib/vtt/tokens/store.js";
    import { connectWS, sendWS } from "$lib/ws.js";
    import { upsertMap, setCurrentMap, loadMaps, currentMap } from "$lib/vtt/map/store.js";

    import { tokenLibrary, loadLibraryFromServer } from "$lib/vtt/tokens/library.js";
    import { inferLabelFromFeet } from "$lib/vtt/tokens/size.js";
    import { recomputeVision } from "$lib/vtt/vision/controller.js";

    import WallCanvas from "$lib/vtt/components/WallCanvas.svelte";
    import PlayerDoorOverlay from "$lib/vtt/components/PlayerDoorOverlay.svelte";
    import { bumpDoorAnimVersion } from "$lib/vtt/walls/store.js";
    import PlayerVisionMask from "$lib/vtt/components/PlayerVisionMask.svelte";
    import { normalizeDoorData, obstructionForState } from "$lib/vtt/walls/model.js";

    import { get } from "svelte/store";
    import { globalMessageController } from "$lib/vtt/messages/controller.ts";
    import { Footprints, LocateFixed } from "@lucide/svelte";

    import "$lib/vtt/styles/player.css";

    let fogRef = null;
    let incomingMeasure = null;
    let movementMeasure = false;
    let cameraFollow = false;
    let wallCanvasRef = null;
    let attemptedLockedDoors = new Set();

    /* ---------------------------------------------
       TOKEN HYDRATION
    --------------------------------------------- */
    function hydratePlayerTokens() {
        const lib = get(tokenLibrary);
        const map = get(currentMap);
        const grid = map?.gridSizePx ?? 64;

        tokens.update(list =>
            list.map(tok => {
                if (!tok.templateId) return tok;

                const tpl = lib.find(t => t.id === tok.templateId);
                if (!tpl) return tok;

                let changed = false;
                const updated = { ...tok };

                // image
                if (!updated.img && tpl.img) {
                    updated.img = tpl.img;
                    changed = true;
                }

                // sizeFeet
                if (!updated.sizeFeet && tpl.sizeFeet) {
                    updated.sizeFeet = tpl.sizeFeet;
                    changed = true;
                }

                // pixel size
                if (!updated.size && updated.sizeFeet) {
                    updated.size = (updated.sizeFeet / 5) * grid;
                    changed = true;
                }

                // label
                if (!updated.sizeLabel) {
                    updated.sizeLabel = inferLabelFromFeet(
                        updated.sizeFeet ?? tpl.sizeFeet ?? 5
                    );
                    changed = true;
                }

                return changed ? updated : tok;
            })
        );
    }

    /* ---------------------------------------------
       WEBSOCKET + INITIAL LOAD
    --------------------------------------------- */
    onMount(async () => {
        await loadLibraryFromServer();

        loadMaps();

        connectWS((msg) => {
            if (!msg) return;

            const mapId = get(currentMap)?.id;

            applyTokenWS(msg, { isGM: false });

            if (msg.type === "measure-live" && msg.mapId === mapId) {
                incomingMeasure = { start: msg.start, end: msg.end, feet: msg.feet };
            }

            if (msg.type === "measure-clear" && msg.mapId === mapId) {
                incomingMeasure = null;
            }

            if (msg.type === "door-update") {
                currentMap.update(m => {
                    if (!m || m.id !== msg.mapId) return m;
                    return {
                        ...m,
                        walls: (m.walls || []).map(w => {
                            if (w.id !== msg.doorId) return w;
                            const nextDoor = normalizeDoorData(msg.door || {}, w.door || {});
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
                });
                recomputeVision();
                wallCanvasRef?.refreshDoorAnimations?.();
                bumpDoorAnimVersion();
            }

            // GM pushes new map + tokens
            if (msg.type === "map-set" && msg.map) {
                upsertMap(msg.map);
                setCurrentMap(msg.map);
                fogRef?.loadFog?.();
            }

            if (msg.type === "fogUpdated" && msg.mapId === mapId) {
                fogRef?.loadFog?.();
            }

            if (msg.type === "gmMessage") {
                globalMessageController.handle(msg);
            }
        });
    });

    // Rehydrate when library or tokens change
    $: if ($tokenLibrary.length && $tokens.length) {
        hydratePlayerTokens();
    }

    function requestDoorToggle(e) {
        const door = e?.detail?.door;
        const mapId = $currentMap?.id;
        if (!door || !mapId) return;
        sendWS({
            type: "door-request",
            mapId,
            doorId: door.id,
            action: "toggle"
        });
    }

    function handleOverlayDoorRequest(e) {
        const doorId = e?.detail?.doorId;
        const door = ($currentMap?.walls || []).find((w) => w.id === doorId);
        if (!door) return;
        requestDoorToggle({ detail: { door } });
    }

    function handleLockedAttempt(e) {
        const doorId = e?.detail?.doorId;
        if (!doorId) return;
        attemptedLockedDoors = new Set(attemptedLockedDoors).add(doorId);
        wallCanvasRef?.shakeDoor?.(doorId);
    }
</script>


<!-- ---------------------------------------------
     PLAYER VIEW LAYOUT
---------------------------------------------- -->

<div class="player-page">
    <div class="player-tools">
        <button
            class={`player-tool-btn ${movementMeasure ? "active" : ""}`}
            title="Snap Move"
            on:click={() => (movementMeasure = !movementMeasure)}
        >
            <Footprints size={18} />
            <span>Snap Move</span>
        </button>
        <button
            class={`player-tool-btn ${cameraFollow ? "active" : ""}`}
            title="Camera Follow"
            on:click={() => (cameraFollow = !cameraFollow)}
        >
            <LocateFixed size={18} />
            <span>Camera Follow</span>
        </button>
    </div>

    <MapCanvas>
        <!-- Player walls -->
        <WallCanvas
            bind:this={wallCanvasRef}
            isGM={false}
            mode={null}
            zIndex={10}
            attemptedLockedDoors={attemptedLockedDoors}
            on:doorRequest={handleOverlayDoorRequest}
            on:lockedAttempt={handleLockedAttempt}
        />

        <!-- Read-only token layer -->
        <TokenLayer
            isGM={false}
            incomingMeasure={incomingMeasure}
            movementMeasure={movementMeasure}
            cameraFollow={cameraFollow}
            zIndex={20}
        />

        {#if $currentMap?.showPlayerVisionToGM ?? true}
            <PlayerVisionMask zIndex={25} enabled={$currentMap?.showPlayerVisionToGM ?? true} />
        {/if}

        <PlayerDoorOverlay
            zIndex={35}
            attemptedLockedDoors={attemptedLockedDoors}
            on:doorRequest={handleOverlayDoorRequest}
            on:lockedAttempt={handleLockedAttempt}
        />

        <!-- Player fog -->
        <FogCanvas
            bind:this={fogRef}
            isGM={false}
            opacity={1}
            zIndex={40}
        />
    </MapCanvas>

    <ToastStack />
</div>
