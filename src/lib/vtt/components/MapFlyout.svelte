<script>
  import { createEventDispatcher } from "svelte";
  const dispatch = createEventDispatcher();
</script>

<div class="flyout">
  <button on:click={() => dispatch("openBrowser")}>Map Browser</button>
  <button on:click={() => dispatch("openSettings")}>Map Settings</button>
</div>

<style>
.flyout {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
}
</style>
