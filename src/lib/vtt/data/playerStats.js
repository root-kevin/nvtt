import { mod } from "$lib/vtt/5e/computeModifiers.js";

// Helper to resolve player ability scores from stats / bonusStats / overrideStats
// without affecting bestiary logic.

const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];

const STAT_MAP = {
    1: "str",
    2: "dex",
    3: "con",
    4: "int",
    5: "wis",
    6: "cha"
};

const SCORE_SUBTYPE_TO_ABILITY = {
    "strength-score": "str",
    "dexterity-score": "dex",
    "constitution-score": "con",
    "intelligence-score": "int",
    "wisdom-score": "wis",
    "charisma-score": "cha"
};

const SCORE_MAXIMUM_SUBTYPE_TO_ABILITY = {
    "strength-score-maximum": "str",
    "dexterity-score-maximum": "dex",
    "constitution-score-maximum": "con",
    "intelligence-score-maximum": "int",
    "wisdom-score-maximum": "wis",
    "charisma-score-maximum": "cha"
};

const SAVE_PROFICIENCY_SUBTYPE_TO_ABILITY = {
    "strength-saving-throws": "str",
    "dexterity-saving-throws": "dex",
    "constitution-saving-throws": "con",
    "intelligence-saving-throws": "int",
    "wisdom-saving-throws": "wis",
    "charisma-saving-throws": "cha"
};

function toLookup(list = []) {
    return Array.isArray(list)
        ? Object.fromEntries(
              list
                  .map((s) => {
                      const rawVal = s?.value;
                      if (rawVal === null || rawVal === undefined) return [s?.id, null];
                      const num = Number(rawVal);
                      return [s?.id, Number.isFinite(num) ? num : null];
                  })
                  .filter(([id, v]) => id != null && v !== null)
          )
        : {};
}

const listItems = (sheet = {}) => {
    const source = sheet?.data ?? sheet;
    const found = [];
    const seen = new Set();

    const looksLikeItem = (obj) => {
        if (!obj || typeof obj !== "object") return false;
        const def = obj.definition;
        if (!def || typeof def !== "object") return false;
        const hasMods =
            (Array.isArray(def.grantedModifiers) && def.grantedModifiers.length > 0) ||
            (Array.isArray(def.modifiers) && def.modifiers.length > 0) ||
            (Array.isArray(obj.modifiers) && obj.modifiers.length > 0);
        return hasMods;
    };

    const walk = (node) => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) {
            node.forEach(walk);
            return;
        }

        if (looksLikeItem(node)) {
            const key = node.id ?? node.definition?.id ?? node.definition?.definitionKey ?? `${found.length}-${Math.random()}`;
            if (!seen.has(key)) {
                seen.add(key);
                found.push(node);
            }
        }

        if (Array.isArray(node.items)) walk(node.items);
        if (Array.isArray(node.inventory)) walk(node.inventory);

        for (const val of Object.values(node)) {
            if (val && typeof val === "object") walk(val);
        }
    };

    walk(source);
    return found;
};

const isEquipped = (item) => item?.equipped === true || item?.isEquipped === true;
const requiresAttunement = (item) => item?.requiresAttunement === true || item?.definition?.canAttune === true;
const isItemAttuned = (item) => !requiresAttunement(item) || item?.isAttuned === true;

const getItemModifiers = (item) => {
    const defMods = Array.isArray(item?.definition?.grantedModifiers) ? item.definition.grantedModifiers : [];
    const defExtra = Array.isArray(item?.definition?.modifiers) ? item.definition.modifiers : [];
    const itemMods = Array.isArray(item?.modifiers) ? item.modifiers : [];
    return [...defMods, ...defExtra, ...itemMods];
};

const getModValue = (mod = {}) => {
    if (Number.isFinite(mod.fixedValue)) return mod.fixedValue;
    if (Number.isFinite(mod.value)) return mod.value;
    if (Number.isFinite(mod?.die?.fixedValue)) return mod.die.fixedValue;
    return null;
};

const emptyAbilityMap = () => ({ str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 });

const getBaseClassId = (sheet = {}) => {
    const source = sheet?.data ?? sheet;
    const classes = Array.isArray(source?.classes) ? source.classes : [];
    if (!classes.length) return null;
    const first = classes[0];
    return first?.definition?.id ?? first?.id ?? null;
};

