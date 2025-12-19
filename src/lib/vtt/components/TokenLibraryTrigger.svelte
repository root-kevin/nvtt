<script>
    import { createEventDispatcher } from "svelte";
    const dispatch = createEventDispatcher();

    export let open = false;
    export let onAddCustom = () => {};
</script>

<div class="trigger">
    <button class="secondary" on:click={() => dispatch("open")}>
        Token Library
    </button>
</div>

<style>
.trigger {
    display: flex;
    flex-direction: column;
}
.secondary {
    padding: 8px 12px;
    background: #2c3a4d;
    border: 1px solid #41526b;
    color: #e9f0ff;
    border-radius: 8px;
    cursor: pointer;
}
</style>
