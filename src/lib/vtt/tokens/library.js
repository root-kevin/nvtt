import { writable } from "svelte/store";
import { normalizeSheet } from "$lib/vtt/5e/normalizeSheet.js";
import { extractAc } from "$lib/vtt/tokens/acUtils.js";
import { defaultVision } from "$lib/vtt/tokens/defaultVision.js";

export const tokenLibrary = writable([]);

function baseMaxFromTemplate(t = {}) {
    const hp = t.overrides?.hp || {};
    const bestiaryHp = t.bestiary?.hp || {};
    const bestiaryMax =
        typeof bestiaryHp.average === "number"
            ? bestiaryHp.average
            : typeof bestiaryHp.hp === "number"
                ? bestiaryHp.hp
                : typeof bestiaryHp.maxHp === "number"
                    ? bestiaryHp.maxHp
                    : null;

    return hp.baseMaxHp ?? t.maxHp ?? bestiaryMax ?? t.hp ?? null;
}
function currentFromTemplate(t = {}) {
    if (!t.consistentHp) return null;
    const hp = t.overrides?.hp || {};
    const baseMax = baseMaxFromTemplate(t);
    return hp.currentHp ?? baseMax;
}
function tempFromTemplate(t = {}) {
    if (!t.consistentHp) return 0;
    const hp = t.overrides?.hp || {};
    return hp.tempHp ?? 0;
}
function acFromTemplate(t = {}) {
    if (t.overrides?.ac != null) return t.overrides.ac;
    if (t.ac != null) return t.ac;
    const b = t.bestiary;
    const { ac } = extractAc(b?.ac);
    return ac;
}

export const TEMPLATE_ALLOWED_KEYS = [
    "id",
    "name",
    "img",
    "bestiary",
    "overrides",
    "templateSource",
    "baseTemplateId",
    "originalName",
    "notes",
    "sizeFeet",
    "sizeLabel",
    "maxHp",
    "hp",
    "ac",
    "speed",
    "race",
    "class",
    "abilities",
    "skills",
    "saves",
    "passives",
    "consistentHp",
    "customized",
    "vision"
];

export function sanitizeTemplateDeep(t = {}) {
    const bestiary = t.bestiary || t.sheet || null;
    const overrides = t.overrides || {};
    const hpOvr = overrides.hp || {};
    const consistent = t.consistentHp ?? false;
    const bestiaryHp = bestiary?.hp || {};
    const bestiaryMax =
        typeof bestiaryHp.average === "number"
            ? bestiaryHp.average
            : typeof bestiaryHp.hp === "number"
                ? bestiaryHp.hp
                : typeof bestiaryHp.maxHp === "number"
                    ? bestiaryHp.maxHp
                    : null;

    const flatMaxHp = hpOvr.baseMaxHp ?? t.maxHp ?? bestiaryMax ?? t.hp ?? null;
    const flatAc = acFromTemplate(t);
    const flatRace = bestiary?.type ?? t.race ?? "";
    const flatClass = t.class ?? "";

    const cleanedHp = consistent
        ? {
              baseMaxHp: hpOvr.baseMaxHp ?? flatMaxHp ?? null,
              currentHp: hpOvr.currentHp ?? flatMaxHp ?? null,
              tempHp: hpOvr.tempHp ?? 0
          }
        : hpOvr.baseMaxHp != null
            ? { baseMaxHp: hpOvr.baseMaxHp }
            : {};

    const cleanedOverrides = t.overrides ? structuredClone(t.overrides) : {};
    if (Object.keys(cleanedHp).length) {
        cleanedOverrides.hp = cleanedHp;
    } else if (cleanedOverrides.hp) {
        delete cleanedOverrides.hp;
    }

    return {
        id: t.id,
        name: t.name,
        img: t.img,
        bestiary: bestiary ? structuredClone(bestiary) : null,
        overrides: cleanedOverrides,
        templateSource: t.templateSource,
        baseTemplateId: t.baseTemplateId,
        originalName: t.originalName,
        notes: t.notes,
        sizeFeet: t.sizeFeet,
        sizeLabel: t.sizeLabel,
        maxHp: flatMaxHp ?? null,
        hp: flatMaxHp ?? null,
        ac: flatAc ?? null,
        speed: t.speed,
        abilities: t.abilities,
        skills: t.skills,
        saves: t.saves,
        passives: t.passives,
        race: flatRace,
        class: flatClass,
        consistentHp: consistent,
        customized: !!t.customized,
        vision: defaultVision(t.vision || {})  // ← NEW LINE
    };
}