const walkModifierTree = (node, apply, origin) => {
    if (!node) return;
    if (Array.isArray(node)) {
        node.forEach((n) => walkModifierTree(n, apply, origin));
        return;
    }
    if (typeof node !== "object") return;

    if (node.type && node.subType) apply(node, origin);
    if (Array.isArray(node.grantedModifiers)) walkModifierTree(node.grantedModifiers, apply, origin);
    if (Array.isArray(node.modifiers)) walkModifierTree(node.modifiers, apply, origin);

    for (const val of Object.values(node)) {
        if (val && typeof val === "object") walkModifierTree(val, apply, origin);
    }
};

function traverseModifierSources(sheet = {}, apply, { includeItemGroup = true, sourcePathsSeen } = {}) {
    const source = sheet?.data ?? sheet;
    const baseClassId = getBaseClassId(source);
    const classCount = Array.isArray(source?.classes) ? source.classes.length : 0;
    const modGroups = source?.modifiers;
    if (modGroups && typeof modGroups === "object") {
        for (const [groupKey, groupVal] of Object.entries(modGroups)) {
            if (!includeItemGroup && groupKey === "item") continue;
            if (groupKey === "class" && Array.isArray(source?.classes)) {
                source.classes.forEach((cls) => {
                    const classId = cls?.definition?.id ?? cls?.id ?? null;
                    walkModifierTree(cls, apply, {
                        source: "modifiers:class",
                        classId,
                        baseClassId,
                        classCount,
                        path: `modifiers.class`
                    });
                });
            } else {
                walkModifierTree(groupVal, apply, {
                    source: `modifiers:${groupKey}`,
                    baseClassId,
                    classCount,
                    path: `modifiers.${groupKey}`
                });
            }

        }
    }

    const classes = Array.isArray(source?.classes) ? source.classes : [];
    classes.forEach((cls, idx) => {
        const classId = cls?.definition?.id ?? cls?.id ?? null;
        const originBase = { source: "class", classId, baseClassId, classCount, classIndex: idx };

        walkModifierTree(cls, apply, { ...originBase, detail: "classRoot", path: `classes[${idx}]` });
        walkModifierTree(cls?.definition, apply, { ...originBase, detail: "classDefinition", path: `classes[${idx}].definition` });

        walkModifierTree(cls?.classFeatures, apply, { ...originBase, detail: "classFeatures", path: `classes[${idx}].classFeatures` });
        walkModifierTree(cls?.definition?.classFeatures, apply, { ...originBase, detail: "definition.classFeatures", path: `classes[${idx}].definition.classFeatures` });

        walkModifierTree(cls?.subclassDefinition, apply, { ...originBase, detail: "subclassDefinition", path: `classes[${idx}].subclassDefinition` });
        walkModifierTree(cls?.definition?.subclassDefinition, apply, { ...originBase, detail: "definition.subclassDefinition", path: `classes[${idx}].definition.subclassDefinition` });

        walkModifierTree(cls?.definition?.grantedModifiers, apply, { ...originBase, detail: "definition.grantedModifiers", path: `classes[${idx}].definition.grantedModifiers` });
        walkModifierTree(cls?.definition?.modifiers, apply, { ...originBase, detail: "definition.modifiers", path: `classes[${idx}].definition.modifiers` });
    });

    const nonItemSources = [
        source?.race,
        source?.subRace ?? source?.subrace,
        source?.class,
        source?.subClass ?? source?.subclass,
        source?.background,
        source?.feat ?? source?.feats
    ];
    nonItemSources.forEach((src, idx) => {
        const path =
            idx === 0 ? "race" :
            idx === 1 ? "subRace" :
            idx === 2 ? "class" :
            idx === 3 ? "subClass" :
            idx === 4 ? "background" :
            "feat";
        walkModifierTree(src, apply, { source: "non-item", baseClassId, classCount, path });
    });

    const items = listItems(source);
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!isEquipped(item)) continue;
        const mods = getItemModifiers(item);
        for (const mod of mods) {
            if (mod?.requiresAttunement === true && item?.isAttuned !== true) continue;
            walkModifierTree(mod, apply, {
                source: "item",
                itemMeta: {
                    definitionId: item?.definition?.id,
                    name: item?.definition?.name,
                    equipped: item?.equipped ?? item?.isEquipped,
                    isAttuned: item?.isAttuned
                },
                baseClassId,
                path: `items[${i}]`
            });
        }
    }
}

