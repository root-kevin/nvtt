import { writable, get } from "svelte/store";

const STORAGE_KEY = "vtt-custom-library";

function clone(obj) {
    try {
        return structuredClone(obj);
    } catch {
        return JSON.parse(JSON.stringify(obj));
    }
}

function readFromStorage() {
    try {
        const raw = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
        return raw ? JSON.parse(raw) : {};
    } catch (err) {
        console.warn("customLibrary load failed", err);
        return {};
    }
}

const initialState = readFromStorage();
export const customLibraryStore = writable(initialState);

function persist(obj) {
    try {
        if (typeof localStorage === "undefined") return;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch (err) {
        console.warn("customLibrary persist failed", err);
    }
}

export function loadCustomLibrary() {
    customLibraryStore.set(readFromStorage());
}

function genId(baseTemplateId) {
    const suffix = Math.random().toString(16).slice(2, 8);
    return `custom-${baseTemplateId || "template"}-${suffix}`;
}

export function saveCustomCreature({ baseTemplateId, templateId, name, overrides = {}, consistentHp = false, customized = false }) {
    const now = new Date().toISOString();
    const id = templateId?.startsWith("custom-") ? templateId : genId(baseTemplateId);
    const cleanOverrides = clone(overrides);
    if (cleanOverrides.hp) {
        cleanOverrides.hp.baseMaxHp =
            cleanOverrides.hp.baseMaxHp ??
            cleanOverrides.hp.maxHp ??
            cleanOverrides.hp.hp;
        if (consistentHp) {
            cleanOverrides.hp.currentHp = cleanOverrides.hp.currentHp ?? cleanOverrides.hp.baseMaxHp;
            cleanOverrides.hp.tempHp = cleanOverrides.hp.tempHp ?? 0;
        } else {
            cleanOverrides.hp = { baseMaxHp: cleanOverrides.hp.baseMaxHp };
        }
    }

    customLibraryStore.update((map) => {
        const existing = map[id] || {};
        const next = {
            id,
            baseTemplateId: baseTemplateId || existing.baseTemplateId || templateId,
            name: name || existing.name || "Custom Creature",
            overrides: cleanOverrides || {},
            consistentHp,
            createdAt: existing.createdAt || now,
            updatedAt: now,
            customized: customized ?? existing.customized ?? false
        };
        const updated = { ...map, [id]: next };
        persist(updated);
        return updated;
    });
    return id;
}

export function updateCustomCreature(id, partial = {}) {
    if (!id) return null;
    let saved = null;
    customLibraryStore.update((map) => {
        const existing = map[id];
        if (!existing) return map;
        const nextOverrides = clone({
            ...(existing.overrides || {}),
            ...(partial.overrides || {})
        });
        const consistentHp = partial.consistentHp ?? existing.consistentHp ?? false;
        if (nextOverrides.hp) {
            nextOverrides.hp.baseMaxHp =
                nextOverrides.hp.baseMaxHp ??
                nextOverrides.hp.maxHp ??
                nextOverrides.hp.hp;
            if (consistentHp) {
                nextOverrides.hp.currentHp = nextOverrides.hp.currentHp ?? nextOverrides.hp.baseMaxHp;
                nextOverrides.hp.tempHp = nextOverrides.hp.tempHp ?? 0;
            } else {
                nextOverrides.hp = { baseMaxHp: nextOverrides.hp.baseMaxHp };
            }
        }
        saved = {
            ...existing,
            ...partial,
            consistentHp,
            overrides: nextOverrides,
            updatedAt: new Date().toISOString(),
            customized: partial.customized ?? existing.customized ?? false
        };
        const next = { ...map, [id]: saved };
        persist(next);
        return next;
    });
    return saved;
}

export function getCustomCreature(id) {
    const map = get(customLibraryStore);
    return map[id] || null;
}

export function findCustomByBaseTemplate(baseTemplateId) {
    const map = get(customLibraryStore);
    return Object.values(map).find((c) => c.baseTemplateId === baseTemplateId) || null;
}
