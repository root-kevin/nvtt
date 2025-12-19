<script>
  import { createEventDispatcher, onMount, onDestroy } from "svelte";
  import {
    MousePointer, Hand, Cloud, CircleUser, Map, Grid,
    Monitor, Ruler, Plus, Tag, EyeOff, BrickWall,
    SplinePointer, DoorClosed, SlidersHorizontal, Footprints, PanelsTopLeft, Mountain
  } from "@lucide/svelte";

  import {
    wallOpacity,
    snapWallsToGrid,
    wallToolMode,
    wallPreset
  } from "$lib/vtt/walls/store.js";

  import FogToolbar from "$lib/vtt/components/FogToolbar.svelte";
  import { showTokenSizes, toggleAllTokensHidden } from "$lib/vtt/tokens/display.js";

  export let fogMode = null;
  export let brushSize = 160;
  export let gridOn = false;
  export let canShowToPlayer = false;
  export let activeTool = "select";
  export let movementMeasure = false;

  const dispatch = createEventDispatcher();
  const iconSize = 20;
  const wallButtons = [
    { key: "NORMAL", tooltip: "Draw Wall", icon: BrickWall },
    { key: "DOOR", tooltip: "Draw Door", icon: DoorClosed },
    { key: "WINDOW", tooltip: "Draw Window", icon: PanelsTopLeft },
    { key: "TERRAIN", tooltip: "Draw Terrain", icon: Mountain },
    { key: "INVISIBLE", tooltip: "Draw Invisible Wall", icon: EyeOff }
  ];

  let openFlyout = "none"; // none | tokens | fog | walls | maps

  function selectPrimaryTool(tool) {
    openFlyout = "none";
    dispatch(tool);
  }

  function toggleWallTool(e) {
    e?.stopPropagation?.();

    if (activeTool !== "wall") {
      openFlyout = "walls";
      dispatch("wallTool");
    } else {
      openFlyout = openFlyout === "walls" ? "none" : "walls";
    }
  }

  function toggleFogTool(e) {
    e?.stopPropagation?.();

    if (activeTool !== "fog") {
      openFlyout = "fog";
      dispatch("fogTool");
    } else {
      openFlyout = "none";
      dispatch("fogTool");
    }
  }

  function closeClosableFlyouts() {
    openFlyout = "none";
  }

  function openFlyoutExclusive(name) {
    openFlyout = openFlyout === name ? "none" : name;
  }

  // 🔥 HARD RESET when tool changes from outside
  $: if (activeTool !== "wall" && openFlyout === "walls") openFlyout = "none";
  $: if (activeTool !== "fog" && openFlyout === "fog") openFlyout = "none";

  // -----------------------------
  // KEYBINDINGS (V P R F W T M G)
  // -----------------------------
  function isTypingTarget(t) {
    const tag = t?.tagName?.toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || t?.isContentEditable;
  }

  function onKeydown(e) {
    if (isTypingTarget(e.target)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.repeat) return;

    const k = (e.key || "").toLowerCase();

    // IMPORTANT: prevent browser find/scroll weirdness for our bound keys
    const handled = ["v","p","r","f","w","t","m","g"].includes(k);
    if (handled) e.preventDefault();

    if (k === "v") {
      selectPrimaryTool("selectTool");
      return;
    }
    if (k === "p") {
      selectPrimaryTool("panTool");
      return;
    }
    if (k === "r") {
      selectPrimaryTool("measureTool");
      return;
    }
    if (k === "f") {
      // Toggle fog tool like clicking the button
      toggleFogTool();
      return;
    }
    if (k === "w") {
      // Enter/keep wall tool like clicking the button
      if (activeTool !== "wall") {
        openFlyout = "walls";
        dispatch("wallTool");
      } else {
        openFlyout = openFlyout === "walls" ? "none" : "walls";
      }
      return;
    }
    if (k === "t") {
      // Token Browser flyout (does NOT open modal)
      openFlyoutExclusive("tokens");
      return;
    }
    if (k === "m") {
      openFlyoutExclusive("maps");
      return;
    }
    if (k === "g") {
      closeClosableFlyouts();
      dispatch("toggleGrid");
      return;
    }
  }

  onMount(() => {
    if (typeof window !== "undefined") {
      window.addEventListener("keydown", onKeydown, { passive: false });
    }
  });

  onDestroy(() => {
    if (typeof window !== "undefined") {
      window.removeEventListener("keydown", onKeydown);
    }
  });