const getTotalCharacterLevel = (sheet = {}) => {
    const source = sheet?.data ?? sheet;
    if (Array.isArray(source?.classes)) {
        return source.classes.reduce((sum, cls) => {
            const lvl = Number(cls?.level);
            return sum + (Number.isFinite(lvl) ? lvl : 0);
        }, 0);
    }
    const lvl = Number(source?.level);
    return Number.isFinite(lvl) ? lvl : 0;
};

export const getProficiencyBonus = (sheet = {}) => {
    const level = Math.max(1, getTotalCharacterLevel(sheet) || 1);
    return 2 + Math.floor((level - 1) / 4);
};

function collectSaveBonuses(sheet = {}) {
    const sourceSheet = sheet?.data ?? sheet;
    const baseClassId = getBaseClassId(sourceSheet);
    const classCount = Array.isArray(sourceSheet?.classes) ? sourceSheet.classes.length : 0;
    const proficiency = new Map(); // ability -> highest rank (0.5,1,2)
    const bonusByAbility = emptyAbilityMap();
    let bonusAll = 0;
    const seen = new Set();
    const matches = [];
    const rejected = [];
    const sourcePathsSeen = new Set();

    const markPath = (origin = {}) => {
        if (origin?.path) {
            sourcePathsSeen.add(origin.path);
        }
    };

    const makeKey = (mod = {}) =>
        [
            mod?.id ?? "noid",
            (mod?.type || "").toLowerCase(),
            (mod?.subType || "").toLowerCase(),
            mod?.componentId ?? "",
            mod?.componentTypeId ?? "",
            mod?.entityId ?? "",
            mod?.entityTypeId ?? "",
            mod?.modifierTypeId ?? "",
            mod?.modifierSubTypeId ?? ""
        ].join("|");

    const shouldRejectForMulticlass = (mod, origin = {}, type, sub) => {
    if (!sub.endsWith("-saving-throws")) return false;

    const originClassCount = origin?.classCount ?? classCount;

    // If not multiclassed, always allow
    if (originClassCount <= 1) return false;

    const originClassId = origin?.classId ?? null;
    const originBaseClassId = origin?.baseClassId ?? baseClassId;

    // ❗ KEY RULE:
    // In multiclass characters, ONLY base-class save proficiencies apply.
    // If we can't confidently tie this modifier to the base class → reject.
    if (!originClassId || originClassId !== originBaseClassId) {
        rejected.push({
            reason: "non-base-class-saving-throw",
            type,
            subType: sub,
            origin
        });
        return true;
    }

    return false;
};


    const recordProficiency = (mod, origin, { type, sub, key }) => {
        const ability = SAVE_PROFICIENCY_SUBTYPE_TO_ABILITY[sub];
        if (!ability) return;
        const rank = type === "expertise" ? 2 : type === "half-proficiency" ? 0.5 : 1;
        markPath(origin);
        seen.add(key);
        const prev = proficiency.get(ability) || 0;
        const next = Math.max(prev, rank);
        if (next > prev) {
            /*console.log("[save-prof][ADD]", {
                ability,
                classId: origin?.classId ?? null,
                baseClassId,
                classCount,
                availableToMulticlass: mod?.availableToMulticlass
            });*/
        }
        proficiency.set(ability, next);
        matches.push({
            type,
            subType: sub,
            value: getModValue(mod),
            isGranted: mod.isGranted,
            restriction: mod.restriction,
            componentId: mod.componentId,
            componentTypeId: mod.componentTypeId,
            modifierTypeId: mod.modifierTypeId,
            modifierSubTypeId: mod.modifierSubTypeId,
            requiresAttunement: mod.requiresAttunement,
            origin,
            rank
        });
    };

    const apply = (mod, origin = {}) => {
        if (!mod || typeof mod !== "object") return;
        if (mod.isGranted === false) return;
        if (typeof mod.restriction === "string" && mod.restriction.trim()) return;
        const type = (mod.type || "").toLowerCase();
        const sub = (mod.subType || "").toLowerCase();
        if (!sub) return;

        const key = makeKey(mod);
        if (seen.has(key)) return;

        const normalizedOrigin = {
            ...origin,
            baseClassId: origin?.baseClassId ?? baseClassId,
            classCount: origin?.classCount ?? classCount
        };
        if (shouldRejectForMulticlass(mod, normalizedOrigin, type, sub)) return;

        if (type === "proficiency" || type === "half-proficiency" || type === "expertise") {
            const isClassOrigin =
                normalizedOrigin?.source === "class" ||
                normalizedOrigin?.source === "modifiers:class";
            if (!isClassOrigin) return;
            recordProficiency(mod, normalizedOrigin, { type, sub, key });
            return;
        }

        if (type !== "bonus") return;

        const val = getModValue(mod);
        if (!Number.isFinite(val)) return;

        if (sub === "saving-throws") {
            seen.add(key);
            markPath(normalizedOrigin);
            bonusAll += val;
            matches.push({
                type,
                subType: sub,
                value: val,
                isGranted: mod.isGranted,
                restriction: mod.restriction,
                componentId: mod.componentId,
                componentTypeId: mod.componentTypeId,
                modifierTypeId: mod.modifierTypeId,
                modifierSubTypeId: mod.modifierSubTypeId,
                requiresAttunement: mod.requiresAttunement,
                origin: normalizedOrigin
            });
            return;
        }

        const ability = SAVE_PROFICIENCY_SUBTYPE_TO_ABILITY[sub];
        if (!ability) return;
        seen.add(key);
        markPath(normalizedOrigin);
        bonusByAbility[ability] += val;
        matches.push({
            type,
            subType: sub,
            value: val,
            isGranted: mod.isGranted,
            restriction: mod.restriction,
            componentId: mod.componentId,
            componentTypeId: mod.componentTypeId,
            modifierTypeId: mod.modifierTypeId,
            modifierSubTypeId: mod.modifierSubTypeId,
            requiresAttunement: mod.requiresAttunement,
            origin: normalizedOrigin
        });
    };

    traverseModifierSources(sheet, apply, { includeItemGroup: true, sourcePathsSeen });

    return { proficiency, bonusAll, bonusByAbility, matches, rejected, sourcePathsSeen };
}

