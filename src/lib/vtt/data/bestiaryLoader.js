// src/lib/vtt/data/bestiaryLoader.js
// Loads 5eTools monsters and normalizes into species templates.

import { inferLabelFromFeet } from "$lib/vtt/tokens/size.js";
import { sanitizeTemplateDeep } from "$lib/vtt/tokens/library.js";
import { extractAc } from "$lib/vtt/tokens/acUtils.js";

const modules = import.meta.glob("/src/lib/data/bestiary/bestiary-*.json");

export const bestiaryIndex = {};

let cached = null;

function clone(value) {
    if (value == null) return value;
    try {
        return structuredClone(value);
    } catch {
        try {
            return JSON.parse(JSON.stringify(value));
        } catch {
            return value;
        }
    }
}

const SIZE_FEET = {
    T: 2.5,
    S: 5,
    M: 5,
    L: 10,
    H: 15,
    G: 20,
    C: 30
};

const SIZE_LABEL = {
    T: "Tiny",
    S: "Small",
    M: "Medium",
    L: "Large",
    H: "Huge",
    G: "Gargantuan",
    C: "Colossal"
};

function parseHP(hp) {
    if (!hp) return null;
    if (typeof hp.average === "number") return hp.average;
    if (typeof hp.hp === "number") return hp.hp;
    if (typeof hp === "number") return hp;
    return null;
}

function normalizeType(typeField) {
    let race = "";
    let cls = "";
    if (typeof typeField === "string") {
        race = typeField;
    } else if (typeField && typeof typeField === "object") {
        if (typeof typeField.type === "string") {
            race = typeField.type;
        }
        if (Array.isArray(typeField.tags) && typeField.tags.length) {
            cls = typeField.tags.join(" / ");
        }
    }
    return { race, cls };
}

function tokenUrl(mon) {
    try {
        const source = (mon.source || "MM").replace(/^X/, "");
        const name = encodeURIComponent(mon.name || "token");
        return `https://5e.tools/img/bestiary/tokens/${source}/${name}.webp`;
    } catch {
        return "/tokens/default.png";
    }
}

function slugify(str = "") {
    return str
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "") || "creature";
}

function makeStableId(mon) {
    const base = `${mon.name}-${mon.source || "src"}`;
    const hash = Array.from(base)
        .reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0)
        .toString(16)
        .replace(/-/g, "");

    return `bestiary-${slugify(mon.name)}-${slugify(mon.source || "src")}-${hash}`;
}

function toTemplate(mon) {
    const letter = Array.isArray(mon.size) ? mon.size[0] : mon.size;
    const sizeFeet = SIZE_FEET[letter] ?? 5;
    const sizeLabel = SIZE_LABEL[letter] ?? inferLabelFromFeet(sizeFeet);

    // Sanitize incoming bestiary creature but keep the full statblock intact.
    const sanitized = clone(mon);
    sanitized.name = mon.name || "Unknown";
    sanitized.type = mon.type || "unknown";
    sanitized.cr = mon.cr ?? null;
    sanitized.source = mon.source || "";
    sanitized.hp =
        (mon.hp && typeof mon.hp === "object")
            ? clone(mon.hp)
            : { average: parseHP(mon.hp) ?? 1 };
    const { ac: parsedAc } = extractAc(mon.ac);
    sanitized.ac = Array.isArray(mon.ac) && mon.ac.length
        ? clone(mon.ac)
        : [{ ac: parsedAc ?? 10 }];
    sanitized.speed = clone(mon.speed || {});

    const id = makeStableId(mon);
    bestiaryIndex[id] = clone(sanitized);

    const flatHp = sanitized.hp?.average ?? 1;
    const { ac: flatAc } = extractAc(sanitized.ac);
    const { race, cls } = normalizeType(sanitized.type);

    let cr = null;
    if (typeof sanitized.cr === "string" || typeof sanitized.cr === "number") {
        cr = sanitized.cr;
    } else if (sanitized.cr && typeof sanitized.cr === "object") {
        cr = sanitized.cr.cr ?? null;
    }
    const source = sanitized.source || "";

    const rawTemplate = {
        id,
        name: sanitized.name,
        img: tokenUrl(sanitized),
        sizeFeet,
        sizeLabel,
        race,
        class: cls,
        source,
        cr,
        maxHp: flatHp,
        hp: flatHp,
        ac: flatAc,
        speed: clone(sanitized.speed || null),
        abilities: {
            str: sanitized.str ?? null,
            dex: sanitized.dex ?? null,
            con: sanitized.con ?? null,
            int: sanitized.int ?? null,
            wis: sanitized.wis ?? null,
            cha: sanitized.cha ?? null
        },
        saves: clone(sanitized.save || null),
        skills: clone(sanitized.skill || null),
        bestiary: clone(sanitized),
        overrides: {},
        consistentHp: false,
        templateSource: "species"
    };

    return sanitizeTemplateDeep(rawTemplate);
}

export function getBestiaryEntry(id) {
    return bestiaryIndex[id] || null;
}

export async function loadBestiary() {
    if (cached) return cached;

    const loaders = Object.values(modules);

    const results = await Promise.all(
        loaders.map(async loader => {
            try {
                const mod = await loader();
                const data = mod?.default ?? mod;
                return Array.isArray(data.monster) ? data.monster : [];
            } catch (err) {
                console.warn("Failed to load bestiary file", err);
                return [];
            }
        })
    );

    const monsters = results.flat();
    cached = monsters.map(mon => toTemplate(mon));
    return cached;
}

export function bestiaryToTemplate(mon) {
    return toTemplate(mon);
}
