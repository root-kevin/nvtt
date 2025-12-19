<script>
  import { createEventDispatcher } from "svelte";
  import { X, Save, Undo2 } from "@lucide/svelte";

  export let open = false;
  export let title = "";
  export let dirty = false;
  export let width = 540;

  const dispatch = createEventDispatcher();

  function handleCancel() {
    dispatch("cancel");
  }

  function handleSave() {
    dispatch("save");
  }
</script>

{#if open}
  <div class="modal-backdrop" on:click={handleCancel}>
    <div
      class="modal-frame"
      style={`width:${width}px;`}
      on:click|stopPropagation
    >
      <div class="modal-header">
        <div class="title-row">
          <span class="title">{title}</span>
          <span class="subtitle"><slot name="subtitle" /></span>
        </div>

        <div class="header-buttons">
          {#if dirty}
            <button class="icon-btn save-btn" on:click={handleSave} aria-label="Save Changes">
              <Save size={16} stroke-width="2" />
            </button>

            <button class="icon-btn cancel-btn" on:click={handleCancel} aria-label="Cancel Changes">
              <Undo2 size={16} stroke-width="2" />
            </button>
          {/if}

          <button class="icon-btn close-btn" on:click={handleCancel} aria-label="Close">
            <X size={16} stroke-width="2" />
          </button>
        </div>
      </div>

      <div class="modal-body">
        <slot />
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 80;
  }

  .modal-frame {
    max-width: calc(100vw - 24px);
    max-height: calc(100vh - 24px);
    background: radial-gradient(circle at top, #181c25 0, #0b0f18 55%);
    color: #f7f9fc;
    border: 1px solid #3a4252;
    border-radius: 14px;
    box-shadow: 0 18px 48px rgba(0,0,0,0.7);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    font-family: system-ui, -apple-system, BlinkMacSystemFont, "Inter", sans-serif;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    background: linear-gradient(to right, #151924, #1e2330);
    border-bottom: 1px solid #2b3240;
    user-select: none;
    height: 48px;
  }

  .title-row {
    display: flex;
    flex-direction: column;
    line-height: 1.1;
  }

  .title {
    font-weight: 800;
    letter-spacing: 0.03em;
    font-size: 0.92rem;
    text-transform: uppercase;
  }

  .subtitle {
    font-size: 0.78rem;
    color: #aab4c8;
    margin-top: 1px;
  }

  .header-buttons {
    display: flex;
    align-items: center;
    gap: 6px;
    pointer-events: auto;
  }

  .icon-btn {
    width: 26px;
    height: 26px;
    border-radius: 6px;
    border: 1px solid #444b57;
    background: #20252f;
    color: #f7f9fc;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 0;
    transition: 120ms ease;
  }

  .icon-btn:hover {
    background: #2d3441;
    border-color: #566074;
  }

  .icon-btn:active {
    transform: scale(0.92);
  }

  .save-btn:hover {
    background: #3c3520;
    border-color: #d1c184;
    color: #d8c892;
  }

  .cancel-btn:hover {
    background: #3a2022;
    border-color: #c57b7b;
    color: #f29b9b;
  }

  .close-btn:hover {
    background: #31262a;
    border-color: #b36b6b;
    color: #f5b1b1;
  }

  .modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 14px;
    background: radial-gradient(
      circle at top left,
      rgba(255,255,255,0.02),
      rgba(0,0,0,0.65)
    );
  }
</style>