function needsBestiaryHydrate(entry = {}) {
    if (entry?.templateSource !== "species" || !entry?.bestiary) return false;
    const b = entry.bestiary;
    const missingStats = ["str", "dex", "con", "int", "wis", "cha"].every((k) => b?.[k] == null);
    const missingSkills = b?.skill == null;
    const missingSaves = b?.save == null;
    const missingPassives = b?.passive == null && b?.passivePerception == null;
    return missingStats || missingSkills || missingSaves || missingPassives;
}

async function hydrateBestiaryFields(list = []) {
    if (!Array.isArray(list) || !list.length) return list;
    const shouldHydrate = list.some(needsBestiaryHydrate);
    if (!shouldHydrate) return list;

    let loadBestiary;
    let getBestiaryEntry;
    try {
        const mod = await import("$lib/vtt/data/bestiaryLoader.js");
        loadBestiary = mod.loadBestiary;
        getBestiaryEntry = mod.getBestiaryEntry;
    } catch (err) {
        console.warn("Bestiary hydration skipped; loader import failed", err);
        return list;
    }

    try {
        await loadBestiary();
    } catch (err) {
        console.warn("Bestiary hydration skipped; loadBestiary failed", err);
        return list;
    }

    return list.map((entry) => {
        if (!needsBestiaryHydrate(entry)) return entry;
        const fallback = getBestiaryEntry ? getBestiaryEntry(entry.id) : null;
        return fallback ? { ...entry, bestiary: structuredClone(fallback) } : entry;
    });
}

let loaded = false;

export async function loadLibraryFromServer() {
    if (loaded) return;
    loaded = true;

    try {
        const res = await fetch("/api/library");
        if (!res.ok) throw new Error("Failed to load library");

        const list = await res.json();

        const sanitized = list
            .filter(t => t && t.id)
            .map((t) => sanitizeTemplateDeep(t));

        const hydrated = await hydrateBestiaryFields(sanitized);

        const cleaned = hydrated.map((base) => {
            const sheet = base.bestiary
                ? normalizeSheet(
                      base.bestiary,
                      base.overrides || {},
                      { name: base.name, templateId: base.id, baseTemplateId: base.baseTemplateId || base.id }
                  )
                : null;
            return {
    ...base,
    vision: base.vision || defaultVision(),  // ← ADD THIS LINE
    maxHp: baseMaxFromTemplate(base),
    currentHp: currentFromTemplate(base),
    tempHp: tempFromTemplate(base),
    ac: acFromTemplate(base),
    race: base.bestiary?.type ?? base.race ?? "",
    class: base.class ?? "",
    sheet
};
        });

        tokenLibrary.set(cleaned);
    } catch (err) {
        console.warn("Library load failed:", err);
        tokenLibrary.set([]);
    }
}

async function persist(template) {
    if (!template?.id) return;

    try {
        await fetch("/api/library", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(template)
        });
    } catch (err) {
        console.warn("Library persist failed:", err);
    }
}

async function removePersist(id) {
    try {
        await fetch("/api/library", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id })
        });
    } catch (err) {
        console.warn("Library delete failed:", err);
    }
}

function isBookCode(src) {
    return typeof src === "string" && /^[A-Z]{2,5}$/i.test(src);
}

