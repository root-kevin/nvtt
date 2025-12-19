export const SKILL_ABILITY = {
    athletics: "str",

    "acrobatics": "dex",
    "sleight of hand": "dex",
    stealth: "dex",

    arcana: "int",
    history: "int",
    investigation: "int",
    nature: "int",
    religion: "int",

    "animal handling": "wis",
    insight: "wis",
    medicine: "wis",
    perception: "wis",
    survival: "wis",

    deception: "cha",
    intimidation: "cha",
    performance: "cha",
    persuasion: "cha"
};

export function abilityMod(score) {
    if (!score && score !== 0) return 0;
    return Math.floor((score - 10) / 2);
}

export function getSkillModifier(skillName, token, sheet) {
    const normalized = skillName.toLowerCase();

    // Rule A: bestiary skill block ALWAYS wins
    const skillBlock = token?.skill || sheet?.skill;
    if (skillBlock && skillBlock[normalized] != null) {
        // Convert "+5" → 5, "-2" → -2
        return parseInt(skillBlock[normalized]);
    }

    // Rule B: fallback to ability modifier
    const ability = SKILL_ABILITY[normalized];
    const abilityScore = token?.[ability] ?? sheet?.[ability];
    return abilityMod(abilityScore);
}

export default {
    SKILL_ABILITY,
    abilityMod,
    getSkillModifier
};
