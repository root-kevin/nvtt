import { parseAbilityBlock, computeAbilityMods } from "./computeModifiers.js";
import { computeSkills, SKILL_ABILITY } from "./computeSkills.js";
import { computeSaves } from "./computeSaves.js";
import { computeHP } from "./computeHP.js";
import { extractSpells } from "./extractSpells.js";
import { extractAc } from "$lib/vtt/tokens/acUtils.js";

const DEFAULT_HP = 1;
const DEFAULT_AC = 10;

function clone(value) {
    if (value == null) return value;
    try {
        return structuredClone(value);
    } catch (err) {
        return JSON.parse(JSON.stringify(value));
    }
}

function applyOverrides(base, overrides = {}) {
    const out = Array.isArray(base) ? [...base] : { ...base };
    Object.entries(overrides || {}).forEach(([key, value]) => {
        if (value == null) return;
        if (typeof value === "object" && !Array.isArray(value)) {
            out[key] = applyOverrides(out[key] || {}, value);
        } else {
            out[key] = value;
        }
    });
    return out;
}

function formatTypeField(type) {
    if (!type) return null;
    if (typeof type === "string") return type;
    if (Array.isArray(type)) return type.map(formatTypeField).filter(Boolean).join(", ");
    if (typeof type === "object") {
        const base = type.type || type.name || "";
        const tags = Array.isArray(type.tags) ? type.tags.join(", ") : type.tags;
        const meta = type.meta ? ` (${type.meta})` : "";
        const tagPart = tags ? ` (${tags})` : "";
        return `${base}${meta || tagPart}`.trim();
    }
    return String(type);
}

export function formatEntryNode(node) {
    if (node == null) return "";
    if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
        return String(node);
    }
    if (Array.isArray(node)) {
        return node.map(formatEntryNode).filter(Boolean).join(" ");
    }
    if (typeof node === "object") {
        if (node.text) return formatEntryNode(node.text);
        if (node.entry) return formatEntryNode(node.entry);
        if (node.entries) {
            const body = formatEntryNode(node.entries);
            const header = node.name ? `${node.name}. ` : "";
            return `${header}${body}`.trim();
        }
        if (node.items) {
            return formatEntryNode(node.items);
        }
        if (node.type === "list" && node.items) {
            return formatEntryNode(node.items);
        }
        if (node.type === "item" && node.name) {
            const body = formatEntryNode(node.entry ?? node.entries ?? node.items);
            return `${node.name}${body ? `. ${body}` : ""}`.trim();
        }
        if (node.type === "table" && node.rows) {
            return node.rows
                .map((row) => (Array.isArray(row) ? row.map(formatEntryNode).join(" ") : formatEntryNode(row)))
                .filter(Boolean)
                .join(" | ");
        }
        if (node.special) return formatEntryNode(node.special);
        if (node.note) return formatEntryNode(node.note);
    }
    return JSON.stringify(node);
}

export function formatDamageArray(arr) {
    if (!arr) return "";
    const parts = [];
    const push = (v) => {
        const val = formatEntryNode(v);
        if (val) parts.push(val);
    };

    const walk = (value) => {
        if (!value) return;
        if (typeof value === "string" || typeof value === "number") {
            push(value);
            return;
        }
        if (Array.isArray(value)) {
            value.forEach(walk);
            return;
        }
        if (typeof value === "object") {
            if (value.special) {
                push(value.special);
                return;
            }
            const payload = value.resist ?? value.immune ?? value.vulnerable ?? value.value ?? value.type ?? value.damage;
            const core = formatEntryNode(payload);
            const noteParts = [];
            if (value.note) noteParts.push(value.note);
            if (value.preNote) noteParts.push(value.preNote);
            if (value.cond) noteParts.push("conditional");
            const suffix = noteParts.length ? ` (${noteParts.join("; ")})` : "";
            const combined = `${core}${suffix}`.trim();
            if (combined) push(combined);
            return;
        }
        push(value);
    };

    walk(arr);
    return parts.join("; ");
}

function normalizeEntries(rawList, overrideList) {
    const source = overrideList ?? rawList ?? [];
    const arr = Array.isArray(source) ? source : [source];
    return arr.map(formatEntryNode).filter(Boolean);
}

