<script>
    import { onMount, onDestroy } from "svelte";
    import MapCanvas from "$lib/vtt/components/MapCanvas.svelte";
    import FogCanvas from "$lib/vtt/components/FogCanvas.svelte";
    import TokenLayer from "$lib/vtt/components/TokenLayer.svelte";
    import ToastStack from "$lib/vtt/messages/ToastStack.svelte";
    import SessionLog from "$lib/vtt/messages/SessionLog.svelte";

    import { connectWS } from "$lib/ws.js";
    import { applyTokenWS, setTokens } from "$lib/vtt/tokens/store.js";
    import {
        maps,
        upsertMap,
        setCurrentMap,
        loadMaps,
        currentMap
    } from "$lib/vtt/map/store.js";

    import { get } from "svelte/store";
    import { globalMessageController } from "$lib/vtt/messages/controller.ts";

    export let mode = "player"; // gm | player
    export let showGrid = false;
    export let fogMode = null;
    export let brushSize = 160;
    export let activeTool = "select";

    const isGM = mode === "gm";
    let fogRef = null;
    let incomingMeasure = null;
    let sessionLogOpen = false;

    function handleWS(msg) {
        if (!msg) return;

        // ---- TOKEN EVENTS ----
        applyTokenWS(msg, { isGM });

        if (msg.type === "map-set" && msg.map) {
            upsertMap(msg.map);
            setCurrentMap(msg.map);
        }

        if (msg.type === "tokensUpdate" && msg.mapId && Array.isArray(msg.tokens)) {
            const cm = get(currentMap);
            if (cm && cm.id === msg.mapId) {
                setTokens(msg.tokens);
            }
        }

        // ---- FILE-BASED FOG ----
        // GM broadcasts:  { type: "fogUpdated", mapId }
        if (msg.type === "fogUpdated" && msg.mapId) {
            const cm = get(currentMap);
            if (cm && cm.id === msg.mapId) {
                console.log("[Fog] WS fogUpdated → reload fog PNG");
                fogRef?.loadFogFromFile?.();   // triggers reload from /fog/<mapId>.png
            }
        }

        // ---- MEASURE MESSAGES ----
        if (msg.type === "gmMessage" && msg.messageType === "vttMessage" && msg.message) {
            globalMessageController.handle(msg.message);

            const p = msg.message.payload;
            if (p?.start && p?.end && msg.message?.category === "measure") {
                incomingMeasure = { start: p.start, end: p.end, feet: p.feet };
            }
        }

        if (msg.type === "gmMessage" && msg.messageType === "measureUpdate" && msg.payload) {
            incomingMeasure = {
                start: msg.payload.start,
                end: msg.payload.current,
                feet: msg.payload.feet
            };
        }

        if (msg.type === "gmMessage" && msg.messageType === "measureFinal" && msg.message) {
            const p = msg.message.payload;
            if (p?.start && p?.end) {
                incomingMeasure = { start: p.start, end: p.end, feet: p.feet };
            }
            globalMessageController.handle(msg.message);
        }
    }

    onMount(() => {
        loadMaps();
        connectWS(handleWS);
    });

    onDestroy(() => {
        if (typeof document !== "undefined") {
            document.body.classList.remove("measure-mode");
        }
    });

    $: {
        if (typeof document !== "undefined") {
            document.body.classList.toggle("measure-mode", activeTool === "measure");
        }
    }
</script>

<div class="vtt-layout">
    <button class="log-toggle" on:click={() => (sessionLogOpen = !sessionLogOpen)}>
        Log
    </button>

    <MapCanvas isGM={isGM} showGrid={showGrid} measureMode={activeTool === "measure"}>
        {#if $currentMap}
            <FogCanvas
                bind:this={fogRef}
                isGM={isGM}
                mode={fogMode}
                brushSize={brushSize}
                opacity={isGM ? 0.78 : 1}
                zIndex={20}
            />
        {/if}

        <TokenLayer
            isGM={isGM}
            activeTool={activeTool}
            incomingMeasure={incomingMeasure}
        />
    </MapCanvas>

    <ToastStack />
    <SessionLog mode={mode} open={sessionLogOpen} />
</div>

<style>
.vtt-layout {
    position: relative;
    width: 100%;
    height: 100%;
}

.log-toggle {
    position: fixed;
    top: 12px;
    right: 12px;
    z-index: 1300;
    background: #323236;
    color: #fff;
    border: 1px solid rgba(255,255,255,0.18);
    border-radius: 8px;
    padding: 6px 10px;
    cursor: pointer;
    box-shadow: 0 8px 18px rgba(0,0,0,0.4);
}
.log-toggle:hover {
    background: rgba(255,255,255,0.08);
    border-color: rgba(255,255,255,0.28);
}
</style>
