import { mod, computeAbilityMods } from "./computeModifiers.js";

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];

function toNumber(val) {
    if (typeof val === "number") return val;
    const parsed = parseInt(val, 10);
    return Number.isFinite(parsed) ? parsed : null;
}

function collectModifiers(raw) {
    const list = [];
    function walk(node) {
        if (!node) return;
        if (Array.isArray(node)) {
            node.forEach(walk);
            return;
        }
        if (typeof node !== "object") return;
        if (node.type && node.subType) list.push(node);
        for (const val of Object.values(node)) walk(val);
    }
    walk(raw?.modifiers);
    return list;
}

function proficiencyBonus(raw) {
    if (typeof raw?.profBonus === "number") return raw.profBonus;
    if (typeof raw?.proficiencyBonus === "number") return raw.proficiencyBonus;
    const level = Array.isArray(raw?.classes)
        ? raw.classes.reduce((sum, cls) => sum + (cls?.level || 0), 0)
        : null;
    if (!level) return 2;
    return 2 + Math.floor((Math.max(level, 1) - 1) / 4);
}

function resolveSaveProficiency(raw) {
    const mods = collectModifiers(raw);
    const prof = new Map();
    for (const m of mods) {
        const type = (m.type || "").toLowerCase();
        const sub = (m.subType || "").toLowerCase();
        const rank = type.includes("expertise") ? 2 : type.includes("proficiency") ? 1 : 0;
        if (!rank) continue;
        if (sub.startsWith("saving-throw-")) {
            const ability = sub.replace("saving-throw-", "");
            prof.set(ability, Math.max(prof.get(ability) || 0, rank));
        }
    }
    return prof;
}

export function computeSaves(raw, abilities, { isPlayer = false } = {}) {
    const abilityMods = computeAbilityMods(abilities);
    const out = {};
    const diff = {};

    const overrides = raw?.save || {};
    const pb = isPlayer ? proficiencyBonus(raw) : 0;
    const saveProf = isPlayer ? resolveSaveProficiency(raw) : new Map();

    for (const ability of ABILITIES) {
        const overrideVal = overrides[ability];
        const parsedOverride = overrideVal != null ? toNumber(overrideVal) : null;
        const base = (abilityMods[ability] ?? mod(abilities[ability])) + (isPlayer ? pb * (saveProf.get(ability) || 0) : 0);

        if (parsedOverride != null && !isPlayer) {
            diff[ability] = parsedOverride - base;
            out[ability] = parsedOverride;
        } else {
            out[ability] = base + (parsedOverride != null && isPlayer ? parsedOverride - base : 0);
        }
    }

    return { saves: out, saveOverrideDiff: diff, proficiencyBonus: pb };
}

export function applySaveOverrides(newAbilities, raw, prevDiff, { isPlayer = false } = {}) {
    const abilityMods = computeAbilityMods(newAbilities);
    const pb = isPlayer ? proficiencyBonus(raw) : 0;
    const saveProf = isPlayer ? resolveSaveProficiency(raw) : new Map();
    const saves = {};

    for (const ability of ABILITIES) {
        const base = (abilityMods[ability] ?? mod(newAbilities[ability])) + (isPlayer ? pb * (saveProf.get(ability) || 0) : 0);
        const delta = prevDiff?.[ability] || 0;
        saves[ability] = base + delta;
    }

    return saves;
}