function isBestiarySource(src) {
    return typeof src === "string" && (
        src === "5etools" ||
        src === "bestiary" ||
        src === "player" ||
        isBookCode(src)
    );
}

function shouldAddTemplate(template, list) {
    if (!template?.id) return false;
    if (template.forceNewFromTemplate) return true;
    if (template.customized) return true;
    const baseId = template.baseTemplateId || template.id;
    const matchesBase = list.filter(t => (t.baseTemplateId || t.id) === baseId);
    if (!matchesBase.length) return true;
    const hasCustomized = matchesBase.some(t => t.customized);
    if (hasCustomized) return true; // will add a copy per rules
    return false;
}

export async function addTemplate(template) {
    if (!template?.id) return;

    await loadLibraryFromServer();

    tokenLibrary.update(list => {
        const baseId = template.baseTemplateId || template.id;
        const matchesBase = list.filter(t => (t.baseTemplateId || t.id) === baseId);
        const hasCustomized = matchesBase.some(t => t.customized);

        if (!shouldAddTemplate(template, list)) return list;

        const randomId = () => Math.random().toString(16).slice(2, 10);
        let candidate = template;

        if (template.forceNewFromTemplate) {
            candidate = {
                ...template,
                id: `custom-${baseId}-${randomId()}`,
                baseTemplateId: template.baseTemplateId || template.id,
                customized: true
            };
        } else if (hasCustomized) {
            candidate = {
                ...template,
                id: `${baseId}-copy-${randomId()}`,
                baseTemplateId: baseId,
                customized: false
            };
        } else {
            candidate = {
                ...template,
                baseTemplateId: baseId,
                customized: false
            };
        }

        const clean = sanitizeTemplateDeep(candidate);
        persist(clean);

        const sheet = clean.bestiary
            ? normalizeSheet(
                  clean.bestiary,
                  clean.overrides || {},
                  { name: clean.name, templateId: clean.id, baseTemplateId: clean.baseTemplateId || clean.id }
              )
            : null;

        return [
            ...list,
            {
    ...clean,
    vision: clean.vision || defaultVision(),  // ← ADD THIS
    sheet,
    maxHp: baseMaxFromTemplate(clean),
    currentHp: currentFromTemplate(clean),
    tempHp: tempFromTemplate(clean),
    ac: acFromTemplate(clean),
    race: clean.bestiary?.type ?? clean.race ?? "",
    class: clean.class ?? ""
}
        ];
    });
}

export async function replaceTemplate(template) {
    if (!template?.id) return;

    await loadLibraryFromServer();

    tokenLibrary.update(list => {
        const idx = list.findIndex(t => t.id === template.id);
        if (idx === -1) return list;
        if (list[idx]?.customized) return list;

        const clean = sanitizeTemplateDeep({ ...template, customized: true });
        persist(clean);

        const sheet = clean.bestiary
            ? normalizeSheet(
                  clean.bestiary,
                  clean.overrides || {},
                  { name: clean.name, templateId: clean.id, baseTemplateId: clean.baseTemplateId || clean.id }
              )
            : null;

        const next = [...list];
        next[idx] = {
    ...clean,
    vision: clean.vision || defaultVision(),  // ← ADD THIS
    sheet,
    maxHp: baseMaxFromTemplate(clean),
    currentHp: currentFromTemplate(clean),
    tempHp: tempFromTemplate(clean),
    ac: acFromTemplate(clean),
    race: clean.bestiary?.type ?? clean.race ?? "",
    class: clean.class ?? ""
};
        return next;
    });
}

export async function removeTemplateById(id) {
    if (!id) return;

    await loadLibraryFromServer();

    tokenLibrary.update(list => {
        const next = list.filter(t => t.id !== id);
        removePersist(id);
        return next;
    });
}

export function clearTemplates() {
    tokenLibrary.set([]);
}