const DEBUG_SAVES = true;

export function resolvePlayerSavingThrows(sheet = {}, abilities = {}) {
    const sourceSheet = sheet?.data ?? sheet;
    const { proficiency, bonusAll, bonusByAbility, matches, rejected, sourcePathsSeen } = collectSaveBonuses(sourceSheet);
    const pb = getProficiencyBonus(sourceSheet);
    const classCount = Array.isArray(sourceSheet?.classes) ? sourceSheet.classes.length : 0;
    const saves = {};
    const abilityScores = {};
    const abilityMods = {};
    const characterValueBonuses = emptyAbilityMap();

    const characterValues = Array.isArray(sourceSheet?.characterValues) ? sourceSheet.characterValues : [];
    for (const cv of characterValues) {
        if (String(cv?.valueTypeId) !== "1472902489") continue; // Saving Throws
        const abil =
            cv?.valueId === "1" ? "str" :
            cv?.valueId === "2" ? "dex" :
            cv?.valueId === "3" ? "con" :
            cv?.valueId === "4" ? "int" :
            cv?.valueId === "5" ? "wis" :
            cv?.valueId === "6" ? "cha" :
            null;
        if (!abil) continue;
        const valNum = Number(cv?.value);
        if (Number.isFinite(valNum)) {
            characterValueBonuses[abil] += valNum;
        }
    }

    for (const ability of ABILITIES) {
        const score = Number(abilities?.[ability]);
        abilityScores[ability] = Number.isFinite(score) ? score : null;
        abilityMods[ability] = mod(score);

        let total = abilityMods[ability];
        const rank = proficiency.get(ability) || 0;
        if (rank) {
            total += rank === 0.5 ? Math.floor(pb / 2) : Math.floor(pb * rank);
        }
        total += bonusAll + (bonusByAbility[ability] ?? 0) + (characterValueBonuses[ability] ?? 0);
        saves[ability] = total;
    }

    /*console.log("[DEBUG SAVE PROF]", {
        detected: Array.from(proficiency.entries()),
        pb,
        classCount,
        sourcePathsSeen: Array.from(sourcePathsSeen)
    });*/
    if (rejected.length) {
        //console.log("[DEBUG SAVE PROF][REJECTED]", rejected);
    }

    if (DEBUG_SAVES) {
        const items = listItems(sourceSheet);
        const ringFound = items.some((it) => {
            const name = (it?.definition?.name || "").toLowerCase();
            const defId = it?.definition?.id;
            return defId === 4726 || name.includes("ring of protection");
        });
        /*console.log("[saves-debug] final", {
            itemCount: items.length,
            ringFound,
            bonusAll,
            abilityScores,
            abilityMods,
            proficiencyAbilities: Array.from(proficiency.entries()),
            itemSaveBonuses: { bonusAll, bonusByAbility },
            characterValueBonuses,
            matches,
            rejectedModifiers: rejected,
            saves,
            proficiencyBonus: pb
        });*/
    }

    return saves;
}