export function normalizeSheet(base = {}, overrides = {}, context = {}) {
    const raw = base || {};
    const ovr = overrides || {};

    // abilities (overrides are the only writable source)
    const baseAbilities = parseAbilityBlock(raw);
    const abilities = {
        str: ovr?.abilities?.str ?? baseAbilities.str,
        dex: ovr?.abilities?.dex ?? baseAbilities.dex,
        con: ovr?.abilities?.con ?? baseAbilities.con,
        int: ovr?.abilities?.int ?? baseAbilities.int,
        wis: ovr?.abilities?.wis ?? baseAbilities.wis,
        cha: ovr?.abilities?.cha ?? baseAbilities.cha
    };
    const abilityMods = computeAbilityMods(abilities);

    // skills (bestiary first, then overrides)
    const skillResult = computeSkills(raw, abilities, { isPlayer: raw?.characterData === true });
    const skills = applyOverrides(skillResult.skills, ovr.skills);
    Object.keys(SKILL_ABILITY).forEach((k) => {
        if (raw.skill?.[k] != null) {
            const parsed = parseInt(raw.skill[k], 10);
            skills[k] = Number.isFinite(parsed) ? parsed : skills[k];
        }
    });

    // saves
    const saveResult = computeSaves(raw, abilities, { isPlayer: raw?.characterData === true });
    const saves = applyOverrides(saveResult.saves, ovr.saves);

    // hp: prefer overrides baseMaxHp → bestiary average → legacy maxHp/hp → fallback
    const rawHp = raw?.hp || {};
    const overrideHp = ovr?.hp || {};
    const baseMaxHp =
        overrideHp.baseMaxHp ??
        (typeof rawHp.average === "number" ? rawHp.average : null) ??
        (typeof rawHp.maxHp === "number" ? rawHp.maxHp : null) ??
        (typeof rawHp.hp === "number" ? rawHp.hp : null) ??
        (typeof raw.maxHp === "number" ? raw.maxHp : null) ??
        (typeof raw.hp === "number" ? raw.hp : null) ??
        DEFAULT_HP;

    const maxHp = Math.max(1, baseMaxHp);
    const tempHp = 0;
    const clampedCurrent = Math.max(
        0,
        Math.min(
            overrideHp.currentHp != null ? overrideHp.currentHp : maxHp,
            maxHp
        )
    );

    // movement / speed
    const speed = applyOverrides(raw.speed || {}, ovr.speed);

    // ac (kept top-level and meta)
    const rawAc = ovr.ac != null ? ovr.ac : raw.ac;
    const { ac: parsedAc, from: acFrom } = extractAc(rawAc);
    const ac = parsedAc ?? DEFAULT_AC;

    // passives
    const passives = applyOverrides(
        {
            perception: raw?.passive ?? (skills.perception != null ? 10 + skills.perception : null),
            investigation: raw?.passiveInvestigation ?? (skills.investigation != null ? 10 + skills.investigation : null),
            insight: raw?.passiveInsight ?? (skills.insight != null ? 10 + skills.insight : null)
        },
        ovr.passives
    );

    // meta
    const meta = applyOverrides(
        {
            cr: raw.cr ?? null,
            type: formatTypeField(ovr.meta?.type ?? raw.type ?? raw.metaType),
            class: raw.class || null,
            race: raw.race || null,
            alignment: raw.alignment || null,
            environment: raw.environment || null,
            ac,
            acFrom,
            speed,
            source: raw.source || raw.templateSource || null,
            name: context.name || raw.name || null,
            baseTemplateId: context.baseTemplateId || raw.baseTemplateId || raw.id || null
        },
        ovr.meta
    );

    const defensesOverride = ovr.defenses || {};
    const defenses = {
        immune: defensesOverride.immune ?? ovr.immune ?? raw.immune ?? null,
        resist: defensesOverride.resist ?? ovr.resist ?? raw.resist ?? null,
        vulnerable: defensesOverride.vulnerable ?? ovr.vulnerable ?? raw.vulnerable ?? null,
        conditionImmune: defensesOverride.conditionImmune ?? ovr.conditionImmune ?? raw.conditionImmune ?? null
    };

    return {
        templateId: context.templateId || raw.id,
        abilities,
        abilityMods,
        skills,
        saves,
        senses: raw.senses || [],
        passives,
        hp: {
            maxHp,
            tempHp,
            currentHp: clampedCurrent
        },
        ac,
        defenses: {
            immune: formatDamageArray(defenses.immune) || null,
            resist: formatDamageArray(defenses.resist) || null,
            vulnerable: formatDamageArray(defenses.vulnerable) || null,
            conditionImmune: formatEntryNode(defenses.conditionImmune) || null
        },
        spellcastingBlocks: extractSpells(raw, { isPlayer: raw?.characterData === true }),
        trait: normalizeEntries(raw.trait, ovr.trait),
        action: normalizeEntries(raw.action, ovr.action),
        bonus: normalizeEntries(raw.bonus, ovr.bonus),
        reaction: normalizeEntries(raw.reaction, ovr.reaction),
        legendary: normalizeEntries(raw.legendary, ovr.legendary),
        lair: normalizeEntries(raw.lair, ovr.lair),
        regional: normalizeEntries(raw.regional, ovr.regional),
        meta: clone(meta),
        raw
    };
}

export { applyOverrides, formatTypeField as formatType };
