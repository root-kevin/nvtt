export function toShorthand(str = "") {
    return str
        .split(/\s+/)
        .map(w => w[0]?.toUpperCase() || "")
        .join("");
}

function escapeRegExp(str = "") {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildMatchPattern(baseName = "") {
    return new RegExp(`^${escapeRegExp(baseName)}(?:\\s*(\\d+))?$`);
}
// Strip trailing number: "Zombie 2" → "Zombie"
export function baseName(str = "") {
    return str.replace(/\s+\d+$/, "").trim();
}

// Extract number if present: "Zombie 2" → 2
export function extractIndex(str = "") {
    const m = str.match(/(\d+)$/);
    return m ? Number(m[1]) : null;
}

// Build final display name with or without shorthand
export function buildDisplayName(name, index, shorthandOn) {
    const raw = shorthandOn ? toShorthand(name) : name;
    return index ? `${raw}${index}` : raw;
}

// Determine the next token name for a spawn and any renames needed for existing copies.
export function assignTokenNameForSpawn(baseName = "", existingTokensOnMap = []) {
    const base = (baseName || "Token").trim();
    const pattern = buildMatchPattern(base);
    const siblings = Array.isArray(existingTokensOnMap)
        ? existingTokensOnMap.map(t => ({ ...t }))
        : [];

    const matches = siblings
        .map(token => {
            const match = (token?.name ?? "").match(pattern);
            return match ? { token, suffix: match[1] ? Number(match[1]) : 0 } : null;
        })
        .filter(Boolean);

    if (!matches.length) {
        return { updatedTokens: siblings, newName: base };
    }

    const numberedSuffixes = matches
        .map(entry => entry.suffix)
        .filter(n => n > 0);

    if (numberedSuffixes.length) {
        const maxSuffix = Math.max(...numberedSuffixes);
        return { updatedTokens: siblings, newName: `${base} ${maxSuffix + 1}` };
    }

    // Exactly one unnumbered match → rename it to "<base> 1", new token "<base> 2"
    const zeroSuffixMatches = matches.filter(entry => entry.suffix === 0);
    if (zeroSuffixMatches.length === 1) {
        const targetId = zeroSuffixMatches[0].token.id;
        const updatedTokens = siblings.map(t =>
            t.id === targetId ? { ...t, name: `${base} 1` } : t
        );
        return { updatedTokens, newName: `${base} 2` };
    }

    // Multiple unnumbered matches but no numbered copies yet: leave existing names untouched.
    return { updatedTokens: siblings, newName: `${base} ${zeroSuffixMatches.length + 1}` };
}