function collectAbilityScoreBonuses(sheet = {}) {
    const totals = { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 };
    const detectedMaximums = [];
    const seen = new Set();

    const apply = (mod) => {
        if (!mod || typeof mod !== "object") return;
        const type = (mod.type || "").toLowerCase();
        const sub = (mod.subType || "").toLowerCase();
        if (!sub) return;

        const maxKey = SCORE_MAXIMUM_SUBTYPE_TO_ABILITY[sub];
        if (maxKey) {
            detectedMaximums.push({ ability: maxKey, mod });
        }

        const abilityKey = SCORE_SUBTYPE_TO_ABILITY[sub];
        if (!abilityKey || type !== "bonus") return;

        const val = getModValue(mod);
        if (!Number.isFinite(val)) return;

        const key = mod?.id ?? `${type}:${sub}:${mod?.componentId ?? ""}:${mod?.entityId ?? ""}:${mod?.modifierTypeId ?? ""}:${mod?.modifierSubTypeId ?? ""}`;
        if (seen.has(key)) return;
        seen.add(key);
        totals[abilityKey] += val;
    };

    const walk = (node) => {
        if (!node) return;
        if (Array.isArray(node)) {
            node.forEach(walk);
            return;
        }
        if (typeof node !== "object") return;

        if (node.type && node.subType) apply(node);
        if (Array.isArray(node.grantedModifiers)) walk(node.grantedModifiers);
        if (Array.isArray(node.modifiers)) walk(node.modifiers);
        for (const val of Object.values(node)) {
            if (val && typeof val === "object") walk(val);
        }
    };

    const modGroups = sheet?.modifiers;
    if (modGroups && typeof modGroups === "object") {
        for (const [groupKey, groupVal] of Object.entries(modGroups)) {
            if (groupKey === "item") continue;
            walk(groupVal);
        }
    }

    const nonItemSources = [
        sheet?.race,
        sheet?.subRace,
        sheet?.classes,
        sheet?.class,
        sheet?.background,
        sheet?.feat ?? sheet?.feats
    ];
    nonItemSources.forEach((src) => walk(src));

    const items = listItems(sheet);
    for (const item of items) {
        if (!isEquipped(item)) continue;
        if (!isItemAttuned(item)) continue;
        const mods = getItemModifiers(item);
        for (const mod of mods) {
            if (mod?.requiresAttunement === true && !isItemAttuned(item)) continue;
            apply(mod);
        }
    }

    return { bonuses: totals, maximums: detectedMaximums };
}

export function resolvePlayerAbilities(sheet = {}, overrides = {}) {
    const baseStats = toLookup(sheet.stats);
    const bonusStats = toLookup(sheet.bonusStats);
    const overrideStats = toLookup(sheet.overrideStats);
    const overridePatch = toLookup(overrides.stats);
    const { bonuses: abilityScoreBonuses } = collectAbilityScoreBonuses(sheet);

    const abilities = {};

    Object.entries(STAT_MAP).forEach(([idStr, key]) => {
        const id = Number(idStr);
        const manual =
            Number.isFinite(overridePatch[id]) ? overridePatch[id] :
            Number.isFinite(overrideStats[id]) ? overrideStats[id] :
            null;

        if (Number.isFinite(manual)) {
            abilities[key] = manual;
            return;
        }

        const base = baseStats[id];
        const bonus = bonusStats[id];
        const scoreMods = abilityScoreBonuses[key] ?? 0;
        const hasBase = Number.isFinite(base);
        const total = (hasBase ? base : 0) + (Number.isFinite(bonus) ? bonus : 0) + scoreMods;

        abilities[key] = hasBase || scoreMods !== 0 || Number.isFinite(bonus) ? total : null;
    });

    return abilities;
}

