function cleanName(name) {
    if (typeof name !== "string") return "";
    return name.replace(/\{@spell\s+([^}]+)\}/g, "$1").trim();
}

function spellcastingFromBestiary(raw) {
    if (!Array.isArray(raw?.spellcasting)) return [];
    return raw.spellcasting.map((sc) => {
        const spellsByLevel = {};
        const slots = {};
        if (sc.spells) {
            for (const [lvl, data] of Object.entries(sc.spells)) {
                spellsByLevel[lvl] = (data?.spells || []).map(cleanName);
                slots[lvl] = data?.slots ?? null;
            }
        }
        return {
            header: sc.name || "Spellcasting",
            headerEntries: sc.headerEntries || [],
            spellsByLevel,
            slots
        };
    });
}

function spellcastingFromPlayer(raw) {
    const blocks = [];
    const spellsByLevel = {};
    const slots = {};

    if (Array.isArray(raw?.spellSlots)) {
        for (const entry of raw.spellSlots) {
            if (entry?.level == null) continue;
            slots[entry.level] = entry.available ?? entry.max ?? entry.override ?? entry.slotCount ?? null;
        }
    }

    // Gather spells from DDB "spells" object (race/class/etc.)
    const buckets = raw?.spells || {};
    const sources = ["race", "class", "background", "item", "feat"];
    for (const src of sources) {
        const list = buckets[src];
        if (!Array.isArray(list)) continue;
        for (const spell of list) {
            const def = spell?.definition || spell;
            const lvl = def?.level ?? 0;
            const arr = (spellsByLevel[lvl] = spellsByLevel[lvl] || []);
            if (def?.name) arr.push(def.name);
        }
    }

    blocks.push({
        header: "Spellcasting",
        spellsByLevel,
        slots
    });

    return blocks;
}

export function extractSpells(raw, { isPlayer = false } = {}) {
    if (!raw) return [];
    if (isPlayer || raw?.characterData) return spellcastingFromPlayer(raw);
    return spellcastingFromBestiary(raw);
}
