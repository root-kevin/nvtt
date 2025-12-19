// Shared HP utilities for tokens (map-local only).
import { get } from "svelte/store";
import { tokens } from "$lib/vtt/tokens/store.js";

const groupId = (token) => token?.sharedHpGroupId || null;

// On creation: if joining a shared group, copy HP from the first member.
export function applySharedHPOnCreate(token) {
    if (!token?.sharedHpGroupId) return token;
    const all = get(tokens) || [];
    const seed = all.find((t) => t.sharedHpGroupId === token.sharedHpGroupId);
    if (!seed) return token;
    return {
        ...token,
        currentHp: seed.currentHp,
        maxHp: seed.maxHp,
        tempHp: seed.tempHp
    };
}

// On update: propagate HP fields to all members of the shared group locally.
export function syncSharedHPOnUpdate(token, list = null) {
    if (!token?.sharedHpGroupId) return list || token;
    const source = Array.isArray(list) ? list : get(tokens) || [];
    const hpPatch = {
        currentHp: token.currentHp,
        maxHp: token.maxHp,
        tempHp: token.tempHp
    };

    const next = source.map((t) =>
        groupId(t) === token.sharedHpGroupId
            ? { ...t, ...hpPatch }
            : t
    );

    if (!Array.isArray(list)) {
        tokens.set(next);
        return token;
    }

    return next;
}

// No external shared state; return null.
export function getSharedForToken() {
    return null;
}