export function resolvePlayerAC(sheet = {}, abilities = {}) {
    const sourceSheet = sheet?.data ?? sheet;
    const dex = Number.isFinite(abilities.dex) ? abilities.dex : 0;
    const dexMod = Math.floor((dex - 10) / 2);

    const items = listItems(sourceSheet);

    const equippedItems = items.filter((item) => item?.equipped === true || item?.isEquipped === true);
    const getDefinition = (item) => item?.definition || {};

    const isShield = (item) => {
        const def = getDefinition(item);
        const name = (def?.name || def?.baseArmorName || def?.baseItemName || def?.type || "").toLowerCase();
        return def?.armorTypeId === 4 || name.includes("shield");
    };

    const isArmor = (item) => {
        const def = getDefinition(item);
        const armorTypeId = def?.armorTypeId;
        if (armorTypeId === 1 || armorTypeId === 2 || armorTypeId === 3) return true;
        const baseName = (def?.baseArmorName || "").toLowerCase();
        const type = (def?.type || "").toLowerCase();
        const filterType = (def?.filterType || "").toLowerCase();
        const isArmorLike = baseName.includes("armor") || type === "armor" || filterType === "armor";
        return isArmorLike && !isShield(item);
    };

    const wearingArmor = equippedItems.some((item) => isArmor(item));
    const shieldItems = equippedItems.filter((item) => isShield(item));

    const equippedArmors = equippedItems.filter((item) => isArmor(item));
    const chosenArmor = equippedArmors.reduce((best, item) => {
        const def = getDefinition(item);
        const acVal = Number(def?.armorClass);
        if (!Number.isFinite(acVal)) return best;
        if (!best) return item;
        const bestAc = Number(getDefinition(best)?.armorClass);
        return acVal > (Number.isFinite(bestAc) ? bestAc : -Infinity) ? item : best;
    }, null);

    const armorDef = chosenArmor ? getDefinition(chosenArmor) : {};
    const armorTypeId = armorDef?.armorTypeId;
    const baseAc = Number.isFinite(armorDef?.armorClass) ? armorDef.armorClass : 10;

    let dexContribution = dexMod;
    if (chosenArmor) {
        if (armorTypeId === 2) {
            dexContribution = Math.min(dexMod, 2);
        } else if (armorTypeId === 3) {
            dexContribution = 0;
        } else {
            dexContribution = dexMod;
        }
    }

    let ac = baseAc + dexContribution;

    if (chosenArmor && isItemAttuned(chosenArmor)) {
        const armorMods = getItemModifiers(chosenArmor);
        for (const mod of armorMods) {
            if (mod?.type !== "bonus" || mod?.subType !== "armor-class") continue;
            const val = getModValue(mod);
            if (Number.isFinite(val)) {
                ac += val;
            }
        }
    }

    const shieldBonus = shieldItems.reduce((best, item) => {
        if (!isItemAttuned(item)) return best;
        const def = getDefinition(item);
        const base = Number.isFinite(def?.armorClass) ? def.armorClass : 0;
        let total = base;

        const mods = getItemModifiers(item);
        for (const mod of mods) {
            if (mod?.type !== "bonus" || mod?.subType !== "armor-class") continue;
            const val = getModValue(mod);
            if (Number.isFinite(val)) {
                total += val;
            }
        }

        return total > best ? total : best;
    }, 0);
    ac += shieldBonus;

    for (const item of equippedItems) {
        if (item === chosenArmor || isShield(item)) continue;
        if (!isItemAttuned(item)) continue;

        const mods = getItemModifiers(item);
        for (const mod of mods) {
            if (mod?.type !== "bonus") continue;
            const val = getModValue(mod);
            if (!Number.isFinite(val)) continue;

            if (mod?.subType === "armor-class") {
                ac += val;
            } else if (mod?.subType === "unarmored-armor-class") {
                if (!wearingArmor && shieldItems.length === 0) {
                    ac += val;
                }
            }
        }
    }

    const characterValues = Array.isArray(sourceSheet.characterValues) ? sourceSheet.characterValues : [];
    for (const cv of characterValues) {
        if (cv?.typeId === 2) {
            const val = Number(cv?.value);
            if (Number.isFinite(val)) {
                ac += val;
            }
        }
    }

    return ac;
}
