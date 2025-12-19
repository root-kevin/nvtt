import { mod, computeAbilityMods } from "./computeModifiers.js";

export const SKILL_ABILITY = {
    "acrobatics": "dex",
    "sleight of hand": "dex",
    "stealth": "dex",
    "athletics": "str",
    "arcana": "int",
    "history": "int",
    "investigation": "int",
    "nature": "int",
    "religion": "int",
    "animal handling": "wis",
    "insight": "wis",
    "medicine": "wis",
    "perception": "wis",
    "survival": "wis",
    "deception": "cha",
    "intimidation": "cha",
    "performance": "cha",
    "persuasion": "cha"
};

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

function resolveSkillProficiency(raw) {
    const mods = collectModifiers(raw);
    const prof = new Map();
    for (const m of mods) {
        const type = (m.type || "").toLowerCase();
        const sub = (m.subType || "").toLowerCase();
        const rank = type.includes("expertise") ? 2 : type.includes("proficiency") ? 1 : 0;
        if (!rank) continue;
        const match = Object.keys(SKILL_ABILITY).find((k) => sub === k || sub.includes(k));
        if (match) prof.set(match, Math.max(prof.get(match) || 0, rank));
    }
    return prof;
}

/**
 * Computes skills and returns { skills, diff } where diff preserves any raw overrides.
 */
export function computeSkills(raw, abilities, { isPlayer = false } = {}) {
    const abilityMods = computeAbilityMods(abilities);
    const base = {};
    const diff = {};

    const overrides = raw?.skill || {};
    const pb = isPlayer ? proficiencyBonus(raw) : 0;
    const skillProf = isPlayer ? resolveSkillProficiency(raw) : new Map();

    for (const [skill, ability] of Object.entries(SKILL_ABILITY)) {
        const overrideVal = overrides[skill] ?? overrides[skill.replace(/\s+/g, "")];
        const parsedOverride = overrideVal != null ? toNumber(overrideVal) : null;

        const abilityMod = abilityMods[ability] ?? mod(abilities[ability]);
        const rank = skillProf.get(skill) || 0;
        const computed = abilityMod + (isPlayer ? pb * rank : 0);

        if (parsedOverride != null && !isPlayer) {
            diff[skill] = parsedOverride - computed;
            base[skill] = parsedOverride;
        } else {
            base[skill] = computed + (parsedOverride != null && isPlayer ? parsedOverride - computed : 0);
        }
    }

    return { skills: base, skillOverrideDiff: diff, proficiencyBonus: pb };
}

export function applySkillOverrides(newAbilities, raw, prevDiff, { isPlayer = false } = {}) {
    const abilityMods = computeAbilityMods(newAbilities);
    const pb = isPlayer ? proficiencyBonus(raw) : 0;
    const skillProf = isPlayer ? resolveSkillProficiency(raw) : new Map();
    const skills = {};

    for (const [skill, ability] of Object.entries(SKILL_ABILITY)) {
        const base = (abilityMods[ability] ?? mod(newAbilities[ability])) + (isPlayer ? pb * (skillProf.get(skill) || 0) : 0);
        const delta = prevDiff?.[skill] || 0;
        skills[skill] = base + delta;
    }

    return skills;
}