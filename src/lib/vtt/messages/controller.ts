import { writable } from "svelte/store";

export const messageQueue = writable([]);

export function sendMessage(text) {
    messageQueue.update((q) => [...q, { id: crypto.randomUUID(), text }]);
}

export const globalMessageController = {
    handle(msg) {
        if (msg?.messageType === "toast" && msg?.text) {
            sendMessage(msg.text);
        }
    }
};
