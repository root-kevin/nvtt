import { writable } from "svelte/store";

export const tokens = writable([]);

export function addToken(token) {
    tokens.update(list => [...list, token]);
}

export function moveToken(id, x, y) {
    tokens.update(list =>
        list.map(t => (t.id === id ? { ...t, x, y } : t))
    );
}
