<script>
    import { messageQueue } from "./controller.ts";
    import { derived } from "svelte/store";
    import { onDestroy } from "svelte";

    const AUTO_DISMISS = 4000;

    const messages = derived(messageQueue, ($q) => $q);

    let timers = new Map();

    function dismiss(id) {
        messageQueue.update((q) => q.filter((m) => m.id !== id));
        if (timers.has(id)) {
            clearTimeout(timers.get(id));
            timers.delete(id);
        }
    }

    $: {
        messages.subscribe(($msgs) => {
            $msgs.forEach((m) => {
                if (!timers.has(m.id)) {
                    const t = setTimeout(() => dismiss(m.id), AUTO_DISMISS);
                    timers.set(m.id, t);
                }
            });
        });
    }

    onDestroy(() => {
        timers.forEach((t) => clearTimeout(t));
        timers.clear();
    });
</script>

<div class="toast-stack">
    {#each $messages as m (m.id)}
        <div class="toast">
            <span>{m.text}</span>
            <button class="toast-close" on:click={() => dismiss(m.id)} aria-label="Close toast">
                ✕
            </button>
        </div>
    {/each}
</div>

<style>
.toast-stack {
    position: fixed;
    bottom: 16px;
    right: 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 1200;
    pointer-events: none;
}
.toast {
    pointer-events: auto;
    background: rgba(0, 0, 0, 0.75);
    color: #fff;
    padding: 10px 14px;
    border-radius: 8px;
    font-size: 13px;
    display: flex;
    gap: 8px;
    align-items: center;
    box-shadow: 0 8px 20px rgba(0,0,0,0.35);
    border: 1px solid rgba(255,255,255,0.12);
}
.toast-close {
    background: transparent;
    color: #fff;
    border: none;
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
}
</style>
