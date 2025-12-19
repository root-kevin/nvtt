// Loader for DNDBeyond character JSON files stored in src/lib/data/players.
// Transforms each character into a token template for the library.

import {
    resolvePlayerAbilities,
    resolvePlayerSavingThrows
} from "$lib/vtt/data/playerStats.js";

const modules = import.meta.glob("/src/lib/data/players/*.json");

function slugify(str = "") {
    return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "character";
}

function makeShortName(name = "") {
    const parts = (name || "").match(/[A-Za-z0-9]+/g) || [];
    const letters = parts.map((p) => p[0].toUpperCase()).join("");
    return letters || (name || "").slice(0, 1).toUpperCase() || "";
}

function statValue(player, id) {
    const match = Array.isArray(player?.stats) ? player.stats.find((s) => s.id === id) : null;
    return typeof match?.value === "number" ? match.value : null;
}

function findArmorClass(player) {
    if (typeof player?.overrideArmorClass === "number") return player.overrideArmorClass;
    if (typeof player?.armorClass === "number") return player.armorClass;

    let found = null;
    function scan(obj) {
        if (!obj || typeof obj !== "object" || found !== null) return;
        if (Object.prototype.hasOwnProperty.call(obj, "armorClass") && typeof obj.armorClass === "number") {
            found = obj.armorClass;
            return;
        }
        if (Object.prototype.hasOwnProperty.call(obj, "overrideArmorClass") && typeof obj.overrideArmorClass === "number") {
            found = obj.overrideArmorClass;
            return;
        }
        for (const val of Object.values(obj)) {
            if (typeof val === "object") scan(val);
        }
    }
    scan(player);
    return found;
}

function classSummary(player) {
    if (!Array.isArray(player?.classes)) return { summary: "", level: null };
    const parts = [];
    let total = 0;
    for (const cls of player.classes) {
        const level = cls?.level ?? 0;
        total += level;
        const name = cls?.definition?.name || "Class";
        parts.push(`${name}${level ? ` ${level}` : ""}`);
    }
    return { summary: parts.join(", "), level: total || null };
}

function resolveRace(player) {
    return (
        player?.race?.fullName ||
        player?.race?.raceName ||
        player?.race?.baseRaceName ||
        player?.race?.fullText ||
        ""
    );
}

function buildSearchText(player, race, cls) {
    return [player?.name, race, cls, player?.readonlyUrl].filter(Boolean).join(" ").toLowerCase();
}

function toTemplate(player, gridSizePx = 64) {
    if (!player) return null;
    player.characterData = true;
    const name = player.name || `Character ${player.id ?? ""}`.trim() || "Player";
    const id = `pc-${player.id ?? slugify(name)}`;
    const race = resolveRace(player);
    const { summary: classText, level } = classSummary(player);
    const ac = findArmorClass(player);
    const baseHp = player.overrideHitPoints ?? player.baseHitPoints ?? null;
    const bonusHp = player.bonusHitPoints ?? 0;
    const maxHp = baseHp != null ? baseHp + bonusHp : null;
    const img =
        player?.decorations?.avatarUrl ||
        player?.decorations?.frameAvatarUrl ||
        player?.decorations?.backdropAvatarUrl ||
        "/tokens/player.png";

    const payload = (() => {
        const b = player?.bestiary;
        if (b && ((Array.isArray(b.stats) && b.stats.length) || b.baseHitPoints != null)) return b;
        return player;
    })();

    const char = structuredClone(payload || {});

    const sheet = {
        ...char,
        stats: char.stats ?? [],
        bonusStats: char.bonusStats ?? [],
        overrideStats: char.overrideStats ?? [],
        inventory: char.inventory ?? char.items ?? [],
        abilities: {},
        saves: {}
    };

    sheet.abilities = resolvePlayerAbilities(sheet, {});
    sheet.saves = resolvePlayerSavingThrows(char, sheet.abilities);

    const template = {
        id,
        name,
        shortName: makeShortName(name),
        race,
        class: classText,
        level,
        alignment: "",
        type: "Player Character",
        ac,
        maxHp,
        initiative: statValue(player, 2),
        str: statValue(player, 1),
        dex: statValue(player, 2),
        con: statValue(player, 3),
        int: statValue(player, 4),
        wis: statValue(player, 5),
        cha: statValue(player, 6),
        allegiance: "ally",
        img,
        size: gridSizePx,
        templateSource: "player",
        characterId: player.id ?? null,
        consistentHp: true,
        searchText: buildSearchText(player, race, classText),
        bestiary: char,
        sheet,
        player,
        characterData: true
    };

    template.abilities = sheet.abilities;
    template.saves = sheet.saves;

    return template;
}

export async function loadPlayers(gridSizePx = 64) {
    const loaders = Object.values(modules);
    const results = await Promise.all(
        loaders.map(async (load) => {
            try {
                const mod = await load();
                const raw = mod?.default ?? mod;
                const player = raw?.data ?? raw;
                if (player && typeof player === "object") player.characterData = true;
                return toTemplate(player, gridSizePx);
            } catch (err) {
                console.warn("Failed to load player file", err);
                return null;
            }
        })
    );
    return results.filter(Boolean);
}

export const playerToTemplate = toTemplate;
