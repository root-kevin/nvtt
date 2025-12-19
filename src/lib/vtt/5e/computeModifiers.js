export function mod(score) {
    if (!score && score !== 0) return 0;
    return Math.floor((score - 10) / 2);
}

export function computeAbilityMods(abilities = {}) {
    const out = {};
    for (const [k, v] of Object.entries(abilities)) {
        out[k] = mod(v);
    }
    return out;
}

export function defaultAbilities() {
    return { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
}

export function parseAbilityBlock(raw) {
    if (!raw) return defaultAbilities();
    const statsMap = Array.isArray(raw?.stats)
        ? raw.stats.reduce((acc, stat) => {
              const id = stat?.id;
              const val = stat?.value;
              const key =
                  id === 1 ? "str" :
                  id === 2 ? "dex" :
                  id === 3 ? "con" :
                  id === 4 ? "int" :
                  id === 5 ? "wis" :
                  id === 6 ? "cha" :
                  null;
              if (key) acc[key] = val;
              return acc;
          }, {})
        : {};
    const abilities = {
        str: raw.str ?? raw.STR ?? statsMap.str ?? null,
        dex: raw.dex ?? raw.DEX ?? statsMap.dex ?? null,
        con: raw.con ?? raw.CON ?? statsMap.con ?? null,
        int: raw.int ?? raw.INT ?? statsMap.int ?? null,
        wis: raw.wis ?? raw.WIS ?? statsMap.wis ?? null,
        cha: raw.cha ?? raw.CHA ?? statsMap.cha ?? null
    };
    const merged = { ...defaultAbilities(), ...abilities };
    return merged;
}