</script>

<svelte:window
  on:click={(e) => {
    if (activeTool === "wall") return;
    if (activeTool === "fog" && openFlyout === "fog") {
      const target = e?.target;
      if (target?.closest?.(".map-container") || target?.closest?.(".gm-map")) {
        return;
      }
    }
    closeClosableFlyouts();
  }}
/>

<div class="gm-toolbar">
  <div class="main">
    <!-- SELECT -->
    <button
      class={`btn ${activeTool === "select" ? "active" : ""}`}
      data-tooltip="Select (V)"
      on:click={() => selectPrimaryTool("selectTool")}
    >
      <MousePointer size={iconSize} />
    </button>

    <!-- PAN -->
    <button
      class={`btn ${activeTool === "pan" ? "active" : ""}`}
      data-tooltip="Pan (P)"
      on:click={() => selectPrimaryTool("panTool")}
    >
      <Hand size={iconSize} />
    </button>

    <!-- MEASURE -->
    <button
      class={`btn ${activeTool === "measure" ? "active" : ""}`}
      data-tooltip="Ruler (R)"
      on:click={() => selectPrimaryTool("measureTool")}
    >
      <Ruler size={iconSize} />
    </button>

    <!-- MOVE MEASURE -->
    <button
      class={`btn ${movementMeasure ? "active" : ""}`}
      data-tooltip="Movement Measure"
      on:click={() => dispatch("toggleMoveMeasure")}
    >
      <Footprints size={iconSize} />
    </button>

    <!-- FOG -->
    <button
      class={`btn ${(activeTool === "fog" || openFlyout === "fog") ? "active" : ""}`}
      data-tooltip="Fog of War (F)"
      on:click={toggleFogTool}
    >
      <Cloud size={iconSize} />
    </button>

    <!-- WALLS -->
    <button
      class={`btn ${(activeTool === "wall" || openFlyout === "walls") ? "active" : ""}`}
      data-tooltip="Walls (W)"
      on:click={toggleWallTool}
    >
      <BrickWall size={iconSize} />
    </button>

    <!-- TOKENS -->
    <button
      class={`btn ${openFlyout === "tokens" ? "active" : ""}`}
      data-tooltip="Token Browser (T)"
      on:click={(e) => {
        e.stopPropagation();
        openFlyoutExclusive("tokens");
      }}
    >
      <CircleUser size={iconSize} />
    </button>

    <!-- MAPS -->
    <button
      class={`btn ${openFlyout === "maps" ? "active" : ""}`}
      data-tooltip="Maps (M)"
      on:click={(e) => {
        e.stopPropagation();
        openFlyoutExclusive("maps");
      }}
    >
      <Map size={iconSize} />
    </button>

    <!-- GRID -->
    <button
      class={`btn ${gridOn ? "active" : ""}`}
      data-tooltip="Show / Hide Grid (G)"
      on:click={() => {
        closeClosableFlyouts();
        dispatch("toggleGrid");
      }}
    >
      <Grid size={iconSize} />
    </button>

    <!-- SHOW TO PLAYER -->
    <button
      class="btn"
      data-tooltip="Show Map to Player"
      disabled={!canShowToPlayer}
      on:click={() => {
        closeClosableFlyouts();
        dispatch("showPlayer");
      }}
    >
      <Monitor size={iconSize} />
    </button>

  </div>

  <!-- TOKEN FLYOUT -->
  {#if openFlyout === "tokens"}
    <div class="token-flyout" on:click|stopPropagation>
      <button class="btn" data-tooltip="Add Token" on:click={() => dispatch("openTokens")}>
        <Plus size={iconSize} />
      </button>

      <button
        class="btn"
        data-tooltip={$showTokenSizes ? "Hide Sizes" : "Show Sizes"}
        on:click={() => showTokenSizes.update(v => !v)}
      >
        <Tag size={iconSize} />
      </button>

      <button
        class="btn"
        data-tooltip="Hide / Reveal All Tokens"
        on:click={() => toggleAllTokensHidden(true)}
      >
        <EyeOff size={iconSize} />
      </button>
    </div>
  {/if}

  <!-- MAPS FLYOUT -->
  {#if openFlyout === "maps"}
    <div class="map-flyout" on:click|stopPropagation>
      <button
        class="btn"
        data-tooltip="Map Browser"
        on:click={() => {
          openFlyout = "none";
          dispatch("openMaps");
        }}
      >
        <Map size={iconSize} />
      </button>

      <button
        class="btn"
        data-tooltip="Map Settings"
        on:click={() => {
          openFlyout = "none";
          dispatch("openMapSettings");
        }}
      >
        <SlidersHorizontal size={iconSize} />
      </button>
    </div>
  {/if}

  <!-- FOG FLYOUT -->
  {#if openFlyout === "fog"}
    <div class="fog-flyout" on:click|stopPropagation>
      <FogToolbar
        fogMode={fogMode}
        brushSize={brushSize}
        on:modeChange={(e) => dispatch("modeChange", e.detail)}
        on:brushChange={(e) => dispatch("brushChange", e.detail)}
        on:coverAll={() => dispatch("coverAll")}
        on:revealAll={() => dispatch("revealAll")}
      />
    </div>
  {/if}

  <!-- WALL FLYOUT -->
  {#if openFlyout === "walls"}
    <div class="wall-flyout" on:click|stopPropagation>
      <button
        class={`btn ${$wallToolMode === "draw" ? "active" : ""}`}
        data-tooltip="Build Wall"
        on:click={() => wallToolMode.set("draw")}
      >
        <SplinePointer size={iconSize} />
      </button>

      <button
        class={`btn ${$snapWallsToGrid ? "active" : ""}`}
        data-tooltip="Snap to Grid"
        on:click={() => snapWallsToGrid.update(v => !v)}
      >
        <Grid size={iconSize} />
      </button>
      <div class="wall-type-buttons">
        {#each wallButtons as opt}
          <button
            class={`btn ${$wallPreset === opt.key && $wallToolMode !== "delete" ? "active" : ""}`}
            data-tooltip={opt.tooltip}
            on:click={() => {
              wallToolMode.set("draw");
              wallPreset.set(opt.key);
            }}
          >
            <svelte:component this={opt.icon} size={iconSize} />
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>

<div class="opacity-row">
  <input type="range" min="0.1" max="1" step="0.05" bind:value={$wallOpacity} />
</div>

<style>
  .gm-toolbar {
    position: absolute;
    left: 12px;
    top: 12px;
    display: flex;
    gap: 10px;
    align-items: flex-start;
    z-index: 250;
    pointer-events: none;
  }

  .main {
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: rgba(10, 20, 32, 0.9);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    padding: 8px;
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.35);
    pointer-events: auto;
  }

  .btn {
    width: 44px;
    height: 44px;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(30, 42, 58, 0.9);
    color: #e7f0ff;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: transform 0.1s ease, background 0.1s ease;
    position: relative; /* needed for tooltip */
  }

  .btn.active {
    background: #e85537;
    border-color: #ff9a7f;
    color: #fff;
  }

  /* -------------------------
     TOOLTIP (uses data-tooltip)
  ------------------------- */
  .btn[data-tooltip]:hover::after {
    content: attr(data-tooltip);
    position: absolute;
    left: calc(100% + 10px);
    top: 50%;
    transform: translateY(-50%);
    white-space: nowrap;
    padding: 6px 8px;
    border-radius: 8px;
    background: rgba(10, 20, 32, 0.96);
    border: 1px solid rgba(255,255,255,0.10);
    color: #e7f0ff;
    font-size: 12px;
    line-height: 1;
    z-index: 9999;
    pointer-events: none;
    box-shadow: 0 8px 20px rgba(0,0,0,0.35);
  }

  .btn[data-tooltip]:hover::before {
    content: "";
    position: absolute;
    left: calc(100% + 2px);
    top: 50%;
    transform: translateY(-50%);
    border-width: 6px;
    border-style: solid;
    border-color: transparent rgba(10, 20, 32, 0.96) transparent transparent;
    z-index: 9999;
    pointer-events: none;
  }

  .token-flyout,
  .wall-flyout,
  .map-flyout {
    position: absolute;
    left: 62px;
    top: 0;
    background: rgba(10, 20, 32, 0.92);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 10px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    pointer-events: auto;
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.35);
  }

  .opacity-row {
    padding: 4px 6px;
  }

  .opacity-row input {
    width: 100%;
  }

  .wall-type-buttons {
    display: flex;
    gap: 6px;
    padding: 2px 0 0;
    flex-wrap: wrap;
  }
</style>
